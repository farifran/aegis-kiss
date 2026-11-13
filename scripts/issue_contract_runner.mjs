#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import {
  buildErrorRejectionReport,
  buildRejectionReport,
  createRejectionError as rejection,
} from './lib/rejection_report.mjs';
import {
  assertDiscoveryUnchanged,
  clearSupersededRuntime,
  readCachedSkeleton,
  readConstitution,
  readPendingRevision,
  readPolicy,
  readPreflight,
  resolveRunnerPaths,
  validateContract,
  writeFileAtomic,
} from './lib/runner_runtime.mjs';
import { handleStatus, handleVerify } from './lib/runner_status.mjs';

const root = resolve(process.env.AEGIS_ROOT ?? fileURLToPath(new URL('..', import.meta.url)));
const paths = resolveRunnerPaths(root);
const semanticOpinionByteLimit = 262_144;

async function handleDraft(args, { emitHandoff = true, maxBytes = undefined } = {}) {
  const [
    { canonicalJson },
    { buildPreflightHandoff, captureDemand, observeWorkspace },
    { assertPreflightDocument },
  ] = await Promise.all([
    import('./lib/canonical_json.mjs'),
    import('./lib/issue_contract_core.mjs'),
    import('./lib/preflight_integrity.mjs'),
  ]);
  const demand = captureDemand(args, { maxBytes });
  const workspaceObservation = observeWorkspace(root, demand, {
    cachedWorkspaceSkeleton: await readCachedSkeleton(paths),
  });
  const { discovery, workspaceSkeleton } = workspaceObservation;
  const preflight = buildPreflightHandoff({ demand, discovery, version: 'v3' });
  assertPreflightDocument(preflight);
  const serializedPreflight = `${canonicalJson(preflight)}\n`;

  await clearSupersededRuntime(paths);
  await Promise.all([
    writeFileAtomic(paths.preflightJsonPath, serializedPreflight),
    writeFileAtomic(paths.skeletonJsonPath, `${canonicalJson(workspaceSkeleton)}\n`),
  ]);

  if (emitHandoff) {
    process.stdout.write(`${JSON.stringify({
      schema: preflight.schema,
      status: preflight.status,
      phase: preflight.phase,
      preflightDigest: preflight.preflightDigest,
      sourceSnapshotDigest: preflight.discovery.sourceSnapshotDigest,
      dataPath: '.harness/runtime/preflight.json',
    })}\n`);
  }
}

async function handleConfirmationRequest() {
  const [contract, preflight] = await Promise.all([
    readFile(paths.contractJsonPath, 'utf8').then(JSON.parse),
    readPreflight(paths),
  ]);
  await validateContract(paths, contract, preflight);
  const [{ canonicalJson }, { buildConfirmationRequest }] = await Promise.all([
    import('./lib/canonical_json.mjs'),
    import('./lib/semantic_approval.mjs'),
  ]);
  const request = buildConfirmationRequest(contract);
  await writeFileAtomic(paths.userConfirmationPath, `${canonicalJson(request)}\n`);
  process.stdout.write(`${canonicalJson(request)}\n`);
}

async function buildCurrentSemanticRequest() {
  const { buildSemanticRequest } = await import('./lib/semantic_request.mjs');
  const [preflight, loadedPolicy, constitution] = await Promise.all([
    readPreflight(paths),
    readPolicy(paths),
    readConstitution(paths),
  ]);
  const workspaceObservation = await assertDiscoveryUnchanged(paths, preflight);
  const revision = await readPendingRevision(
    paths,
    preflight,
    loadedPolicy,
    constitution,
    workspaceObservation,
  );
  const request = buildSemanticRequest({
    repositoryRoot: root,
    preflight,
    policy: loadedPolicy.policy,
    constitution,
    revision: revision?.request ?? null,
    workspaceObservation,
  });
  return {
    request,
    preflight,
    loadedPolicy,
    constitution,
    workspaceObservation,
    revision,
  };
}

async function handleSemanticRequest() {
  const { canonicalJson } = await import('./lib/canonical_json.mjs');
  const { request } = await buildCurrentSemanticRequest();
  process.stdout.write(`${canonicalJson(request)}\n`);
}

async function compileAndPersistSemanticOpinion(opinion, context, execution = null, preparedDraft = null) {
  const [
    { canonicalDigest, canonicalJson },
    {
      assertRevisionApplied,
      buildConfirmationRequest,
      compileSemanticContract,
      compileSemanticOpinion,
      renderSemanticContractMarkdown,
    },
  ] = await Promise.all([
    import('./lib/canonical_json.mjs'),
    import('./lib/semantic_contract.mjs'),
  ]);
  const {
    request,
    preflight,
    loadedPolicy,
    constitution,
    revision,
  } = context;
  let draft;
  try {
    draft = preparedDraft ?? compileSemanticOpinion(opinion, request);
  } catch (error) {
    if (error.message === 'semantic_opinion_evidence_mismatch') {
      throw rejection('SEMANTIC_CONTEXT_MISMATCH');
    }
    throw rejection('INVALID_SEMANTIC_OPINION', error.message);
  }
  if (revision !== null) {
    assertRevisionApplied(draft, revision.request, revision.sourceSpecification);
  }
  const contract = compileSemanticContract({
    repositoryRoot: root,
    draft,
    preflight,
    policy: loadedPolicy.policy,
    policyDigest: loadedPolicy.policyDigest,
    constitution,
    constitutionDigest: constitution.digest,
    humanResolutions: revision?.humanResolutions ?? [],
    semanticRevision: request.revision,
    semanticRequest: request,
  });

  await mkdir(paths.runtimeDir, { recursive: true });
  const writes = [
    writeFileAtomic(paths.contractJsonPath, `${canonicalJson(contract)}\n`),
    writeFileAtomic(paths.contractMdPath, `${renderSemanticContractMarkdown(contract, {
      policyRules: loadedPolicy.policy.rules,
    })}\n`),
    rm(paths.resolutionPath, { force: true }),
  ];
  if (execution !== null) {
    const { assertSchema } = await import('./lib/schema_validator.mjs');
    const receiptPayload = {
      schema: 'aegis.semantic_execution.v1',
      sourceSemanticRequestDigest: request.requestDigest,
      provider: execution.provider,
      model: execution.model,
      calls: execution.calls ?? 1,
      usage: execution.usage,
      opinionDigest: canonicalDigest(opinion),
    };
    const receipt = {
      ...receiptPayload,
      executionDigest: canonicalDigest(receiptPayload),
    };
    assertSchema('aegis.semantic_execution.v1', receipt);
    writes.push(writeFileAtomic(paths.semanticExecutionPath, `${canonicalJson(receipt)}\n`));
  } else {
    writes.push(rm(paths.semanticExecutionPath, { force: true }));
  }
  await Promise.all(writes);
  const confirmation = buildConfirmationRequest(contract, {
    workspaceSkeleton: preflight.discovery?.workspaceSkeleton ?? request.workspace?.workspaceSkeleton ?? null,
  });
  await writeFileAtomic(paths.userConfirmationPath, `${canonicalJson(confirmation)}\n`);
  process.stdout.write(`${canonicalJson(confirmation)}\n`);
  if (preparedDraft === null && process.env.AEGIS_TEST_AUTOMATION !== '1') {
    if (confirmation.questionCount > 0) {
      const qSummary = confirmation.questions
        .map((q) => `${q.id} (recomendado: ${q.recommendedAnswerId})`)
        .join(', ');
      process.stderr.write(
        `\n[AEGIS][PROTOCOL] DELIBERACAO_HUMANA_OBRIGATORIA (${confirmation.questionCount} decisão(ões): ${qSummary})\n`
        + '[AEGIS][PROTOCOL] 1. Apresente as perguntas ao usuário via ferramenta ask_question no chat destacando a recomendação KISS.\n'
        + '[AEGIS][PROTOCOL] 2. PARE e aguarde a resposta humana explícita (NUNCA responda pelo usuário — CONST-DECISIONS).\n'
        + '[AEGIS][PROTOCOL] 3. Após a escolha do usuário, execute apenas: ./aegis --resolve <questionId>=<answerId> (aplica preparedEffect e sela o contrato automaticamente).\n',
      );
    } else {
      process.stderr.write(
        '\n[AEGIS][PROTOCOL] APROVACAO_HUMANA_OBRIGATORIA (0 decisões pendentes)\n'
        + '[AEGIS][PROTOCOL] 1. Apresente o resumo do contrato (.harness/runtime/contract.md) ao usuário e solicite confirmação via ask_question ou resposta direta.\n'
        + '[AEGIS][PROTOCOL] 2. PARE e aguarde o consentimento humano explícito (CONST-DECISIONS).\n'
        + '[AEGIS][PROTOCOL] 3. Após a confirmação do usuário, execute: ./aegis --approve\n',
      );
    }
  }
}

async function handleSemanticCompile(args) {
  if (args.length !== 0) throw rejection('INVALID_SEMANTIC_COMPILE_ARITY');
  let opinion;
  try {
    let serializedDraft = '';
    let receivedBytes = 0;
    for await (const chunk of process.stdin) {
      receivedBytes += Buffer.byteLength(chunk);
      if (receivedBytes > semanticOpinionByteLimit) throw new Error('semantic_opinion_too_large');
      serializedDraft += chunk;
    }
    opinion = JSON.parse(serializedDraft);
  } catch (error) {
    throw rejection('INVALID_SEMANTIC_OPINION', error.message);
  }
  const context = await buildCurrentSemanticRequest();
  // Integrated transports bind their own response. External submissions must
  // carry custody evidence supplied by their caller, never inferred from text.
  if (opinion.sourceSemanticRequestDigest !== undefined) {
    if (opinion.sourceSemanticRequestDigest !== context.request.requestDigest) {
      throw rejection('SEMANTIC_CONTEXT_MISMATCH');
    }
    opinion = opinion.opinion;
  } else if (opinion.sourceEvidenceDigest === undefined) {
    throw rejection('SEMANTIC_CONTEXT_MISMATCH', 'external_opinion_requires_request_binding');
  }
  await compileAndPersistSemanticOpinion(opinion, context);
}

// Adaptive Semantic Scout (Arbiter): acionado exclusivamente sob Silêncio Léxico em repositórios > 96KB
async function applyAdaptiveSemanticScout(context, role, assertSemanticSupervisorReady) {
  if (role.channel !== 'API') return;
  const { shouldTriggerSemanticScout, executeSemanticScout } = await import('./lib/semantic_scout.mjs');
  if (!shouldTriggerSemanticScout({
    preflight: context.preflight,
    workspace: context.request.workspace,
  })) {
    return;
  }
  try {
    const readiness = assertSemanticSupervisorReady(role);
    const scoutResult = await executeSemanticScout({
      role,
      intent: context.preflight.intent,
      workspaceSkeleton: context.preflight.discovery.workspaceSkeleton,
      observedTextPaths: context.request.workspace.observedTextPaths,
      endpoint: readiness.endpoint,
      credential: readiness.credential,
    });
    if (scoutResult.relevantPaths.length > 0) {
      const { buildSemanticRequest } = await import('./lib/semantic_request.mjs');
      context.request = buildSemanticRequest({
        repositoryRoot: root,
        preflight: context.preflight,
        policy: context.loadedPolicy.policy,
        constitution: context.constitution,
        revision: context.revision?.request ?? null,
        workspaceObservation: context.workspaceObservation,
        explicitTargetPaths: scoutResult.relevantPaths,
      });
    }
  } catch {
    throw rejection('SEMANTIC_SCOUT_UNAVAILABLE', 'Repository scope could not be expanded; semantic contract generation stopped. Retry or provide explicit source evidence.');
  }
}

async function handleSemanticRun(args) {
  if (args.length !== 0) throw rejection('INVALID_SEMANTIC_RUN_ARITY');
  const context = await buildCurrentSemanticRequest();
  if (await compilePreparedRevision(context)) return;
  const [{ loadRoleAssignment, defaultRoleAssignment }, { assertSemanticSupervisorReady, requestSemanticOpinion }] = await Promise.all([
    import('./lib/role_assignment.mjs'),
    import('./lib/semantic_gateway.mjs'),
  ]);
  const assignment = (await loadRoleAssignment(root)) ?? defaultRoleAssignment();
  const role = assignment.roles.contractSupervisor;

  await applyAdaptiveSemanticScout(context, role, assertSemanticSupervisorReady);

  const invokeSupervisor = async (previousAttempt = null) => {
    if (role.channel === 'IDE') {
      if (role.adapter !== 'codex') throw rejection('SEMANTIC_IDE_ADAPTER_UNSUPPORTED', role.adapter);
      const { requestCodexSemanticOpinion } = await import('./lib/semantic_codex.mjs');
      return requestCodexSemanticOpinion(context.request, role, { previousAttempt });
    }
    assertSemanticSupervisorReady(role);
    return requestSemanticOpinion(context.request, role, { previousAttempt });
  };

  const attempt1 = await invokeSupervisor();
  try {
    await compileAndPersistSemanticOpinion(attempt1.opinion, context, {
      ...attempt1.execution,
      calls: 1,
    });
  } catch (error) {
    const isInvalidOpinion = error?.message === 'INVALID_SEMANTIC_OPINION' || error?.code === 'INVALID_SEMANTIC_OPINION';
    if (!isInvalidOpinion) throw error;
    const report = buildRejectionReport({
      phase: 'SEMANTIC',
      reason: error.message,
      detail: error.detail || '',
    });
    const diagnosticMessage = [
      `Código do erro: ${report.cause || report.reason}`,
      report.detail ? `Detalhe: ${report.detail}` : null,
      report.ruleId ? `Regra violada: ${report.ruleId}` : null,
      report.message ? `Diagnóstico: ${report.message}` : null,
      report.remediation ? `Como corrigir: ${report.remediation}` : null,
    ].filter(Boolean).join('\n');
    const attempt2 = await invokeSupervisor({
      opinion: attempt1.opinion,
      errorMessage: diagnosticMessage,
    });
    const cumulativeUsage = {
      inputTokens: (attempt1.execution.usage?.inputTokens ?? 0) + (attempt2.execution.usage?.inputTokens ?? 0),
      outputTokens: (attempt1.execution.usage?.outputTokens ?? 0) + (attempt2.execution.usage?.outputTokens ?? 0),
    };
    await compileAndPersistSemanticOpinion(attempt2.opinion, context, {
      ...attempt2.execution,
      calls: 2,
      usage: cumulativeUsage,
    });
  }
}

async function compilePreparedRevision(context) {
  if (context.revision === null) return false;
  const { hasPreparedAnswers, applyPreparedAnswers } = await import('./lib/prepared_effects.mjs');
  const { sourceSpecification, resolution, humanResolutions } = context.revision;
  if (!hasPreparedAnswers(sourceSpecification, resolution.answers)) return false;
  const draft = applyPreparedAnswers(
    sourceSpecification,
    resolution.answers,
    humanResolutions,
    context.request.intentEvidence,
    context.request.workspace?.sourceEvidence,
    context.request.workspace?.workspaceSkeleton ?? null,
  );
  draft.sourceContextDigest = context.request.contextDigest;
  draft.sourceEvidenceDigest = context.request.intentEvidence.evidenceDigest;
  await compileAndPersistSemanticOpinion(null, context, null, draft);
  return true;
}

async function emitIdeBriefing() {
  const [{ canonicalJson }, { semanticSupervisorInstructions }, { isFallbackOnlyEvidence }, { request, preflight }] = await Promise.all([
    import('./lib/canonical_json.mjs'),
    import('./lib/semantic_gateway.mjs'),
    import('./lib/source_evidence.mjs'),
    buildCurrentSemanticRequest(),
  ]);
  await writeFileAtomic(resolve(paths.runtimeDir, 'semantic-request.json'), `${canonicalJson(request)}\n`);
  const brief = {
    schema: preflight.schema,
    status: preflight.status,
    phase: preflight.phase,
    preflightDigest: preflight.preflightDigest,
    evidenceDigest: request.intentEvidence.evidenceDigest,
    sourceSnapshotDigest: preflight.discovery.sourceSnapshotDigest,
    intent: request.intent,
    fragments: request.intentEvidence.fragments.map((f, index) => ({
      index,
      id: f.id,
      anchor: f.anchor,
    })),
    literalFacts: request.intentEvidence.literalFacts.map((f) => ({
      id: f.id,
      kind: f.kind,
      value: f.reference,
      fragmentIndex: f.fragmentIndex,
    })),
    workspace: {
      status: request.workspace.status,
      observedTextPaths: request.workspace.observedTextPaths,
      symbols: (request.workspace.workspaceSkeleton?.symbols ?? []).slice(0, 30).map((s) => ({
        name: s.name,
        kind: s.kind,
        path: s.path,
        startLine: s.startLine,
        endLine: s.endLine,
        signature: s.signature,
      })),
      sourceExcerpts: request.workspace.sourceEvidence.map(({ path, startLine, endLine, content }) => ({
        path,
        startLine,
        endLine,
        content,
      })),
    },
    availableContextTags: request.policy.contexts.map((c) => c.tag),
    supervisionInstructions: semanticSupervisorInstructions(request),
    aiTask: [
      '1. intentClaims: classifique cada fragmento em OBLIGATION/NORMATIVE, OPTION/POLICY_CORRECTION ou AMBIGUITY/DECISION.',
      '2. architectureContexts: declare tags e bases; avalie cada regra aplicável. Declare coverage e rationale de determinismo para cada claim material; o Harness não preenche conclusões semânticas ausentes.',
      '3. requirements + invariants: defina requisitos e casos falsificáveis Dado/Quando/Então (HAPPY_PATH, BOUNDARY, FAILURE).',
      '4. stateModel / decisions: inclua stateModel apenas se houver estado mutável, e decisions apenas se houver ambiguidade material.',
    ],
    dataPath: '.harness/runtime/preflight.json',
    requestPath: '.harness/runtime/semantic-request.json',
    nextCommand: './aegis --semantic-compile',
    message: 'Briefing determinístico pronto. Construa o parecer (usando evidenceDigest em sourceEvidenceDigest) e envie via stdin para ./aegis --semantic-compile.',
  };
  const isFallbackOnly = isFallbackOnlyEvidence(request.workspace.sourceEvidence);
  const hasNoDirectWindowMatches = !request.workspace.sourceEvidence.some((e) => e.selection === 'LEXICAL_WINDOW');
  const hasNoSkeletonMatches = (brief.workspace.symbols?.length ?? 0) === 0;
  if (hasNoDirectWindowMatches && hasNoSkeletonMatches && isFallbackOnly) {
    brief.warning = 'Nenhum símbolo do repositório coincidiu diretamente com os termos da demanda. Especifique o caminho do módulo (ex: src/ledger) ou adicione termos ao léxico (.harness/domain-lexicon.json) para ancoragem precisa.';
  }
  process.stdout.write(`${JSON.stringify(brief)}\n`);
}

async function handleDemand(args, options = {}) {
  await handleDraft(args, { emitHandoff: false, ...options });
  try {
    await handleSemanticRun([]);
  } catch (error) {
    const message = error instanceof Error ? (error.detail || error.message) : '';
    if (
      message.includes('executable_not_found')
      || message.includes('SEMANTIC_CODEX_FAILED')
      || message.includes('SEMANTIC_IDE_ADAPTER_UNSUPPORTED')
      || error?.message === 'SEMANTIC_IDE_ADAPTER_UNSUPPORTED'
    ) {
      await emitIdeBriefing();
      return;
    }
    throw error;
  }
}

async function handleApprove() {
  if (!existsSync(paths.contractJsonPath)) {
    throw rejection(existsSync(paths.preflightJsonPath)
      ? 'SEMANTIC_DELIBERATION_REQUIRED'
      : 'MISSING_CONTRACT_DRAFT');
  }
  const [
    { canonicalDigest, canonicalJson },
    {
      assertConfirmationRequest,
      finalizeContractApproval,
      resolutionRequiresRecompilation,
    },
    { assertContractDocument },
    { renderSemanticContractMarkdown },
    { semanticStatePath },
  ] = await Promise.all([
    import('./lib/canonical_json.mjs'),
    import('./lib/semantic_approval.mjs'),
    import('./lib/semantic_contract_lifecycle.mjs'),
    import('./lib/semantic_contract_markdown.mjs'),
    import('./lib/semantic_state.mjs'),
  ]);
  const [draftContract, preflight, loadedPolicy, constitution] = await Promise.all([
    readFile(paths.contractJsonPath, 'utf8').then(JSON.parse),
    readPreflight(paths),
    readPolicy(paths),
    readConstitution(paths),
  ]);
  if (draftContract.schema !== 'aegis.issue_contract.v14') {
    throw rejection('SEMANTIC_REDELIBERATION_REQUIRED', `found=${draftContract.schema ?? 'unknown'} required=aegis.issue_contract.v14`);
  }
  const workspaceObservation = await assertDiscoveryUnchanged(paths, preflight);
  assertContractDocument({
    repositoryRoot: root,
    contract: draftContract,
    preflight,
    policy: loadedPolicy.policy,
    policyDigest: loadedPolicy.policyDigest,
    constitution,
    constitutionDigest: constitution.digest,
    workspaceObservation,
  });

  if (!existsSync(paths.userConfirmationPath)) throw rejection('MISSING_USER_CONFIRMATION');
  const request = JSON.parse(await readFile(paths.userConfirmationPath, 'utf8'));
  assertConfirmationRequest(draftContract, request);
  let resolution;
  if (existsSync(paths.resolutionPath)) {
    resolution = JSON.parse(await readFile(paths.resolutionPath, 'utf8'));
    if (resolutionRequiresRecompilation({ contract: draftContract, request, resolution })) {
      if (await compilePreparedRevision(await buildCurrentSemanticRequest())) return;
      throw rejection('SEMANTIC_RECOMPILATION_REQUIRED');
    }
  } else if (draftContract.specification.decisions.length > 0) {
    throw rejection('HUMAN_DECISIONS_REQUIRED');
  } else {
    resolution = {
      schema: 'aegis.semantic_resolution.v2',
      executionId: request.executionId,
      contractDraftDigest: request.contractDraftDigest,
      method: 'DIRECT_COMMAND',
      attestation: 'CONTRACT_REVIEWED_AND_APPROVED',
      answers: [],
    };
  }

  const contract = finalizeContractApproval({
    contract: draftContract,
    request,
    resolution,
    workspaceEvidence: workspaceObservation?.sourceEvidence ?? [],
    workspaceSkeleton: workspaceObservation?.workspaceSkeleton ?? preflight.discovery?.workspaceSkeleton ?? null,
  });
  assertContractDocument({
    repositoryRoot: root,
    contract,
    preflight,
    policy: loadedPolicy.policy,
    policyDigest: loadedPolicy.policyDigest,
    constitution,
    constitutionDigest: constitution.digest,
    workspaceObservation,
  });
  const contractDigest = canonicalDigest(contract);
  const statePath = semanticStatePath(root);
  const semanticState = {
    schema: 'aegis.semantic_state.v14',
    contract,
    contractDigest,
  };
  await mkdir(dirname(statePath), { recursive: true });
  await Promise.all([
    writeFileAtomic(paths.contractJsonPath, `${canonicalJson(contract)}\n`),
    writeFileAtomic(paths.contractMdPath, `${renderSemanticContractMarkdown(contract, {
      contractDigest,
      policyRules: loadedPolicy.policy.rules,
    })}\n`),
  ]);
  await writeFileAtomic(statePath, `${canonicalJson(semanticState)}\n`);
  await Promise.all([
    rm(paths.userConfirmationPath, { force: true }),
    rm(paths.resolutionPath, { force: true }),
  ]);
  process.stdout.write(`${JSON.stringify({
    schema: 'aegis.preflight_finalization.v14',
    status: 'FINALIZED',
    contractDigest,
    evidenceState: 'GOVERNED',
    contractIntegrity: 'VALID',
    workspaceFreshness: 'MATCHES_BASELINE',
    implementationCompliance: 'NOT_EVALUATED',
    approvalMethod: contract.approval.method,
    humanDecisionCount: contract.humanResolutions.length,
    implementationAuthorized: false,
  })}\n`);
}

async function handleIssue(args) {
  const { resolveIssueDemand } = await import('./lib/issue_intake.mjs');
  const resolved = await resolveIssueDemand(args, { repositoryRoot: root });
  await handleDemand([resolved.demandText], { maxBytes: resolved.maxBytes });
}

const command = process.argv[2];
const remainingArgs = process.argv.slice(3);

try {
  if (command === 'run') await handleDemand(remainingArgs);
  else if (command === 'issue') await handleIssue(remainingArgs);
  else if (command === 'draft') await handleDraft(remainingArgs);
  else if (command === 'confirmation-request') await handleConfirmationRequest();
  else if (command === 'status') await handleStatus(paths);
  else if (command === 'semantic-request') await handleSemanticRequest();
  else if (command === 'semantic-run') await handleSemanticRun(remainingArgs);
  else if (command === 'semantic-compile') await handleSemanticCompile(remainingArgs);
  else if (command === 'approve') await handleApprove();
  else if (command === 'verify') await handleVerify(paths);
  else throw rejection('UNKNOWN_INTERNAL_COMMAND', command);
} catch (error) {
  const phase = command === 'draft'
    ? 'PREFLIGHT'
    : command === 'run' || command === 'issue' || command === 'semantic-request'
      || command === 'semantic-run' || command === 'semantic-compile'
      ? 'SEMANTIC'
      : command === 'approve' ? 'APPROVAL' : command === 'verify' ? 'VERIFICATION' : 'COMMAND';
  process.stderr.write(`${JSON.stringify(buildErrorRejectionReport(phase, error, 'issue_runner_failed'))}\n`);
  process.exitCode = 1;
  process.exit(1);
}

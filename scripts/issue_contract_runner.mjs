#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import { buildRejectionReport } from './lib/rejection_report.mjs';

const root = resolve(process.env.AEGIS_ROOT ?? fileURLToPath(new URL('..', import.meta.url)));
const harnessDir = resolve(root, '.harness');
const runtimeDir = resolve(harnessDir, 'runtime');
const semanticStateJsonPath = resolve(harnessDir, 'state', 'semantic-state.json');
const contractJsonPath = resolve(runtimeDir, 'contract.json');
const contractMdPath = resolve(runtimeDir, 'contract.md');
const preflightJsonPath = resolve(runtimeDir, 'preflight.json');
const sourceIndexPath = resolve(runtimeDir, 'source-index.json');
const jevAdvisoryPath = resolve(runtimeDir, 'jev-advisory.json');
const jevComparisonPath = resolve(runtimeDir, 'jev-comparison.json');
const semanticExecutionPath = resolve(runtimeDir, 'semantic-execution.json');
const userConfirmationPath = resolve(runtimeDir, 'user_confirmation_request.json');
const resolutionPath = resolve(runtimeDir, 'preflight_resolution.json');
const semanticOpinionByteLimit = 262_144;

function rejection(reason, detail = '') {
  const error = new Error(reason);
  if (detail) error.detail = detail;
  return error;
}

async function writeFileAtomic(target, content) {
  const parent = dirname(target);
  await mkdir(parent, { recursive: true });
  const stagingDirectory = await mkdtemp(resolve(parent, '.aegis-write-'));
  const stagedPath = resolve(stagingDirectory, basename(target));
  try {
    await writeFile(stagedPath, content, { encoding: 'utf8', flush: true });
    await rename(stagedPath, target);
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
}

async function clearSupersededRuntime() {
  const entries = await readdir(runtimeDir, { withFileTypes: true });
  const preserved = new Set([basename(preflightJsonPath), basename(sourceIndexPath)]);
  await Promise.all(entries
    .filter(({ name }) => !preserved.has(name))
    .map(({ name }) => rm(resolve(runtimeDir, name), { recursive: true, force: true })));
}

async function readCachedSourceIndex() {
  if (!existsSync(sourceIndexPath)) return null;
  try {
    return JSON.parse(await readFile(sourceIndexPath, 'utf8'));
  } catch {
    return null;
  }
}

async function readPreflight() {
  if (!existsSync(preflightJsonPath)) throw rejection('MISSING_PREFLIGHT');
  const [{ assertPreflightDocument }, preflight] = await Promise.all([
    import('./lib/preflight_integrity.mjs'),
    readFile(preflightJsonPath, 'utf8').then(JSON.parse),
  ]);
  assertPreflightDocument(preflight);
  return preflight;
}

async function readPolicy() {
  const [{ loadArchitecturePolicy }, { assertSchema }] = await Promise.all([
    import('./lib/issue_contract_core.mjs'),
    import('./lib/schema_validator.mjs'),
  ]);
  try {
    const loaded = loadArchitecturePolicy(root);
    assertSchema('aegis.architecture_policy.v3', loaded.policy);
    return loaded;
  } catch (error) {
    throw rejection('ARCHITECTURE_POLICY_UNAVAILABLE', error.message);
  }
}

async function readConstitution() {
  try {
    const { loadSemanticConstitution } = await import('./lib/semantic_request.mjs');
    return loadSemanticConstitution(root);
  } catch (error) {
    throw rejection('SEMANTIC_CONSTITUTION_UNAVAILABLE', error.message);
  }
}

async function assertDiscoveryUnchanged(preflight) {
  const [{ canonicalDigest }, { observeWorkspace }] = await Promise.all([
    import('./lib/canonical_json.mjs'),
    import('./lib/issue_contract_core.mjs'),
  ]);
  const workspaceObservation = observeWorkspace(root, preflight.intent, {
    cachedSourceIndex: await readCachedSourceIndex(),
  });
  const currentDiscovery = workspaceObservation.discovery;
  if (currentDiscovery.sourceSnapshotDigest !== preflight.discovery.sourceSnapshotDigest) {
    throw rejection('SOURCE_SNAPSHOT_CHANGED');
  }
  if (canonicalDigest(currentDiscovery) !== canonicalDigest(preflight.discovery)) {
    throw rejection('DISCOVERY_EVIDENCE_MISMATCH');
  }
  return workspaceObservation;
}

async function readPendingRevision(preflight, loadedPolicy, constitution, workspaceObservation = null) {
  const pathsExist = [contractJsonPath, userConfirmationPath, resolutionPath]
    .map((path) => existsSync(path));
  if (!pathsExist[2]) return null;
  if (!pathsExist[0] || !pathsExist[1]) throw rejection('INCOMPLETE_SEMANTIC_REVISION_STATE');

  const [
    { assertContractDocument },
    {
      buildHumanResolutionRecords,
      buildSemanticRevision,
      resolutionRequiresRecompilation,
    },
    contract,
    request,
    resolution,
  ] = await Promise.all([
    import('./lib/semantic_contract_lifecycle.mjs'),
    import('./lib/semantic_approval.mjs'),
    readFile(contractJsonPath, 'utf8').then(JSON.parse),
    readFile(userConfirmationPath, 'utf8').then(JSON.parse),
    readFile(resolutionPath, 'utf8').then(JSON.parse),
  ]);
  if (contract.constitutionDigest !== constitution.digest
    || contract.policyDigest !== loadedPolicy.policyDigest) {
    return null;
  }
  if (contract.schema !== 'aegis.issue_contract.v14') return null;
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
  if (!resolutionRequiresRecompilation({ contract, request, resolution })) return null;
  return {
    resolution,
    request: buildSemanticRevision(contract, resolution),
    humanResolutions: [
      ...contract.humanResolutions,
      ...buildHumanResolutionRecords(contract, resolution),
    ],
  };
}

async function handleDraft(args) {
  const [
    { canonicalJson },
    { buildPreflightHandoff, captureDemand, observeWorkspace },
    { assertPreflightDocument },
  ] = await Promise.all([
    import('./lib/canonical_json.mjs'),
    import('./lib/issue_contract_core.mjs'),
    import('./lib/preflight_integrity.mjs'),
  ]);
  const demand = captureDemand(args);
  const workspaceObservation = observeWorkspace(root, demand, {
    cachedSourceIndex: await readCachedSourceIndex(),
  });
  const { discovery, sourceIndex } = workspaceObservation;
  const preflight = buildPreflightHandoff({ demand, discovery });
  assertPreflightDocument(preflight);
  const serializedPreflight = `${canonicalJson(preflight)}\n`;

  await clearSupersededRuntime();
  await Promise.all([
    writeFileAtomic(preflightJsonPath, serializedPreflight),
    writeFileAtomic(sourceIndexPath, `${canonicalJson(sourceIndex)}\n`),
  ]);

  process.stdout.write(`${JSON.stringify({
    schema: preflight.schema,
    status: preflight.status,
    phase: preflight.phase,
    preflightDigest: preflight.preflightDigest,
    sourceSnapshotDigest: preflight.discovery.sourceSnapshotDigest,
    dataPath: '.harness/runtime/preflight.json',
  })}\n`);
}

async function handleValidatePreflight() {
  await readPreflight();
}

async function validateContract(contract, preflight) {
  const { assertContractDocument } = await import('./lib/semantic_contract_lifecycle.mjs');
  const [loadedPolicy, constitution] = await Promise.all([
    readPolicy(),
    readConstitution(),
  ]);
  const workspaceObservation = await assertDiscoveryUnchanged(preflight);
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
}

async function handleValidateContract() {
  const [contract, preflight] = await Promise.all([
    readFile(contractJsonPath, 'utf8').then(JSON.parse),
    readPreflight(),
  ]);
  await validateContract(contract, preflight);
}

async function readGovernedState(statePath) {
  const { parseSemanticState } = await import('./lib/semantic_state.mjs');
  return parseSemanticState(JSON.parse(await readFile(statePath, 'utf8')));
}

function writeStatus(status) {
  process.stdout.write(`${JSON.stringify(status)}\n`);
}

async function inspectWorkspaceFreshness(contract) {
  try {
    const { discoverWorkspace } = await import('./lib/issue_contract_core.mjs');
    const currentSnapshotDigest = discoverWorkspace(root).sourceSnapshotDigest;
    return {
      workspaceFreshness: currentSnapshotDigest === contract.sourceSnapshotDigest
        ? 'MATCHES_BASELINE'
        : 'CHANGED_SINCE_BASELINE',
    };
  } catch (error) {
    return {
      workspaceFreshness: 'UNAVAILABLE',
      workspaceFreshnessReason: error instanceof Error ? error.message : 'unknown_error',
    };
  }
}

async function writeGovernedStatus(statePath, runtimeContract = null) {
  try {
    const [{ canonicalDigest }, state] = await Promise.all([
      import('./lib/canonical_json.mjs'),
      readGovernedState(statePath),
    ]);
    if (runtimeContract !== null && canonicalDigest(runtimeContract) !== state.contractDigest) {
      writeStatus({
        status: 'INVALID_SEMANTIC_STATE',
        reason: 'RUNTIME_CONTRACT_MISMATCH',
        contractIntegrity: 'INVALID',
        workspaceFreshness: 'NOT_CHECKED',
        implementationCompliance: 'NOT_EVALUATED',
        semanticState: statePath,
      });
      return;
    }
    const freshness = await inspectWorkspaceFreshness(state.contract);
    writeStatus({
      status: 'GOVERNED',
      contractDigest: state.contractDigest,
      contractIntegrity: 'VALID',
      ...freshness,
      implementationCompliance: 'NOT_EVALUATED',
      semanticState: statePath,
    });
  } catch {
    writeStatus({
      status: 'INVALID_SEMANTIC_STATE',
      contractIntegrity: 'INVALID',
      workspaceFreshness: 'NOT_CHECKED',
      implementationCompliance: 'NOT_EVALUATED',
      semanticState: statePath,
    });
  }
}

async function handleStatus() {
  const statePath = semanticStateJsonPath;

  if (existsSync(contractJsonPath)) {
    let contract;
    try {
      contract = JSON.parse(await readFile(contractJsonPath, 'utf8'));
    } catch {
      writeStatus({
        status: 'SEMANTIC_REDELIBERATION_REQUIRED',
        foundSchema: 'INVALID',
        requiredSchema: 'aegis.issue_contract.v14',
      });
      return;
    }
    if (contract.schema !== 'aegis.issue_contract.v14') {
      writeStatus({
        status: 'SEMANTIC_REDELIBERATION_REQUIRED',
        foundSchema: contract.schema ?? 'INVALID',
        requiredSchema: 'aegis.issue_contract.v14',
      });
      return;
    }
    if (contract.approval !== null) {
      if (!existsSync(statePath)) {
        writeStatus({
          status: 'INVALID_SEMANTIC_STATE',
          reason: 'MISSING_GOVERNED_STATE',
          contractIntegrity: 'INVALID',
          workspaceFreshness: 'NOT_CHECKED',
          implementationCompliance: 'NOT_EVALUATED',
          semanticState: statePath,
        });
        return;
      }
      await writeGovernedStatus(statePath, contract);
      return;
    }

    let preflight;
    try {
      preflight = await readPreflight();
    } catch {
      writeStatus({ status: 'INVALID_PREFLIGHT', preflightPath: preflightJsonPath });
      return;
    }
    try {
      await validateContract(contract, preflight);
    } catch {
      writeStatus({ status: 'SEMANTIC_REDELIBERATION_REQUIRED', reason: 'INVALID_OR_STALE_CONTRACT' });
      return;
    }
    writeStatus({ status: 'DRAFT_PENDING_CONFIRMATION', draftPath: contractJsonPath });
    return;
  }

  if (existsSync(preflightJsonPath)) {
    try {
      await readPreflight();
      writeStatus({
        status: 'SEMANTIC_DELIBERATION_REQUIRED',
        phase: 'DISCOVERED',
        preflightPath: preflightJsonPath,
      });
    } catch {
      writeStatus({ status: 'INVALID_PREFLIGHT', preflightPath: preflightJsonPath });
    }
    return;
  }

  if (existsSync(statePath)) {
    await writeGovernedStatus(statePath);
    return;
  }

  writeStatus({ status: 'IDLE', workspace: 'clean' });
}

async function buildCurrentSemanticRequest() {
  const { buildSemanticRequest } = await import('./lib/semantic_request.mjs');
  const [preflight, loadedPolicy, constitution] = await Promise.all([
    readPreflight(),
    readPolicy(),
    readConstitution(),
  ]);
  const workspaceObservation = await assertDiscoveryUnchanged(preflight);
  const revision = await readPendingRevision(
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

async function writeSemanticRequest(request) {
  const { canonicalJson } = await import('./lib/canonical_json.mjs');
  process.stdout.write(`${canonicalJson(request)}\n`);
}

async function handleSemanticRequest() {
  const { request } = await buildCurrentSemanticRequest();
  await writeSemanticRequest(request);
}

async function handleJevRequest() {
  const [{ canonicalJson }, { buildJevDecisionBatch }] = await Promise.all([
    import('./lib/canonical_json.mjs'),
    import('./lib/jev_projection.mjs'),
  ]);
  const { request } = await buildCurrentSemanticRequest();
  process.stdout.write(`${canonicalJson(buildJevDecisionBatch(request))}\n`);
}

async function createJevAdvisory(request) {
  const [
    { canonicalJson },
    { requestJevAssessment },
    { compileJevAdvisory },
    { buildJevDecisionBatch },
  ] = await Promise.all([
    import('./lib/canonical_json.mjs'),
    import('./lib/jev_gateway.mjs'),
    import('./lib/jev_advisory.mjs'),
    import('./lib/jev_projection.mjs'),
  ]);
  const batch = buildJevDecisionBatch(request);
  const assessment = await requestJevAssessment(batch);
  const advisory = compileJevAdvisory(request, batch, assessment);
  await writeFileAtomic(jevAdvisoryPath, `${canonicalJson(advisory)}\n`);
  return { assessment, advisory };
}

async function handleJevRun() {
  const { canonicalJson } = await import('./lib/canonical_json.mjs');
  const { request } = await buildCurrentSemanticRequest();
  const { assessment } = await createJevAdvisory(request);
  process.stdout.write(`${canonicalJson(assessment)}\n`);
}

async function ensureJevAdvisory(request) {
  if (existsSync(jevAdvisoryPath)) {
    try {
      const [{ assertJevAdvisory }, advisory] = await Promise.all([
        import('./lib/jev_advisory.mjs'),
        readFile(jevAdvisoryPath, 'utf8').then(JSON.parse),
      ]);
      assertJevAdvisory(advisory, request);
      return 'REUSED';
    } catch {
      // A avaliação é auxiliar; uma versão obsoleta será substituída ou ignorada.
    }
  }
  try {
    await createJevAdvisory(request);
    return 'EXECUTED';
  } catch {
    await Promise.all([
      rm(jevAdvisoryPath, { force: true }),
      rm(jevComparisonPath, { force: true }),
    ]);
    return 'UNAVAILABLE';
  }
}

async function optionalJevComparison(request, draft) {
  if (!existsSync(jevAdvisoryPath)) return null;
  try {
    const [{ compileJevComparison }, advisory] = await Promise.all([
      import('./lib/jev_comparison.mjs'),
      readFile(jevAdvisoryPath, 'utf8').then(JSON.parse),
    ]);
    return compileJevComparison(request, draft, advisory);
  } catch {
    await rm(jevComparisonPath, { force: true });
    return null;
  }
}

async function compileAndPersistSemanticOpinion(opinion, context, execution = null) {
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
    draft = compileSemanticOpinion(opinion, request);
  } catch (error) {
    if (error.message === 'semantic_opinion_evidence_mismatch') {
      throw rejection('SEMANTIC_CONTEXT_MISMATCH');
    }
    throw rejection('INVALID_SEMANTIC_OPINION', error.message);
  }
  if (revision !== null) assertRevisionApplied(draft, revision.request);
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
  const confirmation = buildConfirmationRequest(contract);
  const comparison = await optionalJevComparison(request, draft);

  await mkdir(runtimeDir, { recursive: true });
  const writes = [
    writeFileAtomic(contractJsonPath, `${canonicalJson(contract)}\n`),
    writeFileAtomic(contractMdPath, `${renderSemanticContractMarkdown(contract, {
      policyRules: loadedPolicy.policy.rules,
    })}\n`),
    rm(resolutionPath, { force: true }),
    comparison === null
      ? rm(jevComparisonPath, { force: true })
      : writeFileAtomic(jevComparisonPath, `${canonicalJson(comparison)}\n`),
  ];
  if (execution !== null) {
    const { assertSchema } = await import('./lib/schema_validator.mjs');
    const receiptPayload = {
      schema: 'aegis.semantic_execution.v1',
      sourceSemanticRequestDigest: request.requestDigest,
      provider: execution.provider,
      model: execution.model,
      calls: 1,
      jevEvaluation: execution.jevEvaluation,
      usage: execution.usage,
      opinionDigest: canonicalDigest(opinion),
    };
    const receipt = {
      ...receiptPayload,
      executionDigest: canonicalDigest(receiptPayload),
    };
    assertSchema('aegis.semantic_execution.v1', receipt);
    writes.push(writeFileAtomic(semanticExecutionPath, `${canonicalJson(receipt)}\n`));
  } else {
    writes.push(rm(semanticExecutionPath, { force: true }));
  }
  await Promise.all(writes);
  await writeFileAtomic(userConfirmationPath, `${canonicalJson(confirmation)}\n`);
  process.stdout.write(`${canonicalJson(confirmation)}\n`);
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
  await compileAndPersistSemanticOpinion(opinion, await buildCurrentSemanticRequest());
}

async function handleSemanticRun(args) {
  if (args.length !== 0) throw rejection('INVALID_SEMANTIC_RUN_ARITY');
  const [{ loadRoleAssignment }, { assertSemanticSupervisorReady, requestSemanticOpinion }] = await Promise.all([
    import('./lib/role_assignment.mjs'),
    import('./lib/semantic_gateway.mjs'),
  ]);
  const assignment = await loadRoleAssignment(root);
  if (assignment === null) throw rejection('ROLE_ASSIGNMENT_NOT_CONFIGURED');
  const role = assignment.roles.contractSupervisor;
  if (role.channel === 'IDE') {
    const context = await buildCurrentSemanticRequest();
    await ensureJevAdvisory(context.request);
    await writeSemanticRequest(context.request);
    return;
  }
  assertSemanticSupervisorReady(role);
  const context = await buildCurrentSemanticRequest();
  const jevEvaluation = await ensureJevAdvisory(context.request);
  const { opinion, execution } = await requestSemanticOpinion(context.request, role);
  await compileAndPersistSemanticOpinion(opinion, context, { ...execution, jevEvaluation });
}

async function handleApprove() {
  if (!existsSync(contractJsonPath)) {
    throw rejection(existsSync(preflightJsonPath)
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
    readFile(contractJsonPath, 'utf8').then(JSON.parse),
    readPreflight(),
    readPolicy(),
    readConstitution(),
  ]);
  if (draftContract.schema !== 'aegis.issue_contract.v14') {
    throw rejection('SEMANTIC_REDELIBERATION_REQUIRED', `found=${draftContract.schema ?? 'unknown'} required=aegis.issue_contract.v14`);
  }
  const workspaceObservation = await assertDiscoveryUnchanged(preflight);
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

  if (!existsSync(userConfirmationPath)) throw rejection('MISSING_USER_CONFIRMATION');
  const request = JSON.parse(await readFile(userConfirmationPath, 'utf8'));
  assertConfirmationRequest(draftContract, request);
  let resolution;
  if (existsSync(resolutionPath)) {
    resolution = JSON.parse(await readFile(resolutionPath, 'utf8'));
    if (resolutionRequiresRecompilation({ contract: draftContract, request, resolution })) {
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
    writeFileAtomic(contractJsonPath, `${canonicalJson(contract)}\n`),
    writeFileAtomic(contractMdPath, `${renderSemanticContractMarkdown(contract, {
      contractDigest,
      policyRules: loadedPolicy.policy.rules,
    })}\n`),
  ]);
  await writeFileAtomic(statePath, `${canonicalJson(semanticState)}\n`);
  await Promise.all([
    rm(userConfirmationPath, { force: true }),
    rm(resolutionPath, { force: true }),
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

async function handleVerify() {
  const { semanticStatePath, parseSemanticState } = await import('./lib/semantic_state.mjs');
  const statePath = semanticStatePath(root);
  if (!existsSync(statePath)) throw rejection('NO_GOVERNED_CONTRACT');
  const state = parseSemanticState(JSON.parse(await readFile(statePath, 'utf8')));
  let activeContext = 'NOT_PRESENT';
  if (existsSync(preflightJsonPath)) {
    try {
      const preflight = await readPreflight();
      activeContext = state.contract.sourcePreflightDigest === preflight.preflightDigest
        ? 'MATCHES_CONTRACT'
        : 'DIFFERENT_PREFLIGHT';
    } catch {
      activeContext = 'INVALID_PREFLIGHT';
    }
  }
  process.stdout.write(`${JSON.stringify({
    schema: 'aegis.contract_verification.v2',
    status: 'VALID',
    contractDigest: state.contractDigest,
    contractIntegrity: 'VALID',
    workspaceFreshness: 'NOT_CHECKED',
    implementationCompliance: 'NOT_EVALUATED',
    activeContext,
  })}\n`);
}

const command = process.argv[2];
const remainingArgs = process.argv.slice(3);

try {
  if (command === 'draft') await handleDraft(remainingArgs);
  else if (command === 'validate-preflight') await handleValidatePreflight();
  else if (command === 'validate-contract') await handleValidateContract();
  else if (command === 'status') await handleStatus();
  else if (command === 'semantic-request') await handleSemanticRequest();
  else if (command === 'jev-request') await handleJevRequest();
  else if (command === 'jev-run') await handleJevRun();
  else if (command === 'semantic-run') await handleSemanticRun(remainingArgs);
  else if (command === 'semantic-compile') await handleSemanticCompile(remainingArgs);
  else if (command === 'approve') await handleApprove();
  else if (command === 'verify') await handleVerify();
  else throw rejection('UNKNOWN_INTERNAL_COMMAND', command);
} catch (error) {
  const message = error instanceof Error ? error.message : 'issue_runner_failed';
  const separator = message.indexOf(':');
  const rawReason = separator === -1 ? message : message.slice(0, separator);
  const inferredDetail = separator === -1 ? '' : message.slice(separator + 1).trim();
  const phase = command === 'draft' || command === 'validate-preflight'
    ? 'PREFLIGHT'
    : command === 'semantic-request' || command === 'jev-request' || command === 'jev-run'
      || command === 'semantic-run'
      || command === 'semantic-compile' || command === 'validate-contract'
      ? 'SEMANTIC'
      : command === 'approve' ? 'APPROVAL' : command === 'verify' ? 'VERIFICATION' : 'COMMAND';
  process.stderr.write(`${JSON.stringify(buildRejectionReport({
    phase,
    reason: rawReason,
    detail: error?.detail || inferredDetail,
  }))}\n`);
  process.exitCode = 1;
}

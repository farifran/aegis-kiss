#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { canonicalDigest, canonicalJson, sha256 } from './lib/canonical_json.mjs';
import {
  applyUserResolution,
  buildIssueDraft,
  computeContractDigest,
  createProofRegistry,
  loadArchitecturePolicy,
  maxDemandBytes,
  renderContractMarkdown,
  sanitizeInputText,
  validateContract,
} from './lib/issue_contract_core.mjs';
import { semanticStatePath, parseSemanticState } from './lib/semantic_state.mjs';

const root = resolve(process.env.AEGIS_ROOT ?? fileURLToPath(new URL('..', import.meta.url)));
const runtimeDir = resolve(root, '.harness/runtime');
const contractJsonPath = resolve(runtimeDir, 'contract.json');
const contractMdPath = resolve(runtimeDir, 'contract.md');
const userConfirmationPath = resolve(runtimeDir, 'user_confirmation_request.json');
const resolutionPath = resolve(runtimeDir, 'preflight_resolution.json');

function isPathInside(baseDir, candidatePath) {
  const relativePath = relative(baseDir, candidatePath);
  return relativePath === '' || (!relativePath.startsWith('..' + sep) && relativePath !== '..');
}

function parseJsonOrFile(raw, baseDir, option) {
  const filePath = resolve(baseDir, raw);
  if (existsSync(filePath)) {
    if (!isPathInside(baseDir, filePath)) {
      throw new Error('input_file_outside_workspace:' + option);
    }
    const metadata = statSync(filePath);
    if (!metadata.isFile()) {
      throw new Error('input_path_not_file:' + option);
    }
    if (metadata.size > maxDemandBytes) {
      throw new Error('structured_input_too_large:' + option);
    }
    return JSON.parse(readFileSync(filePath, 'utf8'));
  }
  if (Buffer.byteLength(raw, 'utf8') > maxDemandBytes) {
    throw new Error('structured_input_too_large:' + option);
  }
  return JSON.parse(raw);
}

async function readStdinWithinLimit(maxBytes) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
    totalBytes += bytes.length;
    if (totalBytes > maxBytes) {
      throw new Error('input_too_large');
    }
    chunks.push(bytes);
  }

  return Buffer.concat(chunks);
}

function requiredOptionValue(args, index, option) {
  const value = args[index + 1];
  if (typeof value !== 'string' || value.startsWith('--')) {
    throw new Error(`missing_option_value:${option}`);
  }
  return value;
}

function requireObject(value, option) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_json_object:' + option);
  }
  return value;
}

function requireArray(value, option) {
  if (!Array.isArray(value)) {
    throw new Error('invalid_json_array:' + option);
  }
  return value;
}

async function handleDraft(args) {
  let changeKind = 'PRODUCT';
  let targetHint = '';
  const demandParts = [];
  let specData = null;
  let decisionsData = null;
  let channel = 'IDE_DEFAULT';
  let answersData = null;
  let stateModelKind = null;
  let customTitle = null;

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--') {
      demandParts.push(...args.slice(index + 1));
      break;
    }
    if (args[index] === '--kind') {
      const value = requiredOptionValue(args, index, '--kind');
      if (!['PRODUCT', 'HARNESS'].includes(value)) {
        throw new Error('invalid_option_value:--kind');
      }
      changeKind = value;
      index += 1;
    } else if (args[index] === '--target') {
      targetHint = requiredOptionValue(args, index, '--target');
      index += 1;
    } else if (args[index] === '--channel') {
      channel = requiredOptionValue(args, index, '--channel');
      index += 1;
    } else if (args[index] === '--state-kind') {
      const value = requiredOptionValue(args, index, '--state-kind');
      if (!['NONE', 'STATE_TRANSITION'].includes(value)) {
        throw new Error('invalid_option_value:--state-kind');
      }
      stateModelKind = value;
      index += 1;
    } else if (args[index] === '--title') {
      customTitle = requiredOptionValue(args, index, '--title');
      index += 1;
    } else if (args[index] === '--spec') {
      specData = requireObject(
        parseJsonOrFile(requiredOptionValue(args, index, '--spec'), root, '--spec'),
        '--spec',
      );
      index += 1;
    } else if (args[index] === '--decisions') {
      decisionsData = requireArray(
        parseJsonOrFile(requiredOptionValue(args, index, '--decisions'), root, '--decisions'),
        '--decisions',
      );
      index += 1;
    } else if (args[index] === '--answers') {
      answersData = requireArray(
        parseJsonOrFile(requiredOptionValue(args, index, '--answers'), root, '--answers'),
        '--answers',
      );
      index += 1;
    } else if (args[index].startsWith('--')) {
      throw new Error(`unknown_draft_option:${args[index]}`);
    } else {
      demandParts.push(args[index]);
    }
  }

  const demandText = demandParts.join(' ');
  if (specData?.intent !== undefined && typeof specData.intent !== 'string') {
    throw new Error('invalid_spec_intent');
  }
  if (demandText && specData?.intent !== undefined) {
    throw new Error('ambiguous_intent_sources');
  }
  if (!demandText && specData?.intent !== undefined) {
    demandParts.push(specData.intent);
  }

  const rawBuffer = demandParts.length > 0
    ? Buffer.from(demandParts.join(' '), 'utf8')
    : await readStdinWithinLimit(maxDemandBytes);
  const sanitizedText = sanitizeInputText(rawBuffer);

  const architecturePolicy = loadArchitecturePolicy(root);
  const policy = architecturePolicy.policy;

  if (specData && Array.isArray(specData.decisions) && !decisionsData) {
    decisionsData = specData.decisions;
  }

  const draft = buildIssueDraft({
    sanitizedText,
    architecture: {
      candidateRules: policy.rules,
      policyDigest: '0'.repeat(64),
    },
    changeKind,
    targetHint,
    decisions: decisionsData ?? [],
    stateModelKind: specData?.stateModel?.kind ?? stateModelKind,
    stateModel: specData?.stateModel,
    title: specData?.title ?? customTitle,
    requirements: specData?.requirements,
    behavior: specData?.behavior,
    invariants: specData?.invariants,
    preconditions: specData?.preconditions,
    postconditions: specData?.postconditions,
    failureSemantics: specData?.failureSemantics,
    authorizedPaths: specData?.authorizedPaths ?? specData?.scope?.authorizedPaths,
    proofObligations: specData?.proofObligations,
  });

  await mkdir(runtimeDir, { recursive: true });
  await writeFile(contractJsonPath, `${canonicalJson(draft)}\n`, 'utf8');
  await writeFile(contractMdPath, `${renderContractMarkdown(draft, false, '', policy.rules)}\n`, 'utf8');

  const questions = (draft.decisions ?? []).map((d) => ({
    id: d.questionId,
    question: d.question,
    recommendedAnswerId: d.recommendedAnswerId,
    selectedAnswerId: d.selectedAnswerId,
    answers: d.answers,
  }));

  const draftSessionId = `draft-${Date.now().toString(36)}`;
  const confirmationRequest = {
    schema: 'aegis.preflight_finalization.v2',
    status: 'USER_CONFIRMATION_REQUIRED',
    executionId: draftSessionId,
    decisionDigest: draftSessionId,
    preflightPromptDigest: draftSessionId,
    confirmation: {
      channel,
      confirmationId: draftSessionId,
    },
    title: draft.title,
    intent: draft.intent,
    scope: draft.scope,
    questions,
    artifactPath: '.harness/runtime/contract.md',
  };

  await writeFile(userConfirmationPath, `${JSON.stringify(confirmationRequest, null, 2)}\n`, 'utf8');

  if (Array.isArray(answersData)) {
    const resolution = {
      schema: 'aegis.preflight_resolution.v2',
      decisionDigest: draftSessionId,
      preflightPromptDigest: draftSessionId,
      confirmation: {
        channel,
        confirmationId: draftSessionId,
        selectedAtEpochMs: Date.now(),
      },
      answers: answersData,
    };
    await writeFile(resolutionPath, `${JSON.stringify(resolution, null, 2)}\n`, 'utf8');
  } else if (existsSync(resolutionPath)) {
    await rm(resolutionPath, { force: true });
  }

  process.stdout.write(`${JSON.stringify(confirmationRequest)}\n`);
  process.exit(2);
}

async function handleApprove() {
  if (!existsSync(contractJsonPath)) {
    process.stderr.write('[AEGIS][FATAL] missing_contract_draft\n');
    process.exit(1);
  }

  const rawContract = JSON.parse(await readFile(contractJsonPath, 'utf8'));
  let contract = rawContract;

  const userResolutionPath = resolve(runtimeDir, 'user_resolution.json');
  const targetResolution = existsSync(resolutionPath) ? resolutionPath : (existsSync(userResolutionPath) ? userResolutionPath : null);

  if (targetResolution) {
    try {
      const resolution = JSON.parse(await readFile(targetResolution, 'utf8'));
      if (Array.isArray(resolution.answers)) {
        contract = applyUserResolution(contract, resolution.answers);
      }
    } catch {
      // Continue with draft as is
    }
  } else if ((contract.decisions ?? []).length > 0) {
    contract = applyUserResolution(contract, []);
  }

  let policy;
  let policyText;
  try {
    const architecturePolicy = loadArchitecturePolicy(root);
    policy = architecturePolicy.policy;
    policyText = architecturePolicy.policyText;
  } catch {
    process.stderr.write('[AEGIS][FATAL] architecture_policy_unavailable\n');
    process.exit(1);
  }

  const architecturePolicyDigest = sha256(policyText);
  contract.architecture.policyDigest = architecturePolicyDigest;

  const contractDigest = computeContractDigest(contract);
  const proofRegistry = createProofRegistry(contract);
  const proofRegistryDigest = canonicalDigest(proofRegistry);

  validateContract({
    contract,
    policy,
  });

  const statePath = semanticStatePath(root);
  await mkdir(resolve(root, 'src/.aegis'), { recursive: true });

  const semanticState = {
    schema: 'aegis.semantic_state.v1',
    contract,
    proofRegistry,
    digests: {
      contractSemanticDigest: contractDigest,
      proofRegistrySemanticDigest: proofRegistryDigest,
    },
  };

  await writeFile(statePath, `${canonicalJson(semanticState)}\n`, 'utf8');
  await writeFile(contractJsonPath, `${canonicalJson(contract)}\n`, 'utf8');
  await writeFile(contractMdPath, `${renderContractMarkdown(contract, true, contractDigest, policy.rules)}\n`, 'utf8');

  if (existsSync(userConfirmationPath)) {
    try {
      const existingReq = JSON.parse(await readFile(userConfirmationPath, 'utf8'));
      existingReq.status = 'FINALIZED';
      await writeFile(userConfirmationPath, `${JSON.stringify(existingReq, null, 2)}\n`, 'utf8');
    } catch {
      // Ignora erro se o arquivo não puder ser lido/analisado
    }
  }

  process.stdout.write(`${JSON.stringify({
    schema: 'aegis.preflight_finalization.v2',
    status: 'FINALIZED',
    contractDigest,
    evidenceState: 'GOVERNED',
  })}\n`);
  process.exit(0);
}

async function handleVerify() {
  const statePath = semanticStatePath(root);
  if (!existsSync(statePath)) {
    process.stderr.write('[AEGIS][VERIFY][FATAL] no_governed_contract: Execute ./aegis approve primeiro.\n');
    process.exit(1);
  }

  let semanticState;
  try {
    semanticState = parseSemanticState(JSON.parse(await readFile(statePath, 'utf8')));
  } catch (error) {
    process.stderr.write(`[AEGIS][VERIFY][FATAL] invalid_semantic_state:${error.message}\n`);
    process.exit(1);
  }

  const contract = semanticState.contract;
  const proofRegistry = semanticState.proofRegistry;
  const contractDigest = semanticState.digests.contractSemanticDigest;

  const proofs = proofRegistry.proofs ?? [];
  if (proofs.length === 0) {
    process.stderr.write('[AEGIS][VERIFY][FATAL] no_active_proofs_in_registry\n');
    process.exit(1);
  }

  const results = [];
  const hasStaticProof = proofs.some((p) => p.id === 'PO-ARCH-STATIC');
  if (!hasStaticProof) {
    process.stdout.write('[AEGIS][VERIFY] Portão Arquitetural: Validando conformidade física estática (PO-ARCH-STATIC)...\n');
    const staticStartMs = Date.now();
    const staticGate = spawnSync('bash', ['scripts/substrates/static_gate.sh', '--workspace', 'src'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    const staticDurationMs = Date.now() - staticStartMs;
    if (staticGate.status !== 0) {
      process.stderr.write(`[AEGIS][VERIFY][FAIL] Violação física/arquitetural em src/:\n${staticGate.stderr || staticGate.stdout}\n`);
      process.exit(1);
    }
    const staticPath = resolve(root, 'scripts/substrates/static_gate.sh');
    const staticSourceDigest = existsSync(staticPath) ? sha256(await readFile(staticPath)) : '0'.repeat(64);
    process.stdout.write(`  ✔ PO-ARCH-STATIC (architecture): PASS (${staticDurationMs}ms)\n`);
    results.push({
      proofId: 'PO-ARCH-STATIC',
      coverageKey: 'architecture',
      status: 'PASS',
      durationMs: staticDurationMs,
      sourceDigest: staticSourceDigest,
    });
  }

  process.stdout.write(`[AEGIS][VERIFY] Executando ${proofs.length} obrigações de prova física para o contrato ${contractDigest.slice(0, 12)}...\n`);
  for (const proof of proofs) {
    const fullPath = resolve(root, proof.argv?.[0] ?? proof.entrypoint);
    if (!existsSync(fullPath)) {
      process.stderr.write(`[AEGIS][VERIFY][FAIL] Arquivo de prova não encontrado: ${proof.argv?.[0] ?? proof.entrypoint}\n`);
      process.exit(1);
    }

    const proofSourceBytes = await readFile(fullPath);
    const sourceDigest = sha256(proofSourceBytes);

    const startMs = Date.now();
    const child = spawnSync(proof.executor, proof.argv, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    const durationMs = Date.now() - startMs;

    if (child.status !== 0) {
      process.stderr.write(`[AEGIS][VERIFY][FAIL] Prova ${proof.id} falhou com código ${child.status}:\n${child.stderr || child.stdout}\n`);
      process.exit(1);
    }

    process.stdout.write(`  ✔ ${proof.id} (${proof.coverageKey}): PASS (${durationMs}ms)\n`);
    results.push({
      proofId: proof.id,
      coverageKey: proof.coverageKey,
      status: 'PASS',
      durationMs,
      sourceDigest,
    });
  }

  const receiptData = {
    schema: 'aegis.proof_verification_receipt.v1',
    status: 'PROVEN',
    contractDigest,
    proofRegistryDigest: semanticState.digests?.proofRegistrySemanticDigest,
    verifiedAtEpochMs: Date.now(),
    proofsRun: results.length,
    results,
  };

  const receiptDigest = sha256(canonicalJson(receiptData));
  receiptData.receiptDigest = receiptDigest;

  const receiptPath = resolve(runtimeDir, 'verification_receipt.json');
  await mkdir(runtimeDir, { recursive: true });
  await writeFile(receiptPath, `${canonicalJson(receiptData)}\n`, 'utf8');

  let policyRules = [];
  try {
    const architecturePolicy = loadArchitecturePolicy(root);
    policyRules = architecturePolicy.policy?.rules ?? [];
  } catch {
    // Mantém vazio se não disponível
  }
  await writeFile(contractMdPath, `${renderContractMarkdown(contract, true, contractDigest, policyRules, receiptDigest)}\n`, 'utf8');

  process.stdout.write(`${JSON.stringify({
    schema: 'aegis.proof_verification_receipt.v1',
    status: 'PROVEN',
    contractDigest,
    receiptDigest,
    proofsRun: results.length,
  })}\n`);
  process.exit(0);
}

const command = process.argv[2];
const remainingArgs = process.argv.slice(3);

try {
  if (command === 'draft') {
    await handleDraft(remainingArgs);
  } else if (command === 'approve') {
    await handleApprove();
  } else if (command === 'verify' || command === 'prove') {
    await handleVerify();
  } else {
    process.stderr.write(`[AEGIS][FATAL] unknown_command:${command}\n`);
    process.exit(1);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : 'issue_runner_failed';
  process.stderr.write(`[AEGIS][FATAL] ${message}\n`);
  process.exit(1);
}

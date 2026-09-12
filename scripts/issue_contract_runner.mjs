#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const root = resolve(process.env.AEGIS_ROOT ?? fileURLToPath(new URL('..', import.meta.url)));
const harnessDir = resolve(root, '.harness');
const runtimeDir = resolve(root, '.harness/runtime');
const contractJsonPath = resolve(runtimeDir, 'contract.json');
const contractMdPath = resolve(runtimeDir, 'contract.md');
const preflightJsonPath = resolve(runtimeDir, 'preflight.json');
const userConfirmationPath = resolve(runtimeDir, 'user_confirmation_request.json');
const resolutionPath = resolve(runtimeDir, 'preflight_resolution.json');
const receiptPath = resolve(runtimeDir, 'verification_receipt.json');

function rejection(reason, detail = '') {
  const error = new Error(reason);
  if (detail) error.detail = detail;
  return error;
}

async function handleDraft(args) {
  const [
    { canonicalJson },
    { buildPreflightHandoff, captureDemand, discoverWorkspace },
    { assertPreflightDocument },
  ] = await Promise.all([
    import('./lib/canonical_json.mjs'),
    import('./lib/issue_contract_core.mjs'),
    import('./lib/preflight_integrity.mjs'),
  ]);
  const demand = captureDemand(args);
  const discovery = discoverWorkspace(root, demand);
  const preflight = buildPreflightHandoff({ demand, discovery });
  assertPreflightDocument(preflight);
  const serializedPreflight = `${canonicalJson(preflight)}\n`;

  await mkdir(harnessDir, { recursive: true });
  const stagingDir = await mkdtemp(resolve(harnessDir, '.preflight-'));
  const stagedPreflightPath = resolve(stagingDir, 'preflight.json');
  try {
    await writeFile(stagedPreflightPath, serializedPreflight, { encoding: 'utf8', flush: true });
    await rm(runtimeDir, { recursive: true, force: true });
    await mkdir(runtimeDir, { recursive: true });
    await rename(stagedPreflightPath, preflightJsonPath);
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }

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
  const { assertPreflightDocument } = await import('./lib/preflight_integrity.mjs');
  const preflight = JSON.parse(await readFile(preflightJsonPath, 'utf8'));
  assertPreflightDocument(preflight);
}

async function handleApprove() {
  if (!existsSync(contractJsonPath)) {
    if (existsSync(preflightJsonPath)) {
      throw rejection('SEMANTIC_DELIBERATION_REQUIRED');
    }
    throw rejection('MISSING_CONTRACT_DRAFT');
  }
  if (!existsSync(preflightJsonPath)) {
    throw rejection('MISSING_PREFLIGHT');
  }

  const [
    { canonicalDigest, canonicalJson, sha256 },
    { computeContractDigest, createProofRegistry, discoverWorkspace, loadArchitecturePolicy, renderContractMarkdown, validateContract },
    { assertPreflightDocument },
    { assertSchema },
    { semanticStatePath },
  ] = await Promise.all([
    import('./lib/canonical_json.mjs'),
    import('./lib/issue_contract_core.mjs'),
    import('./lib/preflight_integrity.mjs'),
    import('./lib/schema_validator.mjs'),
    import('./lib/semantic_state.mjs'),
  ]);

  const [contract, preflight] = await Promise.all([
    readFile(contractJsonPath, 'utf8').then(JSON.parse),
    readFile(preflightJsonPath, 'utf8').then(JSON.parse),
  ]);

  assertPreflightDocument(preflight);
  if (contract.sourcePreflightDigest !== preflight.preflightDigest) {
    throw rejection('CONTRACT_PREFLIGHT_MISMATCH');
  }
  if (contract.intent !== preflight.intent) {
    throw rejection('CONTRACT_INTENT_MISMATCH');
  }
  if (existsSync(resolutionPath)) {
    try {
      const resolution = JSON.parse(await readFile(resolutionPath, 'utf8'));
      if (Array.isArray(resolution.answers)) {
        for (const ans of resolution.answers) {
          const dec = (contract.decisions || []).find((d) => d.questionId === ans.questionId);
          if (dec && ans.answerId) {
            dec.selectedAnswerId = ans.answerId;
          }
        }
      }
    } catch (error) {
      throw rejection('INVALID_PREFLIGHT_RESOLUTION', error.message);
    }
  }

  let policy;
  let policyText;
  try {
    const architecturePolicy = loadArchitecturePolicy(root);
    policy = architecturePolicy.policy;
    policyText = architecturePolicy.policyText;
    assertSchema('aegis.architecture_policy.v1', policy);
  } catch (error) {
    throw rejection('ARCHITECTURE_POLICY_UNAVAILABLE', error.message);
  }

  const architecturePolicyDigest = sha256(policyText);
  contract.architecture.policyDigest = architecturePolicyDigest;
  contract.implementationAuthorized = false;
  contract.sourceSnapshotDigest = preflight.discovery.sourceSnapshotDigest;
  assertSchema('aegis.issue_contract.v2', contract);

  validateContract({
    contract,
    policy,
  });

  const currentDiscovery = discoverWorkspace(root, preflight.intent);
  if (currentDiscovery.sourceSnapshotDigest !== preflight.discovery.sourceSnapshotDigest) {
    throw rejection('SOURCE_SNAPSHOT_CHANGED');
  }
  if (canonicalDigest(currentDiscovery) !== canonicalDigest(preflight.discovery)) {
    throw rejection('DISCOVERY_EVIDENCE_MISMATCH');
  }

  const contractDigest = computeContractDigest(contract);
  const proofRegistry = createProofRegistry(contract);
  const proofRegistryDigest = canonicalDigest(proofRegistry);

  const statePath = semanticStatePath(root);
  await mkdir(dirname(statePath), { recursive: true });

  const semanticState = {
    schema: 'aegis.semantic_state.v2',
    contract,
    proofRegistry,
    digests: {
      contractSemanticDigest: contractDigest,
      proofRegistrySemanticDigest: proofRegistryDigest,
    },
  };

  let finalizedConfirmation;
  if (existsSync(userConfirmationPath)) {
    try {
      const existingReq = JSON.parse(await readFile(userConfirmationPath, 'utf8'));
      existingReq.status = 'FINALIZED';
      finalizedConfirmation = `${JSON.stringify(existingReq, null, 2)}\n`;
    } catch (error) {
      throw rejection('INVALID_CONFIRMATION_REQUEST', error.message);
    }
  }

  await Promise.all([
    writeFile(statePath, `${canonicalJson(semanticState)}\n`, 'utf8'),
    writeFile(contractJsonPath, `${canonicalJson(contract)}\n`, 'utf8'),
    writeFile(contractMdPath, `${renderContractMarkdown(contract, true, contractDigest, policy.rules)}\n`, 'utf8'),
    ...(finalizedConfirmation === undefined
      ? []
      : [writeFile(userConfirmationPath, finalizedConfirmation, 'utf8')]),
  ]);

  process.stdout.write(`${JSON.stringify({
    schema: 'aegis.preflight_finalization.v2',
    status: 'FINALIZED',
    contractDigest,
    evidenceState: 'GOVERNED',
    implementationAuthorized: false,
  })}\n`);
}

async function handleVerify() {
  const [
    { spawnSync },
    { canonicalJson, sha256 },
    { loadArchitecturePolicy, renderContractMarkdown },
    { semanticStatePath, parseSemanticState },
  ] = await Promise.all([
    import('node:child_process'),
    import('./lib/canonical_json.mjs'),
    import('./lib/issue_contract_core.mjs'),
    import('./lib/semantic_state.mjs'),
  ]);
  const statePath = semanticStatePath(root);
  if (!existsSync(statePath)) {
    throw rejection('NO_GOVERNED_CONTRACT', 'Execute ./aegis --approve primeiro.');
  }

  let semanticState;
  try {
    semanticState = parseSemanticState(JSON.parse(await readFile(statePath, 'utf8')));
  } catch (error) {
    throw rejection('INVALID_SEMANTIC_STATE', error.message);
  }

  const contract = semanticState.contract;
  const proofRegistry = semanticState.proofRegistry;
  const contractDigest = semanticState.digests.contractSemanticDigest;

  const proofs = proofRegistry.proofs ?? [];
  if (proofs.length === 0) {
    throw rejection('NO_ACTIVE_PROOFS_IN_REGISTRY');
  }

  const results = [];
  const executionCache = new Map();
  let executionsRun = 0;
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
      throw rejection('STATIC_GATE_FAILED', staticGate.stderr || staticGate.stdout);
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
      executionKey: 'aegis-static-gate',
      reusedExecution: false,
    });
    executionsRun += 1;
  }

  process.stdout.write(`[AEGIS][VERIFY] Verificando ${proofs.length} obrigações de prova física para o contrato ${contractDigest.slice(0, 12)}...\n`);
  for (const proof of proofs) {
    const executionIdentity = JSON.stringify([proof.executor, proof.argv]);
    let execution = executionCache.get(executionIdentity);
    const reusedExecution = Boolean(execution);

    if (!execution) {
      const sourcePath = proof.entrypoint ?? proof.argv?.at(-1);
      const fullPath = resolve(root, sourcePath);
      if (!existsSync(fullPath)) {
        throw rejection('PROOF_FILE_NOT_FOUND', sourcePath);
      }

      const sourceDigest = sha256(await readFile(fullPath));
      const startMs = Date.now();
      const child = spawnSync(proof.executor, proof.argv, {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
      });
      const durationMs = Date.now() - startMs;

      if (child.status !== 0) {
        throw rejection('PROOF_FAILED', `${proof.id}:${child.status}:${child.stderr || child.stdout}`);
      }

      execution = {
        durationMs,
        sourceDigest,
        executionKey: proof.executionKey,
      };
      executionCache.set(executionIdentity, execution);
      executionsRun += 1;
    }

    const reuseLabel = reusedExecution ? ', resultado reutilizado' : '';
    process.stdout.write(`  ✔ ${proof.id} (${proof.coverageKey}): PASS (${execution.durationMs}ms${reuseLabel})\n`);
    results.push({
      proofId: proof.id,
      coverageKey: proof.coverageKey,
      status: 'PASS',
      durationMs: execution.durationMs,
      sourceDigest: execution.sourceDigest,
      executionKey: execution.executionKey,
      reusedExecution,
    });
  }

  const receiptData = {
    schema: 'aegis.proof_verification_receipt.v1',
    status: 'PROVEN',
    contractDigest,
    proofRegistryDigest: semanticState.digests?.proofRegistrySemanticDigest,
    verifiedAtEpochMs: Date.now(),
    proofsCovered: results.length,
    executionsRun,
    results,
  };

  const receiptDigest = sha256(canonicalJson(receiptData));
  receiptData.receiptDigest = receiptDigest;

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
    proofsCovered: results.length,
    executionsRun,
  })}\n`);
}

const command = process.argv[2];
const remainingArgs = process.argv.slice(3);

try {
  if (command === 'draft') {
    await handleDraft(remainingArgs);
  } else if (command === 'validate-preflight') {
    await handleValidatePreflight();
  } else if (command === 'approve') {
    await handleApprove();
  } else if (command === 'verify') {
    await handleVerify();
  } else {
    throw rejection('UNKNOWN_INTERNAL_COMMAND', command);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : 'issue_runner_failed';
  const separator = message.indexOf(':');
  const rawReason = separator === -1 ? message : message.slice(0, separator);
  const inferredDetail = separator === -1 ? '' : message.slice(separator + 1).trim();
  const phase = command === 'draft' || command === 'validate-preflight'
    ? 'PREFLIGHT'
    : command === 'approve' ? 'APPROVAL' : command === 'verify' ? 'VERIFICATION' : 'COMMAND';
  process.stderr.write(`${JSON.stringify({
    schema: 'aegis.rejection.v1',
    status: 'REJECTED',
    phase,
    reason: rawReason.replace(/[^a-z0-9]+/giu, '_').toUpperCase(),
    ...(error?.detail || inferredDetail ? { detail: error?.detail || inferredDetail } : {}),
  })}\n`);
  process.exitCode = 1;
}

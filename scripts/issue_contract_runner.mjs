#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const root = resolve(process.env.AEGIS_ROOT ?? fileURLToPath(new URL('..', import.meta.url)));
const runtimeDir = resolve(root, '.harness/runtime');
const contractJsonPath = resolve(runtimeDir, 'contract.json');
const contractMdPath = resolve(runtimeDir, 'contract.md');
const preflightJsonPath = resolve(runtimeDir, 'preflight.json');
const preflightMdPath = resolve(runtimeDir, 'preflight.md');
const userConfirmationPath = resolve(runtimeDir, 'user_confirmation_request.json');
const resolutionPath = resolve(runtimeDir, 'preflight_resolution.json');
const receiptPath = resolve(runtimeDir, 'verification_receipt.json');

async function handleDraft(args) {
  const [
    { canonicalJson },
    { buildPreflightHandoff, discoverWorkspace, renderPreflightMarkdown, sanitizeInputText },
  ] = await Promise.all([
    import('./lib/canonical_json.mjs'),
    import('./lib/issue_contract_core.mjs'),
  ]);
  const rawBuffer = Buffer.from(args.join(' '), 'utf8');

  const sanitizedText = sanitizeInputText(rawBuffer);
  const discovery = discoverWorkspace(root, sanitizedText);
  const preflight = buildPreflightHandoff({ sanitizedText, discovery });

  await mkdir(runtimeDir, { recursive: true });
  await Promise.all([
    contractJsonPath,
    contractMdPath,
    userConfirmationPath,
    resolutionPath,
    receiptPath,
  ].map((path) => rm(path, { force: true })));
  await writeFile(preflightJsonPath, `${canonicalJson(preflight)}\n`, 'utf8');
  await writeFile(preflightMdPath, `${renderPreflightMarkdown(preflight)}\n`, 'utf8');

  process.stdout.write(`${JSON.stringify({
    schema: preflight.schema,
    status: preflight.status,
    phase: preflight.phase,
    title: preflight.title,
    dataPath: '.harness/runtime/preflight.json',
    artifactPath: '.harness/runtime/preflight.md',
  })}\n`);
}

async function handleApprove() {
  if (!existsSync(contractJsonPath)) {
    if (existsSync(preflightJsonPath)) {
      process.stderr.write('[AEGIS][FATAL] semantic_deliberation_required\n');
      process.exit(1);
    }
    process.stderr.write('[AEGIS][FATAL] missing_contract_draft\n');
    process.exit(1);
  }

  const [
    { canonicalDigest, canonicalJson, sha256 },
    { computeContractDigest, createProofRegistry, loadArchitecturePolicy, renderContractMarkdown, validateContract },
    { semanticStatePath },
  ] = await Promise.all([
    import('./lib/canonical_json.mjs'),
    import('./lib/issue_contract_core.mjs'),
    import('./lib/semantic_state.mjs'),
  ]);

  const contract = JSON.parse(await readFile(contractJsonPath, 'utf8'));

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

  validateContract({
    contract,
    policy,
  });

  const contractDigest = computeContractDigest(contract);
  const proofRegistry = createProofRegistry(contract);
  const proofRegistryDigest = canonicalDigest(proofRegistry);

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

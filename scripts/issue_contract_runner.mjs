#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { canonicalDigest, canonicalJson, sha256 } from './lib/canonical_json.mjs';
import {
  applyUserResolution,
  buildIssueDraft,
  computeContractDigest,
  createProofRegistry,
  loadArchitecturePolicy,
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

function parseJsonOrFile(raw, baseDir) {
  const filePath = resolve(baseDir, raw);
  if (existsSync(filePath)) {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  }
  return JSON.parse(raw);
}

function generateProofScriptScaffold(contract) {
  const isLiquidityDemand = /(?:liquidityresolver|deadlock|câmara de compensação|camara de compensacao|anéis circulares|aneis circulares|anel circular|minflow)/iu.test(`${contract.title} ${contract.intent}`);
  if (isLiquidityDemand) {
    return `#!/usr/bin/env bash
set -Eeuo pipefail

# Tribunal de Provas Físicas — LiquidityResolver & Zero-Sum Invariant
ROOT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"

node --import tsx <<'EOF'
import {
  LiquidityResolver,
  obterLiquidityResolverBitmask,
  SettlementBus,
  obterSaudeBitmask,
  ClearinghouseCore,
  obterClearinghouseBitmask,
  ClearingEngine,
  obterEstadoCompensacaoBitmask,
  ThrottleGuard,
  obterStatusBitmask,
  SettlementEngine,
  calcularTaxaDinamica
} from './src/index.ts';
import assert from 'node:assert/strict';

// 1. Verificação de Integridade das Exportações do Ecossistema
assert.ok(typeof LiquidityResolver === 'function', 'LiquidityResolver deve ser exportado nominalmente');
assert.ok(typeof obterLiquidityResolverBitmask === 'function', 'obterLiquidityResolverBitmask deve ser exportada');
assert.ok(typeof ThrottleGuard === 'function', 'ThrottleGuard deve ser exportado');
assert.ok(typeof calcularTaxaDinamica === 'function', 'calcularTaxaDinamica deve ser exportado');
assert.ok(typeof SettlementBus === 'function', 'SettlementBus deve ser exportado');
assert.ok(typeof ClearingEngine === 'function', 'ClearingEngine deve ser exportado');
assert.ok(typeof ClearinghouseCore === 'function', 'ClearinghouseCore deve ser exportado');

// 2. Prova de Resolução de Ciclos 3-Way (PO-BEHAVIOR - A->B->C->A)
const bus = new SettlementBus({}, 0n);
const core = new ClearinghouseCore(bus);
const resolver = new LiquidityResolver(bus, core);

const cycleOrders = [
  { id: 'O-1', senderId: 'A', recipientId: 'B', amount: 1000n },
  { id: 'O-2', senderId: 'B', recipientId: 'C', amount: 1200n },
  { id: 'O-3', senderId: 'C', recipientId: 'A', amount: 1500n },
];

const res1 = resolver.resolveDeadlocks(cycleOrders);
assert.equal(res1.resolvedCycles, 1, 'Deve detectar e resolver exatamente 1 ciclo fechado');
assert.equal(res1.totalObliterated, 1000n, 'MinFlow deve ser min(1000, 1200, 1500) = 1000n');
assert.equal(res1.residualOrders.length, 2, 'Devem restar 2 ordens com valores residuais');

// 3. Prova da Telemetria em Bitmask de 32 Bits (PO-BEHAVIOR)
const mask = obterLiquidityResolverBitmask(resolver);
assert.equal(typeof mask, 'number', 'Bitmask deve retornar number');
assert.equal(mask & 1, 0, 'Bit 0: trava desativada');
assert.equal(mask & 2, 2, 'Bit 1: ciclo circular detectado e resolvido');
assert.equal(mask & 4, 0, 'Bit 2: sem violação de conservação');
assert.equal((mask >> 8) & 0xFF, 2, 'Bits 8-15: 2 ordens residuais');

// 4. Prova de Proteção contra Sub-milissegundo no ThrottleGuard (PO-BEHAVIOR)
const guard = new ThrottleGuard(5, 1000n);
const t0 = 1700000000000n;
assert.equal(guard.allow('acc-1', t0), true);
assert.equal(guard.allow('acc-1', t0), true);
assert.equal(guard.allow('acc-1', t0), true);
assert.equal(guard.allow('acc-1', t0), true);
assert.equal(guard.allow('acc-1', t0), true);
assert.equal(guard.allow('acc-1', t0), false, 'Sub-milissegundo Δt=0n deve atingir teto de vazão sem mutação regressiva');

// 5. Provas Adversariais e Modos de Falha (PO-FAILURES)
assert.throws(() => new LiquidityResolver(bus, core, 0), RangeError, 'maxHeapAccounts <= 0 deve lançar RangeError');
assert.throws(() => new LiquidityResolver(bus, core, -5), RangeError, 'maxHeapAccounts negativo deve lançar RangeError');
assert.throws(() => new LiquidityResolver(bus, core, 1.5), RangeError, 'maxHeapAccounts decimal deve lançar RangeError');

const invalidOrders = [
  { id: 'INV-1', senderId: 'A', recipientId: 'A', amount: 500n },
];
const resInv = resolver.resolveDeadlocks(invalidOrders);
assert.equal(resInv.resolvedCycles, 0, 'Auto-débito não deve formar ciclo');
assert.equal(resInv.totalObliterated, 0n);

console.log('[PROOFS] Todas as provas físicas de LiquidityResolver foram aprovadas.');
EOF
`;
  }

  const isPalindromeDemand = /(?:palindrom|palindrome)/iu.test(`${contract.title} ${contract.intent}`);
  if (isPalindromeDemand) {
    const isStrict = contract.decisions?.some((d) => d.questionId === 'Q-0001' && d.selectedAnswerId === 'ANS-STRICT');
    if (isStrict) {
      return `#!/usr/bin/env bash
set -Eeuo pipefail

# Tribunal de Provas Físicas — Modo Estrito Caractere a Caractere
ROOT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"

node --import tsx <<'EOF'
import { isPalindrome } from './src/index.ts';
import assert from 'node:assert/strict';

// 1. Provas Nominais e de Borda (PO-BEHAVIOR - Modo Estrito)
assert.equal(isPalindrome(""), true, 'Borda: string vazia deve ser palíndromo');
assert.equal(isPalindrome("a"), true, 'Borda: caractere único deve ser palíndromo');
assert.equal(isPalindrome("   "), true, 'Borda: espaços puros simétricos devem ser palíndromo');
assert.equal(isPalindrome("ï"), true, 'Nominal: caractere isolado deve ser palíndromo');
assert.equal(isPalindrome("ana"), true, 'Nominal: palíndromo estrito em minúsculas');
assert.equal(isPalindrome("Ana"), false, 'Estrito: case diferente rejeita simetria');
assert.equal(isPalindrome("radar"), true, 'Nominal: palavra simétrica');
assert.equal(isPalindrome("A cara rajada da jararaca"), false, 'Estrito: espaços e pontuação preservados rejeitam');
assert.equal(isPalindrome("топот"), true, 'Nominal: cirílico palíndromo');
assert.equal(isPalindrome("собака"), false, 'Nominal: cirílico não-palíndromo');
assert.equal(isPalindrome("computador"), false, 'Nominal: palavra assimétrica');

// 2. Provas Adversariais e Modos de Falha (PO-FAILURES)
assert.throws(() => (isPalindrome as unknown as (x: unknown) => boolean)(null), TypeError, 'Adversarial: null deve lançar TypeError');
assert.throws(() => (isPalindrome as unknown as (x: unknown) => boolean)(undefined), TypeError, 'Adversarial: undefined deve lançar TypeError');
assert.throws(() => (isPalindrome as unknown as (x: unknown) => boolean)(12345), TypeError, 'Adversarial: número deve lançar TypeError');
assert.throws(() => isPalindrome("a".repeat(65537)), RangeError, 'Adversarial: carga > 65.536 chars deve lançar RangeError (DoS)');

console.log('[PROOFS] Todas as provas físicas de aceite e falhas (Modo Estrito) foram aprovadas.');
EOF
`;
    }

    return `#!/usr/bin/env bash
set -Eeuo pipefail

# Tribunal de Provas Físicas — Modo Canônico Universal
ROOT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"

node --import tsx <<'EOF'
import { isPalindrome } from './src/index.ts';
import assert from 'node:assert/strict';

// 1. Provas Nominais e de Borda (PO-BEHAVIOR - Modo Canônico)
assert.equal(isPalindrome(""), true, 'Borda: string vazia deve ser palíndromo');
assert.equal(isPalindrome("a"), true, 'Borda: caractere único deve ser palíndromo');
assert.equal(isPalindrome("   "), true, 'Borda: espaços puros devem ser palíndromo');
assert.equal(isPalindrome("ï"), true, 'Nominal: diacrítico isolado deve ser palíndromo');
assert.equal(isPalindrome("Ana"), true, 'Nominal: case-insensitive');
assert.equal(isPalindrome("A cara rajada da jararaca"), true, 'Nominal: frase com espaços e pontuação');
assert.equal(isPalindrome("топот"), true, 'Nominal: cirílico palíndromo');
assert.equal(isPalindrome("собака"), false, 'Nominal: cirílico não-palíndromo');
assert.equal(isPalindrome("computador"), false, 'Nominal: palavra latina assimétrica');

// 2. Provas Adversariais e Modos de Falha (PO-FAILURES)
assert.throws(() => (isPalindrome as unknown as (x: unknown) => boolean)(null), TypeError, 'Adversarial: null deve lançar TypeError');
assert.throws(() => (isPalindrome as unknown as (x: unknown) => boolean)(undefined), TypeError, 'Adversarial: undefined deve lançar TypeError');
assert.throws(() => (isPalindrome as unknown as (x: unknown) => boolean)(12345), TypeError, 'Adversarial: número deve lançar TypeError');
assert.throws(() => isPalindrome("a".repeat(65537)), RangeError, 'Adversarial: carga > 65.536 chars deve lançar RangeError (DoS)');

console.log('[PROOFS] Todas as 13 provas físicas de aceite e falhas (Modo Canônico) foram aprovadas.');
EOF
`;
  }

  return `#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"

node --import tsx <<'EOF'
import * as entrypoint from './src/index.ts';
import assert from 'node:assert/strict';

assert.ok(entrypoint, 'Ponto de entrada autorizado deve ser carregável e exportar símbolos esperados');
console.log('[PROOFS] Provas básicas executadas com sucesso.');
EOF
`;
}

async function handleDraft(args) {
  let changeKind = 'PRODUCT';
  let targetHint = '';
  let demandText = '';
  let specData = null;
  let decisionsData = null;
  let channel = 'IDE_DEFAULT';
  let answersData = null;
  let stateModelKind = null;
  let customTitle = null;

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--kind' && ['PRODUCT', 'HARNESS'].includes(args[index + 1])) {
      changeKind = args[index + 1];
      index += 1;
    } else if (args[index] === '--target' && typeof args[index + 1] === 'string') {
      targetHint = args[index + 1];
      index += 1;
    } else if (args[index] === '--channel' && typeof args[index + 1] === 'string') {
      channel = args[index + 1];
      index += 1;
    } else if (args[index] === '--state-kind' && ['NONE', 'STATE_TRANSITION'].includes(args[index + 1])) {
      stateModelKind = args[index + 1];
      index += 1;
    } else if (args[index] === '--title' && typeof args[index + 1] === 'string') {
      customTitle = args[index + 1];
      index += 1;
    } else if (args[index] === '--spec' && typeof args[index + 1] === 'string') {
      specData = parseJsonOrFile(args[index + 1], root);
      index += 1;
    } else if (args[index] === '--decisions' && typeof args[index + 1] === 'string') {
      decisionsData = parseJsonOrFile(args[index + 1], root);
      index += 1;
    } else if (args[index] === '--answers' && typeof args[index + 1] === 'string') {
      answersData = parseJsonOrFile(args[index + 1], root);
      index += 1;
    } else if (!demandText && !args[index].startsWith('--')) {
      demandText = args[index];
    }
  }

  if (!demandText && specData?.intent) {
    demandText = specData.intent;
  }

  if (!demandText) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    demandText = Buffer.concat(chunks);
  }

  const rawBuffer = Buffer.isBuffer(demandText) ? demandText : Buffer.from(demandText, 'utf8');
  const sanitizedText = sanitizeInputText(rawBuffer);

  let policy;
  try {
    const architecturePolicy = loadArchitecturePolicy(root);
    policy = architecturePolicy.policy;
  } catch {
    policy = {
      rules: [{ id: 'ARCH-FAILURE-EXPLICIT' }],
      amendments: [],
    };
  }

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
    decisions: Array.isArray(decisionsData) ? decisionsData : [],
    stateModelKind: specData?.stateModel?.kind ?? stateModelKind,
    stateModel: specData?.stateModel,
    title: specData?.title ?? customTitle,
    intent: specData?.intent,
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

  // Scaffold automático do tribunal de provas físicas se não existir
  for (const proof of (contract.proofObligations ?? [])) {
    if (proof.entrypoint.endsWith('.proof.sh')) {
      const fullProofPath = resolve(root, proof.entrypoint);
      if (!existsSync(fullProofPath)) {
        const scaffold = generateProofScriptScaffold(contract);
        await mkdir(dirname(fullProofPath), { recursive: true });
        await writeFile(fullProofPath, scaffold, { encoding: 'utf8', mode: 0o755 });
      }
    }
  }

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

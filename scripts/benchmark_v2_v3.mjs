#!/usr/bin/env node

import { performance } from 'node:perf_hooks';

import { observeWorkspace, buildPreflightHandoff } from './lib/issue_contract_core.mjs';
import { canonicalJson } from './lib/canonical_json.mjs';
import { assertSchema } from './lib/schema_validator.mjs';

const root = process.cwd();
const demand = `Estender cirurgicamente o motor em src/ledger/settlement_engine.ts e a validação em src/risk/velocity_guard.ts para suportar a operação reverseSettlement sobre SettlementLedgerState, preservando intactos os limites atuais de MAX_PENDING_SETTLEMENTS, DAILY_SETTLEMENT_LIMIT_CENTS e MAX_BATCH_REJECTIONS já definidos no código-fonte e mantendo src/ledger/fee_calculator.ts inalterado. Na operação processSettlementBatch, inserir a nova guarda GUARD_DISPUTE_HOLD_ACTIVE imediatamente após GUARD_ACCOUNT_FROZEN e antes de GUARD_DAILY_LIMIT_EXCEEDED. Ao executar reverseSettlement de um valor já liquidado no mesmo dia, o impacto sobre o acumulador diário dailySettledCents ainda precisa ser definido.`;

console.log('='.repeat(75));
console.log('AEGIS PRODUCTION VERIFICATION: PREFLIGHT v3 (AST SKELETON)');
console.log('='.repeat(75));

// --- RUN v3 BENCHMARK ---
const startV3 = performance.now();
const obsV3 = observeWorkspace(root, demand);
const preflightV3 = buildPreflightHandoff({ demand, discovery: obsV3.discovery, version: 'v3' });
assertSchema('aegis.preflight_handoff.v3', preflightV3);
const elapsedV3 = performance.now() - startV3;

const v3SkeletonJson = canonicalJson(obsV3.workspaceSkeleton);
const v3PreflightJson = canonicalJson(preflightV3);
const v3SkeletonBytes = Buffer.byteLength(v3SkeletonJson, 'utf8');
const v3PreflightBytes = Buffer.byteLength(v3PreflightJson, 'utf8');

// --- RELEVANT CONTRACT SYMBOLS AUDIT (Demanda 11 Requirements) ---
const requiredSymbols = [
  { name: 'MAX_PENDING_SETTLEMENTS', file: 'src/ledger/settlement_engine.ts' },
  { name: 'DAILY_SETTLEMENT_LIMIT_CENTS', file: 'src/ledger/settlement_engine.ts' },
  { name: 'MAX_BATCH_REJECTIONS', file: 'src/risk/velocity_guard.ts' },
  { name: 'SettlementLedgerState', file: 'src/ledger/settlement_engine.ts' },
  { name: 'processSettlementBatch', file: 'src/ledger/settlement_engine.ts' },
  { name: 'evaluateSettlementGuards', file: 'src/risk/velocity_guard.ts' },
  { name: 'calculateSettlementFeeCents', file: 'src/ledger/fee_calculator.ts' },
];

const v3SymbolsPresent = requiredSymbols.map(sym => {
  const match = obsV3.workspaceSkeleton.symbols.find(s => s.name === sym.name && s.path === sym.file);
  return {
    ...sym,
    found: Boolean(match),
    kind: match?.kind,
    signature: match?.signature?.slice(0, 80),
  };
});

// --- DISPLAY RESULTS ---
console.log('\n[1. METRICAS DE PAYLOAD E EFICIENCIA]');
console.log(`• v3 Workspace Skeleton (AST em disco):  ${v3SkeletonBytes.toLocaleString()} bytes (~${(v3SkeletonBytes/1024).toFixed(1)} KB)`);
console.log(`• v3 Preflight Handoff completo:         ${v3PreflightBytes.toLocaleString()} bytes`);
console.log(`• Total de símbolos extraídos:           ${obsV3.workspaceSkeleton.symbolCount}`);

console.log('\n[2. LATENCIA E TEMPO DE PROCESSAMENTO]');
console.log(`• Tempo de execução v3 (AST TypeScript):   ${elapsedV3.toFixed(2)} ms`);

console.log('\n[3. COBERTURA DOS CONTRATOS DA DEMANDA 11 (GROUND TRUTH)]');
v3SymbolsPresent.forEach(item => {
  const status = item.found ? '✓ PRESENTE' : '✗ AUSENTE';
  console.log(`  ${status} [${item.kind || 'N/A'}] ${item.name} (${item.file})`);
  if (item.signature) console.log(`      Assinatura: "${item.signature}..."`);
});
console.log('='.repeat(75));

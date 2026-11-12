#!/usr/bin/env node

/**
 * Benchmark Adversarial: Colisão Real Askesis vs Ledger
 * 
 * O workspace atual contém 210 arquivos em src/ (204 do Askesis + 6 do Ledger).
 * Testamos se uma demanda com vocabulário ambíguo (conta, histórico, eventos, segurança)
 * consegue filtrar cirurgicamente o Ledger sem ser contaminada pelo Askesis.
 */

import { performance } from 'node:perf_hooks';
import { observeWorkspace, buildPreflightHandoff, loadArchitecturePolicy } from '../scripts/lib/issue_contract_core.mjs';
import { loadSemanticConstitution, buildSemanticRequest } from '../scripts/lib/semantic_request.mjs';

const root = process.cwd();
const demand = 'Permitir estornar a liquidação financeira no histórico da conta preservando o teto diário de cinquenta mil reais e validando as guardas de segurança antifraude, registrando o evento no log de auditoria.';

console.log('='.repeat(80));
console.log('AEGIS BENCHMARK ADVERSARIAL: COLISAO REAL ASKESIS (204 ARQUIVOS) VS LEDGER');
console.log('='.repeat(80));

console.log('\n[1. DEMANDA AMBIGUA SUBMETIDA]');
console.log(`"${demand}"`);

// 1. DISCOVERY & AST EXTRACTION SOBRE 210 ARQUIVOS
const t0 = performance.now();
const obs = observeWorkspace(root, demand);
const preflight = buildPreflightHandoff({ demand, discovery: obs.discovery, version: 'v3' });
const tDiscovery = performance.now() - t0;

console.log('\n[2. METRICAS DE PROCESSAMENTO MONOREPO]');
console.log(`• Arquivos escaneados em src/:          ${obs.discovery.files.length}`);
console.log(`• Volume total lido em bytes:          ${obs.discovery.scannedBytes.toLocaleString()} bytes (~${(obs.discovery.scannedBytes / 1024 / 1024).toFixed(2)} MB)`);
console.log(`• Total de símbolos extraídos na AST:  ${obs.discovery.workspaceSkeleton.symbolCount}`);
console.log(`• Tempo de processamento Discovery:    ${tDiscovery.toFixed(2)} ms`);

// 2. MONTAGEM DO SEMANTIC REQUEST
const { policy } = loadArchitecturePolicy(root);
const constitution = loadSemanticConstitution(root);

const t1 = performance.now();
const req = buildSemanticRequest({
  repositoryRoot: root,
  preflight,
  policy,
  constitution,
  workspaceObservation: obs,
});
const tRequest = performance.now() - t1;

console.log(`• Tempo de montagem SemanticRequest:   ${tRequest.toFixed(2)} ms`);
console.log(`• Tempo total de ponta a ponta:        ${(tDiscovery + tRequest).toFixed(2)} ms`);

// 3. AUDITORIA FORENSE DA EVIDENCIA FISICA ENTREGUE
console.log('\n[3. AUDITORIA FORENSE DA EVIDENCIA FISICA (32 KB CAP)]');
const evidence = req.workspace.sourceEvidence || [];
const totalEvidenceBytes = evidence.reduce((acc, e) => acc + Buffer.byteLength(e.content, 'utf8'), 0);

console.log(`• Arquivos entregues no corte:         ${evidence.length}`);
console.log(`• Orçamento consumido:                 ${totalEvidenceBytes.toLocaleString()} / 32,768 bytes (${((totalEvidenceBytes / 32768) * 100).toFixed(1)}%)`);

let ledgerFilesCount = 0;
let askesisFilesCount = 0;

console.log('\nLista de arquivos entregues para a IA:');
evidence.forEach((e, idx) => {
  const isLedger = e.path.startsWith('src/ledger/') || e.path.startsWith('src/risk/') || e.path.startsWith('src/reporting/') || e.path === 'src/index.ts';
  const isAskesis = e.path.startsWith('src/askesis/');
  if (isLedger) ledgerFilesCount++;
  if (isAskesis) askesisFilesCount++;
  const label = isLedger ? '[LEDGER - ALVO]' : (isAskesis ? '[ASKESIS - RUIDO]' : '[OUTRO]');
  console.log(`  #${idx + 1}: ${e.path.padEnd(50)} ${label}`);
});

// 4. VERIFICAÇÃO DE CONTAMINAÇÃO E PRECISÃO
console.log('\n[4. RELATORIO DE PRECISÃO E REJEIÇÃO DE RUIDO]');
console.log(`• Arquivos do Ledger Capturados:  ${ledgerFilesCount}`);
console.log(`• Arquivos do Askesis Infiltrados: ${askesisFilesCount}`);

const contaminationRate = (askesisFilesCount / evidence.length) * 100;
console.log(`• Taxa de Contaminação de Ruído:   ${contaminationRate.toFixed(1)}%`);

// 5. TOP 10 SÍMBOLOS DO SKELETON
console.log('\n[5. TOP 10 SÍMBOLOS PRIORIZADOS NO ESQUELETO]');
const skeletonSymbols = req.workspace.workspaceSkeleton?.symbols || [];
skeletonSymbols.slice(0, 10).forEach((s, idx) => {
  const isLedger = s.path.startsWith('src/ledger/') || s.path.startsWith('src/risk/') || s.path.startsWith('src/reporting/') || s.path === 'src/index.ts';
  const tag = isLedger ? '✓ LEDGER' : '✗ ASKESIS';
  console.log(`  #${idx + 1}: [${s.kind}] ${s.name.padEnd(35)} (${s.path}) ${tag}`);
});

console.log('\n' + '='.repeat(80));
if (ledgerFilesCount > 0 && askesisFilesCount === 0) {
  console.log('RESULTADO: ISOLAMENTO CIRURGICO PERFEITO (ZERO CONTAMINACAO)');
} else if (ledgerFilesCount > 0 && askesisFilesCount <= 2) {
  console.log('RESULTADO: ISOLAMENTO ALTO COM CONTAMINACAO RESIDUAL MARGINAL');
} else {
  console.log('RESULTADO: CONTAMINACAO SIGNIFICATIVA DE RUIDO');
}
console.log('='.repeat(80));


import { performance } from 'node:perf_hooks';
import { observeWorkspace, loadArchitecturePolicy, buildPreflightHandoff } from '../scripts/lib/issue_contract_core.mjs';
import { loadSemanticConstitution, buildSemanticRequest } from '../scripts/lib/semantic_request.mjs';

const root = process.cwd();
const { policy } = loadArchitecturePolicy(root);
const constitution = loadSemanticConstitution(root);

console.log('='.repeat(80));
console.log('BATERIA DE CENÁRIOS AVANÇADOS: CROSS-MODULE & POLISSEMIA ADVERSARIAL');
console.log('='.repeat(80));

// ============================================================================
// CENÁRIO 1: DEMANDA CROSS-MODULE MULTI-DOMÍNIO SIMULTÂNEA
// ============================================================================
console.log('\n>>> CENÁRIO 1: Demanda Cross-Module Multi-Domínio');
const demandCross = 'Gerar relatorio analitico em CSV dos limites de velocidade de risco e das tarifas de liquidacao mercantil.';
console.log(`Demanda: "${demandCross}"`);

const t0 = performance.now();
const obsCross = observeWorkspace(root, demandCross);
const preflightCross = buildPreflightHandoff({ demand: demandCross, discovery: obsCross.discovery, version: 'v3' });
const reqCross = buildSemanticRequest({
  repositoryRoot: root,
  preflight: preflightCross,
  policy,
  constitution,
  workspaceObservation: obsCross,
});
const tCross = performance.now() - t0;

console.log(`\n• Tempo de resolução: ${tCross.toFixed(2)} ms`);
console.log(`• Total de arquivos na evidência física: ${reqCross.workspace.sourceEvidence.length}`);

const deliveredPaths = reqCross.workspace.sourceEvidence.map((e) => e.path);
console.log('• Arquivos entregues:');
for (const item of reqCross.workspace.sourceEvidence) {
  const bytes = Buffer.byteLength(item.content, 'utf8');
  console.log(`  - ${item.path.padEnd(40)} | ${item.selection.padEnd(16)} | ${bytes} bytes | L${item.startLine}..L${item.endLine}`);
}

const hasReporting = deliveredPaths.some((p) => p.includes('reporting'));
const hasRisk = deliveredPaths.some((p) => p.includes('risk'));
const hasLedger = deliveredPaths.some((p) => p.includes('ledger'));

console.log('\n• Verificação de Presença Multi-Módulo:');
console.log(`  - Reporting (CSV Exporter): ${hasReporting ? 'PRESENTE' : 'AUSENTE'}`);
console.log(`  - Risk (Velocity Guard):   ${hasRisk ? 'PRESENTE' : 'AUSENTE'}`);
console.log(`  - Ledger (Fee / Settle):   ${hasLedger ? 'PRESENTE' : 'AUSENTE'}`);

// ============================================================================
// CENÁRIO 2: POLISSEMIA E HOMÔNIMOS ENGANOSOS (ASKESIS VS LEDGER)
// ============================================================================
console.log('\n' + '='.repeat(80));
console.log('>>> CENÁRIO 2: Polissemia e Homônimos Enganosos');
const demandPoly = 'Expurgar e resetar o historico e eventos de auditoria com purge de sincronizacao de contratos.';
console.log(`Demanda: "${demandPoly}"`);

const t1 = performance.now();
const obsPoly = observeWorkspace(root, demandPoly);
const preflightPoly = buildPreflightHandoff({ demand: demandPoly, discovery: obsPoly.discovery, version: 'v3' });
const reqPoly = buildSemanticRequest({
  repositoryRoot: root,
  preflight: preflightPoly,
  policy,
  constitution,
  workspaceObservation: obsPoly,
});
const tPoly = performance.now() - t1;

console.log(`\n• Tempo de resolução: ${tPoly.toFixed(2)} ms`);
console.log(`• Total de arquivos na evidência física: ${reqPoly.workspace.sourceEvidence.length}`);
console.log('• Arquivos entregues:');
for (const item of reqPoly.workspace.sourceEvidence) {
  const bytes = Buffer.byteLength(item.content, 'utf8');
  console.log(`  - ${item.path.padEnd(45)} | ${item.selection.padEnd(16)} | ${bytes} bytes | L${item.startLine}..L${item.endLine}`);
}

const askesisMatches = reqPoly.workspace.sourceEvidence.filter((e) => e.path.startsWith('src/askesis/'));
const ledgerMatches = reqPoly.workspace.sourceEvidence.filter((e) => !e.path.startsWith('src/askesis/'));
console.log(`\n• Proporção da disputa: Askesis (${askesisMatches.length}) vs Core/Ledger (${ledgerMatches.length})`);


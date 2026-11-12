import { performance } from 'node:perf_hooks';
import { observeWorkspace, buildPreflightHandoff, loadArchitecturePolicy } from '../scripts/lib/issue_contract_core.mjs';
import { loadSemanticConstitution, buildSemanticRequest } from '../scripts/lib/semantic_request.mjs';
import { sourceEvidenceByteLimit, sourceEvidenceFileByteLimit } from '../scripts/lib/semantic_authority.mjs';

const root = process.cwd();

console.log('='.repeat(80));
console.log(`AEGIS EXPERIMENTO COMPARATIVO: IMPACTO DE 64 KB VS 32 KB`);
console.log(`sourceEvidenceByteLimit atual configurado: ${sourceEvidenceByteLimit.toLocaleString()} bytes (64 KB)`);
console.log(`sourceEvidenceFileByteLimit:             ${sourceEvidenceFileByteLimit.toLocaleString()} bytes (8 KB por arquivo)`);
console.log('='.repeat(80));

const demands = [
  {
    title: 'CASO 1: Módulo Financeiro & Risco (Ledger + Risk)',
    demand: 'No módulo de liquidação e risco (src/ledger, src/risk), permitir estornar a liquidação financeira no histórico da conta preservando o teto diário de cinquenta mil reais e validando as guardas de segurança antifraude, registrando o evento no log de auditoria.',
    targetPrefixes: ['src/ledger/', 'src/risk/', 'src/index.ts'],
  },
  {
    title: 'CASO 2: Notificações & Hábitos (Askesis PWA)',
    demand: 'No módulo de hábitos e notificações do Askesis (src/askesis/services/push.ts), configurar o lembrete de notificação diária respeitando a permissão do usuário.',
    targetPrefixes: ['src/askesis/services/push.ts', 'src/askesis/api/reminder.ts', 'src/askesis/services/notificationCard.ts', 'src/askesis/services/persistence.ts'],
  },
  {
    title: 'CASO 3: Compliance & Exportação CSV (Reporting)',
    demand: 'No módulo de compliance e auditoria (src/reporting/audit_csv_exporter.ts), gerar o cabeçalho do arquivo CSV de conformidade validando o delimitador de colunas e suprimindo o cabeçalho quando desativado.',
    targetPrefixes: ['src/reporting/audit_csv_exporter.ts'],
  }
];

const { policy } = loadArchitecturePolicy(root);
const constitution = loadSemanticConstitution(root);

for (const { title, demand, targetPrefixes } of demands) {
  console.log(`\n>>> ${title}`);
  console.log(`Demanda: "${demand}"`);

  const t0 = performance.now();
  const obs = observeWorkspace(root, demand);
  const preflight = buildPreflightHandoff({ demand, discovery: obs.discovery, version: 'v3' });
  const tDiscovery = performance.now() - t0;

  const t1 = performance.now();
  const req = buildSemanticRequest({
    repositoryRoot: root,
    preflight,
    policy,
    constitution,
    workspaceObservation: obs,
  });
  const tRequest = performance.now() - t1;

  const evidence = req.workspace.sourceEvidence || [];
  const totalBytes = evidence.reduce((acc, e) => acc + Buffer.byteLength(e.content, 'utf8'), 0);

  let targetFiles = 0;
  let noiseFiles = 0;
  let targetBytes = 0;
  let noiseBytes = 0;

  console.log('\nArquivos entregues com o limite de 64 KB:');
  evidence.forEach((e, idx) => {
    const isTarget = targetPrefixes.some((p) => e.path === p || e.path.startsWith(p));
    const bytes = Buffer.byteLength(e.content, 'utf8');
    if (isTarget) {
      targetFiles++;
      targetBytes += bytes;
    } else {
      noiseFiles++;
      noiseBytes += bytes;
    }
    const tag = isTarget ? '✓ ALVO' : '✗ SOBRA/RUIDO';
    console.log(`  #${idx + 1}: ${e.path.padEnd(48)} ${tag} (${bytes.toLocaleString()} bytes, ${e.selection})`);
  });

  console.log(`\n• Arquivos no corte: ${evidence.length} (Alvos úteis: ${targetFiles}, Sobra: ${noiseFiles})`);
  console.log(`• Bytes consumidos:  ${totalBytes.toLocaleString()} / 65,536 bytes (${((totalBytes / 65536) * 100).toFixed(1)}%)`);
  console.log(`• Bytes ÚTEIS:       ${targetBytes.toLocaleString()} bytes (${((targetBytes / totalBytes) * 100).toFixed(1)}% do pacote)`);
  console.log(`• Bytes SOBRA:       ${noiseBytes.toLocaleString()} bytes (${((noiseBytes / totalBytes) * 100).toFixed(1)}% do pacote)`);
  console.log(`• Tempo total:       ${(tDiscovery + tRequest).toFixed(2)} ms`);
  console.log('-'.repeat(80));
}


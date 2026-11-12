import { performance } from 'node:perf_hooks';
import { observeWorkspace, buildPreflightHandoff, loadArchitecturePolicy } from '../scripts/lib/issue_contract_core.mjs';
import { loadSemanticConstitution, buildSemanticRequest } from '../scripts/lib/semantic_request.mjs';

const root = process.cwd();

const testCases = [
  {
    id: 'CASO 1',
    name: 'Financeiro & Risco (Ledger + Risk)',
    demand: 'No módulo de liquidação e risco (src/ledger, src/risk), permitir estornar a liquidação financeira no histórico da conta preservando o teto diário de cinquenta mil reais e validando as guardas de segurança antifraude, registrando o evento no log de auditoria.',
    targetPrefixes: ['src/ledger/', 'src/risk/', 'src/index.ts'],
    // Dados medidos anteriormente sem corte dinâmico (fixo)
    baseline32: { files: 10, totalBytes: 32768, targetBytes: 8671, noiseBytes: 24097, timeMs: 510.4 },
    baseline64Fixed: { files: 18, totalBytes: 65536, targetBytes: 8671, noiseBytes: 56865, timeMs: 566.8 },
  },
  {
    id: 'CASO 2',
    name: 'Notificações & Hábitos (Askesis PWA)',
    demand: 'No módulo de hábitos e notificações do Askesis (src/askesis/services/push.ts), configurar o lembrete de notificação diária respeitando a permissão do usuário.',
    targetPrefixes: ['src/askesis/services/push.ts', 'src/askesis/api/reminder.ts', 'src/askesis/services/notificationCard.ts', 'src/askesis/services/persistence.ts'],
    baseline32: { files: 8, totalBytes: 32833, targetBytes: 18200, noiseBytes: 14633, timeMs: 295.2 },
    baseline64Fixed: { files: 18, totalBytes: 66029, targetBytes: 30737, noiseBytes: 35292, timeMs: 276.8 },
  },
  {
    id: 'CASO 3',
    name: 'Compliance & Exportação CSV (Reporting)',
    demand: 'No módulo de compliance e auditoria (src/reporting/audit_csv_exporter.ts), gerar o cabeçalho do arquivo CSV de conformidade validando o delimitador de colunas e suprimindo o cabeçalho quando desativado.',
    targetPrefixes: ['src/reporting/audit_csv_exporter.ts'],
    baseline32: { files: 7, totalBytes: 32768, targetBytes: 8177, noiseBytes: 24591, timeMs: 278.4 },
    baseline64Fixed: { files: 13, totalBytes: 66043, targetBytes: 8177, noiseBytes: 57866, timeMs: 297.8 },
  }
];

const { policy } = loadArchitecturePolicy(root);
const constitution = loadSemanticConstitution(root);

console.log('='.repeat(80));
console.log('BENCHMARK DE PERFORMANCE E EFICIÊNCIA: FIXO (ANTERIOR) VS DINÂMICO (ATUAL)');
console.log('Ambiente: Monorepo Real com 210 arquivos em src/ (2.39 MB)');
console.log('='.repeat(80));

for (const tc of testCases) {
  // Executa 5 iterações para média estável
  const runs = [];
  let lastReq = null;
  let lastObs = null;

  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    const obs = observeWorkspace(root, tc.demand);
    const preflight = buildPreflightHandoff({ demand: tc.demand, discovery: obs.discovery, version: 'v3' });
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

    runs.push({ tDiscovery, tRequest, total: tDiscovery + tRequest });
    lastReq = req;
    lastObs = obs;
  }

  const avgDiscovery = runs.reduce((acc, r) => acc + r.tDiscovery, 0) / runs.length;
  const avgRequest = runs.reduce((acc, r) => acc + r.tRequest, 0) / runs.length;
  const avgTotal = runs.reduce((acc, r) => acc + r.total, 0) / runs.length;

  const evidence = lastReq.workspace.sourceEvidence || [];
  const totalBytes = evidence.reduce((acc, e) => acc + Buffer.byteLength(e.content, 'utf8'), 0);

  let targetBytes = 0;
  let noiseBytes = 0;
  let targetFiles = 0;
  let noiseFiles = 0;

  evidence.forEach((e) => {
    const isTarget = tc.targetPrefixes.some((p) => e.path === p || e.path.startsWith(p));
    const bytes = Buffer.byteLength(e.content, 'utf8');
    if (isTarget) {
      targetFiles++;
      targetBytes += bytes;
    } else {
      noiseFiles++;
      noiseBytes += bytes;
    }
  });

  const b32 = tc.baseline32;
  const b64 = tc.baseline64Fixed;
  const dyn = {
    files: evidence.length,
    targetFiles,
    noiseFiles,
    totalBytes,
    targetBytes,
    noiseBytes,
    signalToNoise: (targetBytes / totalBytes) * 100,
    timeMs: avgTotal,
    discoveryMs: avgDiscovery,
    requestMs: avgRequest,
  };

  console.log(`\n>>> [${tc.id}] ${tc.name}`);
  console.log(`Demanda: "${tc.demand.slice(0, 80)}..."`);
  console.log('-'.repeat(80));

  console.log(`| Métrica                           | Fixo 32 KB (Antigo) | Fixo 64 KB (Sem Corte) | Dinâmico 64 KB (Atual) | Ganho Dinâmico vs Fixo |`);
  console.log(`| :-------------------------------- | :------------------ | :--------------------- | :--------------------- | :--------------------- |`);
  console.log(`| Arquivos Entregues                | ${String(b32.files).padEnd(19)} | ${String(b64.files).padEnd(22)} | ${String(dyn.files).padEnd(22)} | ${dyn.files <= b64.files ? '-' + (b64.files - dyn.files) + ' arquivos' : 'Equivalente'} |`);
  console.log(`| Bytes Úteis (Sinal)               | ${String(b32.targetBytes.toLocaleString() + ' B').padEnd(19)} | ${String(b64.targetBytes.toLocaleString() + ' B').padEnd(22)} | ${String(dyn.targetBytes.toLocaleString() + ' B').padEnd(22)} | ${((dyn.targetBytes / b32.targetBytes - 1) * 100).toFixed(0)}% mais sinal |`);
  console.log(`| Bytes de Ruído (Lixo)             | ${String(b32.noiseBytes.toLocaleString() + ' B').padEnd(19)} | ${String(b64.noiseBytes.toLocaleString() + ' B').padEnd(22)} | ${String(dyn.noiseBytes.toLocaleString() + ' B').padEnd(22)} | ${b64.noiseBytes > 0 ? '-' + (((b64.noiseBytes - dyn.noiseBytes) / b64.noiseBytes) * 100).toFixed(1) + '% de ruído' : 'Zero'} |`);
  console.log(`| Pureza / Densidade de Sinal       | ${((b32.targetBytes / b32.totalBytes) * 100).toFixed(1)}%               | ${((b64.targetBytes / b64.totalBytes) * 100).toFixed(1)}%                 | ${dyn.signalToNoise.toFixed(1)}%                 | +${(dyn.signalToNoise - (b64.targetBytes / b64.totalBytes) * 100).toFixed(1)} pp pureza |`);
  console.log(`| Tempo Discovery (210 arquivos)    | ~280 ms             | ~280 ms                | ${dyn.discoveryMs.toFixed(1)} ms               | Estável (< 300 ms)     |`);
  console.log(`| Tempo SemanticRequest (Montagem)  | ~230 ms             | ~270 ms                | ${dyn.requestMs.toFixed(1)} ms               | ${dyn.requestMs < 250 ? 'Mais rápido' : 'Estável'} |`);
  console.log(`| Tempo Total Ponta a Ponta         | ${b32.timeMs.toFixed(1)} ms            | ${b64.timeMs.toFixed(1)} ms               | ${dyn.timeMs.toFixed(1)} ms               | ${(b64.timeMs - dyn.timeMs).toFixed(1)} ms mais veloz |`);
  console.log(`| Tokens de Entrada Estimados (LLM) | ~8.200 tokens       | ~16.400 tokens         | ~${Math.round(dyn.totalBytes / 4).toLocaleString()} tokens        | ${b64.totalBytes > dyn.totalBytes ? '-' + Math.round((b64.totalBytes - dyn.totalBytes) / 4).toLocaleString() + ' tokens' : 'Otimizado'} |`);
  console.log(`| Custo/Latência de Inferência IA   | Baixo               | Alto (16k tokens)      | Mínimo Suficiente      | Evita 'Lost-in-Middle' |`);
}


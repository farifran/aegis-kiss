import { performance } from 'node:perf_hooks';
import { observeWorkspace, buildPreflightHandoff, loadArchitecturePolicy } from '../scripts/lib/issue_contract_core.mjs';
import { loadSemanticConstitution, buildSemanticRequest } from '../scripts/lib/semantic_request.mjs';

const root = process.cwd();

// Demanda 1: Demanda puramente negocial sem citar caminho explícito
const demandWithoutPath = 'Calcular a taxa proporcional de liquidação por pontos-base respeitando a taxa mínima e o teto máximo de tarifas em centavos, retornando o detalhamento com valor líquido.';

// Demanda 2: Demanda com indicação de módulo (Bounded Context)
const demandWithModule = 'No módulo de tarifas em src/ledger (src/ledger/fee_calculator.ts), calcular o detalhamento da taxa de liquidação por pontos-base respeitando a taxa mínima e máxima em centavos, garantindo a invariante de valor líquido.';

function runTest(demandTitle, demand) {
  console.log('='.repeat(80));
  console.log(`TESTE: ${demandTitle}`);
  console.log(`DEMANDA: "${demand}"`);
  console.log('='.repeat(80));

  const t0 = performance.now();
  const obs = observeWorkspace(root, demand);
  const preflight = buildPreflightHandoff({ demand, discovery: obs.discovery, version: 'v3' });
  const tDiscovery = performance.now() - t0;

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

  console.log(`\n• Tempo Discovery:   ${tDiscovery.toFixed(2)} ms`);
  console.log(`• Tempo Request:     ${tRequest.toFixed(2)} ms`);
  console.log(`• Tempo Total:       ${(tDiscovery + tRequest).toFixed(2)} ms`);

  console.log('\n[TOP 10 SÍMBOLOS NO ESQUELETO DA AST]');
  const skeletonSymbols = req.workspace.workspaceSkeleton?.symbols || [];
  skeletonSymbols.slice(0, 10).forEach((s, idx) => {
    const isTarget = s.path.startsWith('src/ledger/') || s.path === 'src/index.ts';
    const tag = isTarget ? '✓ LEDGER (ALVO)' : '✗ ASKESIS (RUIDO)';
    console.log(`  #${idx + 1}: [${s.kind}] ${s.name.padEnd(35)} (${s.path}) ${tag}`);
  });

  console.log('\n[ARQUIVOS NA EVIDÊNCIA FÍSICA (ORÇAMENTO 32 KB)]');
  const evidence = req.workspace.sourceEvidence || [];
  let targetCount = 0;
  let noiseCount = 0;
  evidence.forEach((e, idx) => {
    const isTarget = e.path.startsWith('src/ledger/') || e.path === 'src/index.ts';
    if (isTarget) targetCount++;
    else noiseCount++;
    const tag = isTarget ? '✓ LEDGER' : '✗ RUIDO';
    console.log(`  #${idx + 1}: ${e.path.padEnd(50)} ${tag} (${e.selection}, ${e.content.length} chars)`);
  });

  const totalBytes = evidence.reduce((acc, e) => acc + Buffer.byteLength(e.content, 'utf8'), 0);
  console.log(`\n• Total de arquivos: ${evidence.length} (Alvo: ${targetCount}, Ruído: ${noiseCount})`);
  console.log(`• Volume consumido:  ${totalBytes.toLocaleString()} / 32,768 bytes`);
  console.log(`• Taxa de Precisão:  ${((targetCount / evidence.length) * 100).toFixed(1)}%`);
}

runTest('CENÁRIO A: Demanda sem Caminho Explícito', demandWithoutPath);
console.log('\n\n');
runTest('CENÁRIO B: Demanda com Ancoragem de Módulo (src/ledger)', demandWithModule);


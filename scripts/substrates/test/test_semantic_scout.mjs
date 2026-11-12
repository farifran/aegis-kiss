import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  shouldTriggerSemanticScout,
  filterPhysicalPaths,
  buildScoutPayload,
  buildTopographicalMap,
  persistInferredAliases,
  executeSemanticScout,
} from '../../lib/semantic_scout.mjs';

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

log('[CTDD TEST] Starting Adaptive Semantic Scout (Arbiter) Test Suite...');

// 1. Guardião Greenfield: EMPTY_SOURCE deve retornar false
{
  const preflight = {
    discovery: {
      status: 'EMPTY_SOURCE',
      files: [],
      workspaceSkeleton: { symbolCount: 0, symbols: [] },
    },
  };
  const trigger = shouldTriggerSemanticScout({ preflight, workspace: { sourceEvidence: [] } });
  assert.equal(trigger, false, 'Scout must NOT trigger on EMPTY_SOURCE (greenfield project)');
  log('  PASS: Greenfield guard (EMPTY_SOURCE) verified');
}

// 2. Guardião Compacto: smallWorkspace (<= 64KB) deve retornar false
{
  const preflight = {
    discovery: {
      status: 'SOURCE_OBSERVED',
      files: [
        { path: 'src/app.ts', kind: 'UTF8_TEXT', bytes: 1024 },
        { path: 'src/utils.ts', kind: 'UTF8_TEXT', bytes: 2048 },
      ],
      workspaceSkeleton: { symbolCount: 5, symbols: [{ path: 'src/app.ts', name: 'runApp', kind: 'FUNCTION' }] },
    },
  };
  const trigger = shouldTriggerSemanticScout({
    preflight,
    workspace: { sourceEvidence: [{ path: 'src/app.ts', selection: 'FULL_SOURCE' }] },
  });
  assert.equal(trigger, false, 'Scout must NOT trigger when total bytes <= 64KB (compact repo delivers FULL_SOURCE)');
  log('  PASS: Compact workspace guard (smallWorkspace <= 64KB) verified');
}

// 3. Guardião do Esqueleto Vazio: symbolCount === 0 deve retornar false
{
  const preflight = {
    discovery: {
      status: 'SOURCE_OBSERVED',
      files: [
        { path: 'src/filler.ts', kind: 'UTF8_TEXT', bytes: 80_000 },
      ],
      workspaceSkeleton: { symbolCount: 0, symbols: [] },
    },
  };
  const trigger = shouldTriggerSemanticScout({ preflight, workspace: { sourceEvidence: [] } });
  assert.equal(trigger, false, 'Scout must NOT trigger when workspaceSkeleton has 0 symbols');
  log('  PASS: Empty skeleton guard (symbolCount === 0) verified');
}

// 4. Guardião de Correspondência Existente: se a evidência já contém janelas focadas (LEXICAL_WINDOW), deve retornar false
{
  const preflight = {
    discovery: {
      status: 'SOURCE_OBSERVED',
      files: [
        { path: 'src/ledger/fee.ts', kind: 'UTF8_TEXT', bytes: 80_000 },
        { path: 'src/ledger/other.ts', kind: 'UTF8_TEXT', bytes: 500 },
      ],
      workspaceSkeleton: { symbolCount: 10, symbols: [{ path: 'src/ledger/fee.ts', name: 'calcFee', kind: 'FUNCTION' }] },
    },
    intent: 'Calcular calcFee para o lote de taxa',
  };
  const workspace = {
    sourceEvidence: [
      { path: 'src/ledger/fee.ts', selection: 'LEXICAL_WINDOW', content: 'export function calcFee() { /* lote de taxa */ }' },
      { path: 'src/ledger/other.ts', selection: 'LEXICAL_WINDOW', content: 'export function other() {}' },
    ],
  };
  const trigger = shouldTriggerSemanticScout({ preflight, workspace });
  assert.equal(trigger, false, 'Scout must NOT trigger when sourceEvidence already contains direct AST matches (LEXICAL_WINDOW)');
  log('  PASS: Direct AST match guard verified');
}

// 5. Ativação Correta sob Silêncio Léxico em Monorepo (> 64KB)
{
  const preflight = {
    discovery: {
      status: 'SOURCE_OBSERVED',
      files: [
        { path: 'src/ledger/fee.ts', kind: 'UTF8_TEXT', bytes: 70_000 },
        { path: 'src/index.ts', kind: 'UTF8_TEXT', bytes: 500 },
      ],
      workspaceSkeleton: {
        symbolCount: 15,
        symbols: [
          { path: 'src/ledger/fee.ts', name: 'calculateSettlementFee', kind: 'FUNCTION' },
        ],
      },
    },
  };
  const workspace = {
    sourceEvidence: [
      { path: 'src/index.ts', selection: 'ENTRYPOINT_PREFIX' },
    ],
  };
  const trigger = shouldTriggerSemanticScout({ preflight, workspace });
  assert.equal(trigger, true, 'Scout MUST trigger on pure lexical silence in large repo with existing symbols');
  log('  PASS: Trigger on genuine lexical silence in large repo verified');
}

// 5b. Ativação sob Silêncio Parcial (Falsa Saciedade / Canibalização de Módulos)
{
  const preflight = {
    intent: 'Gerar relatorio analitico em CSV dos limites de velocidade de risco e das tarifas de liquidacao mercantil.',
    discovery: {
      status: 'SOURCE_OBSERVED',
      files: [
        { path: 'src/reporting/csv.ts', kind: 'UTF8_TEXT', bytes: 50_000 },
        { path: 'src/ledger/fee.ts', kind: 'UTF8_TEXT', bytes: 50_000 },
      ],
      workspaceSkeleton: {
        symbolCount: 20,
        symbols: [{ path: 'src/reporting/csv.ts', name: 'CsvExporter', kind: 'CLASS' }],
      },
    },
  };
  // Simulando que apenas o arquivo de CSV foi entregue (cobriu 'csv', mas nada de risco ou liquidação)
  const workspace = {
    sourceEvidence: [
      { path: 'src/reporting/csv.ts', selection: 'LEXICAL_WINDOW', content: 'export class CsvExporter { exportCsv() {} }' },
      { path: 'src/index.ts', selection: 'ENTRYPOINT_PREFIX', content: 'export * from "./reporting/csv";' },
    ],
  };
  const trigger = shouldTriggerSemanticScout({ preflight, workspace });
  assert.equal(trigger, true, 'Scout MUST trigger on partial silence (false satiety) where 1 module monopolizes evidence');
  log('  PASS: Trigger on partial silence (false satiety multi-module deficit) verified');
}

// 6. Validação Física Fail-Closed: Rejeição de Alucinações
{
  const observedTextPaths = [
    'src/ledger/fee_calculator.ts',
    'src/risk/limits.ts',
    'src/index.ts',
  ];
  const suggested = [
    'src/ledger/fee_calculator.ts', // Válido
    'src/nonexistent/invented.ts',  // Alucinação
    'package.json',                // Fora de src/
    '../../etc/passwd',            // Path traversal
    null,
    123,
  ];
  const filtered = filterPhysicalPaths(suggested, observedTextPaths);
  assert.deepEqual(filtered, ['src/ledger/fee_calculator.ts'], 'Only existing physical paths from observedTextPaths must be retained');
  log('  PASS: Fail-closed physical path validation (hallucination rejection) verified');
}

// 7. Execução Mockada do Scout
{
  const mockFetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              relevantPaths: ['src/ledger/fee_calculator.ts', 'src/fake/ghost.ts'],
              inferredAliases: { estorno: 'reversal' },
            }),
          },
        },
      ],
    }),
  });

  const observedTextPaths = ['src/ledger/fee_calculator.ts', 'src/index.ts'];
  const result = await executeSemanticScout({
    role: { model: 'mock-model' },
    intent: 'Estornar liquidação',
    workspaceSkeleton: { symbols: [] },
    observedTextPaths,
    fetchImplementation: mockFetch,
    endpoint: 'https://mock.endpoint',
    credential: 'test-token',
  });

  assert.equal(result.skipped, false);
  assert.deepEqual(result.relevantPaths, ['src/ledger/fee_calculator.ts']);
  assert.equal(result.inferredAliases.estorno, 'reversal');
  log('  PASS: Mocked Scout execution & alias extraction verified');
}

// 8. Resiliência a Falhas de Rede
{
  const failingFetch = async () => { throw new Error('ECONNREFUSED'); };
  const result = await executeSemanticScout({
    role: { model: 'mock-model' },
    intent: 'Estornar liquidação',
    workspaceSkeleton: { symbols: [] },
    observedTextPaths: ['src/index.ts'],
    fetchImplementation: failingFetch,
    endpoint: 'https://mock.endpoint',
    credential: 'test-token',
  });

  assert.equal(result.skipped, true);
  assert.deepEqual(result.relevantPaths, []);
  log('  PASS: Network failure resilience (graceful fallback) verified');
}

// 9. Amostragem Estrutural Panorâmica (Sem Viés Alfabético)
{
  // Simula 200 arquivos onde os 150 primeiros são de 'src/askesis/' e o último é de 'src/ledger/'
  const symbols = [];
  for (let i = 0; i < 150; i++) {
    symbols.push({ path: `src/askesis/file_${String(i).padStart(3, '0')}.ts`, name: `AskesisSymbol${i}`, kind: 'FUNCTION' });
  }
  symbols.push({ path: 'src/ledger/fee_calculator.ts', name: 'FeeCalculator', kind: 'CLASS' });
  symbols.push({ path: 'src/risk/limits.ts', name: 'DailyLimit', kind: 'CLASS' });

  const topography = buildTopographicalMap({ symbols });
  assert.ok(topography['src/ledger/fee_calculator.ts'], 'Topography MUST include src/ledger even if it appears after 150 files');
  assert.deepEqual(topography['src/ledger/fee_calculator.ts'], ['FeeCalculator']);
  assert.ok(topography['src/risk/limits.ts'], 'Topography MUST include src/risk');
  log('  PASS: Stratified Topographical Map (zero alphabetical bias) verified');
}

// 10. Auto-Lexicon Persistente: Persistência e Mesclagem sem Sobrescrita
{
  const tempDir = path.resolve('.harness/tmp_test_autolexicon');
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    // 1ª persistência
    await persistInferredAliases(tempDir, { estorno: 'reversal' });
    const lexiconFile = path.resolve(tempDir, '.harness/domain-lexicon.json');
    assert.ok(fs.existsSync(lexiconFile), 'Lexicon file must be created');
    let loaded = JSON.parse(fs.readFileSync(lexiconFile, 'utf8'));
    assert.equal(loaded.estorno, 'reversal');

    // 2ª persistência com sinônimo adicional para a mesma chave
    await persistInferredAliases(tempDir, { estorno: 'refund', liquidacao: 'settlement' });
    loaded = JSON.parse(fs.readFileSync(lexiconFile, 'utf8'));
    assert.deepEqual(loaded.estorno, ['reversal', 'refund'], 'Subsequent alias must merge into array without overwriting');
    assert.equal(loaded.liquidacao, 'settlement');
    log('  PASS: Auto-Lexicon continuous learning (persistence & merge) verified');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

log('[CTDD TEST] All Adaptive Semantic Scout tests passed successfully!');


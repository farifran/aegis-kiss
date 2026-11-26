import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import process from 'node:process';
import { buildDemandBrief, renderBriefMarkdown } from '../../lib/brief_renderer.mjs';
import { verifyContractMarkdown } from '../../lib/contract_verifier.mjs';
import { buildTopographicalMap, filterPhysicalPaths, shouldShowTopography } from '../../lib/topography.mjs';
import { observeWorkspace } from '../../lib/workspace_observer.mjs';

const rootDir = resolve(import.meta.dirname, '../../..');

function createTempRepo() {
  const dir = mkdtempSync(resolve(tmpdir(), 'aegis-ide-test-'));
  for (const item of ['aegis', 'package.json', 'tsconfig.json', 'eslint.config.js', 'scripts', 'src']) {
    cpSync(resolve(rootDir, item), resolve(dir, item), { recursive: true });
  }
  mkdirSync(resolve(dir, '.harness'), { recursive: true });
  cpSync(resolve(rootDir, '.harness/config'), resolve(dir, '.harness/config'), { recursive: true });
  cpSync(resolve(rootDir, '.harness/enforcement'), resolve(dir, '.harness/enforcement'), { recursive: true });
  symlinkSync(resolve(rootDir, 'node_modules'), resolve(dir, 'node_modules'), 'dir');
  return dir;
}

// 1. Discovery focado em src/ real (D11: isola ledger/risk e não vaza audit_csv_exporter.ts)
{
  const observation = observeWorkspace(rootDir);
  const d11 = 'Estender src/ledger/settlement_engine.ts e src/risk/velocity_guard.ts para adicionar reverseSettlement mantendo src/ledger/fee_calculator.ts inalterado.';
  const brief = buildDemandBrief({
    repositoryRoot: rootDir,
    intent: d11,
    workspaceObservation: observation,
  });
  const md = renderBriefMarkdown(brief);
  assert.ok(brief.coverage.excerptedPaths.includes('src/ledger/settlement_engine.ts'));
  assert.ok(brief.coverage.excerptedPaths.includes('src/risk/velocity_guard.ts'));
  assert.equal(brief.coverage.excerptedPaths.includes('src/reporting/audit_csv_exporter.ts'), false);
  assert.equal(brief.coverage.referencedPathsNotDiscovered.length, 0);
  assert.ok(md.includes('## 1. Demanda'));
  assert.ok(md.includes('## 4. Trechos de código observados'));
  process.stdout.write('  PASS: Discovery isolates target modules without leaking unrelated files\n');
}

// 2. Demanda greenfield mantém brief compacto sem arrastar src/ inteiro
{
  const observation = observeWorkspace(rootDir);
  const brief = buildDemandBrief({
    repositoryRoot: rootDir,
    intent: 'Calcular desconto percentual (0 a 100) sobre preço base com rejeição determinística para negativos.',
    workspaceObservation: observation,
  });
  const md = renderBriefMarkdown(brief);
  assert.equal(brief.coverage.excerptedPaths.length, 1);
  assert.equal(brief.skeletonSymbols.length, 0);
  assert.ok(md.length < 4000, `Expected compact greenfield brief (< 4 KB), got ${md.length}`);
  process.stdout.write('  PASS: Greenfield demand produces compact brief (< 4 KB)\n');
}

// 3. Léxico bilíngue (PT-BR -> EN) resolve módulos sem citar caminho explícito
{
  const observation = observeWorkspace(rootDir);
  const brief = buildDemandBrief({
    repositoryRoot: rootDir,
    intent: 'Revisar tarifa e liquidação com limite de risco na velocidade de lotes.',
    workspaceObservation: observation,
  });
  assert.ok(brief.coverage.excerptedPaths.includes('src/ledger/settlement_engine.ts'));
  assert.ok(brief.coverage.excerptedPaths.includes('src/risk/velocity_guard.ts'));
  process.stdout.write('  PASS: Bilingual lexicon resolves domain modules deterministically\n');
}

// 4. Mapa topográfico panorâmico sob silêncio léxico em repo > 96 KB
{
  const bigDiscovery = {
    status: 'SOURCE_OBSERVED',
    files: [
      { path: 'src/alpha/a.ts', bytes: 60_000, kind: 'UTF8_TEXT' },
      { path: 'src/beta/b.ts', bytes: 60_000, kind: 'UTF8_TEXT' },
    ],
    workspaceSkeleton: {
      symbolCount: 4,
      symbols: [
        { path: 'src/alpha/a.ts', name: 'reconcileBatch' },
        { path: 'src/alpha/a.ts', name: 'BatchState' },
        { path: 'src/alpha/a.ts', name: 'ignoredThirdSymbol' },
        { path: 'src/beta/b.ts', name: 'emitAudit' },
      ],
    },
  };
  assert.equal(
    shouldShowTopography({
      intent: 'Dar baixa no lote de cobrança',
      discovery: bigDiscovery,
      sourceEvidence: [{ path: 'src/index.ts', selection: 'ENTRYPOINT_PREFIX', content: '' }],
    }),
    true,
  );
  const topo = buildTopographicalMap(bigDiscovery.workspaceSkeleton, 2, 400);
  assert.deepEqual(topo['src/alpha/a.ts'], ['reconcileBatch', 'BatchState']);
  assert.deepEqual(topo['src/beta/b.ts'], ['emitAudit']);
  assert.deepEqual(
    filterPhysicalPaths(['src/alpha/a.ts', 'src/invented/fake.ts'], ['src/alpha/a.ts', 'src/beta/b.ts']),
    ['src/alpha/a.ts'],
  );
  process.stdout.write('  PASS: Topographical map and fail-closed physical path filter verified\n');
}

// 5. verify-contract: aceita contrato válido e bloqueia violações mecânicas reais
const tempDir = createTempRepo();
try {
  const validContractPath = resolve(tempDir, '.harness/runtime/contract.md');
  mkdirSync(resolve(tempDir, '.harness/runtime'), { recursive: true });
  writeFileSync(validContractPath, [
    '# Contrato: Trava de rejeições consecutivas',
    '',
    '## Escopo',
    '- Incluído: bloquear liquidação após 5 rejeições (`src/risk/velocity_guard.ts:L6`).',
    '- Fora do escopo: alterações em `src/ledger/fee_calculator.ts`.',
    '',
    '## Arquivos',
    '- `src/risk/velocity_guard.ts`',
    '- `src/ledger/settlement_engine.ts`',
    '- `src/ledger/streak_guard.ts` [novo]',
    '',
    '## Casos de prova',
    '- **Sucesso**',
    '  - Dado: `consecutiveBatchRejections = 4`',
    '  - Quando: `processSettlementBatch` liquida lote válido',
    '  - Então: zera contador para `0`',
    '- **Falha / Limite**',
    '  - Dado: `consecutiveBatchRejections = 5`',
    '  - Quando: `processSettlementBatch` é chamado novamente',
    '  - Então: rejeita com erro determinístico sem mutar estado',
  ].join('\n'));

  const validRes = verifyContractMarkdown({ repositoryRoot: tempDir, contractPath: validContractPath });
  assert.equal(validRes.ok, true, `Expected valid contract, got errors: ${validRes.errors.join('; ')}`);
  assert.equal(validRes.scenarioCount, 2);
  assert.deepEqual(validRes.authorizedPaths, [
    'src/ledger/settlement_engine.ts',
    'src/ledger/streak_guard.ts',
    'src/risk/velocity_guard.ts',
  ]);

  // Contrato inválido: linha fora do arquivo + caminho fantasma + [PENDENTE] + /etc/passwd
  const badContractPath = resolve(tempDir, '.harness/runtime/bad-contract.md');
  writeFileSync(badContractPath, [
    '# Contrato ruim',
    '## Escopo',
    '- Ler `/etc/passwd` e aguardar [PENDENTE]',
    '## Arquivos',
    '- `/etc/passwd`',
    '- `src/risk/velocity_guard.ts:L9999`',
    '- `src/nao_existe.ts`',
    '## Casos de prova',
    '- Dado: x',
    '- Quando: y',
    '- Então: z',
  ].join('\n'));
  const badRes = verifyContractMarkdown({ repositoryRoot: tempDir, contractPath: badContractPath });
  assert.equal(badRes.ok, false);
  assert.ok(badRes.errors.some((e) => e.includes('Marcador pendente')));
  assert.ok(badRes.errors.some((e) => e.includes('Violação de fronteira')));
  assert.ok(badRes.errors.some((e) => e.includes('Faixa de linhas inválida')));
  assert.ok(badRes.errors.some((e) => e.includes('Arquivo inexistente')));
  assert.ok(badRes.errors.some((e) => e.includes('ao menos 2 cenários')));
  process.stdout.write('  PASS: verify-contract validates lines, paths, boundaries, and scenarios\n');

  // 6. Fluxo CLI ponta a ponta: brief -> verify-contract -> check -> status -> clean
  const env = { ...process.env, AEGIS_ROOT: tempDir };
  const briefOut = execFileSync('bash', ['./aegis', 'brief', 'Proteger src/ledger/settlement_engine.ts contra 5 rejeições'], {
    cwd: tempDir,
    encoding: 'utf8',
    env,
  });
  assert.ok(briefOut.includes('[AEGIS][BRIEF] OK'));
  assert.ok(existsSync(resolve(tempDir, '.harness/runtime/brief.md')));

  const verifyOut = execFileSync('bash', ['./aegis', 'verify-contract'], {
    cwd: tempDir,
    encoding: 'utf8',
    env,
  });
  assert.ok(verifyOut.includes('[AEGIS][CONTRACT] PASS'));

  // Inicializa git no tempDir para testar checagem real de escopo no `./aegis check`
  execFileSync('git', ['init', '-q'], { cwd: tempDir });
  execFileSync('git', ['config', 'user.email', 'test@aegis.local'], { cwd: tempDir });
  execFileSync('git', ['config', 'user.name', 'Aegis Test'], { cwd: tempDir });
  execFileSync('git', ['add', 'src', 'package.json', 'tsconfig.json', 'eslint.config.js'], { cwd: tempDir });
  execFileSync('git', ['commit', '-q', '-m', 'baseline'], { cwd: tempDir });

  const checkPassOut = execFileSync('bash', ['./aegis', 'check'], {
    cwd: tempDir,
    encoding: 'utf8',
    env,
  });
  assert.ok(checkPassOut.includes('[AEGIS][CHECK] PASS'));

  // Alterar arquivo fora do contrato deve falhar o `./aegis check`
  writeFileSync(
    resolve(tempDir, 'src/reporting/audit_csv_exporter.ts'),
    `${readFileSync(resolve(tempDir, 'src/reporting/audit_csv_exporter.ts'), 'utf8')}\n// out-of-scope edit\n`,
  );
  let scopeFailed = false;
  try {
    execFileSync('bash', ['./aegis', 'check'], { cwd: tempDir, encoding: 'utf8', env, stdio: 'pipe' });
  } catch (err) {
    scopeFailed = true;
    assert.ok(String(err.stderr).includes('fora dos arquivos autorizados'));
  }
  assert.equal(scopeFailed, true);

  const statusJson = JSON.parse(execFileSync('bash', ['./aegis', 'status'], {
    cwd: tempDir,
    encoding: 'utf8',
    env,
  }));
  assert.equal(statusJson.status, 'CONTRACT_PRESENT');
  assert.equal(statusJson.workspaceFreshness, 'CHANGED_SINCE_BASELINE');

  const cleanOut = execFileSync('bash', ['./aegis', 'clean'], {
    cwd: tempDir,
    encoding: 'utf8',
    env,
  });
  assert.ok(cleanOut.includes('clean=PASS'));
  assert.equal(existsSync(resolve(tempDir, '.harness/runtime/brief.md')), false);
  assert.ok(existsSync(resolve(tempDir, 'src/ledger/settlement_engine.ts')));
  process.stdout.write('  PASS: End-to-end CLI flow (brief, verify-contract, check, status, clean) verified\n');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

process.stdout.write('[AEGIS][TEST] discovery and IDE CLI suite: PASS\n');

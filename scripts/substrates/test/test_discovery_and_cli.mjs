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
  // Melhoria #1: nenhum símbolo de arquivo já incluído inteiro é duplicado em skeletonSymbols
  const fullPaths = new Set(brief.sourceEvidence.filter((e) => !e.truncated).map((e) => e.path));
  assert.equal(brief.skeletonSymbols.some((s) => fullPaths.has(s.path)), false);
  // Melhoria #2: linhas numeradas dentro dos blocos de código
  assert.ok(md.includes('6 | export const MAX_BATCH_REJECTIONS = 5;'));
  // Melhoria #4: chamadores detectados em src/
  assert.ok(brief.directCallers.some((c) => c.symbol === 'evaluateSettlementGuards'
    && c.locations.some((loc) => loc.startsWith('src/ledger/settlement_engine.ts:L'))));
  assert.ok(md.includes('## Chamadores / referências observadas'));
  assert.ok(md.includes('## 1. Demanda'));
  assert.ok(md.includes('## 4. Trechos de código observados'));
  process.stdout.write('  PASS: Discovery isolates target modules, avoids AST duplication, numbers lines, and finds callers\n');
}

// 1b. Melhorias #3, #4 (1-hop import) e #5 (arquivo > 256 KB pulado + autodetect lib/)
{
  const bigTemp = mkdtempSync(resolve(tmpdir(), 'aegis-improvements-'));
  try {
    mkdirSync(resolve(bigTemp, 'lib/core'), { recursive: true });
    mkdirSync(resolve(bigTemp, 'lib/risk'), { recursive: true });
    // Autodetect lib/ (sem src/) + arquivo gigante (> 256 KB) pulado sem quebrar o scan
    writeFileSync(resolve(bigTemp, 'lib/huge_dump.json'), 'x'.repeat(270_000));
    writeFileSync(resolve(bigTemp, 'lib/risk/helper.ts'), [
      'export interface RiskLimit {',
      '  readonly maxAttempts: number;',
      '}',
      'export function checkRiskLimit(attempts: number, limit: RiskLimit): boolean {',
      '  return attempts < limit.maxAttempts;',
      '}',
    ].join('\n'));
    // Arquivo grande (> 8 KB) com função alvo multi-linha no meio para provar janela de bloco AST inteiro
    const paddingBlock = Array.from({ length: 180 }, (_, i) => `export function fillerFn_${i}(v: number): number { return v + ${i}; }`).join('\n');
    const targetFn = [
      'export function computeSpecialRebate(grossCents: number, tier: number): number {',
      '  const base = grossCents * tier;',
      '  const capped = Math.min(base, 50000);',
      '  const adjusted = capped - 10;',
      '  return Math.max(0, adjusted);',
      '}',
    ].join('\n');
    writeFileSync(resolve(bigTemp, 'lib/core/engine.ts'), [
      "import { checkRiskLimit, type RiskLimit } from '../risk/helper.js';",
      paddingBlock,
      targetFn,
      paddingBlock,
      'export function runCheck(a: number, l: RiskLimit): boolean { return checkRiskLimit(a, l); }',
    ].join('\n'));
    // Outro arquivo > 90 KB para forçar modo largeWorkspace (> 96 KB total)
    writeFileSync(
      resolve(bigTemp, 'lib/risk/archive.ts'),
      Array.from({ length: 1600 }, (_, i) => `export const ARCHIVE_${i} = ${i}; // padding line for large workspace mode`).join('\n'),
    );

    const obs = observeWorkspace(bigTemp);
    assert.deepEqual(obs.discovery.sourceRoots, ['lib']);
    assert.ok(obs.discovery.ignoredEntries.some((e) => e.path === 'lib/huge_dump.json' && e.reason === 'TOO_LARGE'));

    const brief = buildDemandBrief({
      repositoryRoot: bigTemp,
      intent: 'Ajustar computeSpecialRebate em lib/core/engine.ts',
      workspaceObservation: obs,
    });
    // Janela AST em arquivo grande deve conter a função computeSpecialRebate inteira (início ao fim)
    const engineExcerpts = brief.sourceEvidence.filter((e) => e.path === 'lib/core/engine.ts');
    const joinedEngine = engineExcerpts.map((e) => e.content).join('\n');
    assert.ok(joinedEngine.includes('export function computeSpecialRebate'));
    assert.ok(joinedEngine.includes('return Math.max(0, adjusted);'));

    // 1-hop import: lib/risk/helper.ts não veio inteiro, mas sua assinatura importada (checkRiskLimit) aparece em directImports
    assert.ok(brief.directImports.some((s) => s.path === 'lib/risk/helper.ts' && s.name === 'checkRiskLimit'));
    process.stdout.write('  PASS: AST-span windows, 1-hop imports, huge-file skip, and lib/ autodetect verified\n');
  } finally {
    rmSync(bigTemp, { recursive: true, force: true });
  }
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
    '- Incluído: bloquear liquidação após `MAX_BATCH_REJECTIONS = 5` (`src/risk/velocity_guard.ts:L6`).',
    '- Fora do escopo: alterações em `src/ledger/fee_calculator.ts`.',
    '',
    '## Arquivos',
    '- `src/risk/velocity_guard.ts`',
    '- `src/ledger/settlement_engine.ts`',
    '- `src/ledger/streak_guard.ts` [novo]',
    '',
    '## Casos de prova',
    '- **AC-1 — Sucesso**',
    '  - Dado: `consecutiveBatchRejections = 4`',
    '  - Quando: `processSettlementBatch` liquida lote válido',
    '  - Então: zera contador para `0`',
    '- **AC-2 — Falha / Limite**',
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

  // Contrato inválido: linha fora do arquivo + símbolo errado na linha + caminho fantasma + [PENDENTE] + /etc/passwd
  const badContractPath = resolve(tempDir, '.harness/runtime/bad-contract.md');
  writeFileSync(badContractPath, [
    '# Contrato ruim',
    '## Escopo',
    '- Ler `/etc/passwd`, usar `SIMBOLO_INEXISTENTE` (`src/risk/velocity_guard.ts:L6`) e aguardar [PENDENTE]',
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
  assert.ok(badRes.errors.some((e) => e.includes("Símbolo 'SIMBOLO_INEXISTENTE' não encontrado")));
  assert.ok(badRes.errors.some((e) => e.includes('Arquivo inexistente')));
  assert.ok(badRes.errors.some((e) => e.includes('ao menos 2 cenários')));
  process.stdout.write('  PASS: verify-contract validates lines, symbols, paths, boundaries, and scenarios\n');

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

  // Inicializa git no tempDir para testar checagem real de escopo, fronteira e testes no `./aegis check`
  execFileSync('git', ['init', '-q'], { cwd: tempDir });
  execFileSync('git', ['config', 'user.email', 'test@aegis.local'], { cwd: tempDir });
  execFileSync('git', ['config', 'user.name', 'Aegis Test'], { cwd: tempDir });
  execFileSync('git', ['add', 'src', 'package.json', 'tsconfig.json', 'eslint.config.js', 'aegis', 'scripts'], { cwd: tempDir });
  execFileSync('git', ['commit', '-q', '-m', 'baseline'], { cwd: tempDir });
  writeFileSync(resolve(tempDir, '.gitignore'), '.harness/\nnode_modules\n');
  execFileSync('git', ['add', '.gitignore'], { cwd: tempDir });
  execFileSync('git', ['commit', '-q', '-m', 'gitignore'], { cwd: tempDir });

  // guard-path: permite arquivo autorizado em src/ e .harness/runtime/contract.md; bloqueia fora de src/ ou fora do contrato
  const guardAllowSrc = execFileSync('bash', ['./aegis', 'guard-path', 'src/risk/velocity_guard.ts'], { cwd: tempDir, encoding: 'utf8', env });
  assert.ok(guardAllowSrc.includes('[AEGIS][GUARD] ALLOW'));
  const guardAllowContract = execFileSync('bash', ['./aegis', 'guard-path', '.harness/runtime/contract.md'], { cwd: tempDir, encoding: 'utf8', env });
  assert.ok(guardAllowContract.includes('[AEGIS][GUARD] ALLOW'));
  for (const denied of ['eslint.config.js', 'package.json', 'src/reporting/audit_csv_exporter.ts', '../escape.ts']) {
    let blocked = false;
    try {
      execFileSync('bash', ['./aegis', 'guard-path', denied], { cwd: tempDir, encoding: 'utf8', env, stdio: 'pipe' });
    } catch {
      blocked = true;
    }
    assert.equal(blocked, true, `Expected guard-path to deny ${denied}`);
  }

  const checkPassOut = execFileSync('bash', ['./aegis', 'check'], {
    cwd: tempDir,
    encoding: 'utf8',
    env,
  });
  assert.ok(checkPassOut.includes('[AEGIS][CHECK] PASS'));

  // Anti-sabotagem: alterar arquivo fora de src/ (eslint.config.js) DEVE falhar, mesmo passando --allow
  const origEslint = readFileSync(resolve(tempDir, 'eslint.config.js'), 'utf8');
  writeFileSync(resolve(tempDir, 'eslint.config.js'), `${origEslint}\n// tampered\n`);
  let outsideBlocked = false;
  try {
    execFileSync('bash', ['./aegis', 'check'], { cwd: tempDir, encoding: 'utf8', env, stdio: 'pipe' });
  } catch (err) {
    outsideBlocked = true;
    assert.ok(String(err.stderr).includes('FORA DA FRONTEIRA'));
    assert.ok(String(err.stderr).includes('eslint.config.js'));
  }
  assert.equal(outsideBlocked, true);

  let invalidAllowBlocked = false;
  try {
    execFileSync('bash', ['./aegis', 'check', '--allow', 'eslint.config.js'], { cwd: tempDir, encoding: 'utf8', env, stdio: 'pipe' });
  } catch (err) {
    invalidAllowBlocked = true;
    assert.ok(String(err.stderr).includes('--allow inválido fora da fronteira'));
  }
  assert.equal(invalidAllowBlocked, true);

  // Exceção humana explícita (--allow-outside) permite quando intencional
  const allowOutsideOut = execFileSync('bash', ['./aegis', 'check', '--allow-outside', 'eslint.config.js'], {
    cwd: tempDir,
    encoding: 'utf8',
    env,
  });
  assert.ok(allowOutsideOut.includes('[AEGIS][CHECK] PASS'));
  writeFileSync(resolve(tempDir, 'eslint.config.js'), origEslint);

  // Amarração Contrato <-> Testes: editar arquivo autorizado em src/ SEM teste deve FALHAR
  const origGuard = readFileSync(resolve(tempDir, 'src/risk/velocity_guard.ts'), 'utf8');
  writeFileSync(resolve(tempDir, 'src/risk/velocity_guard.ts'), `${origGuard}\n// authorized product edit\n`);
  let missingTestsFailed = false;
  try {
    execFileSync('bash', ['./aegis', 'check'], { cwd: tempDir, encoding: 'utf8', env, stdio: 'pipe' });
  } catch (err) {
    missingTestsFailed = true;
    assert.ok(String(err.stderr).includes('nenhum arquivo *.test.* foi encontrado'));
  }
  assert.equal(missingTestsFailed, true);

  // Modo rápido (--allow src/risk/velocity_guard.ts) funciona sem exigir testes do contract.md
  const fastModeOut = execFileSync('bash', ['./aegis', 'check', '--allow', 'src/risk/velocity_guard.ts'], {
    cwd: tempDir,
    encoding: 'utf8',
    env,
  });
  assert.ok(fastModeOut.includes('[AEGIS][CHECK] PASS'));

  // Teste incompleto (só AC-1, faltando AC-2) deve FALHAR com contract.md ativo
  writeFileSync(resolve(tempDir, 'src/sample.test.ts'), [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "test('AC-1: only first scenario', () => { assert.equal(1 + 1, 2); });",
  ].join('\n'));
  let partialCoverageFailed = false;
  try {
    execFileSync('bash', ['./aegis', 'check'], { cwd: tempDir, encoding: 'utf8', env, stdio: 'pipe' });
  } catch (err) {
    partialCoverageFailed = true;
    assert.ok(String(err.stderr).includes('AC-2'));
  }
  assert.equal(partialCoverageFailed, true);

  // Teste completo cobrindo AC-1 e AC-2 deve PASSAR
  writeFileSync(resolve(tempDir, 'src/sample.test.ts'), [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "test('AC-1: happy path', () => { assert.equal(1 + 1, 2); });",
    "test('AC-2: boundary lock', () => { assert.equal(2 + 2, 4); });",
  ].join('\n'));
  const fullCoverageOut = execFileSync('bash', ['./aegis', 'check'], {
    cwd: tempDir,
    encoding: 'utf8',
    env,
  });
  assert.ok(fullCoverageOut.includes('[AEGIS][CHECK] PASS'));
  assert.ok(fullCoverageOut.includes('2 caso(s) PASS'));
  rmSync(resolve(tempDir, 'src/sample.test.ts'));
  writeFileSync(resolve(tempDir, 'src/risk/velocity_guard.ts'), origGuard);

  // Alterar arquivo fora do contrato dentro de src/ deve falhar o `./aegis check`
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

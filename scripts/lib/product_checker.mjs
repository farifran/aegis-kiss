import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { join, relative, resolve, sep } from 'node:path';
import {
  countContractScenarios,
  extractAuthorizedPaths,
  extractScenarioIds,
  readSafeContractText,
} from './contract_verifier.mjs';
import {
  hasSymlinkComponent,
  isInsideProductRoots,
  isPathCovered,
  isProductTestPath,
  normalizeRepoRelativePath,
} from './path_guard.mjs';
import { resolveSourceRoots } from './workspace_observer.mjs';
import {
  extractActiveTestCases,
  extractAstImports,
  loadTsconfigPathAliases,
} from './workspace_skeleton.mjs';

const stepTimeoutMs = 60_000;
const stepMaxBufferBytes = 10 * 1024 * 1024;
const secretPatterns = [
  /\b(?:ghp|gho|ghs)_[A-Za-z0-9_]{30,}\b/u,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/u,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/u,
  /\bAIza[0-9A-Za-z_-]{35}\b/u,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
];

function runStep(command, args, cwd, { trimOutput = true } = {}) {
  try {
    const stdout = execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: stepTimeoutMs,
      maxBuffer: stepMaxBufferBytes,
    });
    return { ok: true, output: trimOutput ? stdout.trimEnd() : stdout };
  } catch (error) {
    const combined = [error?.stdout, error?.stderr, error?.message]
      .filter((part) => typeof part === 'string' && part.trim().length > 0)
      .join('\n')
      .trim();
    return { ok: false, output: combined };
  }
}

function collectFilesMatching(dir, predicate, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
      collectFilesMatching(full, predicate, acc);
    } else if (entry.isFile() && predicate(full)) {
      acc.push(full);
    }
  }
  return acc;
}

function packageRootName(specifier) {
  if (!specifier || specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/') || specifier.startsWith('node:')) {
    return null;
  }
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
  }
  return specifier.split('/')[0];
}

function matchesTsconfigAlias(specifier, aliases) {
  for (const alias of aliases) {
    if (alias.hasWildcard) {
      if (specifier.startsWith(alias.prefix) && specifier.endsWith(alias.suffix)) return true;
    } else if (specifier === alias.prefix) {
      return true;
    }
  }
  return false;
}

function loadDeclaredPackages(repositoryRoot) {
  const pkgPath = resolve(repositoryRoot, 'package.json');
  if (!existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const names = new Set();
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      if (pkg[section] && typeof pkg[section] === 'object') {
        for (const name of Object.keys(pkg[section])) names.add(name);
      }
    }
    return names;
  } catch {
    return null;
  }
}

/**
 * Verificações mecânicas puras em Node/AST (0 dependências externas, portátil):
 *  - imports bare não declarados em package.json (respeitando node builtins e paths do tsconfig.json)
 *  - segredos hardcoded (chaves API / private keys) em código de produto
 */
function runStaticChecks({ repositoryRoot, existingRoots }) {
  const violations = [];
  const declared = loadDeclaredPackages(repositoryRoot);
  const pathAliases = loadTsconfigPathAliases(repositoryRoot);
  const codeFiles = [];

  for (const rootRel of existingRoots) {
    collectFilesMatching(
      resolve(repositoryRoot, rootRel),
      (f) => /\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/u.test(f),
      codeFiles,
    );
  }

  for (const absFile of codeFiles) {
    const relPath = relative(repositoryRoot, absFile).replaceAll(sep, '/');
    const content = readFileSync(absFile, 'utf8');

    if (declared && declared.size > 0) {
      const seenUndeclared = new Set();
      for (const imp of extractAstImports(relPath, content)) {
        const spec = imp.specifier;
        if (matchesTsconfigAlias(spec, pathAliases)) continue;
        const pkgRoot = packageRootName(spec);
        if (!pkgRoot || isBuiltin(spec) || isBuiltin(pkgRoot) || declared.has(pkgRoot)) continue;
        if (seenUndeclared.has(pkgRoot)) continue;
        seenUndeclared.add(pkgRoot);
        violations.push(`undeclared_import: '${pkgRoot}' em ${relPath} (ausente em package.json)`);
      }
    }

    if (!isProductTestPath(relPath)) {
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        if (secretPatterns.some((re) => re.test(lines[i]))) {
          violations.push(`hardcoded_secret detectado em ${relPath}:L${i + 1}`);
        }
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

function parseGitPorcelainZ(porcelainZOutput) {
  const tokens = porcelainZOutput.split('\0');
  const paths = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const entry = tokens[i];
    if (!entry || entry.length < 4) continue;
    const status = entry.slice(0, 2);
    const firstPath = entry.slice(3);
    if (firstPath) paths.push(firstPath);
    if (status.includes('R') || status.includes('C')) {
      const origPath = tokens[i + 1];
      if (origPath) paths.push(origPath);
      i += 1;
    }
  }
  return [...new Set(paths)];
}

/**
 * Vigia TODO o git status do repositório (`--porcelain -z -uall`):
 * - Ignora apenas .harness/runtime/ (artefatos transitórios do Aegis).
 * - Valida tanto origem quanto destino em renames/cópias (`R`/`C`).
 * - Qualquer arquivo fora das raízes de produto (padrão: src/) FALHA, salvo
 *   se explicitamente listado pelo humano em --allow-outside.
 * - Dentro das raízes de produto, bloqueia symlinks e exige aderência a --allow ou contract.md (fail-closed).
 */
function checkGitScope({
  repositoryRoot,
  contractPath,
  sourceRoots,
  allowPaths = [],
  allowOutsidePaths = [],
}) {
  const violations = [];
  const normalizedAllow = [];
  for (const raw of allowPaths) {
    const rel = normalizeRepoRelativePath(repositoryRoot, raw);
    if (!rel || !isInsideProductRoots(rel, sourceRoots)) {
      violations.push(`--allow inválido fora da fronteira (${sourceRoots.join(', ')}/): ${raw}`);
    } else {
      normalizedAllow.push(rel);
    }
  }

  const normalizedOutside = new Set(
    allowOutsidePaths
      .map((raw) => normalizeRepoRelativePath(repositoryRoot, raw))
      .filter(Boolean),
  );

  const gitCheck = runStep('git', ['rev-parse', '--is-inside-work-tree'], repositoryRoot);
  if (!gitCheck.ok) {
    return {
      skipped: violations.length === 0,
      ok: violations.length === 0,
      changedProductFiles: [],
      violations,
    };
  }

  const statusRes = runStep(
    'git',
    ['-c', 'core.quotepath=false', 'status', '--porcelain', '-z', '-uall'],
    repositoryRoot,
    { trimOutput: false },
  );
  if (!statusRes.ok) {
    return {
      skipped: violations.length === 0,
      ok: violations.length === 0,
      changedProductFiles: [],
      violations,
    };
  }

  const contractRead = readSafeContractText(contractPath);
  if (contractRead.status === 'SYMLINK_OR_INVALID') {
    violations.push('contract.md não pode ser symlink ou não-arquivo.');
  }
  const hasContract = contractRead.status === 'OK';
  const authorizedPaths = normalizedAllow.length > 0
    ? normalizedAllow
    : (hasContract ? extractAuthorizedPaths(contractRead.text, sourceRoots).authorizedPaths : []);

  const changedProductFiles = [];
  const changedInProductRoots = [];
  const changedAll = parseGitPorcelainZ(statusRes.output);

  for (const relPath of changedAll) {
    if (relPath === '.harness/runtime' || relPath.startsWith('.harness/runtime/')) {
      continue;
    }
    if (!isInsideProductRoots(relPath, sourceRoots)) {
      if (!normalizedOutside.has(relPath)) {
        violations.push(`FORA DA FRONTEIRA (${sourceRoots.join(', ')}/): ${relPath} alterado sem permissão`);
      }
      continue;
    }
    if (hasSymlinkComponent(repositoryRoot, relPath)) {
      violations.push(`SYMLINK proibido na fronteira de produto: ${relPath}`);
      continue;
    }
    changedInProductRoots.push(relPath);
    if (!isProductTestPath(relPath)) {
      changedProductFiles.push(relPath);
    }
    if (authorizedPaths.length > 0 && !isPathCovered(relPath, authorizedPaths)) {
      const sourceLabel = normalizedAllow.length > 0 ? '--allow' : 'contract.md';
      violations.push(`${relPath} alterado fora dos arquivos autorizados em ${sourceLabel}`);
    }
  }

  if (changedInProductRoots.length > 0 && authorizedPaths.length === 0 && violations.length === 0) {
    violations.push(
      hasContract
        ? `contract.md ativo não declara caminhos autorizados em ${sourceRoots.join(', ')}/ para: ${changedInProductRoots.join(', ')}`
        : `Alterações em ${sourceRoots.join(', ')}/ sem contract.md ativo nem --allow (${changedInProductRoots.join(', ')})`,
    );
  }

  return {
    skipped: false,
    ok: violations.length === 0,
    changedProductFiles,
    violations,
  };
}

function compactErrorLines(rawOutput, maxLines = 15) {
  const lines = rawOutput
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);
  if (lines.length <= maxLines) return lines;
  return [...lines.slice(0, maxLines), `... (+${lines.length - maxLines} linhas omitidas)`];
}

/**
 * Executa a verificação mecânica pós-implementação (0 tokens):
 * 1. Escopo git completo (bloqueia symlinks e qualquer alteração fora de src/ + fora do contrato/--allow)
 * 2. tsc --noEmit (se houver TS em raízes de produto)
 * 3. eslint sobre raízes de produto (inclui regras estruturais e DETERMINISTIC-TIME)
 * 4. static_checks (AST undeclared imports respeitando tsconfig paths + segredos hardcoded)
 * 5. Testes reais de produto (obrigatórios quando há contract.md + edição em produto,
 *    com checagem AST de casos ativos e IDs AC-*)
 */
export function runProductCheck({
  repositoryRoot,
  contractPath,
  skipDiff = false,
  allowPaths = [],
  allowOutsidePaths = [],
  sourceRoots = null,
}) {
  const results = [];
  const warnings = [];
  const effectiveRoots = resolveSourceRoots(repositoryRoot, sourceRoots);
  const existingRoots = effectiveRoots.filter((r) => existsSync(resolve(repositoryRoot, r)));

  // 1. Escopo git completo
  let changedProductFiles = [];
  if (!skipDiff) {
    const scope = checkGitScope({
      repositoryRoot,
      contractPath,
      sourceRoots: effectiveRoots,
      allowPaths,
      allowOutsidePaths,
    });
    changedProductFiles = scope.changedProductFiles;
    if (!scope.skipped) {
      results.push({
        name: 'scope',
        ok: scope.ok,
        summary: scope.ok
          ? `${scope.changedProductFiles.length} arquivo(s) de produto dentro da fronteira (${effectiveRoots.join(', ')}/)`
          : `${scope.violations.length} violação(ões) de escopo/fronteira`,
        details: scope.violations,
      });
    }
  }

  // Coleta arquivos TS/JS e testes nas raízes de produto
  const tsFiles = [];
  const lintableFiles = [];
  const productTests = [];
  for (const rootRel of existingRoots) {
    const absRoot = resolve(repositoryRoot, rootRel);
    collectFilesMatching(absRoot, (f) => /\.(?:ts|tsx)$/u.test(f) && !isProductTestPath(f), tsFiles);
    collectFilesMatching(absRoot, (f) => /\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/u.test(f) && !isProductTestPath(f), lintableFiles);
    collectFilesMatching(absRoot, (f) => isProductTestPath(f), productTests);
  }

  // 2. TypeScript typecheck
  if (tsFiles.length > 0 && existsSync(resolve(repositoryRoot, 'tsconfig.json'))) {
    const tscBin = resolve(repositoryRoot, 'node_modules/.bin/tsc');
    const cmd = existsSync(tscBin) ? tscBin : 'tsc';
    const res = runStep(cmd, ['--noEmit'], repositoryRoot);
    results.push({
      name: 'typecheck',
      ok: res.ok,
      summary: res.ok ? '0 erros de tipo' : 'erros de tipo',
      details: res.ok ? [] : compactErrorLines(res.output),
    });
  }

  // 3. ESLint sobre raízes de produto (TS e JS)
  if (lintableFiles.length > 0 && existingRoots.length > 0) {
    const eslintBin = resolve(repositoryRoot, 'node_modules/.bin/eslint');
    const cmd = existsSync(eslintBin) ? eslintBin : 'eslint';
    const res = runStep(cmd, existingRoots, repositoryRoot);
    results.push({
      name: 'eslint',
      ok: res.ok,
      summary: res.ok ? 'limpo' : 'violações de lint',
      details: res.ok ? [] : compactErrorLines(res.output),
    });
  }

  // 4. Verificações estáticas puras em Node/AST (imports não declarados + segredos hardcoded)
  if (existingRoots.length > 0) {
    const staticRes = runStaticChecks({ repositoryRoot, existingRoots });
    results.push({
      name: 'static_checks',
      ok: staticRes.ok,
      summary: staticRes.ok ? 'limpo (imports AST + segredos)' : `${staticRes.violations.length} violação(ões) estática(s)`,
      details: staticRes.violations,
    });
  }

  // 5. Testes reais de produto + amarração AST com cenários do contract.md
  const contractRead = readSafeContractText(contractPath);
  const hasContract = contractRead.status === 'OK';
  const enforceContractTests = hasContract && allowPaths.length === 0 && changedProductFiles.length > 0;
  if (skipDiff && hasContract && allowPaths.length === 0) {
    warnings.push('--skip-diff ativo com contract.md presente: escopo git e obrigatoriedade de testes do contrato não foram cobrados.');
  }

  if (productTests.length === 0) {
    if (enforceContractTests) {
      results.push({
        name: 'product_tests',
        ok: false,
        summary: 'nenhum teste encontrado para o contrato',
        details: [
          `contract.md ativo com ${changedProductFiles.length} arquivo(s) alterado(s) em produto, mas nenhum arquivo *.test.* foi encontrado em ${effectiveRoots.join(', ')}/.`,
        ],
      });
    }
  } else {
    const hasTsTests = productTests.some((f) => /\.tsx?$/u.test(f));
    const args = hasTsTests
      ? ['--import', 'tsx', '--test', ...productTests]
      : ['--test', ...productTests];
    const res = runStep('node', args, repositoryRoot);

    let declaredTestCases = 0;
    const activeTestTitles = [];
    for (const testFile of productTests) {
      const content = readFileSync(testFile, 'utf8');
      const extracted = extractActiveTestCases(testFile, content);
      declaredTestCases += extracted.caseCount;
      activeTestTitles.push(...extracted.titles);
    }

    const coverageFailures = [];
    if (hasContract && allowPaths.length === 0) {
      const contractMd = contractRead.text;
      const scenarios = countContractScenarios(contractMd);
      const scenarioIds = extractScenarioIds(contractMd);

      if (scenarios > 0 && declaredTestCases < scenarios) {
        const msg = `contract.md define ${scenarios} cenário(s), mas apenas ${declaredTestCases} caso(s) ativos test()/it() foram encontrados`;
        if (enforceContractTests) coverageFailures.push(msg);
        else warnings.push(`Cobertura de cenários: ${msg}`);
      }

      const missingIds = scenarioIds.filter((id) => !activeTestTitles.some((title) => title.includes(id)));
      if (missingIds.length > 0) {
        const msg = `Cenários do contract.md ausentes nos títulos de test()/it()/describe() ativos: ${missingIds.join(', ')}`;
        if (enforceContractTests) coverageFailures.push(msg);
        else warnings.push(msg);
      }
    }

    const ok = res.ok && coverageFailures.length === 0;
    results.push({
      name: 'product_tests',
      ok,
      summary: ok
        ? `${productTests.length} arquivo(s), ${declaredTestCases} caso(s) PASS`
        : (res.ok ? 'cobertura de contrato incompleta' : 'falha nos testes de produto'),
      details: [
        ...(res.ok ? [] : compactErrorLines(res.output, 20)),
        ...coverageFailures,
      ],
    });
  }

  const allPassed = results.every((r) => r.ok);
  return { ok: allPassed, results, warnings };
}

export function formatCheckReport(report) {
  const header = `[AEGIS][CHECK] ${report.ok ? 'PASS' : 'FAIL'}`;
  const lines = [header];
  for (const step of report.results) {
    lines.push(`- ${step.name}: ${step.ok ? 'PASS' : 'FAIL'} (${step.summary})`);
    if (!step.ok && step.details.length > 0) {
      for (const detail of step.details) {
        lines.push(`  ${detail}`);
      }
    }
  }
  for (const warning of report.warnings ?? []) {
    lines.push(`- AVISO: ${warning}`);
  }
  return `${lines.join('\n')}\n`;
}

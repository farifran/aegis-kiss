import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { join, relative, resolve, sep } from 'node:path';
import {
  countContractScenarios,
  extractAuthorizedPaths,
  extractScenarioIds,
  readSafeContractText,
  verifyContractMarkdown,
} from './contract_verifier.mjs';
import {
  hasSymlinkComponent,
  isEditableProductPath,
  isPathCovered,
  isProductTestPath,
  isProtectedPath,
  normalizeRepoRelativePath,
} from './path_guard.mjs';
import { loadProjectConfig, resolveSourceRoots } from './workspace_observer.mjs';
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

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function matchesScenarioId(title, id) {
  return new RegExp(`(?<![A-Za-z0-9-])${escapeRegex(id)}(?![A-Za-z0-9-])`, 'u').test(title);
}

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
function runStaticChecks({ repositoryRoot, existingRoots, projectDir = repositoryRoot, protectedPaths = [] }) {
  const violations = [];
  const declared = loadDeclaredPackages(projectDir) ?? loadDeclaredPackages(repositoryRoot);
  const pathAliases = loadTsconfigPathAliases(projectDir);
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
    if (isProtectedPath(relPath, protectedPaths)) continue;
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
  const entriesByPath = new Map();
  const upsert = (path, { deleted }) => {
    const prev = entriesByPath.get(path);
    entriesByPath.set(path, {
      path,
      deleted: prev ? (prev.deleted && deleted) : deleted,
    });
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const entry = tokens[i];
    if (!entry || entry.length < 4) continue;
    const status = entry.slice(0, 2);
    const firstPath = entry.slice(3);
    if (firstPath) {
      upsert(firstPath, { deleted: status.includes('D') });
    }
    if (status.includes('R') || status.includes('C')) {
      const origPath = tokens[i + 1];
      if (origPath) {
        upsert(origPath, { deleted: status.includes('R') });
      }
      i += 1;
    }
  }
  return [...entriesByPath.values()];
}

/**
 * Vigia TODO o git status do repositório (`--porcelain -z -uall`, fail-closed):
 * - Ignora apenas .harness/runtime/ (artefatos transitórios do Aegis).
 * - Valida tanto origem quanto destino em renames/cópias (`R`/`C`).
 * - Qualquer arquivo fora das raízes de produto (padrão: src/) FALHA, salvo
 *   se explicitamente listado pelo humano em --allow-outside.
 * - Dentro das raízes de produto, bloqueia symlinks, exige aderência a --allow ou contract.md,
 *   impede edição/exclusão de testes alheios e valida estrutura do contrato quando ativo.
 */
function checkGitScope({
  repositoryRoot,
  contractPath,
  sourceRoots,
  protectedPaths = [],
  allowPaths = [],
  allowOutsidePaths = [],
}) {
  const violations = [];
  const normalizedAllow = [];
  for (const raw of allowPaths) {
    const rel = normalizeRepoRelativePath(repositoryRoot, raw);
    if (!rel || !isEditableProductPath(rel, sourceRoots, protectedPaths) || sourceRoots.includes(rel)) {
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
    violations.push('Repositório git ausente ou inacessível; não é possível validar fronteira de escopo (use --skip-diff se intencional).');
    return {
      skipped: false,
      ok: false,
      changedProductFiles: [],
      changedTestFiles: [],
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
    violations.push('Falha ao executar git status; não é possível validar fronteira de escopo.');
    return {
      skipped: false,
      ok: false,
      changedProductFiles: [],
      changedTestFiles: [],
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
    : (hasContract ? extractAuthorizedPaths(contractRead.text, sourceRoots, repositoryRoot, protectedPaths).authorizedPaths : []);

  const changedProductFiles = [];
  const changedTestFiles = [];
  const changedInProductRoots = [];
  const changedEntries = parseGitPorcelainZ(statusRes.output);

  for (const { path: relPath, deleted } of changedEntries) {
    if (relPath === '.harness/runtime' || relPath.startsWith('.harness/runtime/')) {
      continue;
    }
    if (!isEditableProductPath(relPath, sourceRoots, protectedPaths)) {
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
    const absPath = resolve(repositoryRoot, relPath);
    const isTest = isProductTestPath(relPath);
    const isDeleted = deleted || !existsSync(absPath);

    if (isTest) {
      if (!isDeleted) changedTestFiles.push(absPath);
    } else {
      changedProductFiles.push(relPath);
    }

    if (authorizedPaths.length > 0) {
      const sourceLabel = normalizedAllow.length > 0 ? '--allow' : 'contract.md';
      if (!isPathCovered(relPath, authorizedPaths)) {
        violations.push(`${relPath} alterado fora dos arquivos autorizados em ${sourceLabel}`);
      } else if (isTest && isDeleted && !authorizedPaths.includes(relPath)) {
        violations.push(`Exclusão de arquivo de teste não autorizada explicitamente em ${sourceLabel}: ${relPath}`);
      }
    }
  }

  if (changedInProductRoots.length > 0 && authorizedPaths.length === 0 && violations.length === 0) {
    violations.push(
      hasContract
        ? `contract.md ativo não declara caminhos autorizados em ${sourceRoots.join(', ')}/ para: ${changedInProductRoots.join(', ')}`
        : `Alterações em ${sourceRoots.join(', ')}/ sem contract.md ativo nem --allow (${changedInProductRoots.join(', ')})`,
    );
  }

  if (hasContract && normalizedAllow.length === 0 && changedInProductRoots.length > 0) {
    const structural = verifyContractMarkdown({
      repositoryRoot,
      contractPath,
      sourceRoots,
      skipFileLineChecks: true,
    });
    if (!structural.ok) {
      for (const err of structural.errors) {
        violations.push(`Contrato inválido: ${err}`);
      }
    }
  }

  return {
    skipped: false,
    ok: violations.length === 0,
    changedProductFiles,
    changedTestFiles,
    violations,
  };
}

function compactErrorLines(rawOutput, maxLines = 15, { fromTail = false } = {}) {
  const lines = rawOutput
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);
  if (lines.length <= maxLines) return lines;
  if (fromTail) {
    return [`... (+${lines.length - maxLines} linhas anteriores omitidas)`, ...lines.slice(-maxLines)];
  }
  return [...lines.slice(0, maxLines), `... (+${lines.length - maxLines} linhas omitidas)`];
}

function inspectTestFiles(testPaths) {
  let declaredTestCases = 0;
  const activeTestTitles = [];
  for (const testFile of testPaths) {
    const content = readFileSync(testFile, 'utf8');
    const extracted = extractActiveTestCases(testFile, content);
    declaredTestCases += extracted.caseCount;
    activeTestTitles.push(...extracted.titles);
  }
  return { declaredTestCases, activeTestTitles };
}

/**
 * Executa a verificação mecânica pós-implementação (0 tokens):
 * 1. Escopo git completo (fail-closed, bloqueia symlinks, fora da fronteira, testes alheios e contrato inválido)
 * 2. tsc --noEmit (se houver TS em raízes de produto)
 * 3. eslint sobre raízes de produto (inclui regras estruturais e DETERMINISTIC-TIME)
 * 4. static_checks (AST undeclared imports respeitando tsconfig paths + segredos hardcoded)
 * 5. Testes reais de produto (executa toda a suíte e exige cobertura AST + AC-* com word-boundary
 *    nos arquivos de teste adicionados/modificados nesta tarefa)
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
  const projectConfig = loadProjectConfig(repositoryRoot);
  const protectedPaths = projectConfig.protectedPaths;
  const projectDir = projectConfig.projectRoot ? resolve(repositoryRoot, projectConfig.projectRoot) : repositoryRoot;
  const effectiveRoots = resolveSourceRoots(repositoryRoot, sourceRoots);
  const existingRoots = effectiveRoots.filter((r) => existsSync(resolve(repositoryRoot, r)));

  // 1. Escopo git completo
  let changedProductFiles = [];
  let changedTestFiles = [];
  if (!skipDiff) {
    const scope = checkGitScope({
      repositoryRoot,
      contractPath,
      sourceRoots: effectiveRoots,
      protectedPaths,
      allowPaths,
      allowOutsidePaths,
    });
    changedProductFiles = scope.changedProductFiles;
    changedTestFiles = scope.changedTestFiles;
    if (!scope.skipped) {
      results.push({
        name: 'scope',
        ok: scope.ok,
        summary: scope.ok
          ? `${scope.changedProductFiles.length} arquivo(s) de produto dentro da fronteira (${effectiveRoots.join(', ')}/)`
          : `${scope.violations.length} violação(ões) de escopo/fronteira`,
        details: scope.violations,
      });
      if (!scope.ok) {
        warnings.push('Demais etapas (typecheck, lint, guardrails, testes) foram puladas por fail-fast devido à violação de fronteira/escopo.');
        return { ok: false, results, warnings };
      }
    }
  }

  // Coleta arquivos TS/JS e testes nas raízes de produto (excluindo protectedPaths)
  const tsFiles = [];
  const lintableFiles = [];
  const productTests = [];
  for (const rootRel of existingRoots) {
    const absRoot = resolve(repositoryRoot, rootRel);
    const notProtected = (absPath) => !isProtectedPath(relative(repositoryRoot, absPath).replaceAll(sep, '/'), protectedPaths);
    collectFilesMatching(absRoot, (f) => notProtected(f) && /\.(?:ts|tsx|mts|cts)$/u.test(f) && !isProductTestPath(f), tsFiles);
    collectFilesMatching(absRoot, (f) => notProtected(f) && /\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/u.test(f) && !isProductTestPath(f), lintableFiles);
    collectFilesMatching(absRoot, (f) => notProtected(f) && isProductTestPath(f), productTests);
  }

  // 2. TypeScript typecheck (comando configurado em project.json ou padrão tsc --noEmit)
  if (projectConfig.typecheckCommand !== null) {
    if (Array.isArray(projectConfig.typecheckCommand)) {
      const res = runStep(projectConfig.typecheckCommand[0], projectConfig.typecheckCommand.slice(1), projectDir);
      results.push({
        name: 'typecheck',
        ok: res.ok,
        summary: res.ok ? '0 erros de tipo' : 'erros de tipo',
        details: res.ok ? [] : compactErrorLines(res.output),
      });
    } else if (tsFiles.length > 0 && existsSync(resolve(projectDir, 'tsconfig.json'))) {
      const tscBin = resolve(projectDir, 'node_modules/.bin/tsc');
      const rootTscBin = resolve(repositoryRoot, 'node_modules/.bin/tsc');
      const cmd = existsSync(tscBin) ? tscBin : (existsSync(rootTscBin) ? rootTscBin : 'tsc');
      const res = runStep(cmd, ['--noEmit'], projectDir);
      results.push({
        name: 'typecheck',
        ok: res.ok,
        summary: res.ok ? '0 erros de tipo' : 'erros de tipo',
        details: res.ok ? [] : compactErrorLines(res.output),
      });
    }
  }

  // 3. ESLint / lint (comando configurado em project.json ou padrão eslint nas raízes)
  if (projectConfig.lintCommand !== null) {
    if (Array.isArray(projectConfig.lintCommand)) {
      const res = runStep(projectConfig.lintCommand[0], projectConfig.lintCommand.slice(1), projectDir);
      results.push({
        name: 'eslint',
        ok: res.ok,
        summary: res.ok ? 'limpo' : 'violações de lint',
        details: res.ok ? [] : compactErrorLines(res.output),
      });
    } else if (lintableFiles.length > 0 && existingRoots.length > 0) {
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
  }

  // 3b. Guardrails extras configurados em project.json (ex.: segurança HTML, paridade de locales, SW manifest)
  for (const extra of projectConfig.extraChecks) {
    const res = runStep(extra.command[0], extra.command.slice(1), projectDir);
    results.push({
      name: extra.name,
      ok: res.ok,
      summary: res.ok ? 'limpo' : 'violação detectada',
      details: res.ok ? [] : compactErrorLines(res.output),
    });
  }

  // 4. Verificações estáticas puras em Node/AST (imports não declarados + segredos hardcoded)
  if (existingRoots.length > 0) {
    const staticRes = runStaticChecks({ repositoryRoot, existingRoots, projectDir, protectedPaths });
    results.push({
      name: 'static_checks',
      ok: staticRes.ok,
      summary: staticRes.ok ? 'limpo (imports AST + segredos)' : `${staticRes.violations.length} violação(ões) estática(s)`,
      details: staticRes.violations,
    });
  }

  // 5. Testes reais de produto + amarração AST escopada aos testes modificados
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
  } else if (projectConfig.testCommand !== null) {
    const res = Array.isArray(projectConfig.testCommand)
      ? runStep(projectConfig.testCommand[0], projectConfig.testCommand.slice(1), projectDir)
      : (() => {
        const hasTsTests = productTests.some((f) => /\.(?:ts|tsx|mts|cts)$/u.test(f));
        const args = hasTsTests
          ? ['--import', 'tsx', '--test', ...productTests]
          : ['--test', ...productTests];
        return runStep('node', args, repositoryRoot);
      })();

    const allSuiteStats = inspectTestFiles(productTests);
    const coverageFailures = [];

    if (hasContract && allowPaths.length === 0) {
      const contractMd = contractRead.text;
      const scenarios = countContractScenarios(contractMd);
      const scenarioIds = extractScenarioIds(contractMd);

      if (enforceContractTests) {
        if (changedTestFiles.length === 0) {
          coverageFailures.push(
            `contract.md ativo com ${changedProductFiles.length} arquivo(s) de produto alterado(s), mas nenhum arquivo de teste (*.test.*/*.spec.*) foi adicionado ou modificado nesta alteração.`,
          );
        } else {
          const changedStats = inspectTestFiles(changedTestFiles);
          if (scenarios > 0 && changedStats.declaredTestCases < scenarios) {
            coverageFailures.push(
              `contract.md define ${scenarios} cenário(s), mas apenas ${changedStats.declaredTestCases} caso(s) ativos test()/it() foram encontrados nos arquivos de teste modificados`,
            );
          }
          const missingIds = scenarioIds.filter(
            (id) => !changedStats.activeTestTitles.some((title) => matchesScenarioId(title, id)),
          );
          if (missingIds.length > 0) {
            coverageFailures.push(
              `Cenários do contract.md ausentes nos títulos de test()/it() ativos dos testes modificados: ${missingIds.join(', ')}`,
            );
          }
        }
      } else {
        if (scenarios > 0 && allSuiteStats.declaredTestCases < scenarios) {
          warnings.push(
            `Cobertura de cenários: contract.md define ${scenarios} cenário(s), mas apenas ${allSuiteStats.declaredTestCases} caso(s) ativos test()/it() foram encontrados`,
          );
        }
        const missingIds = scenarioIds.filter(
          (id) => !allSuiteStats.activeTestTitles.some((title) => matchesScenarioId(title, id)),
        );
        if (missingIds.length > 0) {
          warnings.push(
            `Cenários do contract.md ausentes nos títulos de test()/it() ativos: ${missingIds.join(', ')}`,
          );
        }
      }
    }

    const ok = res.ok && coverageFailures.length === 0;
    results.push({
      name: 'product_tests',
      ok,
      summary: ok
        ? `${productTests.length} arquivo(s), ${allSuiteStats.declaredTestCases} caso(s) PASS`
        : (res.ok ? 'cobertura de contrato incompleta' : 'falha nos testes de produto'),
      details: [
        ...(res.ok ? [] : compactErrorLines(res.output, 20, { fromTail: true })),
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

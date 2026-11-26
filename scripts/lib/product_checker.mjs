import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  countContractScenarios,
  extractAuthorizedPaths,
  extractScenarioIds,
} from './contract_verifier.mjs';
import {
  isInsideProductRoots,
  isPathCovered,
  isProductTestPath,
  normalizeRepoRelativePath,
} from './path_guard.mjs';
import { resolveSourceRoots } from './workspace_observer.mjs';

function runStep(command, args, cwd) {
  try {
    const stdout = execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, output: stdout.trimEnd() };
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

function parseGitChangedPaths(porcelainOutput) {
  const paths = [];
  for (const rawLine of porcelainOutput.split('\n')) {
    if (!rawLine || rawLine.length < 4) continue;
    const rawPath = rawLine.slice(3).trim();
    const relPath = rawPath.includes(' -> ') ? rawPath.split(' -> ').pop().trim() : rawPath;
    if (relPath) paths.push(relPath.replace(/^"|"$/gu, ''));
  }
  return paths;
}

/**
 * Vigia TODO o git status do repositório:
 * - Ignora apenas .harness/runtime/ (artefatos transitórios do Aegis).
 * - Qualquer arquivo fora das raízes de produto (padrão: src/) FALHA, salvo
 *   se explicitamente listado pelo humano em --allow-outside.
 * - Dentro das raízes de produto, exige aderência a --allow (modo rápido) ou contract.md.
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

  const statusRes = runStep('git', ['status', '--porcelain'], repositoryRoot);
  if (!statusRes.ok) {
    return {
      skipped: violations.length === 0,
      ok: violations.length === 0,
      changedProductFiles: [],
      violations,
    };
  }

  const hasContract = existsSync(contractPath);
  const authorizedPaths = normalizedAllow.length > 0
    ? normalizedAllow
    : (hasContract ? extractAuthorizedPaths(readFileSync(contractPath, 'utf8')).authorizedPaths : []);

  const changedProductFiles = [];
  const changedAll = parseGitChangedPaths(statusRes.output);

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
    if (!isProductTestPath(relPath)) {
      changedProductFiles.push(relPath);
    }
    if (authorizedPaths.length > 0 && !isPathCovered(relPath, authorizedPaths)) {
      const sourceLabel = normalizedAllow.length > 0 ? '--allow' : 'contract.md';
      violations.push(`${relPath} alterado fora dos arquivos autorizados em ${sourceLabel}`);
    }
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
 * 1. Escopo git completo (bloqueia qualquer alteração fora de src/ + fora do contrato/--allow)
 * 2. tsc --noEmit (se houver TS em src/)
 * 3. eslint sobre raízes de produto
 * 4. static_gate.sh --workspace --imports (20 regras ast-grep + imports)
 * 5. Testes reais de produto (obrigatórios quando há contract.md + edição em produto,
 *    com checagem de contagem de cenários e IDs AC-*)
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

  // Coleta arquivos TS e testes nas raízes de produto
  const tsFiles = [];
  const productTests = [];
  for (const rootRel of existingRoots) {
    const absRoot = resolve(repositoryRoot, rootRel);
    collectFilesMatching(absRoot, (f) => /\.(?:ts|tsx)$/u.test(f) && !isProductTestPath(f), tsFiles);
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

  // 3. ESLint sobre raízes de produto
  if (tsFiles.length > 0 && existingRoots.length > 0) {
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

  // 4. Static gate (ast-grep + imports)
  const gateScript = resolve(repositoryRoot, 'scripts/substrates/static_gate.sh');
  if (existsSync(gateScript) && existingRoots.length > 0) {
    const res = runStep('bash', [gateScript, '--workspace', '--imports', ...existingRoots], repositoryRoot);
    results.push({
      name: 'static_gate',
      ok: res.ok,
      summary: res.ok ? 'limpo (AST + imports)' : 'violações AST/imports',
      details: res.ok ? [] : compactErrorLines(res.output),
    });
  }

  // 5. Testes reais de produto + amarração com cenários do contract.md
  const hasContract = existsSync(contractPath);
  const enforceContractTests = hasContract && allowPaths.length === 0 && changedProductFiles.length > 0;

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
    const allTestSource = productTests
      .map((testFile) => {
        const content = readFileSync(testFile, 'utf8');
        declaredTestCases += (content.match(/(?:^|\n)\s*(?:test|it)\s*\(/gu) ?? []).length;
        return content;
      })
      .join('\n');

    const coverageFailures = [];
    if (hasContract && allowPaths.length === 0) {
      const contractMd = readFileSync(contractPath, 'utf8');
      const scenarios = countContractScenarios(contractMd);
      const scenarioIds = extractScenarioIds(contractMd);

      if (scenarios > 0 && declaredTestCases < scenarios) {
        const msg = `contract.md define ${scenarios} cenário(s), mas apenas ${declaredTestCases} caso(s) test()/it() foram encontrados`;
        if (enforceContractTests) coverageFailures.push(msg);
        else warnings.push(`Cobertura de cenários: ${msg}`);
      }

      const missingIds = scenarioIds.filter((id) => !allTestSource.includes(id));
      if (missingIds.length > 0) {
        const msg = `Cenários do contract.md ausentes nos testes: ${missingIds.join(', ')}`;
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

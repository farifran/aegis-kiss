import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { extractAuthorizedPaths } from './contract_verifier.mjs';

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

function isProductTestPath(relPath) {
  return /\.(?:test|spec)\.(?:ts|tsx|mts|cts|js|mjs)$/u.test(relPath);
}

function pathCoveredByContract(changedPath, authorizedPaths) {
  if (authorizedPaths.length === 0) return true;
  if (isProductTestPath(changedPath)) return true;
  return authorizedPaths.some((allowed) => (
    changedPath === allowed
    || (allowed.endsWith('/') && changedPath.startsWith(allowed))
  ));
}

function checkGitScope(repositoryRoot, contractPath) {
  if (!existsSync(contractPath)) {
    return { skipped: true, ok: true, reason: 'Sem contract.md ativo; checagem de escopo git pulada.' };
  }
  const gitCheck = runStep('git', ['rev-parse', '--is-inside-work-tree'], repositoryRoot);
  if (!gitCheck.ok) {
    return { skipped: true, ok: true, reason: 'Fora de repositório Git.' };
  }

  const statusRes = runStep('git', ['status', '--porcelain'], repositoryRoot);
  if (!statusRes.ok) {
    return { skipped: true, ok: true, reason: 'Não foi possível ler git status.' };
  }

  const markdown = readFileSync(contractPath, 'utf8');
  const { authorizedPaths, allowsPackageJson } = extractAuthorizedPaths(markdown);
  const violations = [];
  const changedSrc = [];

  for (const rawLine of statusRes.output.split('\n')) {
    if (!rawLine || rawLine.length < 4) continue;
    const rawPath = rawLine.slice(3).trim();
    const relPath = rawPath.includes(' -> ') ? rawPath.split(' -> ').pop().trim() : rawPath;
    if (relPath === 'package.json' && !allowsPackageJson) {
      violations.push('package.json modificado sem autorização no contract.md');
      continue;
    }
    if (relPath.startsWith('src/')) {
      changedSrc.push(relPath);
      if (!pathCoveredByContract(relPath, authorizedPaths)) {
        violations.push(`${relPath} alterado fora dos arquivos autorizados no contract.md`);
      }
    }
  }

  return {
    skipped: false,
    ok: violations.length === 0,
    changedSrc,
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
 * 1. Escopo git diff vs. contract.md
 * 2. tsc --noEmit (se houver TS em src/)
 * 3. eslint sobre src/
 * 4. static_gate.sh --workspace src (20 regras ast-grep + imports)
 * 5. Testes unitários de produto em src/**\/*.test.{ts,js,mjs} (se existirem)
 */
export function runProductCheck({
  repositoryRoot,
  contractPath,
  skipDiff = false,
}) {
  const results = [];
  const srcDir = resolve(repositoryRoot, 'src');

  // 1. Escopo git diff
  if (!skipDiff) {
    const scope = checkGitScope(repositoryRoot, contractPath);
    if (!scope.skipped) {
      results.push({
        name: 'scope',
        ok: scope.ok,
        summary: scope.ok
          ? `${scope.changedSrc.length} arquivo(s) em src/ dentro do contrato`
          : `${scope.violations.length} violação(ões) de escopo`,
        details: scope.violations,
      });
    }
  }

  // 2. TypeScript typecheck
  const tsFiles = collectFilesMatching(srcDir, (f) => /\.(?:ts|tsx)$/u.test(f) && !isProductTestPath(f));
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

  // 3. ESLint em src/
  if (tsFiles.length > 0) {
    const eslintBin = resolve(repositoryRoot, 'node_modules/.bin/eslint');
    const cmd = existsSync(eslintBin) ? eslintBin : 'eslint';
    const res = runStep(cmd, ['src'], repositoryRoot);
    results.push({
      name: 'eslint',
      ok: res.ok,
      summary: res.ok ? 'limpo' : 'violações de lint',
      details: res.ok ? [] : compactErrorLines(res.output),
    });
  }

  // 4. Static gate (ast-grep + fallback)
  const gateScript = resolve(repositoryRoot, 'scripts/substrates/static_gate.sh');
  if (existsSync(gateScript) && existsSync(srcDir)) {
    const res = runStep('bash', [gateScript, '--workspace', '--imports', 'src'], repositoryRoot);
    results.push({
      name: 'static_gate',
      ok: res.ok,
      summary: res.ok ? 'limpo (AST + imports)' : 'violações AST/imports',
      details: res.ok ? [] : compactErrorLines(res.output),
    });
  }

  // 5. Testes reais de produto (src/**/*.test.*)
  const productTests = collectFilesMatching(srcDir, (f) => isProductTestPath(f));
  if (productTests.length > 0) {
    const hasTsTests = productTests.some((f) => /\.tsx?$/u.test(f));
    const args = hasTsTests
      ? ['--import', 'tsx', '--test', ...productTests]
      : ['--test', ...productTests];
    const res = runStep('node', args, repositoryRoot);
    results.push({
      name: 'product_tests',
      ok: res.ok,
      summary: res.ok ? `${productTests.length} arquivo(s) PASS` : 'falha nos testes de produto',
      details: res.ok ? [] : compactErrorLines(res.output, 20),
    });
  }

  const allPassed = results.every((r) => r.ok);
  return { ok: allPassed, results };
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
  return `${lines.join('\n')}\n`;
}

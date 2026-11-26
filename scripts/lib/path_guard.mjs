import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { extractAuthorizedPaths } from './contract_verifier.mjs';
import { resolveSourceRoots } from './workspace_observer.mjs';

export function normalizeRepoRelativePath(repositoryRoot, rawPath) {
  if (typeof rawPath !== 'string' || rawPath.trim().length === 0) return null;
  const trimmed = rawPath.trim();
  const abs = isAbsolute(trimmed) ? resolve(trimmed) : resolve(repositoryRoot, trimmed);
  const rootPrefix = repositoryRoot.endsWith(sep) ? repositoryRoot : `${repositoryRoot}${sep}`;
  if (abs !== repositoryRoot && !abs.startsWith(rootPrefix)) {
    return null;
  }
  const rel = relative(repositoryRoot, abs);
  const portable = sep === '\\' ? rel.replaceAll('\\', '/') : rel;
  return portable.replace(/^\.\//u, '');
}

export function isInsideProductRoots(relPath, sourceRoots) {
  return sourceRoots.some((root) => relPath === root || relPath.startsWith(`${root}/`));
}

export function isProductTestPath(relPath) {
  return /\.(?:test|spec)\.(?:ts|tsx|mts|cts|js|mjs)$/u.test(relPath);
}

export function isPathCovered(relPath, authorizedPaths) {
  if (authorizedPaths.length === 0) return true;
  if (isProductTestPath(relPath)) return true;
  return authorizedPaths.some((allowed) => (
    relPath === allowed
    || (allowed.endsWith('/') && relPath.startsWith(allowed))
  ));
}

/**
 * Avalia se um caminho pode ser editado pela IA em modo produto (para hooks de IDE).
 * Permite apenas:
 *  - .harness/runtime/contract.md (para redigir o contrato)
 *  - arquivos dentro de src/ (ou AEGIS_SRC_DIRS) cobertos por --allow ou contract.md
 */
export function evaluateGuardPath({
  repositoryRoot,
  targetPath,
  contractPath,
  allowPaths = [],
  sourceRoots = null,
}) {
  const relPath = normalizeRepoRelativePath(repositoryRoot, targetPath);
  if (!relPath) {
    return {
      allowed: false,
      path: String(targetPath ?? ''),
      reason: 'Caminho fora do repositório ou inválido.',
    };
  }

  if (relPath === '.harness/runtime/contract.md') {
    return {
      allowed: true,
      path: relPath,
      reason: 'Contrato transitório do Aegis permitido.',
    };
  }

  const roots = resolveSourceRoots(repositoryRoot, sourceRoots);
  if (!isInsideProductRoots(relPath, roots)) {
    return {
      allowed: false,
      path: relPath,
      reason: `Fora da fronteira de produto (${roots.join(', ')}/): IA só pode editar código em ${roots.join(', ')}/.`,
    };
  }

  if (Array.isArray(allowPaths) && allowPaths.length > 0) {
    const normalizedAllow = allowPaths
      .map((p) => normalizeRepoRelativePath(repositoryRoot, p))
      .filter((p) => p && isInsideProductRoots(p, roots));
    if (!isPathCovered(relPath, normalizedAllow)) {
      return {
        allowed: false,
        path: relPath,
        reason: `Arquivo fora da lista --allow (${normalizedAllow.join(', ')}).`,
      };
    }
    return { allowed: true, path: relPath, reason: 'Autorizado via --allow.' };
  }

  if (contractPath && existsSync(contractPath)) {
    const { authorizedPaths } = extractAuthorizedPaths(readFileSync(contractPath, 'utf8'));
    if (authorizedPaths.length > 0 && !isPathCovered(relPath, authorizedPaths)) {
      return {
        allowed: false,
        path: relPath,
        reason: `Arquivo fora dos caminhos autorizados em contract.md (${authorizedPaths.join(', ')}).`,
      };
    }
  }

  return { allowed: true, path: relPath, reason: 'Dentro da fronteira de produto.' };
}

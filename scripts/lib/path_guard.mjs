import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { extractAuthorizedPaths, readSafeContractText } from './contract_verifier.mjs';
import { resolveSourceRoots } from './workspace_observer.mjs';

function resolveNearestRealPath(targetPath) {
  const abs = resolve(targetPath);
  const missingSegments = [];
  let current = abs;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    missingSegments.unshift(current.slice(parent.endsWith(sep) ? parent.length : parent.length + 1));
    current = parent;
  }
  const base = existsSync(current) ? realpathSync(current) : current;
  return missingSegments.length > 0 ? resolve(base, ...missingSegments) : base;
}

export function hasSymlinkComponent(repositoryRoot, relPath) {
  const parts = relPath.split('/').filter(Boolean);
  let current = resolve(repositoryRoot);
  for (const part of parts) {
    current = resolve(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) return true;
    } catch {
      break;
    }
  }
  return false;
}

export function normalizeRepoRelativePath(repositoryRoot, rawPath) {
  if (typeof rawPath !== 'string' || rawPath.trim().length === 0) return null;
  const trimmed = rawPath.trim();
  const realRoot = existsSync(repositoryRoot) ? realpathSync(repositoryRoot) : resolve(repositoryRoot);
  const rootPrefix = realRoot.endsWith(sep) ? realRoot : `${realRoot}${sep}`;

  const rawAbs = isAbsolute(trimmed) ? resolve(trimmed) : resolve(repositoryRoot, trimmed);
  try {
    if (lstatSync(rawAbs).isSymbolicLink()) return null;
  } catch {
    // Arquivo novo ainda inexistente no disco: continua validação nos ancestrais.
  }

  const realAbs = resolveNearestRealPath(rawAbs);
  if (realAbs !== realRoot && !realAbs.startsWith(rootPrefix)) {
    return null;
  }
  const rel = relative(realRoot, realAbs);
  const portable = (sep === '\\' ? rel.replaceAll('\\', '/') : rel).replace(/^\.\//u, '');
  if (!portable || hasSymlinkComponent(realRoot, portable)) {
    return null;
  }
  return portable;
}

export function isInsideProductRoots(relPath, sourceRoots) {
  return sourceRoots.some((root) => relPath === root || relPath.startsWith(`${root}/`));
}

export function isProductTestPath(relPath) {
  return /\.(?:test|spec)\.(?:ts|tsx|mts|cts|js|mjs)$/u.test(relPath);
}

export function isPathCovered(relPath, authorizedPaths) {
  if (!Array.isArray(authorizedPaths) || authorizedPaths.length === 0) return false;
  if (isProductTestPath(relPath)) return true;
  return authorizedPaths.some((allowed) => (
    relPath === allowed
    || (allowed.endsWith('/') && relPath.startsWith(allowed))
  ));
}

/**
 * Avalia se um caminho pode ser editado pela IA em modo produto (para hooks de IDE).
 * Falha fechado (fail-closed): permite apenas
 *  - .harness/runtime/contract.md (para redigir o contrato)
 *  - arquivos dentro de src/ (ou AEGIS_SRC_DIRS) explicitamente cobertos por --allow ou contract.md
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
      reason: 'Caminho fora do repositório, symlink ou inválido.',
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
    const normalizedAllow = [];
    for (const raw of allowPaths) {
      const normalized = normalizeRepoRelativePath(repositoryRoot, raw);
      if (!normalized || !isInsideProductRoots(normalized, roots)) {
        return {
          allowed: false,
          path: relPath,
          reason: `--allow inválido fora da fronteira (${roots.join(', ')}/): ${raw}`,
        };
      }
      normalizedAllow.push(normalized);
    }
    if (!isPathCovered(relPath, normalizedAllow)) {
      return {
        allowed: false,
        path: relPath,
        reason: `Arquivo fora da lista --allow (${normalizedAllow.join(', ')}).`,
      };
    }
    return { allowed: true, path: relPath, reason: 'Autorizado via --allow.' };
  }

  if (!contractPath) {
    return {
      allowed: false,
      path: relPath,
      reason: 'Sem contract.md ativo nem --allow; crie .harness/runtime/contract.md ou informe --allow antes de editar.',
    };
  }

  const contractRead = readSafeContractText(contractPath);
  if (contractRead.status === 'MISSING') {
    return {
      allowed: false,
      path: relPath,
      reason: 'Sem contract.md ativo nem --allow; crie .harness/runtime/contract.md ou informe --allow antes de editar.',
    };
  }
  if (contractRead.status !== 'OK' || !normalizeRepoRelativePath(repositoryRoot, contractPath)) {
    return {
      allowed: false,
      path: relPath,
      reason: 'contract.md inválido, symlink ou fora do repositório.',
    };
  }

  const { authorizedPaths } = extractAuthorizedPaths(contractRead.text, roots);
  if (authorizedPaths.length === 0) {
    return {
      allowed: false,
      path: relPath,
      reason: 'contract.md não declara caminhos autorizados dentro da fronteira de produto.',
    };
  }
  if (!isPathCovered(relPath, authorizedPaths)) {
    return {
      allowed: false,
      path: relPath,
      reason: `Arquivo fora dos caminhos autorizados em contract.md (${authorizedPaths.join(', ')}).`,
    };
  }

  return { allowed: true, path: relPath, reason: 'Autorizado via contract.md.' };
}

import { dirname, resolve } from 'node:path';
import {
  computeContractDigest,
  readContractVerificationStamp,
  readSafeContractText,
  verifyContractMarkdown,
} from './contract_verifier.mjs';
import {
  hasSymlinkComponent,
  isEditableProductPath,
  isInsideProductRoots,
  isPathCovered,
  isProductTestPath,
  isProtectedPath,
  loadProjectConfig,
  normalizeRepoRelativePath,
  resolveSourceRoots,
} from './workspace_observer.mjs';

export {
  hasSymlinkComponent,
  isEditableProductPath,
  isInsideProductRoots,
  isPathCovered,
  isProductTestPath,
  isProtectedPath,
  normalizeRepoRelativePath,
};

function sameRoots(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((item, idx) => item === right[idx]);
}

/**
 * Avalia se um caminho pode ser editado pela IA em modo produto (para hooks de IDE).
 * Falha fechado (fail-closed): permite apenas
 *  - .harness/runtime/contract.md (para redigir o contrato)
 *  - arquivos dentro de src/ (ou AEGIS_SRC_DIRS) explicitamente cobertos por --allow ou
 *    por um contract.md validado via ./aegis verify-contract (selo de digest válido + fronteira íntegra).
 */
export function evaluateGuardPath({
  repositoryRoot,
  targetPath,
  contractPath,
  contractVerifiedPath = null,
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
  const protectedPaths = loadProjectConfig(repositoryRoot).protectedPaths;
  if (!isEditableProductPath(relPath, roots, protectedPaths)) {
    return {
      allowed: false,
      path: relPath,
      reason: isProtectedPath(relPath, protectedPaths)
        ? `Arquivo protegido na fronteira do projeto: ${relPath} (não editável pela IA sem exceção humana).`
        : `Fora da fronteira de produto (${roots.join(', ')}/): IA só pode editar código em ${roots.join(', ')}/.`,
    };
  }

  if (Array.isArray(allowPaths) && allowPaths.length > 0) {
    const normalizedAllow = [];
    for (const raw of allowPaths) {
      const normalized = normalizeRepoRelativePath(repositoryRoot, raw);
      if (!normalized || !isEditableProductPath(normalized, roots, protectedPaths) || roots.includes(normalized)) {
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

  const stampPath = contractVerifiedPath ?? resolve(dirname(contractPath), 'contract-verified.json');
  const stamp = readContractVerificationStamp(stampPath);
  const currentDigest = computeContractDigest(contractRead.text);
  if (!stamp || stamp.contractDigest !== currentDigest || !sameRoots(stamp.sourceRoots, roots)) {
    return {
      allowed: false,
      path: relPath,
      reason: 'contract.md ainda não foi validado (ou foi alterado após validação); rode ./aegis verify-contract antes de editar arquivos de produto.',
    };
  }

  // Revalidação estrutural sem depender de números de linha (que podem deslocar durante a edição de src/)
  const structural = verifyContractMarkdown({
    repositoryRoot,
    contractPath,
    sourceRoots: roots,
    skipFileLineChecks: true,
  });
  if (!structural.ok) {
    return {
      allowed: false,
      path: relPath,
      reason: `contract.md inválido: ${structural.errors[0]}`,
    };
  }

  const { authorizedPaths } = structural;
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

  return { allowed: true, path: relPath, reason: 'Autorizado via contract.md validado.' };
}

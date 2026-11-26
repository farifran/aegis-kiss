import { Buffer } from 'node:buffer';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { TextDecoder } from 'node:util';
import { canonicalDigest, compareCodeUnits, sha256 } from './canonical_json.mjs';
import { buildWorkspaceSkeleton } from './workspace_skeleton.mjs';

export const maxDemandBytes = 65_536;
export const maxIssueDemandBytes = 262_144;
const maxSingleFileBytes = 262_144;

const discoveryFileLimit = 1024;
const discoveryEntryLimit = 4096;
const discoveryByteLimit = 8_388_608;
const bidirectionalControlPattern = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;
const ignoredDirectories = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.turbo', '.next',
]);
const forbiddenSourceRoots = new Set([
  '.', '..', '.git', '.github', '.harness', 'scripts', 'node_modules',
]);
const fallbackSourceRoots = ['app', 'lib'];
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

export function resolveRuntimePaths(root) {
  const harnessDir = resolve(root, '.harness');
  const runtimeDir = resolve(harnessDir, 'runtime');
  return {
    root,
    harnessDir,
    runtimeDir,
    briefMdPath: resolve(runtimeDir, 'brief.md'),
    briefMetaPath: resolve(runtimeDir, 'brief-meta.json'),
    contractMdPath: resolve(runtimeDir, 'contract.md'),
    skeletonJsonPath: resolve(runtimeDir, 'workspace_skeleton.json'),
  };
}

export function resolveSourceRoots(repositoryRoot, explicitRoots = null) {
  const configured = Array.isArray(explicitRoots) && explicitRoots.length > 0
    ? explicitRoots
    : (process.env.AEGIS_SRC_DIRS
      ? process.env.AEGIS_SRC_DIRS.split(',').map((s) => s.trim()).filter(Boolean)
      : null);
  if (configured && configured.length > 0) {
    const normalized = [...new Set(configured.map((r) => r.replace(/^\.\//u, '').replace(/\/+$/u, '')))].sort(compareCodeUnits);
    for (const root of normalized) {
      const topSegment = root.split('/')[0];
      if (!root || forbiddenSourceRoots.has(topSegment) || root.includes('..') || root.startsWith('/')) {
        throw new Error(`invalid_source_root:${root}`);
      }
    }
    return normalized;
  }
  if (existsSync(resolve(repositoryRoot, 'src'))) return ['src'];
  const detected = fallbackSourceRoots.filter((dir) => existsSync(resolve(repositoryRoot, dir)));
  return detected.length > 0 ? detected : ['src'];
}

export async function writeFileAtomic(target, content) {
  const parent = dirname(target);
  await mkdir(parent, { recursive: true });
  const stagingDirectory = await mkdtemp(resolve(parent, '.aegis-write-'));
  const stagedPath = resolve(stagingDirectory, basename(target));
  try {
    await writeFile(stagedPath, content, { encoding: 'utf8', flush: true });
    await rename(stagedPath, target);
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
}

export async function readCachedSkeleton(paths, expectedSnapshotDigest = null) {
  if (!existsSync(paths.skeletonJsonPath)) return null;
  try {
    const parsed = JSON.parse(await readFile(paths.skeletonJsonPath, 'utf8'));
    if (expectedSnapshotDigest && parsed?.sourceSnapshotDigest !== expectedSnapshotDigest) {
      return null;
    }
    return parsed?.workspaceSkeleton ?? parsed;
  } catch {
    return null;
  }
}

function hasUnsafeControlCharacter(text) {
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if ((codePoint < 0x20 && codePoint !== 0x09 && codePoint !== 0x0A) || codePoint === 0x7F) {
      return true;
    }
  }
  return false;
}

export function captureDemand(args, { maxBytes = maxDemandBytes } = {}) {
  if (!Array.isArray(args) || args.length !== 1 || typeof args[0] !== 'string') {
    throw new Error('invalid_demand_arity');
  }
  const effectiveMaxBytes = Number.isInteger(maxBytes) && maxBytes > 0
    ? Math.min(maxBytes, maxIssueDemandBytes)
    : maxDemandBytes;
  const text = args[0].replace(/\r\n?/gu, '\n').normalize('NFC');
  if (text.trim().length === 0) {
    throw new Error('empty_demand');
  }
  if (hasUnsafeControlCharacter(text)) {
    throw new Error('unsafe_control_character');
  }
  if (Buffer.byteLength(text, 'utf8') > effectiveMaxBytes) {
    throw new Error('input_too_large');
  }
  return text;
}

function portableRelativePath(repositoryRoot, absolutePath) {
  const nativePath = relative(repositoryRoot, absolutePath);
  return sep === '\\' ? nativePath.replaceAll('\\', '/') : nativePath;
}

function computeSourceSnapshotDigest(files, ignoredEntries, sourceRoots = ['src']) {
  return canonicalDigest({
    sourceRoot: sourceRoots.length === 1 ? sourceRoots[0] : sourceRoots,
    files,
    ignoredEntries,
  });
}

function isReusableWorkspaceSkeleton(cachedSkeleton) {
  if (!cachedSkeleton || typeof cachedSkeleton !== 'object') return false;
  if (cachedSkeleton.schema !== 'aegis.workspace_skeleton.v1') return false;
  const { digest, ...unsigned } = cachedSkeleton;
  return canonicalDigest(unsigned) === digest;
}

/**
 * Varredura local segura e determinística sobre as raízes de código (padrão: src/,
 * configurável via AEGIS_SRC_DIRS ou autodetect app/lib), pulando arquivos gigantes
 * individuais (> 256 KB) sem abortar a descoberta do restante do projeto.
 */
export function observeWorkspace(repositoryRoot, {
  cachedWorkspaceSkeleton = null,
  cachedSnapshotDigest = null,
  sourceRoots = null,
  singleFileByteLimit = maxSingleFileBytes,
} = {}) {
  const effectiveRoots = resolveSourceRoots(repositoryRoot, sourceRoots);
  const sourceRecords = [];
  const sourceBytesByPath = new Map();
  const files = [];
  const ignoredEntries = [];
  let visitedEntries = 0;
  let scannedBytes = 0;

  function inspectDirectory(directory) {
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => compareCodeUnits(left.name, right.name));
    for (const entry of entries) {
      visitedEntries += 1;
      if (visitedEntries > discoveryEntryLimit) {
        ignoredEntries.push({ path: portableRelativePath(repositoryRoot, directory), reason: 'ENTRY_LIMIT_REACHED' });
        return;
      }
      const absolutePath = resolve(directory, entry.name);
      const relativePath = portableRelativePath(repositoryRoot, absolutePath);
      if (bidirectionalControlPattern.test(relativePath)) {
        throw new Error('unsafe_source_path');
      }
      if (entry.isSymbolicLink()) {
        ignoredEntries.push({ path: relativePath, reason: 'SYMLINK' });
        continue;
      }
      if (entry.isDirectory()) {
        if (ignoredDirectories.has(entry.name)) continue;
        inspectDirectory(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (files.length >= discoveryFileLimit) {
        ignoredEntries.push({ path: relativePath, reason: 'FILE_LIMIT_REACHED' });
        continue;
      }

      const metadata = statSync(absolutePath);
      if (metadata.size > singleFileByteLimit) {
        ignoredEntries.push({ path: relativePath, reason: 'TOO_LARGE' });
        continue;
      }
      if (scannedBytes + metadata.size > discoveryByteLimit) {
        ignoredEntries.push({ path: relativePath, reason: 'BYTE_BUDGET_EXCEEDED' });
        continue;
      }

      const sourceBytes = readFileSync(absolutePath);
      if (sourceBytes.byteLength > singleFileByteLimit) {
        ignoredEntries.push({ path: relativePath, reason: 'TOO_LARGE' });
        continue;
      }
      if (scannedBytes + sourceBytes.byteLength > discoveryByteLimit) {
        ignoredEntries.push({ path: relativePath, reason: 'BYTE_BUDGET_EXCEEDED' });
        continue;
      }
      scannedBytes += sourceBytes.byteLength;
      sourceBytesByPath.set(relativePath, sourceBytes);
      const file = {
        path: relativePath,
        bytes: sourceBytes.byteLength,
        digest: sha256(sourceBytes),
        kind: 'UTF8_TEXT',
      };
      if (sourceBytes.includes(0)) {
        file.kind = 'BINARY';
        files.push(file);
        continue;
      }
      let sourceText;
      try {
        sourceText = utf8Decoder.decode(sourceBytes);
      } catch {
        file.kind = 'INVALID_UTF8';
        files.push(file);
        continue;
      }
      files.push(file);
      sourceRecords.push({ path: relativePath, text: sourceText });
    }
  }

  const realRepoRoot = existsSync(repositoryRoot) ? realpathSync(repositoryRoot) : resolve(repositoryRoot);
  const realRepoPrefix = realRepoRoot.endsWith(sep) ? realRepoRoot : `${realRepoRoot}${sep}`;

  for (const relRoot of effectiveRoots) {
    const absRoot = resolve(repositoryRoot, relRoot);
    const repoPrefix = repositoryRoot.endsWith(sep) ? repositoryRoot : `${repositoryRoot}${sep}`;
    if (!absRoot.startsWith(repoPrefix)) {
      throw new Error(`invalid_source_root:${relRoot}`);
    }
    if (!existsSync(absRoot)) continue;
    const rootMetadata = lstatSync(absRoot);
    if (rootMetadata.isSymbolicLink()) {
      throw new Error('discovery_source_root_symlink');
    }
    if (!rootMetadata.isDirectory()) {
      throw new Error('invalid_source_root');
    }
    const realAbsRoot = realpathSync(absRoot);
    if (!realAbsRoot.startsWith(realRepoPrefix)) {
      throw new Error('discovery_source_root_symlink');
    }
    inspectDirectory(absRoot);
  }

  files.sort((left, right) => compareCodeUnits(left.path, right.path));
  ignoredEntries.sort((left, right) => compareCodeUnits(left.path, right.path));
  sourceRecords.sort((left, right) => compareCodeUnits(left.path, right.path));

  const sourceSnapshotDigest = computeSourceSnapshotDigest(files, ignoredEntries, effectiveRoots);
  const canReuseCache = isReusableWorkspaceSkeleton(cachedWorkspaceSkeleton)
    && (cachedSnapshotDigest === null || cachedSnapshotDigest === sourceSnapshotDigest);
  const workspaceSkeleton = canReuseCache
    ? cachedWorkspaceSkeleton
    : buildWorkspaceSkeleton(sourceRecords);
  const hasTextSource = files.some(({ kind }) => kind === 'UTF8_TEXT');

  const discovery = {
    sourceRoot: effectiveRoots.length === 1 ? effectiveRoots[0] : effectiveRoots.join(','),
    sourceRoots: effectiveRoots,
    status: hasTextSource
      ? 'SOURCE_OBSERVED'
      : (files.length > 0 || ignoredEntries.length > 0 ? 'NO_TEXT_SOURCE' : 'EMPTY_SOURCE'),
    files,
    ignoredEntries,
    visitedEntries,
    scannedBytes,
    sourceSnapshotDigest,
    workspaceSkeleton,
  };
  return { discovery, sourceBytesByPath, workspaceSkeleton };
}

export function discoverWorkspace(repositoryRoot, options = {}) {
  return observeWorkspace(repositoryRoot, options).discovery;
}

export function inspectWorkspaceFreshness(repositoryRoot, expectedSnapshotDigest, options = {}) {
  if (!expectedSnapshotDigest) {
    return { workspaceFreshness: 'NO_BASELINE' };
  }
  try {
    const currentSnapshotDigest = discoverWorkspace(repositoryRoot, options).sourceSnapshotDigest;
    return {
      workspaceFreshness: currentSnapshotDigest === expectedSnapshotDigest
        ? 'MATCHES_BASELINE'
        : 'CHANGED_SINCE_BASELINE',
      currentSnapshotDigest,
    };
  } catch (error) {
    return {
      workspaceFreshness: 'UNAVAILABLE',
      reason: error instanceof Error ? error.message : 'unknown_error',
    };
  }
}

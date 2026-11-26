import { Buffer } from 'node:buffer';
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { TextDecoder } from 'node:util';
import { canonicalDigest, compareCodeUnits, sha256 } from './canonical_json.mjs';
import { buildWorkspaceSkeleton } from './workspace_skeleton.mjs';

export const maxDemandBytes = 65_536;
export const maxIssueDemandBytes = 262_144;

const discoveryFileLimit = 1024;
const discoveryEntryLimit = 4096;
const discoveryByteLimit = 8_388_608;
const bidirectionalControlPattern = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;
const ignoredDirectories = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.turbo', '.next',
]);
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

export function computeSourceSnapshotDigest(files, ignoredEntries) {
  return canonicalDigest({
    sourceRoot: 'src',
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
 * Varredura local segura e determinística de src/ com proteção anti-symlink,
 * anti-Trojan-Source e cache de AST Skeleton.
 */
export function observeWorkspace(repositoryRoot, {
  cachedWorkspaceSkeleton = null,
  cachedSnapshotDigest = null,
} = {}) {
  const sourceRoot = resolve(repositoryRoot, 'src');
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
        throw new Error('discovery_entry_limit_exceeded');
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
        throw new Error('discovery_file_limit_exceeded');
      }

      const metadata = statSync(absolutePath);
      if (scannedBytes + metadata.size > discoveryByteLimit) {
        throw new Error('discovery_byte_limit_exceeded');
      }

      const sourceBytes = readFileSync(absolutePath);
      if (scannedBytes + sourceBytes.byteLength > discoveryByteLimit) {
        throw new Error('discovery_byte_limit_exceeded');
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

  if (existsSync(sourceRoot)) {
    const sourceRootMetadata = lstatSync(sourceRoot);
    if (sourceRootMetadata.isSymbolicLink()) {
      throw new Error('discovery_source_root_symlink');
    }
    if (!sourceRootMetadata.isDirectory()) {
      throw new Error('invalid_source_root');
    }
    inspectDirectory(sourceRoot);
  }
  files.sort((left, right) => compareCodeUnits(left.path, right.path));
  ignoredEntries.sort((left, right) => compareCodeUnits(left.path, right.path));
  sourceRecords.sort((left, right) => compareCodeUnits(left.path, right.path));

  const sourceSnapshotDigest = computeSourceSnapshotDigest(files, ignoredEntries);
  const canReuseCache = isReusableWorkspaceSkeleton(cachedWorkspaceSkeleton)
    && (cachedSnapshotDigest === null || cachedSnapshotDigest === sourceSnapshotDigest);
  const workspaceSkeleton = canReuseCache
    ? cachedWorkspaceSkeleton
    : buildWorkspaceSkeleton(sourceRecords);
  const hasTextSource = files.some(({ kind }) => kind === 'UTF8_TEXT');

  const discovery = {
    sourceRoot: 'src',
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

export function discoverWorkspace(repositoryRoot) {
  return observeWorkspace(repositoryRoot).discovery;
}

export function inspectWorkspaceFreshness(repositoryRoot, expectedSnapshotDigest) {
  if (!expectedSnapshotDigest) {
    return { workspaceFreshness: 'NO_BASELINE' };
  }
  try {
    const currentSnapshotDigest = discoverWorkspace(repositoryRoot).sourceSnapshotDigest;
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

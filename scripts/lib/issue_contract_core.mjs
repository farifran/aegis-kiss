import { Buffer } from 'node:buffer';
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { TextDecoder } from 'node:util';
import { canonicalDigest, sha256 } from './canonical_json.mjs';
import {
  buildHybridSourceIndex,
  isReusableHybridSourceIndex,
  searchHybridSourceIndex,
} from './hybrid_source_index.mjs';

const maxDemandBytes = 65_536;

function hasUnsafeControlCharacter(text) {
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if ((codePoint < 0x20 && codePoint !== 0x09 && codePoint !== 0x0A) || codePoint === 0x7F) {
      return true;
    }
  }
  return false;
}

/**
 * Captura exatamente um argumento textual, sem reconstruir tokens do shell.
 * Normaliza quebras de linha e equivalência Unicode, preservando a semântica.
 */
export function captureDemand(args) {
  if (!Array.isArray(args) || args.length !== 1 || typeof args[0] !== 'string') {
    throw new Error('invalid_demand_arity');
  }
  const text = args[0].replace(/\r\n?/gu, '\n').normalize('NFC');
  if (text.trim().length === 0) {
    throw new Error('empty_demand');
  }
  if (hasUnsafeControlCharacter(text)) {
    throw new Error('unsafe_control_character');
  }
  if (Buffer.byteLength(text, 'utf8') > maxDemandBytes) {
    throw new Error('input_too_large');
  }
  return text;
}

const discoveryFileLimit = 256;
const discoveryEntryLimit = 512;
const discoveryByteLimit = 1_048_576;
const bidirectionalControlPattern = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
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

/**
 * Descobre apenas fatos estruturais já presentes em src/.
 * A evidência nasce em RAM; somente o índice derivado pode ser reutilizado como
 * cache transitório e nunca substitui a leitura/hash do snapshot atual.
 */
export function observeWorkspace(repositoryRoot, intent = '', { cachedSourceIndex = null } = {}) {
  const sourceRoot = resolve(repositoryRoot, 'src');
  const sourceRecords = [];
  const sourceBytesByPath = new Map();
  const files = [];
  const ignoredEntries = [];
  let visitedEntries = 0;
  let scannedBytes = 0;

  function inspectDirectory(directory) {
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => compareText(left.name, right.name));
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
  files.sort((left, right) => compareText(left.path, right.path));
  ignoredEntries.sort((left, right) => compareText(left.path, right.path));
  sourceRecords.sort((left, right) => compareText(left.path, right.path));
  const sourceSnapshotDigest = computeSourceSnapshotDigest(files, ignoredEntries);
  const sourceIndex = isReusableHybridSourceIndex(cachedSourceIndex, sourceSnapshotDigest)
    ? cachedSourceIndex
    : buildHybridSourceIndex(sourceRecords, sourceSnapshotDigest);
  const lexicalEvidence = searchHybridSourceIndex(sourceIndex, intent);
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
    lexicalEvidence,
  };
  return { discovery, sourceBytesByPath, sourceIndex };
}

export function discoverWorkspace(repositoryRoot, intent = '') {
  return observeWorkspace(repositoryRoot, intent).discovery;
}

/**
 * Compila somente os fatos mecânicos das Fases 1 a 3.
 * Deliberação, requisitos, riscos e provas pertencem às fases seguintes.
 */
export function buildPreflightHandoff({ demand, discovery }) {
  const handoff = {
    schema: 'aegis.preflight_handoff.v2',
    phase: 'DISCOVERED',
    status: 'SEMANTIC_DELIBERATION_REQUIRED',
    intent: demand,
    capture: {
      provenance: 'USER',
      transport: 'ARGV_STRING',
      unicodeNormalization: 'NFC',
      lineEndings: 'LF',
      byteLength: Buffer.byteLength(demand, 'utf8'),
    },
    discovery,
  };
  return {
    ...handoff,
    preflightDigest: computePreflightDigest(handoff),
  };
}

export function computePreflightDigest(preflight) {
  const { preflightDigest, ...digestInput } = preflight;
  void preflightDigest;
  return canonicalDigest(digestInput);
}

/**
 * Carrega a política arquitetural oficial e comprova sua origem humana.
 */
export function loadArchitecturePolicy(repositoryRoot) {
  const policyPath = resolve(repositoryRoot, 'governance/architecture.policy.json');
  if (!existsSync(policyPath)) {
    throw new Error('architecture_policy_unavailable');
  }
  const policyText = readFileSync(policyPath, 'utf8');
  const policy = JSON.parse(policyText);
  const sourcePath = resolve(repositoryRoot, policy.origin?.sourcePath ?? '');
  const repositoryPrefix = repositoryRoot.endsWith(sep) ? repositoryRoot : `${repositoryRoot}${sep}`;
  if (!sourcePath.startsWith(repositoryPrefix) || !existsSync(sourcePath)) {
    throw new Error('architecture_policy_origin_unavailable');
  }
  if (sha256(readFileSync(sourcePath)) !== policy.origin.sourceDigest) {
    throw new Error('architecture_policy_origin_mismatch');
  }
  return { policy, policyDigest: canonicalDigest(policy) };
}

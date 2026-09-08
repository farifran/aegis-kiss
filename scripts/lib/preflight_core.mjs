import { Buffer } from 'node:buffer';
import { execFileSync, spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { TextDecoder } from 'node:util';
import { canonicalDigest, sha256 } from './canonical_json.mjs';
import { assertSchema } from './schema_validator.mjs';
import { parseSemanticState } from './semantic_state.mjs';

export const maxDemandBytes = 65_536;
const governedMaxBytes = 256 * 1024;
const gitMaxBytes = 512 * 1024;
const gitTimeoutMs = 3_000;
const discoveryGitMaxBytes = 4 * 1024 * 1024;
const discoveryMaxCandidates = 12;
const discoveryMaxTrackedPaths = 10_000;
const discoveryMaxSymbolAnchors = 8;
const discoveryMaxLexicalTerms = 64;
const discoveryBudgetMs = 3_000;
const discoveryScanner = Object.freeze({
  id: 'aegis.layer0',
  version: 2,
  algorithmDigest: canonicalDigest({
    input: 'git_tree_and_fixed_string_grep',
    contentReads: false,
    automaticRoots: { PRODUCT: ['src'], HARNESS: ['*'] },
    candidateReasons: ['explicit_target', 'explicit_path', 'previous_contract_scope', 'path_term_match', 'symbol_match'],
    ranking: 'highest_reason_score_then_code_unit_path',
  }),
});
const semanticProtocolVersion = 'aegis.semantic_protocol.v4';
const knownFileExtension = /\.(?:c|cc|cpp|css|go|h|hpp|html|java|js|json|jsx|md|mjs|py|rb|rs|sh|sql|toml|ts|tsx|txt|xml|yaml|yml)$/iu;

function digest(value) {
  return sha256(value);
}

function gitEnvironment() {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM'].includes(key) || key.startsWith('GIT_CONFIG_')) {
      delete environment[key];
    }
  }
  return environment;
}

function git(root, args, code, encoding = 'buffer') {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: gitEnvironment(),
      timeout: gitTimeoutMs,
      maxBuffer: gitMaxBytes,
    });
  } catch {
    throw new Error(code);
  }
}

function canonicalRoot(root) {
  let canonical;
  try {
    canonical = realpathSync(root);
  } catch {
    throw new Error('preflight_root_unavailable');
  }
  const reported = git(canonical, ['rev-parse', '--show-toplevel'], 'preflight_requires_git_repository', 'utf8').trim();
  let gitRoot;
  try {
    gitRoot = realpathSync(reported);
  } catch {
    throw new Error('preflight_requires_git_repository');
  }
  if (gitRoot !== canonical) throw new Error('preflight_root_mismatch');
  return canonical;
}

function currentCommit(root) {
  return git(root, ['rev-parse', 'HEAD'], 'preflight_requires_git_repository', 'utf8').trim();
}

function canonicalRepositoryPath(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.startsWith('/')
    || value.includes('\\')
    || value.split('/').some((part) => part.length === 0 || part === '.' || part === '..')
  ) {
    throw new Error('non_canonical_repository_path');
  }
  return value;
}

function readCommitBlob(root, commit, path, code) {
  const repositoryPath = canonicalRepositoryPath(path);
  const bytes = git(root, ['show', `${commit}:${repositoryPath}`], code);
  if (bytes.length > governedMaxBytes) throw new Error('governed_artifact_budget_exceeded');
  return bytes;
}

function readOptionalCommitBlob(root, commit, path) {
  try {
    return readCommitBlob(root, commit, path, 'governed_artifact_missing');
  } catch (error) {
    if (error instanceof Error && error.message === 'governed_artifact_missing') return null;
    throw error;
  }
}

function supervisorBinding(supervisor) {
  if (
    supervisor === null || typeof supervisor !== 'object'
    || !['IDE', 'EXTERNAL'].includes(supervisor.mode)
    || typeof supervisor.id !== 'string' || supervisor.id.length === 0
    || !/^[a-f0-9]{64}$/u.test(supervisor.configDigest)
  ) {
    throw new Error('invalid_supervisor_binding');
  }
  return { mode: supervisor.mode, id: supervisor.id, configDigest: supervisor.configDigest };
}

function executionId(baseCommit, normalizedDemandDigest, changeKind, supervisor) {
  return sha256(`base=${baseCommit ?? 'UNVERSIONED'}\ndemand=${normalizedDemandDigest}\nkind=${changeKind}\nsupervisor=${supervisor.configDigest}\n`);
}

export function repositorySnapshot(root) {
  const canonical = canonicalRoot(root);
  const commit = currentCommit(canonical);
  const trackedRuntime = git(canonical, ['ls-files', '-z', '--', '.harness/runtime'], 'worktree_status_unavailable');
  if (trackedRuntime.length > 0) throw new Error('tracked_runtime_path_forbidden');
  const status = git(canonical, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], 'worktree_status_unavailable');
  if (currentCommit(canonical) !== commit) throw new Error('repository_snapshot_changed');
  return {
    commit,
    worktreeDigest: sha256(status),
    clean: status.length === 0,
  };
}

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

function byteOffset(text, utf16Offset) {
  return byteLength(text.slice(0, utf16Offset));
}

function classifyLine(line, inCode) {
  if (inCode || line.startsWith('\x60\x60\x60')) return 'code';
  if (/^#{1,6}\s+/u.test(line)) return 'heading';
  if (/^(?:[-+*]|\d+[.)])\s+/u.test(line)) return 'list';
  if (/^>\s?/u.test(line)) return 'quote';
  return 'paragraph';
}

function sentenceRanges(line, inCode) {
  if (inCode || line.startsWith('\x60\x60\x60') || /^(?:#{1,6}\s+|[-+*]|\d+[.)])\s+/u.test(line)) {
    return [[0, line.length]];
  }
  const ranges = [];
  let start = 0;
  let inInlineCode = false;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '\x60') inInlineCode = !inInlineCode;
    if (inInlineCode || !'.!?'.includes(line[index])) continue;
    if (index + 1 < line.length && !/\s/u.test(line[index + 1])) continue;
    ranges.push([start, index + 1]);
    start = index + 1;
  }
  if (start < line.length) ranges.push([start, line.length]);
  return ranges;
}

function extractUnits(text) {
  const units = [];
  let utf16Start = 0;
  let inCode = false;
  for (const match of text.matchAll(/.*(?:\n|$)/gu)) {
    const rawLine = match[0];
    if (rawLine.length === 0) continue;
    const line = rawLine.endsWith('\n') ? rawLine.slice(0, -1) : rawLine;
    const startsFence = line.startsWith('\x60\x60\x60');
    for (const [start, end] of sentenceRanges(line, inCode)) {
      const fragment = line.slice(start, end);
      if (fragment.trim().length === 0) continue;
      const unitStart = utf16Start + start;
      const unitEnd = utf16Start + end;
      units.push({
        id: 'UNIT-' + String(units.length + 1).padStart(4, '0'),
        kind: classifyLine(fragment.trimStart(), inCode),
        text: fragment,
        range: {
          startByte: byteOffset(text, unitStart),
          endByte: byteOffset(text, unitEnd),
        },
      });
    }
    if (startsFence) inCode = !inCode;
    utf16Start += rawLine.length;
  }
  return units;
}

function unitForOffset(units, offset) {
  return units.find((unit) => offset >= unit.range.startByte && offset < unit.range.endByte)?.id;
}

function isPathLike(value) {
  return value.includes('/') || knownFileExtension.test(value);
}

function addReference(references, units, kind, value, startIndex, endIndex, text) {
  const startByte = byteOffset(text, startIndex);
  const endByte = byteOffset(text, endIndex);
  const unitId = unitForOffset(units, startByte);
  if (unitId === undefined) return;
  const candidate = { kind, value, unitId, range: { startByte, endByte } };
  if (references.some((item) => item.kind === kind && item.value === value && item.range.startByte === startByte)) return;
  references.push(candidate);
}

function extractReferences(text, units) {
  const references = [];
  const urlRanges = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>()]+/gu)) {
    const start = match.index;
    const end = start + match[0].length;
    urlRanges.push({ start, end });
    addReference(references, units, 'url', match[0], start, end, text);
  }
  for (const match of text.matchAll(/`([^`\n]+)`/gu)) {
    const value = match[1];
    const start = match.index + 1;
    if (isPathLike(value)) addReference(references, units, 'path', value, start, start + value.length, text);
    else if (/^[A-Za-z_$][A-Za-z0-9_$]*(?:[.:][A-Za-z_$][A-Za-z0-9_$]*)*$/u.test(value)) {
      addReference(references, units, 'symbol', value, start, start + value.length, text);
    }
  }
  for (const match of text.matchAll(/\b(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\b/gu)) {
    const start = match.index;
    const end = start + match[0].length;
    if (!urlRanges.some((range) => start >= range.start && end <= range.end)) {
      addReference(references, units, 'path', match[0], start, end, text);
    }
  }
  for (const match of text.matchAll(/\b[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+\b/gu)) {
    const start = match.index;
    const end = start + match[0].length;
    const startByte = byteOffset(text, start);
    const endByte = byteOffset(text, end);
    const overlapsKnownReference = references.some((reference) => (
      reference.kind === 'path' && startByte >= reference.range.startByte && endByte <= reference.range.endByte
    ));
    if (!urlRanges.some((range) => start >= range.start && end <= range.end) && !overlapsKnownReference) {
      addReference(references, units, 'symbol', match[0], start, end, text);
    }
  }
  return references.sort((left, right) => left.range.startByte - right.range.startByte || left.kind.localeCompare(right.kind));
}

export function normalizeDemand(rawBytes, maxBytes = maxDemandBytes) {
  if (!Buffer.isBuffer(rawBytes) || rawBytes.length > maxBytes) throw new Error('input_too_large');
  let decoded;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(rawBytes);
  } catch {
    throw new Error('invalid_utf8');
  }
  const text = decoded.replace(/\r\n?/gu, '\n');
  if (text.trim().length === 0) throw new Error('empty_demand');
  const units = extractUnits(text);
  if (units.length === 0) throw new Error('empty_demand');
  const normalized = {
    schema: 'aegis.normalized_demand.v2',
    digest: digest(text),
    text,
    units,
    references: extractReferences(text, units),
  };
  return normalized;
}

function pathFact(tree, kind, value, source = {}) {
  let canonical;
  try {
    canonical = canonicalRepositoryPath(value);
  } catch {
    return { kind, value, status: 'DISPROVEN', evidence: 'unsafe_relative_path', ...source };
  }
  const entry = tree.entries.get(canonical);
  if (entry === undefined && !tree.complete) return { kind, value, status: 'UNPROVEN', evidence: 'baseline_tree_incomplete', ...source };
  if (entry === undefined) return { kind, value, status: 'DISPROVEN', evidence: 'path_not_found_in_baseline', ...source };
  if (entry.kind === 'symlink') return { kind, value, status: 'DISPROVEN', evidence: 'symlink_not_allowed', ...source };
  if (entry.kind === 'directory') return { kind, value, status: 'PROVEN', evidence: 'directory_exists_in_baseline', ...source };
  if (entry.kind === 'file') return { kind, value, status: 'PROVEN', evidence: 'file_exists_in_baseline', ...source };
  return { kind, value, status: 'DISPROVEN', evidence: 'special_path_not_allowed', ...source };
}

function referenceFact(tree, reference) {
  const source = { unitId: reference.unitId, range: reference.range };
  if (reference.kind === 'path') return pathFact(tree, 'path', reference.value, source);
  if (reference.kind === 'url') return { kind: 'url', value: reference.value, status: 'UNPROVEN', evidence: 'external_reference_not_verified', ...source };
  return { kind: 'symbol', value: reference.value, status: 'UNPROVEN', evidence: 'semantic_resolution_requires_ide', ...source };
}

function createDiscoveryDeadline() {
  return process.hrtime.bigint() + BigInt(discoveryBudgetMs) * 1_000_000n;
}

function remainingDiscoveryMs(deadline) {
  const remaining = deadline - process.hrtime.bigint();
  return Number(remaining > 0n ? remaining / 1_000_000n : 0n);
}

function discoveryGit(root, args, deadline, stopWhenRecord = undefined) {
  const timeout = remainingDiscoveryMs(deadline);
  if (timeout < 1) return Promise.resolve({ status: 'INCOMPLETE', bytes: Buffer.alloc(0), reason: 'budget_exhausted' });
  return new Promise((resolveResult) => {
    const chunks = [];
    let byteCount = 0;
    let remainder = Buffer.alloc(0);
    let terminalReason;
    let completed = false;
    let timer;
    const child = spawn('git', ['-C', root, ...args], {
      stdio: ['ignore', 'pipe', 'ignore'],
      env: gitEnvironment(),
    });
    const finish = (result) => {
      if (completed) return;
      completed = true;
      if (timer !== undefined) clearTimeout(timer);
      resolveResult(result);
    };
    const stop = (reason) => {
      if (terminalReason !== undefined) return;
      terminalReason = reason;
      child.kill('SIGTERM');
    };
    timer = setTimeout(() => stop('budget_exhausted'), timeout);
    child.stdout.on('data', (chunk) => {
      if (terminalReason !== undefined) return;
      const remaining = discoveryGitMaxBytes - byteCount;
      if (chunk.length > remaining) {
        if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
        byteCount = discoveryGitMaxBytes;
        stop('git_output_limit');
        return;
      }
      chunks.push(chunk);
      byteCount += chunk.length;
      if (stopWhenRecord === undefined) return;
      const joined = remainder.length === 0 ? chunk : Buffer.concat([remainder, chunk]);
      let start = 0;
      for (let index = 0; index < joined.length; index += 1) {
        if (joined[index] !== 0) continue;
        if (stopWhenRecord(joined.subarray(start, index))) {
          stop('tracked_paths_limit');
          return;
        }
        start = index + 1;
      }
      remainder = joined.subarray(start);
    });
    child.once('error', () => finish({ status: 'INCOMPLETE', bytes: Buffer.alloc(0), reason: 'git_failure' }));
    child.once('close', (code) => {
      if (terminalReason !== undefined) {
        finish({ status: 'INCOMPLETE', bytes: Buffer.concat(chunks), reason: terminalReason });
      } else if (code === 0 || (code === 1 && args[0] === 'grep')) {
        finish({ status: 'PROVEN', bytes: Buffer.concat(chunks), reason: undefined });
      } else {
        finish({ status: 'INCOMPLETE', bytes: Buffer.alloc(0), reason: 'git_failure' });
      }
    });
  });
}

function treeEntry(raw) {
  const tab = raw.indexOf(0x09);
  if (tab < 0) return undefined;
  const [mode, type] = raw.subarray(0, tab).toString('utf8').split(' ');
  const path = raw.subarray(tab + 1).toString('utf8');
  try {
    canonicalRepositoryPath(path);
  } catch {
    return undefined;
  }
  const kind = mode === '120000'
    ? 'symlink'
    : type === 'tree'
      ? 'directory'
      : type === 'blob'
        ? 'file'
        : 'special';
  return { path, kind };
}

function treeEntries(bytes) {
  const entries = new Map();
  let start = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 0) continue;
    const entry = treeEntry(bytes.subarray(start, index));
    if (entry !== undefined) entries.set(entry.path, { kind: entry.kind });
    start = index + 1;
  }
  return entries;
}

function discoveryTerms(text) {
  const terms = new Set();
  const comparable = text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  for (const match of comparable.matchAll(/[\p{L}\p{N}_$-]{4,}/gu)) {
    terms.add(match[0]);
    if (terms.size >= discoveryMaxLexicalTerms) break;
  }
  return terms;
}

function discoverySymbols(normalizedDemand, allowInferred) {
  const explicit = new Set();
  for (const reference of normalizedDemand.references.filter((item) => item.kind === 'symbol')) {
    explicit.add(reference.value);
    for (const part of reference.value.split(/[.:]/u)) {
      if (part.length >= 4) explicit.add(part);
    }
  }
  const symbols = new Set([...explicit].sort().slice(0, discoveryMaxSymbolAnchors));
  if (!allowInferred || symbols.size >= discoveryMaxSymbolAnchors) return [...symbols];
  const identifierPattern = /\b(?:[A-Z][A-Za-z0-9_$]*[A-Z][A-Za-z0-9_$]*|[a-z][A-Za-z0-9_$]*[A-Z][A-Za-z0-9_$]*|[A-Za-z_$][A-Za-z0-9_$]*_[A-Za-z0-9_$]+)\b/gu;
  for (const match of normalizedDemand.text.matchAll(identifierPattern)) {
    if (!match[0].includes('\n') && Buffer.byteLength(match[0], 'utf8') <= 128) symbols.add(match[0]);
    if (symbols.size >= discoveryMaxSymbolAnchors) break;
  }
  return [...symbols].sort().slice(0, discoveryMaxSymbolAnchors);
}

function pathTerms(path) {
  const comparable = path.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  return new Set(
    comparable.split(/[^\p{L}\p{N}]+/gu).filter((part) => part.length >= 4),
  );
}

function isAutomaticDiscoveryPath(changeKind, path) {
  return changeKind === 'HARNESS' || path === 'src' || path.startsWith('src/');
}

async function discoverRepository(root, commit, normalizedDemand, targetHint, previousContract, changeKind) {
  const deadline = createDiscoveryDeadline();
  let eligibleEntryCount = 0;
  const listing = await discoveryGit(
    root,
    ['ls-tree', '-r', '-t', '-z', commit],
    deadline,
    (raw) => {
      const entry = treeEntry(raw);
      if (entry?.kind !== 'file' || !isAutomaticDiscoveryPath(changeKind, entry.path)) return false;
      eligibleEntryCount += 1;
      return eligibleEntryCount > discoveryMaxTrackedPaths;
    },
  );
  const entries = treeEntries(listing.bytes);
  const tree = { entries, complete: listing.status === 'PROVEN' };
  const allTrackedPaths = [...entries]
    .filter(([, entry]) => entry.kind === 'file')
    .map(([path]) => path);
  const eligiblePaths = allTrackedPaths.filter((path) => isAutomaticDiscoveryPath(changeKind, path));
  const trackedPaths = eligiblePaths.slice(0, discoveryMaxTrackedPaths);
  const tracked = new Set(trackedPaths);
  const candidates = new Map();
  const existenceFor = (path) => entries.has(path) ? true : tree.complete ? false : null;
  const addCandidate = (path, reason, score, exists = existenceFor(path), anchors = []) => {
    let canonical;
    try {
      canonical = canonicalRepositoryPath(path);
    } catch {
      return;
    }
    const current = candidates.get(canonical) ?? { path: canonical, exists, score: 0, reasons: new Set(), anchors: new Set() };
    current.exists = current.exists === true || exists === true
      ? true
      : current.exists === false || exists === false
        ? false
        : null;
    current.score = Math.max(current.score, score);
    current.reasons.add(reason);
    for (const anchor of anchors) current.anchors.add(anchor);
    candidates.set(canonical, current);
  };

  if (targetHint.length > 0) addCandidate(targetHint, 'explicit_target', 100, existenceFor(targetHint));
  for (const reference of normalizedDemand.references) {
    if (reference.kind === 'path') addCandidate(reference.value, 'explicit_path', 100, existenceFor(reference.value), [reference.unitId]);
  }
  for (const path of previousContract?.scope.authorizedPaths ?? []) {
    if (path !== 'src/.aegis/semantic-state.json' && isAutomaticDiscoveryPath(changeKind, path)) {
      addCandidate(path, 'previous_contract_scope', 80, existenceFor(path));
    }
  }

  const strongTrackedCandidateCount = [...candidates.values()]
    .filter((candidate) => candidate.score >= 80 && tracked.has(candidate.path))
    .length;
  if (strongTrackedCandidateCount === 0) {
    const terms = discoveryTerms(normalizedDemand.text);
    for (const path of trackedPaths) {
      const overlap = [...pathTerms(path)].filter((term) => terms.has(term));
      if (overlap.length > 0) addCandidate(path, 'path_term_match', 20 + Math.min(overlap.length, 5), true, overlap);
    }
  }

  const explicitSymbolCount = normalizedDemand.references.filter((item) => item.kind === 'symbol').length;
  const symbols = discoverySymbols(normalizedDemand, strongTrackedCandidateCount === 0);
  let symbolSearch = { status: 'NOT_APPLICABLE', reason: undefined };
  if (symbols.length > 0 && (explicitSymbolCount > 0 || strongTrackedCandidateCount === 0)) {
    const grepArguments = ['grep', '-l', '-z', '-I', '-F'];
    for (const symbol of symbols) grepArguments.push('-e', symbol);
    grepArguments.push(commit, '--');
    if (changeKind === 'PRODUCT') grepArguments.push('src');
    const matches = await discoveryGit(root, grepArguments, deadline);
    symbolSearch = matches;
    if (matches.status === 'PROVEN') {
      const prefix = `${commit}:`;
      for (const rawPath of matches.bytes.toString('utf8').split('\0').filter(Boolean)) {
        const path = rawPath.startsWith(prefix) ? rawPath.slice(prefix.length) : rawPath;
        addCandidate(path, 'symbol_match', 60, existenceFor(path), symbols);
      }
    }
  }

  const incompleteReasons = [...new Set([
    ...(listing.status === 'INCOMPLETE' ? [listing.reason] : []),
    ...(listing.reason === 'tracked_paths_limit' ? ['tracked_paths_limit'] : []),
    ...(symbolSearch.status === 'INCOMPLETE' ? [symbolSearch.reason] : []),
    ...(remainingDiscoveryMs(deadline) < 1 ? ['budget_exhausted'] : []),
  ].filter(Boolean))].sort();
  const incomplete = incompleteReasons.length > 0;
  const selected = [...candidates.values()]
    .sort((left, right) => right.score - left.score || (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
    .slice(0, discoveryMaxCandidates)
    .map(({ path, exists, reasons, anchors }) => ({ path, exists, reasons: [...reasons].sort(), anchors: [...anchors].sort() }));
  const body = {
    schema: 'aegis.discovery.v2',
    scanner: discoveryScanner,
    status: incomplete ? 'INCOMPLETE' : selected.length > 0 ? 'CANDIDATES' : trackedPaths.length === 0 ? 'NOT_APPLICABLE' : 'UNKNOWN',
    demandDigest: normalizedDemand.digest,
    baseCommit: commit,
    candidates: selected,
    incompleteReasons,
    coverage: {
      trackedPaths: allTrackedPaths.length,
      eligiblePaths: eligiblePaths.length,
      consideredPaths: trackedPaths.length,
      symbolAnchors: symbols.length,
      returnedCandidates: selected.length,
    },
    limits: {
      maxCandidates: discoveryMaxCandidates,
      maxTrackedPaths: discoveryMaxTrackedPaths,
      maxSymbolAnchors: discoveryMaxSymbolAnchors,
      maxLexicalTerms: discoveryMaxLexicalTerms,
      maxGitBytes: discoveryGitMaxBytes,
      budgetMs: discoveryBudgetMs,
    },
  };
  return { discovery: { ...body, digest: canonicalDigest(body) }, tree };
}

export function loadArchitecturePolicy(root, commit = undefined) {
  const canonical = canonicalRoot(root);
  const baseCommit = commit ?? currentCommit(canonical);
  let policy;
  let policyBytes;
  try {
    policyBytes = readCommitBlob(canonical, baseCommit, 'governance/architecture.policy.json', 'architecture_policy_unavailable');
    policy = JSON.parse(policyBytes.toString('utf8'));
    assertSchema('aegis.architecture_policy.v1', policy);
  } catch {
    throw new Error('invalid_architecture_policy');
  }
  if (new Set(policy.rules.map((rule) => rule.id)).size !== policy.rules.length) throw new Error('invalid_architecture_policy');
  let sourceBytes;
  try {
    sourceBytes = readCommitBlob(canonical, baseCommit, policy.origin.sourcePath, 'architecture_source_unavailable');
  } catch {
    throw new Error('architecture_source_unavailable');
  }
  if (digest(sourceBytes) !== policy.origin.sourceDigest) throw new Error('stale_architecture_policy');
  return {
    policy,
    policyText: policyBytes.toString('utf8'),
    policyDigest: digest(policyBytes),
  };
}

export function loadArchitecture(root, commit = undefined) {
  const { policy, policyDigest } = loadArchitecturePolicy(root, commit);
  return {
    schema: 'aegis.preflight_architecture.v2',
    policyDigest,
    sourceStatus: 'CURRENT',
    candidateRules: policy.rules.map(({ id, level, statement, appliesWhen, appliesMode, forbiddenReferences = [] }) => ({
      id, level, statement, appliesWhen, appliesMode, forbiddenReferences,
    })),
  };
}

export function loadPreviousEvidence(root, commit = undefined) {
  const canonical = canonicalRoot(root);
  const baseCommit = commit ?? currentCommit(canonical);
  const semanticStateBytes = readOptionalCommitBlob(canonical, baseCommit, 'src/.aegis/semantic-state.json');
  if (semanticStateBytes !== null) {
    try {
      const state = parseSemanticState(JSON.parse(semanticStateBytes.toString('utf8')));
      return { source: 'semantic-state', contract: state.contract, proofRegistry: state.proofRegistry };
    } catch {
      throw new Error('invalid_previous_contract');
    }
  }
  for (const path of [
    'src/.aegis/contract-ir.json',
    'src/.aegis/clarified-demand.json',
    'src/.aegis/proof-registry.json',
  ]) {
    if (readOptionalCommitBlob(canonical, baseCommit, path) !== null) {
      throw new Error('legacy_previous_semantic_metadata');
    }
  }
  return null;
}

function inject(template, placeholder, value) {
  const token = '{{' + placeholder + '}}';
  if (template.split(token).length !== 2) throw new Error('invalid_prompt_placeholder:' + placeholder);
  return template.replace(token, JSON.stringify(value));
}

export async function buildPreflight(rawBytes, requestedTarget, root, changeKind = 'PRODUCT', configuredSupervisor = { mode: 'IDE', id: 'ide-active-model', configDigest: canonicalDigest({ schema: 'aegis.supervisor_config.v1', mode: 'IDE' }) }) {
  if (!['PRODUCT', 'HARNESS'].includes(changeKind)) throw new Error('invalid_change_kind');
  const supervisor = supervisorBinding(configuredSupervisor);
  const canonical = canonicalRoot(root);
  const baseline = repositorySnapshot(canonical);
  if (!baseline.clean) throw new Error('preflight_requires_clean_worktree');
  const normalizedDemand = normalizeDemand(rawBytes);
  const targetHint = requestedTarget.length === 0 ? '' : requestedTarget;
  const architecture = loadArchitecture(canonical, baseline.commit);
  const previousEvidence = loadPreviousEvidence(canonical, baseline.commit);
  const previousContract = previousEvidence?.contract ?? null;
  const previousProofRegistry = previousEvidence?.proofRegistry ?? null;
  const discoveryResult = await discoverRepository(canonical, baseline.commit, normalizedDemand, targetHint, previousContract, changeKind);
  const target = targetHint.length === 0
    ? { kind: 'target', value: '', status: 'NOT_APPLICABLE', evidence: 'no_target_hint' }
    : pathFact(discoveryResult.tree, 'target', targetHint);
  const factBody = {
    schema: 'aegis.preflight_facts.v2',
    target,
    references: normalizedDemand.references.map((reference) => referenceFact(discoveryResult.tree, reference)),
    discovery: discoveryResult.discovery,
  };
  const mechanicalFacts = { ...factBody, digest: canonicalDigest(factBody) };
  const previousContractDigest = previousContract === null ? null : canonicalDigest(previousContract);
  const constitutionText = readCommitBlob(canonical, baseline.commit, 'AGENTS.md', 'constitution_unavailable').toString('utf8');
  const constitutionDigest = digest(constitutionText);
  const promptTemplate = readCommitBlob(canonical, baseline.commit, 'governance/prompts/preflight.v2.md', 'preflight_prompt_unavailable').toString('utf8');
  const promptTemplateDigest = digest(promptTemplate);
  const semanticProtocolDigest = canonicalDigest({
    version: semanticProtocolVersion,
    decisionSchema: 'aegis.preflight_decision.v2',
    normalizedDemandSchema: 'aegis.normalized_demand.v2',
  });
  const contextDigest = canonicalDigest({
    changeKind,
    supervisor,
    baseline,
    normalizedDemandDigest: normalizedDemand.digest,
    mechanicalFactsDigest: mechanicalFacts.digest,
    architecturePolicyDigest: architecture.policyDigest,
    previousContractDigest,
    constitutionDigest,
    promptTemplateDigest,
    semanticProtocolDigest,
  });
  let prompt = promptTemplate;
  prompt = inject(prompt, 'constitution', { source: 'AGENTS.md', digest: constitutionDigest, rules: constitutionText });
  prompt = inject(prompt, 'context_digest', contextDigest);
  prompt = inject(prompt, 'change_kind', changeKind);
  prompt = inject(prompt, 'normalized_demand', {
    text: normalizedDemand.text,
    units: normalizedDemand.units.map(({ id, kind, range }) => ({ id, kind, range })),
  });
  const representedPaths = new Set([
    ...(mechanicalFacts.target.value.length > 0 ? [mechanicalFacts.target.value] : []),
    ...mechanicalFacts.references.filter(({ kind }) => kind === 'path').map(({ value }) => value),
    ...(previousContract?.scope.authorizedPaths ?? []),
  ]);
  prompt = inject(prompt, 'mechanical_facts', {
    target: mechanicalFacts.target,
    references: mechanicalFacts.references,
    discovery: [
      mechanicalFacts.discovery.status,
      mechanicalFacts.discovery.candidates
        .filter(({ path }) => !representedPaths.has(path))
        .map(({ path, exists, reasons }) => [path, exists, reasons]),
    ],
  });
  prompt = inject(prompt, 'architecture_rules', { candidateRules: architecture.candidateRules });
  const previousContractProjection = previousContract === null ? null : {
    changeKind: previousContract.changeKind,
    architecture: { amendmentIds: previousContract.architecture.amendmentIds },
    ...(previousContract.verification === undefined ? {} : { verification: previousContract.verification }),
    ...(previousContract.stateModel === undefined ? {} : { stateModel: previousContract.stateModel }),
    scope: previousContract.scope,
    proofObligations: previousContract.proofObligations,
    continuity: previousContract.continuity,
    activeProofs: previousProofRegistry?.proofs
      .filter((proof) => proof.status === 'active')
      .map(({ id, coverageKey, targets, cadence }) => ({ id, coverageKey, targets, cadence })) ?? [],
  };
  prompt = inject(prompt, 'previous_contract', previousContractProjection);
  const envelope = {
    schema: 'aegis.ide_preflight.v2',
    status: 'PENDING_SEMANTIC_COMPILATION',
    changeKind,
    executionId: executionId(baseline.commit, normalizedDemand.digest, changeKind, supervisor),
    baseCommit: baseline.commit,
    baseline,
    normalizedDemand,
    mechanicalFacts,
    architecture,
    previousContract,
    previousContractDigest,
    constitutionDigest,
    promptTemplateDigest,
    semanticProtocolDigest,
    supervisor,
    contextDigest,
    promptDigest: digest(prompt),
    prompt,
  };
  if (canonicalDigest(repositorySnapshot(canonical)) !== canonicalDigest(baseline)) {
    throw new Error('repository_snapshot_changed');
  }
  return envelope;
}

export function semanticRequest(envelope, timing) {
  return {
    schema: 'aegis.ide_semantic_request.v2',
    status: envelope.status,
    changeKind: envelope.changeKind,
    executionId: envelope.executionId,
    baseCommit: envelope.baseCommit,
    contextDigest: envelope.contextDigest,
    promptDigest: envelope.promptDigest,
    promptTemplateDigest: envelope.promptTemplateDigest,
    constitutionDigest: envelope.constitutionDigest,
    semanticProtocolDigest: envelope.semanticProtocolDigest,
    supervisor: envelope.supervisor,
    timing,
    protocol: {
      decisionPath: '.harness/runtime/preflight_decision.json',
      continue: './aegis resume',
      userInteraction: 'Depois de gravar a decisão, execute ./aegis resume. USER_CONFIRMATION_REQUIRED é uma parada obrigatória: o adaptador nativo do IDE renderiza o payload estruturado; não escolha a recomendação, não implemente e não gere resolução antes da resposta explícita do usuário. Use AEGIS_WIZARD_MODE=terminal somente como fallback explícito.',
      forensicReview: 'forensic: após confirmação, o IDE revisa internamente em execução isolada antes de finalizar; o usuário não participa.',
      revision: 'quando finalize retornar SEMANTIC_REVISION_REQUIRED, corrija somente a decisão usando as correções e repita finalize sem redescobrir o repositório',
      promotion: ['implement authorized scope', 'stage persistent changes', './aegis authorize', 'git commit'],
      forbidden: ['repository reads during semantic compilation', 'manual pre-commit execution', 'verification before authorize'],
    },
    prompt: envelope.prompt,
  };
}

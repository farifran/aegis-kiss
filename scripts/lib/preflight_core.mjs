import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { TextDecoder } from 'node:util';
import { canonicalDigest, sha256 } from './canonical_json.mjs';
import { assertSchema } from './schema_validator.mjs';
import { parseSemanticState } from './semantic_state.mjs';

export const maxDemandBytes = 65_536;
const governedMaxBytes = 256 * 1024;
const gitMaxBytes = 512 * 1024;
const gitTimeoutMs = 3_000;
const semanticProtocolVersion = 'aegis.semantic_protocol.v2';
const knownFileExtension = /\.(?:c|cc|cpp|css|go|h|hpp|html|java|js|json|jsx|md|mjs|py|rb|rs|sh|sql|toml|ts|tsx|txt|xml|yaml|yml)$/iu;

export function digest(value) {
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

function executionId(baseCommit, normalizedDemandDigest, changeKind) {
  return sha256(`base=${baseCommit ?? 'UNVERSIONED'}\ndemand=${normalizedDemandDigest}\nkind=${changeKind}\n`);
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

function safePath(root, value) {
  let canonical;
  try {
    canonical = canonicalRepositoryPath(value);
  } catch {
    return undefined;
  }
  const absolute = resolve(root, canonical);
  const relation = relative(root, absolute);
  if (relation === '..' || relation.startsWith('..' + sep)) return undefined;
  return absolute;
}

function containsSymlink(root, absolute) {
  const relation = relative(root, absolute);
  let cursor = root;
  for (const part of relation.split(sep).filter(Boolean)) {
    cursor = resolve(cursor, part);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) return true;
  }
  return false;
}

function pathFact(root, kind, value, source = {}) {
  const absolute = safePath(root, value);
  if (absolute === undefined) return { kind, value, status: 'DISPROVEN', evidence: 'unsafe_relative_path', ...source };
  if (!existsSync(absolute)) return { kind, value, status: 'DISPROVEN', evidence: 'path_not_found', ...source };
  if (containsSymlink(root, absolute)) return { kind, value, status: 'DISPROVEN', evidence: 'symlink_not_allowed', ...source };
  const stat = lstatSync(absolute);
  if (stat.isDirectory()) return { kind, value, status: 'PROVEN', evidence: 'directory_exists', ...source };
  if (stat.isFile()) return { kind, value, status: 'PROVEN', evidence: 'file_exists', ...source };
  return { kind, value, status: 'DISPROVEN', evidence: 'special_path_not_allowed', ...source };
}

function referenceFact(root, reference) {
  const source = { unitId: reference.unitId, range: reference.range };
  if (reference.kind === 'path') return pathFact(root, 'path', reference.value, source);
  if (reference.kind === 'url') return { kind: 'url', value: reference.value, status: 'UNPROVEN', evidence: 'external_reference_not_verified', ...source };
  return { kind: 'symbol', value: reference.value, status: 'UNPROVEN', evidence: 'semantic_resolution_requires_ide', ...source };
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
  const legacyContractBytes = readOptionalCommitBlob(canonical, baseCommit, 'src/.aegis/contract-ir.json');
  if (legacyContractBytes === null) return null;
  try {
    const contract = JSON.parse(legacyContractBytes.toString('utf8'));
    assertSchema('aegis.contract_ir.v2', contract);
    return { source: 'legacy-contract', contract, proofRegistry: null };
  } catch {
    throw new Error('invalid_previous_contract');
  }
}

function inject(template, placeholder, value) {
  const token = '{{' + placeholder + '}}';
  if (template.split(token).length !== 2) throw new Error('invalid_prompt_placeholder:' + placeholder);
  return template.replace(token, JSON.stringify(value));
}

export async function buildPreflight(rawBytes, requestedTarget, root, changeKind = 'PRODUCT') {
  if (!['PRODUCT', 'HARNESS'].includes(changeKind)) throw new Error('invalid_change_kind');
  const canonical = canonicalRoot(root);
  const baseline = repositorySnapshot(canonical);
  if (!baseline.clean) throw new Error('preflight_requires_clean_worktree');
  const normalizedDemand = normalizeDemand(rawBytes);
  const target = requestedTarget.length === 0
    ? { kind: 'target', value: '', status: 'NOT_APPLICABLE', evidence: 'no_target_hint' }
    : pathFact(canonical, 'target', requestedTarget);
  const factBody = {
    schema: 'aegis.preflight_facts.v2',
    target,
    references: normalizedDemand.references.map((reference) => referenceFact(canonical, reference)),
  };
  const mechanicalFacts = { ...factBody, digest: canonicalDigest(factBody) };
  const architecture = loadArchitecture(canonical, baseline.commit);
  const previousEvidence = loadPreviousEvidence(canonical, baseline.commit);
  const previousContract = previousEvidence?.contract ?? null;
  const previousProofRegistry = previousEvidence?.proofRegistry ?? null;
  const previousContractDigest = previousContract === null ? null : canonicalDigest(previousContract);
  const promptTemplate = readCommitBlob(canonical, baseline.commit, 'governance/prompts/preflight.v2.md', 'preflight_prompt_unavailable').toString('utf8');
  const promptTemplateDigest = digest(promptTemplate);
  const semanticProtocolDigest = canonicalDigest({
    version: semanticProtocolVersion,
    decisionSchema: 'aegis.preflight_decision.v2',
    normalizedDemandSchema: 'aegis.normalized_demand.v2',
  });
  const contextDigest = canonicalDigest({
    changeKind,
    baseline,
    normalizedDemandDigest: normalizedDemand.digest,
    mechanicalFactsDigest: mechanicalFacts.digest,
    architecturePolicyDigest: architecture.policyDigest,
    previousContractDigest,
    promptTemplateDigest,
    semanticProtocolDigest,
  });
  let prompt = promptTemplate;
  prompt = inject(prompt, 'context_digest', contextDigest);
  prompt = inject(prompt, 'change_kind', changeKind);
  prompt = inject(prompt, 'normalized_demand', {
    text: normalizedDemand.text,
    units: normalizedDemand.units.map(({ id, kind, range }) => ({ id, kind, range })),
  });
  prompt = inject(prompt, 'mechanical_facts', { target: mechanicalFacts.target, references: mechanicalFacts.references });
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
    executionId: executionId(baseline.commit, normalizedDemand.digest, changeKind),
    baseCommit: baseline.commit,
    baseline,
    normalizedDemand,
    mechanicalFacts,
    architecture,
    previousContract,
    previousContractDigest,
    promptTemplateDigest,
    semanticProtocolDigest,
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
    semanticProtocolDigest: envelope.semanticProtocolDigest,
    timing,
    protocol: {
      decisionPath: '.harness/runtime/preflight_decision.json',
      finalize: './aegis finalize <same-demand> --decision .harness/runtime/preflight_decision.json',
      forensicReview: 'forensic: ./aegis review <demanda> --decision <arquivo>; finalize com --independent-review <review>',
      revision: 'quando finalize retornar SEMANTIC_REVISION_REQUIRED, corrija somente a decisão usando as correções e repita finalize sem redescobrir o repositório',
      promotion: ['implement authorized scope', 'stage persistent changes', './aegis authorize', 'git commit'],
      forbidden: ['repository reads during semantic compilation', 'manual pre-commit execution', 'verification before authorize'],
    },
    prompt: envelope.prompt,
  };
}

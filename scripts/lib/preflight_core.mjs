import { Buffer } from 'node:buffer';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { TextDecoder } from 'node:util';
import { canonicalDigest, sha256 } from './canonical_json.mjs';

const defaultMaxBytes = 65_536;
const knownFileExtension = /\.(?:c|cc|cpp|css|go|h|hpp|html|java|js|json|jsx|md|mjs|py|rb|rs|sh|sql|toml|ts|tsx|txt|xml|yaml|yml)$/iu;

export function digest(value) {
  return sha256(value);
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

function extractUnits(text) {
  const units = [];
  let utf16Start = 0;
  let inCode = false;
  for (const match of text.matchAll(/.*(?:\n|$)/gu)) {
    const rawLine = match[0];
    if (rawLine.length === 0) continue;
    const line = rawLine.endsWith('\n') ? rawLine.slice(0, -1) : rawLine;
    const startsFence = line.startsWith('\x60\x60\x60');
    if (line.trim().length > 0) {
      units.push({
        id: 'UNIT-' + String(units.length + 1).padStart(4, '0'),
        kind: classifyLine(line, inCode),
        text: line,
        range: {
          startByte: byteOffset(text, utf16Start),
          endByte: byteOffset(text, utf16Start + rawLine.length),
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

export function normalizeDemand(rawBytes, maxBytes = defaultMaxBytes) {
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
  if (typeof value !== 'string' || value.length === 0 || value.startsWith('/') || value.split(/[\\/]/u).includes('..')) return undefined;
  const absolute = resolve(root, value);
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
  return { kind, value, status: 'PROVEN', evidence: lstatSync(absolute).isDirectory() ? 'directory_exists' : 'file_exists', ...source };
}

function referenceFact(root, reference) {
  const source = { unitId: reference.unitId, range: reference.range };
  if (reference.kind === 'path') return pathFact(root, 'path', reference.value, source);
  if (reference.kind === 'url') return { kind: 'url', value: reference.value, status: 'UNPROVEN', evidence: 'external_reference_not_verified', ...source };
  return { kind: 'symbol', value: reference.value, status: 'UNPROVEN', evidence: 'semantic_resolution_requires_ide', ...source };
}

export function loadArchitecture(root) {
  const policyPath = resolve(root, 'governance/architecture.policy.json');
  const policyText = readFileSync(policyPath, 'utf8');
  const policy = JSON.parse(policyText);
  if (
    policy === null
    || typeof policy !== 'object'
    || policy.schema !== 'aegis.architecture_policy.v1'
    || policy.origin === null
    || typeof policy.origin !== 'object'
    || typeof policy.origin.sourcePath !== 'string'
    || !/^[a-f0-9]{64}$/u.test(policy.origin.sourceDigest)
    || !Array.isArray(policy.rules)
    || !policy.rules.every((rule) => (
      rule !== null
      && typeof rule === 'object'
      && typeof rule.id === 'string'
      && ['hard', 'default', 'preference'].includes(rule.level)
      && typeof rule.statement === 'string'
      && Array.isArray(rule.appliesWhen)
      && rule.appliesWhen.every((item) => typeof item === 'string')
      && ['any', 'all'].includes(rule.appliesMode)
    ))
  ) throw new Error('invalid_architecture_policy');
  const sourcePath = safePath(root, policy.origin.sourcePath);
  if (sourcePath === undefined || !existsSync(sourcePath)) throw new Error('architecture_source_unavailable');
  if (digest(readFileSync(sourcePath)) !== policy.origin.sourceDigest) throw new Error('stale_architecture_policy');
  return {
    schema: 'aegis.preflight_architecture.v2',
    policyDigest: digest(policyText),
    sourceStatus: 'CURRENT',
    candidateRules: policy.rules.map(({ id, level, statement, appliesWhen, appliesMode }) => ({ id, level, statement, appliesWhen, appliesMode })),
  };
}

function inject(template, placeholder, value) {
  const token = '{{' + placeholder + '}}';
  if (template.split(token).length !== 2) throw new Error('invalid_prompt_placeholder:' + placeholder);
  return template.replace(token, JSON.stringify(value));
}

export async function buildPreflight(rawBytes, requestedTarget, root) {
  const normalizedDemand = normalizeDemand(rawBytes);
  const target = requestedTarget.length === 0
    ? { kind: 'target', value: '', status: 'NOT_APPLICABLE', evidence: 'no_target_hint' }
    : pathFact(root, 'target', requestedTarget);
  const factBody = {
    schema: 'aegis.preflight_facts.v2',
    target,
    references: normalizedDemand.references.map((reference) => referenceFact(root, reference)),
  };
  const mechanicalFacts = { ...factBody, digest: canonicalDigest(factBody) };
  const architecture = loadArchitecture(root);
  const previousContractPath = resolve(root, '.harness/active_contract_ir.json');
  let previousContract = null;
  if (existsSync(previousContractPath)) {
    try {
      previousContract = JSON.parse(readFileSync(previousContractPath, 'utf8'));
      const { assertSchema } = await import('./schema_validator.mjs');
      assertSchema('aegis.contract_ir.v2', previousContract);
    } catch {
      throw new Error('invalid_previous_contract');
    }
  }
  const previousContractDigest = previousContract === null ? null : canonicalDigest(previousContract);
  const contextDigest = canonicalDigest({
    normalizedDemandDigest: normalizedDemand.digest,
    mechanicalFactsDigest: mechanicalFacts.digest,
    architecturePolicyDigest: architecture.policyDigest,
    previousContractDigest,
  });
  let prompt = readFileSync(resolve(root, 'governance/prompts/preflight.v2.md'), 'utf8');
  prompt = inject(prompt, 'context_digest', contextDigest);
  prompt = inject(prompt, 'normalized_demand', { units: normalizedDemand.units });
  prompt = inject(prompt, 'mechanical_facts', { target: mechanicalFacts.target, references: mechanicalFacts.references });
  prompt = inject(prompt, 'architecture_rules', { candidateRules: architecture.candidateRules });
  prompt = inject(prompt, 'previous_contract', previousContract);
  const envelope = {
    schema: 'aegis.ide_preflight.v2',
    status: 'PENDING_SEMANTIC_COMPILATION',
    normalizedDemand,
    mechanicalFacts,
    architecture,
    previousContract,
    previousContractDigest,
    contextDigest,
    promptDigest: digest(prompt),
    prompt,
  };
  return envelope;
}

#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const rootDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)));
const promptPath = resolve(rootDirectory, 'governance/prompts/preflight.v1.md');
const architectureNormalizerPath = resolve(rootDirectory, 'scripts/normalize_architecture.mjs');

function fail(code) {
  process.stderr.write(`[AEGIS][PREFLIGHT][FATAL] ${code}\n`);
  process.exit(1);
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isSafePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && !value.startsWith('/')
    && !value.split(/[\\/]/u).includes('..');
}

function isInsideRoot(path) {
  const relation = relative(rootDirectory, path);
  return relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..' && !relation.includes(`${sep}..${sep}`));
}

function currentWorktreeDigest() {
  try {
    const status = execFileSync('git', ['-C', rootDirectory, 'status', '--porcelain=v1', '-z']);
    return digest(status);
  } catch {
    fail('worktree_status_unavailable');
  }
}

function pathFact(path) {
  if (!isSafePath(path)) return { kind: 'path', value: path, status: 'DISPROVEN', evidence: 'unsafe_relative_path' };
  const absolute = resolve(rootDirectory, path);
  if (!isInsideRoot(absolute) || !existsSync(absolute)) {
    return { kind: 'path', value: path, status: 'DISPROVEN', evidence: 'path_not_found' };
  }
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink()) return { kind: 'path', value: path, status: 'DISPROVEN', evidence: 'symlink_not_allowed' };
  return {
    kind: 'path',
    value: path,
    status: 'PROVEN',
    evidence: stat.isDirectory() ? 'directory_exists' : 'file_exists',
  };
}

function referenceFact(reference) {
  if (reference.kind === 'path') return pathFact(reference.value);
  if (reference.kind === 'url') return { kind: 'url', value: reference.value, status: 'NOT_APPLICABLE', evidence: 'network_not_used_in_preflight' };
  return { kind: reference.kind, value: reference.value, status: 'UNPROVEN', evidence: 'semantic_resolution_requires_ide' };
}

function replacePlaceholder(template, placeholder, value) {
  const token = `{{${placeholder}}}`;
  if ((template.match(new RegExp(token.replace(/[{}]/gu, '\\$&'), 'gu')) ?? []).length !== 1) fail(`invalid_prompt_placeholder:${placeholder}`);
  return template.replace(token, JSON.stringify(value));
}

let inputText;
let intake;
try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  inputText = Buffer.concat(chunks).toString('utf8');
  intake = JSON.parse(inputText);
} catch {
  fail('invalid_intake');
}

if (
  intake?.schema !== 'aegis.ide_intake.v2'
  || intake.status !== 'PENDING_PREFLIGHT'
  || typeof intake.baseCommit !== 'string'
  || typeof intake.worktreeStatusDigest !== 'string'
  || typeof intake.evidenceState !== 'string'
  || typeof intake.normalizedDemand?.normalizedDigest !== 'string'
  || typeof intake.normalizedDemand?.text !== 'string'
  || !Array.isArray(intake.normalizedDemand.references)
) fail('malformed_intake');

let architecture;
let promptTemplate;
try {
  architecture = JSON.parse(execFileSync(process.execPath, [architectureNormalizerPath, '--all'], { encoding: 'utf8' }));
  promptTemplate = await readFile(promptPath, 'utf8');
} catch {
  fail('preflight_dependencies_unavailable');
}

const targetFact = intake.requestedTarget.length === 0
  ? { kind: 'target', value: '', status: 'NOT_APPLICABLE', evidence: 'no_target_hint' }
  : pathFact(intake.requestedTarget);
const facts = {
  schema: 'aegis.preflight_facts.v1',
  baseCommit: intake.baseCommit,
  evidenceState: intake.evidenceState,
  worktreeStatus: currentWorktreeDigest() === intake.worktreeStatusDigest ? 'CURRENT' : 'CHANGED',
  target: targetFact,
  references: intake.normalizedDemand.references.map(referenceFact),
};
const architectureRules = architecture.rules.map(({ appliesMode, appliesWhen, id, level, statement }) => ({
  id,
  level,
  statement,
  appliesWhen,
  appliesMode,
}));
let prompt = replacePlaceholder(promptTemplate, 'normalized_demand', {
  digest: intake.normalizedDemand.normalizedDigest,
  text: intake.normalizedDemand.text,
});
prompt = replacePlaceholder(prompt, 'mechanical_facts', facts);
prompt = replacePlaceholder(prompt, 'architecture_rules', {
  policyDigest: architecture.policyDigest,
  sourceStatus: architecture.sourceStatus,
  candidateRules: architectureRules,
});

const output = {
  schema: 'aegis.ide_preflight.v1',
  status: 'PENDING_SEMANTIC_PREFLIGHT',
  normalizedDemandDigest: intake.normalizedDemand.normalizedDigest,
  mechanicalFactsDigest: digest(JSON.stringify(facts)),
  architecturePolicyDigest: architecture.policyDigest,
  architectureSourceStatus: architecture.sourceStatus,
  promptDigest: digest(prompt),
  prompt,
};
process.stdout.write(`${JSON.stringify(output)}\n`);

#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const rootDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)));
const defaultPolicyPath = 'governance/architecture.policy.json';

function fail(code) {
  process.stderr.write(`[AEGIS][ARCHITECTURE][FATAL] ${code}\n`);
  process.exit(1);
}

function isSafePath(value) {
  return value.length > 0 && !value.startsWith('/') && !value.split(/[\\/]/u).includes('..');
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function parseArguments(argv) {
  const tags = [];
  let policyPath = defaultPolicyPath;
  let includeAll = false;
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    const value = argv[index + 1];
    if (option === '--all') {
      includeAll = true;
      continue;
    }
    if (option === '--tag' && value !== undefined && /^[a-z0-9][a-z0-9-]*$/u.test(value)) {
      if (!tags.includes(value)) tags.push(value);
      index += 1;
      continue;
    }
    if (option === '--policy' && value !== undefined && isSafePath(value)) {
      policyPath = value;
      index += 1;
      continue;
    }
    fail('invalid_arguments');
  }
  return { includeAll, tags: tags.sort(), policyPath };
}

function isInsideRoot(path) {
  const relation = relative(rootDirectory, path);
  return relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..' && !relation.includes(`${sep}..${sep}`));
}

function isRange(value, sourceLength) {
  return Number.isInteger(value?.startByte)
    && Number.isInteger(value?.endByte)
    && value.startByte >= 0
    && value.endByte > value.startByte
    && value.endByte <= sourceLength;
}

function validatePolicy(policy, sourceLength) {
  if (
    policy?.schema !== 'aegis.architecture_policy.v1'
    || !Number.isInteger(policy.policyVersion)
    || policy.policyVersion < 1
    || typeof policy.origin?.sourcePath !== 'string'
    || !/^[a-f0-9]{64}$/u.test(policy.origin?.sourceDigest ?? '')
    || typeof policy.origin?.normalizerVersion !== 'string'
    || !Array.isArray(policy.rules)
    || !Array.isArray(policy.amendments ?? [])
  ) fail('malformed_policy');

  const ruleIds = new Set();
  for (const rule of policy.rules) {
    if (
      !/^ARCH-[A-Z0-9][A-Z0-9-]+$/u.test(rule?.id ?? '')
      || !['hard', 'default', 'preference'].includes(rule.level)
      || typeof rule.statement !== 'string'
      || rule.statement.length === 0
      || !Array.isArray(rule.appliesWhen)
      || rule.appliesWhen.length === 0
      || !rule.appliesWhen.every((tag) => /^[a-z0-9][a-z0-9-]*$/u.test(tag))
      || !['any', 'all'].includes(rule.appliesMode)
      || !Array.isArray(rule.sourceRanges)
      || rule.sourceRanges.length === 0
      || !rule.sourceRanges.every((item) => isRange(item, sourceLength))
      || ruleIds.has(rule.id)
    ) fail('malformed_rule');
    ruleIds.add(rule.id);
  }

  const amendmentIds = new Set();
  for (const amendment of policy.amendments ?? []) {
    if (
      !/^ARCH-AMEND-[A-Z0-9][A-Z0-9-]+$/u.test(amendment?.id ?? '')
      || !ruleIds.has(amendment.ruleId)
      || amendment.status !== 'approved'
      || amendment.approvedBy !== 'user'
      || typeof amendment.reason !== 'string'
      || amendment.reason.length === 0
      || amendmentIds.has(amendment.id)
    ) fail('malformed_amendment');
    amendmentIds.add(amendment.id);
  }
}

function applies(rule, tags) {
  return rule.appliesMode === 'all'
    ? rule.appliesWhen.every((tag) => tags.includes(tag))
    : rule.appliesWhen.some((tag) => tags.includes(tag));
}

const { includeAll, tags, policyPath } = parseArguments(process.argv.slice(2));
const absolutePolicyPath = resolve(rootDirectory, policyPath);
if (!isInsideRoot(absolutePolicyPath)) fail('unsafe_policy_path');

let policyText;
let policy;
try {
  policyText = await readFile(absolutePolicyPath, 'utf8');
  policy = JSON.parse(policyText);
} catch {
  fail('unreadable_policy');
}

if (!isSafePath(policy.origin?.sourcePath ?? '')) fail('unsafe_source_path');
const sourcePath = resolve(rootDirectory, policy.origin.sourcePath);
if (!isInsideRoot(sourcePath)) fail('unsafe_source_path');

let source;
try {
  source = await readFile(sourcePath);
} catch {
  fail('unreadable_source');
}

validatePolicy(policy, source.length);
const output = {
  schema: 'aegis.architecture_projection.v1',
  policyDigest: digest(policyText),
  sourceStatus: digest(source) === policy.origin.sourceDigest ? 'CURRENT' : 'STALE',
  tags,
  rules: includeAll ? policy.rules : policy.rules.filter((rule) => applies(rule, tags)),
};
process.stdout.write(`${JSON.stringify(output)}\n`);

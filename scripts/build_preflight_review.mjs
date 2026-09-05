#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { sha256 } from './lib/canonical_json.mjs';
import { assertSchema } from './lib/schema_validator.mjs';

const root = resolve(process.env.AEGIS_ROOT ?? fileURLToPath(new URL('..', import.meta.url)));

function fail(code) {
  process.stderr.write(`[AEGIS][REVIEW][FATAL] ${code}\n`);
  process.exit(1);
}

function parseArguments(argv) {
  const options = { decision: '', producerId: '', reviewerId: '' };
  const names = new Map([
    ['--decision', 'decision'],
    ['--producer-id', 'producerId'],
    ['--reviewer-id', 'reviewerId'],
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const key = names.get(argv[index]);
    const value = argv[index + 1];
    if (key === undefined || value === undefined || value.length === 0 || options[key].length > 0) fail('invalid_arguments');
    options[key] = value;
  }
  if (options.decision.length === 0 || options.producerId.length === 0 || options.reviewerId.length === 0) fail('missing_arguments');
  if (options.producerId === options.reviewerId) fail('review_authority_not_independent');
  if (options.decision.startsWith('/') || options.decision.split(/[\\/]/u).includes('..')) fail('unsafe_decision_path');
  return options;
}

function inject(template, value) {
  const token = '{{review_context}}';
  if (template.split(token).length !== 2) fail('invalid_review_prompt');
  return template.replace(token, JSON.stringify(value));
}

function decisionPath(value) {
  const path = resolve(root, value);
  const relation = relative(root, path);
  if (relation === '..' || relation.startsWith(`..${sep}`)) fail('unsafe_decision_path');
  let cursor = root;
  for (const part of relation.split(sep).filter(Boolean)) {
    cursor = resolve(cursor, part);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) fail('unsafe_decision_path');
  }
  return path;
}

const options = parseArguments(process.argv.slice(2));
let decisionBytes;
let decision;
try {
  decisionBytes = readFileSync(decisionPath(options.decision));
  decision = JSON.parse(decisionBytes.toString('utf8'));
  assertSchema('aegis.preflight_decision.v2', decision);
} catch {
  fail('invalid_decision');
}
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
let preflight;
try {
  preflight = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  assertSchema('aegis.ide_preflight.v2', preflight);
} catch {
  fail('invalid_preflight_envelope');
}
if (decision.contextDigest !== preflight.contextDigest) fail('decision_context_mismatch');
const context = {
  normalizedDemand: preflight.normalizedDemand,
  mechanicalFacts: preflight.mechanicalFacts,
  architecture: preflight.architecture,
  previousContract: preflight.previousContract,
  contextDigest: preflight.contextDigest,
  decision,
  producerId: options.producerId,
  reviewerId: options.reviewerId,
};
const template = readFileSync(resolve(root, 'governance/prompts/preflight-review.v2.md'), 'utf8');
const prompt = inject(template, context);
const request = {
  schema: 'aegis.preflight_review_request.v2',
  status: 'PENDING_INDEPENDENT_REVIEW',
  normalizedDemandDigest: preflight.normalizedDemand.digest,
  decisionDigest: sha256(decisionBytes),
  producerId: options.producerId,
  reviewerId: options.reviewerId,
  promptDigest: sha256(prompt),
  prompt,
};
try {
  assertSchema(request.schema, request);
} catch {
  fail('invalid_review_request');
}
process.stdout.write(`${JSON.stringify(request)}\n`);

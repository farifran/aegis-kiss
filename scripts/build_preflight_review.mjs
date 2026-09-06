#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { canonicalDigest, sha256 } from './lib/canonical_json.mjs';
import { questionIds, resolvePreflightDecision, selectedAnswer } from './lib/preflight_resolution.mjs';
import { assertSchema } from './lib/schema_validator.mjs';

const root = resolve(process.env.AEGIS_ROOT ?? fileURLToPath(new URL('..', import.meta.url)));

function fail(code) {
  process.stderr.write(`[AEGIS][REVIEW][FATAL] ${code}\n`);
  process.exit(1);
}

function parseArguments(argv) {
  const options = { decision: '', resolution: '', producerId: '', reviewerId: '' };
  const names = new Map([
    ['--decision', 'decision'],
    ['--resolution', 'resolution'],
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
  if ([options.decision, options.resolution].some((value) => value.startsWith('/') || value.split(/[\\/]/u).includes('..'))) fail('unsafe_decision_path');
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

async function persistReviewRequest(request) {
  const runtimeDirectory = resolve(root, '.harness/runtime');
  const destination = resolve(runtimeDirectory, 'preflight_review_request.json');
  const temporary = `${destination}.${process.pid}.tmp`;
  await mkdir(runtimeDirectory, { recursive: true });
  await writeFile(temporary, `${JSON.stringify(request)}\n`, 'utf8');
  await rename(temporary, destination);
}

const options = parseArguments(process.argv.slice(2));
let decisionBytes;
let sourceDecision;
try {
  decisionBytes = readFileSync(decisionPath(options.decision));
  sourceDecision = JSON.parse(decisionBytes.toString('utf8'));
  assertSchema('aegis.preflight_decision.v2', sourceDecision);
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
if (sourceDecision.contextDigest !== preflight.contextDigest) fail('decision_context_mismatch');
if (sourceDecision.promptDigest !== preflight.promptDigest) fail('decision_prompt_mismatch');
let decision = sourceDecision;
let clarifications = [];
if (sourceDecision.status === 'NEEDS_CONFIRMATION') {
  if (options.resolution.length === 0) fail('resolution_required');
  let resolution;
  try {
    resolution = JSON.parse(readFileSync(decisionPath(options.resolution), 'utf8'));
    assertSchema('aegis.preflight_resolution.v2', resolution);
  } catch {
    fail('invalid_resolution');
  }
  if (resolution.decisionDigest !== sha256(decisionBytes) || resolution.preflightPromptDigest !== preflight.promptDigest) {
    fail('resolution_binding_mismatch');
  }
  const expectedIds = questionIds(sourceDecision);
  const actualIds = resolution.answers.map((answer) => answer.questionId);
  if (actualIds.length !== new Set(actualIds).size || JSON.stringify([...actualIds].sort()) !== JSON.stringify([...expectedIds].sort())) {
    fail('resolution_answers_mismatch');
  }
  for (const answer of resolution.answers) {
    if (answer.action !== 'SELECT_ANSWER') continue;
    const index = expectedIds.indexOf(answer.questionId);
    if (index < 0 || selectedAnswer(sourceDecision.questions[index], answer.answerId) === undefined) {
      fail('resolution_unknown_answer');
    }
  }
  if (resolution.answers.some((answer) => answer.action === 'CORRECT_INTERPRETATION')) fail('resolution_requires_semantic_revision');
  try {
    ({ decision, clarifications } = resolvePreflightDecision(sourceDecision, resolution));
  } catch {
    fail('invalid_resolution');
  }
} else if (options.resolution.length > 0) {
  fail('resolution_not_allowed');
}
const resolvedDecisionDigest = decision === sourceDecision ? sha256(decisionBytes) : canonicalDigest(decision);
const producerExecutionId = preflight.executionId;
const reviewExecutionId = sha256([
  'aegis.preflight_review_execution.v1',
  producerExecutionId,
  resolvedDecisionDigest,
  options.producerId,
  options.reviewerId,
].join('\n'));
const reviewBinding = {
  schema: 'aegis.preflight_review_request.v2',
  status: 'PENDING_INDEPENDENT_REVIEW',
  normalizedDemandDigest: preflight.normalizedDemand.digest,
  decisionDigest: resolvedDecisionDigest,
  producerId: options.producerId,
  reviewerId: options.reviewerId,
  producerExecutionId,
  reviewExecutionId,
};
const reviewRequestDigest = canonicalDigest(reviewBinding);
const context = {
  normalizedDemand: preflight.normalizedDemand,
  mechanicalFacts: preflight.mechanicalFacts,
  architecture: preflight.architecture,
  previousContract: preflight.previousContract,
  contextDigest: preflight.contextDigest,
  decision,
  clarifications,
  producerId: options.producerId,
  reviewerId: options.reviewerId,
  producerExecutionId,
  reviewExecutionId,
  reviewRequestDigest,
};
const template = readFileSync(resolve(root, 'governance/prompts/preflight-review.v2.md'), 'utf8');
const prompt = inject(template, context);
const request = {
  ...reviewBinding,
  reviewRequestDigest,
  promptDigest: sha256(prompt),
  prompt,
};
try {
  assertSchema(request.schema, request);
} catch {
  fail('invalid_review_request');
}
try {
  await persistReviewRequest(request);
} catch {
  fail('review_request_persistence_failed');
}
process.stdout.write(`${JSON.stringify(request)}\n`);

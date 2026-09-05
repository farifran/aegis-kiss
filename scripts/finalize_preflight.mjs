#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const rootDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)));
const clarifiedDemandPath = resolve(rootDirectory, '.harness/active_clarified_demand.json');

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

function parseArguments(argv) {
  let decisionPath = '';
  let resolutionPath = '';
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    const value = argv[index + 1];
    if (option === '--decision' && value !== undefined && isSafePath(value) && decisionPath.length === 0) {
      decisionPath = value;
      index += 1;
      continue;
    }
    if (option === '--resolution' && value !== undefined && isSafePath(value) && resolutionPath.length === 0) {
      resolutionPath = value;
      index += 1;
      continue;
    }
    fail('invalid_arguments');
  }
  if (decisionPath.length === 0) fail('missing_decision');
  return { decisionPath, resolutionPath };
}

async function readJson(relativePath, missingCode) {
  const absolutePath = resolve(rootDirectory, relativePath);
  if (!isInsideRoot(absolutePath)) fail('unsafe_input_path');
  let bytes;
  try {
    bytes = await readFile(absolutePath);
  } catch {
    fail(missingCode);
  }
  try {
    return { bytes, value: JSON.parse(bytes.toString('utf8')) };
  } catch {
    fail('invalid_json');
  }
}

function validateClarifiedDemand(value, normalizedDemandDigest) {
  if (
    value?.schema !== 'aegis.clarified_demand.v1'
    || value.normalizedDemandDigest !== normalizedDemandDigest
    || typeof value.intent !== 'string'
    || value.intent.length === 0
    || !Array.isArray(value.requirements)
    || value.requirements.length === 0
    || !Array.isArray(value.scope?.included)
    || !Array.isArray(value.scope?.excluded)
    || !value.requirements.every((requirement) => (
      /^REQ-[A-Z0-9][A-Z0-9-]+$/u.test(requirement?.id ?? '')
      && typeof requirement.statement === 'string'
      && requirement.statement.length > 0
      && ['USER', 'SAFE_CORRECTION', 'USER_CLARIFICATION', 'ARCHITECTURE_DEFAULT', 'KISS_DERIVATION'].includes(requirement.provenance)
    ))
  ) fail('malformed_clarified_demand');
  const ids = value.requirements.map((requirement) => requirement.id);
  if (new Set(ids).size !== ids.length) fail('duplicate_requirement_id');
}

function validateDecision(value, preflight) {
  if (
    value?.schema !== 'aegis.preflight_decision.v1'
    || value.normalizedDemandDigest !== preflight.normalizedDemandDigest
    || value.mechanicalFactsDigest !== preflight.mechanicalFactsDigest
    || value.architecturePolicyDigest !== preflight.architecturePolicyDigest
    || !['CLARIFIED', 'NEEDS_CONFIRMATION', 'BLOCKED'].includes(value.status)
    || !Array.isArray(value.findings)
    || !Array.isArray(value.questions)
  ) fail('malformed_decision');
  const ids = value.questions.map((question) => question?.id);
  if (ids.some((id) => !/^Q-[A-Z0-9][A-Z0-9-]+$/u.test(id ?? '')) || new Set(ids).size !== ids.length) {
    fail('malformed_question_ids');
  }
  if (!value.questions.every((question) => (
    ['INPUT', 'SCOPE', 'ARCHITECTURE'].includes(question?.scope)
    && typeof question.prompt === 'string' && question.prompt.length > 0
    && typeof question.evidence === 'string' && question.evidence.length > 0
    && typeof question.impact === 'string' && question.impact.length > 0
    && typeof question.recommendation === 'string' && question.recommendation.length > 0
  ))) fail('malformed_questions');
  if (value.status === 'CLARIFIED' && (value.questions.length !== 0 || value.clarifiedDemand === undefined)) {
    fail('clarified_decision_incomplete');
  }
  if (value.status === 'NEEDS_CONFIRMATION' && (value.questions.length === 0 || value.questions.length > 3)) {
    fail('confirmation_questions_invalid');
  }
  if (value.status === 'BLOCKED' && value.questions.length !== 0) fail('blocked_decision_has_questions');
}

function validateResolution(value, decisionBytes, decision, preflight) {
  if (
    value?.schema !== 'aegis.preflight_resolution.v1'
    || value.decisionDigest !== digest(decisionBytes)
    || value.preflightPromptDigest !== preflight.promptDigest
    || !Array.isArray(value.answers)
    || value.answers.length !== decision.questions.length
    || value.clarifiedDemand === undefined
  ) fail('malformed_resolution');
  const expectedIds = decision.questions.map((question) => question.id).sort();
  const answerIds = value.answers.map((answer) => answer?.questionId).sort();
  if (
    answerIds.some((id) => !/^Q-[A-Z0-9][A-Z0-9-]+$/u.test(id ?? ''))
    || new Set(answerIds).size !== answerIds.length
    || JSON.stringify(answerIds) !== JSON.stringify(expectedIds)
    || !value.answers.every((answer) => typeof answer.answer === 'string' && answer.answer.length > 0)
  ) fail('resolution_answers_mismatch');
}

async function persistClarifiedDemand(value) {
  await mkdir(resolve(rootDirectory, '.harness'), { recursive: true });
  const temporaryPath = `${clarifiedDemandPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, 'utf8');
  await rename(temporaryPath, clarifiedDemandPath);
}

const { decisionPath, resolutionPath } = parseArguments(process.argv.slice(2));
let input;
try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
} catch {
  fail('invalid_preflight_envelope');
}
if (
  input?.schema !== 'aegis.ide_preflight.v1'
  || input.status !== 'PENDING_SEMANTIC_PREFLIGHT'
  || !/^[a-f0-9]{64}$/u.test(input.normalizedDemandDigest ?? '')
  || !/^[a-f0-9]{64}$/u.test(input.mechanicalFactsDigest ?? '')
  || !/^[a-f0-9]{64}$/u.test(input.architecturePolicyDigest ?? '')
  || !/^[a-f0-9]{64}$/u.test(input.promptDigest ?? '')
  || typeof input.prompt !== 'string'
  || digest(input.prompt) !== input.promptDigest
) fail('malformed_preflight_envelope');

const decision = await readJson(decisionPath, 'unreadable_decision');
validateDecision(decision.value, input);

if (decision.value.status === 'BLOCKED') {
  process.stdout.write(`${JSON.stringify({ schema: 'aegis.preflight_finalization.v1', status: 'BLOCKED' })}\n`);
  process.exit(0);
}

let clarifiedDemand;
if (decision.value.status === 'CLARIFIED') {
  if (resolutionPath.length !== 0) fail('resolution_not_allowed');
  clarifiedDemand = decision.value.clarifiedDemand;
} else {
  if (resolutionPath.length === 0) fail('resolution_required');
  const resolution = await readJson(resolutionPath, 'unreadable_resolution');
  validateResolution(resolution.value, decision.bytes, decision.value, input);
  clarifiedDemand = resolution.value.clarifiedDemand;
}

validateClarifiedDemand(clarifiedDemand, input.normalizedDemandDigest);
await persistClarifiedDemand(clarifiedDemand);
process.stdout.write(`${JSON.stringify({
  schema: 'aegis.preflight_finalization.v1',
  status: 'CLARIFIED_DEMAND_PERSISTED',
  clarifiedDemandDigest: digest(JSON.stringify(clarifiedDemand)),
  path: '.harness/active_clarified_demand.json',
})}\n`);

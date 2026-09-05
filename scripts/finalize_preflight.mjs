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

function hasOnlyKeys(value, keys) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).every((key) => keys.includes(key));
}

function validRange(value) {
  return hasOnlyKeys(value, ['startByte', 'endByte'])
    && Number.isInteger(value.startByte)
    && Number.isInteger(value.endByte)
    && value.startByte >= 0
    && value.endByte >= 0;
}

function validStringList(value) {
  return Array.isArray(value)
    && value.every((item) => typeof item === 'string' && item.length > 0)
    && new Set(value).size === value.length;
}

function architectureRulesFromPrompt(prompt, policyDigest) {
  const startMarker = '<REGRAS_ARQUITETURAIS_CANDIDATAS>';
  const endMarker = '</REGRAS_ARQUITETURAIS_CANDIDATAS>';
  const start = prompt.indexOf(startMarker);
  const end = prompt.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) fail('missing_architecture_rules');
  let projection;
  try {
    projection = JSON.parse(prompt.slice(start + startMarker.length, end).trim());
  } catch {
    fail('invalid_architecture_rules');
  }
  if (
    projection?.policyDigest !== policyDigest
    || !Array.isArray(projection.candidateRules)
    || !projection.candidateRules.every((rule) => (
      /^ARCH-[A-Z0-9][A-Z0-9-]+$/u.test(rule?.id ?? '')
      && ['hard', 'default', 'preference'].includes(rule.level)
    ))
  ) fail('malformed_architecture_rules');
  return projection.candidateRules;
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
    !hasOnlyKeys(value, ['schema', 'normalizedDemandDigest', 'intent', 'requirements', 'scope', 'acceptanceCriteria', 'failureSemantics'])
    ||
    value?.schema !== 'aegis.clarified_demand.v1'
    || value.normalizedDemandDigest !== normalizedDemandDigest
    || typeof value.intent !== 'string'
    || value.intent.length === 0
    || !Array.isArray(value.requirements)
    || value.requirements.length === 0
    || !Array.isArray(value.scope?.included)
    || !Array.isArray(value.scope?.excluded)
    || !hasOnlyKeys(value.scope, ['included', 'excluded'])
    || !validStringList(value.scope.included)
    || !validStringList(value.scope.excluded)
    || (value.acceptanceCriteria !== undefined && !validStringList(value.acceptanceCriteria))
    || (value.failureSemantics !== undefined && !Array.isArray(value.failureSemantics))
    || !value.requirements.every((requirement) => (
      hasOnlyKeys(requirement, ['id', 'statement', 'provenance', 'sourceRange'])
      &&
      /^REQ-[A-Z0-9][A-Z0-9-]+$/u.test(requirement?.id ?? '')
      && typeof requirement.statement === 'string'
      && requirement.statement.length > 0
      && ['USER', 'SAFE_CORRECTION', 'USER_CLARIFICATION', 'ARCHITECTURE_DEFAULT', 'KISS_DERIVATION'].includes(requirement.provenance)
      && (requirement.sourceRange === undefined || validRange(requirement.sourceRange))
    ))
  ) fail('malformed_clarified_demand');
  const ids = value.requirements.map((requirement) => requirement.id);
  if (new Set(ids).size !== ids.length) fail('duplicate_requirement_id');
  if (value.failureSemantics !== undefined && !value.failureSemantics.every((failure) => (
    hasOnlyKeys(failure, ['id', 'trigger', 'observableOutcome'])
    && /^FAIL-[A-Z0-9][A-Z0-9-]+$/u.test(failure?.id ?? '')
    && typeof failure.trigger === 'string' && failure.trigger.length > 0
    && typeof failure.observableOutcome === 'string' && failure.observableOutcome.length > 0
  ))) fail('malformed_failure_semantics');
}

function validateDecision(value, preflight, architectureRules) {
  if (
    !hasOnlyKeys(value, ['schema', 'normalizedDemandDigest', 'mechanicalFactsDigest', 'architecturePolicyDigest', 'appliedRuleIds', 'hardConflictRuleIds', 'status', 'findings', 'questions', 'clarifiedDemand'])
    ||
    value?.schema !== 'aegis.preflight_decision.v1'
    || value.normalizedDemandDigest !== preflight.normalizedDemandDigest
    || value.mechanicalFactsDigest !== preflight.mechanicalFactsDigest
    || value.architecturePolicyDigest !== preflight.architecturePolicyDigest
    || !Array.isArray(value.appliedRuleIds)
    || !Array.isArray(value.hardConflictRuleIds)
    || !['CLARIFIED', 'NEEDS_CONFIRMATION', 'BLOCKED'].includes(value.status)
    || !Array.isArray(value.findings)
    || !Array.isArray(value.questions)
  ) fail('malformed_decision');
  if (
    !value.findings.every((finding) => (
      hasOnlyKeys(finding, ['id', 'kind', 'status', 'evidence', 'sourceRange'])
      && /^PF-[A-Z0-9][A-Z0-9-]+$/u.test(finding?.id ?? '')
      && ['input', 'reference', 'scope', 'architecture', 'repository'].includes(finding.kind)
      && ['PROVEN', 'UNPROVEN', 'DISPROVEN', 'NOT_APPLICABLE'].includes(finding.status)
      && typeof finding.evidence === 'string' && finding.evidence.length > 0
      && (finding.sourceRange === undefined || validRange(finding.sourceRange))
    ))
  ) fail('malformed_findings');
  const ruleIds = new Set(architectureRules.map((rule) => rule.id));
  const hardRuleIds = new Set(architectureRules.filter((rule) => rule.level === 'hard').map((rule) => rule.id));
  const appliedRuleIds = value.appliedRuleIds;
  const hardConflictRuleIds = value.hardConflictRuleIds;
  if (
    !appliedRuleIds.every((id) => /^ARCH-[A-Z0-9][A-Z0-9-]+$/u.test(id) && ruleIds.has(id))
    || new Set(appliedRuleIds).size !== appliedRuleIds.length
    || !hardConflictRuleIds.every((id) => appliedRuleIds.includes(id) && hardRuleIds.has(id))
    || new Set(hardConflictRuleIds).size !== hardConflictRuleIds.length
  ) fail('invalid_architecture_rule_binding');
  if (hardConflictRuleIds.length > 0 && value.status !== 'BLOCKED') fail('hard_conflict_not_blocked');
  const ids = value.questions.map((question) => question?.id);
  if (ids.some((id) => !/^Q-[A-Z0-9][A-Z0-9-]+$/u.test(id ?? '')) || new Set(ids).size !== ids.length) {
    fail('malformed_question_ids');
  }
  if (!value.questions.every((question) => (
    hasOnlyKeys(question, ['id', 'scope', 'prompt', 'evidence', 'impact', 'recommendation', 'sourceRange'])
    &&
    ['INPUT', 'SCOPE', 'ARCHITECTURE'].includes(question?.scope)
    && typeof question.prompt === 'string' && question.prompt.length > 0
    && typeof question.evidence === 'string' && question.evidence.length > 0
    && typeof question.impact === 'string' && question.impact.length > 0
    && typeof question.recommendation === 'string' && question.recommendation.length > 0
    && (question.sourceRange === undefined || validRange(question.sourceRange))
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
    !hasOnlyKeys(value, ['schema', 'decisionDigest', 'preflightPromptDigest', 'answers', 'clarifiedDemand'])
    ||
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
    || !value.answers.every((answer) => (
      hasOnlyKeys(answer, ['questionId', 'answer'])
      && typeof answer.answer === 'string' && answer.answer.length > 0
    ))
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
  || input.architectureSourceStatus !== 'CURRENT'
  || typeof input.prompt !== 'string'
  || digest(input.prompt) !== input.promptDigest
) fail('malformed_preflight_envelope');

const architectureRules = architectureRulesFromPrompt(input.prompt, input.architecturePolicyDigest);

const decision = await readJson(decisionPath, 'unreadable_decision');
validateDecision(decision.value, input, architectureRules);

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

#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { canonicalDigest, canonicalJson, sha256 } from './lib/canonical_json.mjs';
import { validateContract } from './lib/contract_validator.mjs';
import { loadArchitecture } from './lib/preflight_core.mjs';
import { assertSchema } from './lib/schema_validator.mjs';

const rootDirectory = resolve(process.env.AEGIS_ROOT ?? fileURLToPath(new URL('..', import.meta.url)));
const clarifiedDemandPath = resolve(rootDirectory, '.harness/active_clarified_demand.json');
const activeContractPath = resolve(rootDirectory, '.harness/active_contract_ir.json');
const startedAtEpochMs = Date.now();
const started = performance.now();

function fail(code) {
  process.stderr.write(`[AEGIS][PREFLIGHT][FATAL] ${code}\n`);
  process.exit(1);
}

function isSafeRelativePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && !value.startsWith('/')
    && !value.split(/[\\/]/u).includes('..');
}

function isInsideRoot(path) {
  const relation = relative(rootDirectory, path);
  return relation === '' || (relation !== '..' && !relation.startsWith(`..${sep}`));
}

function containsSymlink(path) {
  const relation = relative(rootDirectory, path);
  let cursor = rootDirectory;
  for (const part of relation.split(sep).filter(Boolean)) {
    cursor = resolve(cursor, part);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) return true;
  }
  return false;
}

function parseArguments(argv) {
  const options = { decision: '', resolution: '', independentReview: '' };
  const names = new Map([
    ['--decision', 'decision'],
    ['--resolution', 'resolution'],
    ['--independent-review', 'independentReview'],
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const key = names.get(argv[index]);
    const value = argv[index + 1];
    if (key === undefined || !isSafeRelativePath(value) || options[key].length > 0) fail('invalid_arguments');
    options[key] = value;
  }
  if (options.decision.length === 0) fail('missing_decision');
  return options;
}

async function readJson(relativePath, missingCode) {
  const absolutePath = resolve(rootDirectory, relativePath);
  if (!isInsideRoot(absolutePath) || containsSymlink(absolutePath)) fail('unsafe_input_path');
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

function assertValidSchema(schemaId, value, code) {
  try {
    assertSchema(schemaId, value);
  } catch {
    fail(code);
  }
}

function exactIds(actual, expected, code) {
  if (actual.length !== new Set(actual).size) fail(code);
  const left = [...actual].sort();
  const right = [...expected].sort();
  if (JSON.stringify(left) !== JSON.stringify(right)) fail(code);
}

function validateEnvelope(envelope) {
  assertValidSchema('aegis.ide_preflight.v2', envelope, 'malformed_preflight_envelope');
  if (sha256(envelope.normalizedDemand.text) !== envelope.normalizedDemand.digest) fail('normalized_demand_digest_mismatch');
  const { digest, ...factBody } = envelope.mechanicalFacts;
  if (canonicalDigest(factBody) !== digest) fail('mechanical_facts_digest_mismatch');
  if (sha256(envelope.prompt) !== envelope.promptDigest) fail('preflight_prompt_digest_mismatch');
  const expectedContextDigest = canonicalDigest({
    baseCommit: envelope.baseCommit,
    normalizedDemandDigest: envelope.normalizedDemand.digest,
    mechanicalFactsDigest: envelope.mechanicalFacts.digest,
    architecturePolicyDigest: envelope.architecture.policyDigest,
    previousContractDigest: envelope.previousContractDigest,
  });
  if (expectedContextDigest !== envelope.contextDigest) fail('preflight_context_digest_mismatch');
  if (envelope.previousContract === null) {
    if (envelope.previousContractDigest !== null || existsSync(activeContractPath)) fail('previous_contract_mismatch');
  } else {
    if (canonicalDigest(envelope.previousContract) !== envelope.previousContractDigest) fail('previous_contract_digest_mismatch');
    if (!existsSync(activeContractPath)) fail('previous_contract_mismatch');
    let activeContract;
    try {
      activeContract = JSON.parse(readFileSync(activeContractPath, 'utf8'));
    } catch {
      fail('invalid_previous_contract');
    }
    if (canonicalJson(activeContract) !== canonicalJson(envelope.previousContract)) fail('stale_previous_contract');
  }
  let currentArchitecture;
  try {
    currentArchitecture = loadArchitecture(rootDirectory);
  } catch {
    fail('architecture_policy_unavailable');
  }
  if (currentArchitecture.policyDigest !== envelope.architecture.policyDigest) fail('stale_architecture_policy');
  const unitIds = envelope.normalizedDemand.units.map((unit) => unit.id);
  if (unitIds.length !== new Set(unitIds).size) fail('duplicate_input_unit');
  const byteLength = Buffer.byteLength(envelope.normalizedDemand.text, 'utf8');
  if (!envelope.normalizedDemand.units.every((unit) => (
    unit.range.startByte < unit.range.endByte && unit.range.endByte <= byteLength
  ))) fail('invalid_input_range');
}

function validateRuleAssessments(envelope, assessments) {
  const candidates = envelope.architecture.candidateRules;
  exactIds(assessments.map((item) => item.ruleId), candidates.map((item) => item.id), 'architecture_assessment_incomplete');
  const unitIds = new Set(envelope.normalizedDemand.units.map((unit) => unit.id));
  if (!assessments.every((assessment) => assessment.sourceUnitIds.every((id) => unitIds.has(id)))) {
    fail('architecture_assessment_unknown_unit');
  }
}

function validateDecision(envelope, decision) {
  assertValidSchema('aegis.preflight_decision.v2', decision, 'malformed_decision');
  if (decision.contextDigest !== envelope.contextDigest) fail('decision_context_digest_mismatch');
  validateRuleAssessments(envelope, decision.ruleAssessments);
  const unitIds = new Set(envelope.normalizedDemand.units.map((unit) => unit.id));
  const sourceCollections = [
    ...decision.findings.map((item) => item.sourceUnitIds),
    ...decision.questions.map((item) => item.sourceUnitIds),
  ];
  if (!sourceCollections.every((ids) => ids.every((id) => unitIds.has(id)))) fail('decision_unknown_unit');
  const hardRuleIds = new Set(envelope.architecture.candidateRules.filter((rule) => rule.level === 'hard').map((rule) => rule.id));
  const hardConflict = decision.ruleAssessments.some((item) => item.verdict === 'CONFLICT' && hardRuleIds.has(item.ruleId));
  if (hardConflict && decision.status !== 'BLOCKED') fail('hard_conflict_not_blocked');
}

function validateClarifiedDemand(envelope, clarified, ruleAssessments) {
  assertValidSchema('aegis.clarified_demand.v2', clarified, 'malformed_clarified_demand');
  if (clarified.normalizedDemandDigest !== envelope.normalizedDemand.digest) fail('clarified_demand_digest_mismatch');
  if (clarified.architecture.policyDigest !== envelope.architecture.policyDigest) fail('clarified_architecture_digest_mismatch');
  if (canonicalJson(clarified.architecture.ruleAssessments) !== canonicalJson(ruleAssessments)) {
    fail('clarified_architecture_assessment_mismatch');
  }

  const inputUnitIds = envelope.normalizedDemand.units.map((unit) => unit.id);
  exactIds(clarified.inputCoverage.map((entry) => entry.unitId), inputUnitIds, 'input_coverage_incomplete');
  const requirements = new Map(clarified.requirements.map((requirement) => [requirement.id, requirement]));
  if (requirements.size !== clarified.requirements.length) fail('duplicate_requirement_id');
  for (const entry of clarified.inputCoverage) {
    if (entry.disposition === 'REQUIREMENT' && entry.requirementIds.length === 0) fail('requirement_unit_without_requirement');
    if (entry.disposition !== 'REQUIREMENT' && entry.requirementIds.length !== 0) fail('non_requirement_unit_with_requirement');
    if (!entry.requirementIds.every((id) => requirements.has(id))) fail('input_coverage_unknown_requirement');
  }
  const covered = new Set(clarified.inputCoverage.flatMap((entry) => entry.requirementIds));
  const sourceProvenance = new Set(['USER', 'SAFE_CORRECTION', 'USER_CLARIFICATION']);
  if (clarified.requirements.some((requirement) => sourceProvenance.has(requirement.provenance) && !covered.has(requirement.id))) {
    fail('source_requirement_without_input_coverage');
  }
}

function validateResolution(envelope, decisionFile, resolution) {
  assertValidSchema('aegis.preflight_resolution.v2', resolution, 'malformed_resolution');
  if (resolution.decisionDigest !== sha256(decisionFile.bytes)) fail('resolution_decision_digest_mismatch');
  if (resolution.preflightPromptDigest !== envelope.promptDigest) fail('resolution_prompt_digest_mismatch');
  exactIds(
    resolution.answers.map((answer) => answer.questionId),
    decisionFile.value.questions.map((question) => question.id),
    'resolution_answers_mismatch',
  );
}

function assembleClarifiedDemand(envelope, decision, body) {
  return {
    schema: 'aegis.clarified_demand.v2',
    normalizedDemandDigest: envelope.normalizedDemand.digest,
    ...body,
    architecture: {
      policyDigest: envelope.architecture.policyDigest,
      ruleAssessments: decision.ruleAssessments,
    },
  };
}

function assembleContract(envelope, decision, clarifiedDemand, body) {
  return {
    schema: 'aegis.contract_ir.v2',
    clarifiedDemandDigest: canonicalDigest(clarifiedDemand),
    architecture: {
      policyDigest: envelope.architecture.policyDigest,
      appliedRuleIds: decision.ruleAssessments
        .filter((assessment) => assessment.verdict === 'APPLIED')
        .map((assessment) => assessment.ruleId),
      amendmentIds: envelope.previousContract?.architecture.amendmentIds ?? [],
    },
    ...body,
  };
}

function validateIndependentReview(envelope, decisionFile, review) {
  assertValidSchema('aegis.preflight_review.v2', review, 'malformed_independent_review');
  if (review.normalizedDemandDigest !== envelope.normalizedDemand.digest) fail('review_demand_digest_mismatch');
  if (review.decisionDigest !== sha256(decisionFile.bytes)) fail('review_decision_digest_mismatch');
  if (review.producerId === review.reviewerId) fail('review_authority_not_independent');
  const unitIds = new Set(envelope.normalizedDemand.units.map((unit) => unit.id));
  if (!review.findings.every((finding) => finding.sourceUnitIds.every((id) => unitIds.has(id)))) fail('review_unknown_unit');
  if (review.verdict !== 'APPROVED') fail('independent_review_rejected');
}

async function persistSemanticState(clarifiedDemand, contract) {
  await mkdir(resolve(rootDirectory, '.harness'), { recursive: true });
  const clarifiedTemporaryPath = `${clarifiedDemandPath}.${process.pid}.tmp`;
  const contractTemporaryPath = `${activeContractPath}.${process.pid}.tmp`;
  await Promise.all([
    writeFile(clarifiedTemporaryPath, `${canonicalJson(clarifiedDemand)}\n`, 'utf8'),
    writeFile(contractTemporaryPath, `${canonicalJson(contract)}\n`, 'utf8'),
  ]);
  await rename(clarifiedTemporaryPath, clarifiedDemandPath);
  await rename(contractTemporaryPath, activeContractPath);
}

const options = parseArguments(process.argv.slice(2));
let envelope;
try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  envelope = JSON.parse(Buffer.concat(chunks).toString('utf8'));
} catch {
  fail('invalid_preflight_envelope');
}
validateEnvelope(envelope);

const decisionFile = await readJson(options.decision, 'unreadable_decision');
validateDecision(envelope, decisionFile.value);
if (options.independentReview.length > 0) {
  const review = await readJson(options.independentReview, 'unreadable_independent_review');
  validateIndependentReview(envelope, decisionFile, review.value);
}

if (decisionFile.value.status === 'BLOCKED') {
  process.stdout.write(`${JSON.stringify({ schema: 'aegis.preflight_finalization.v2', status: 'BLOCKED' })}\n`);
  process.exit(0);
}

let clarifiedDemandBody;
let contractBody;
let interpretationStatus = 'NOT_REQUIRED';
if (decisionFile.value.status === 'CLARIFIED') {
  if (options.resolution.length > 0) fail('resolution_not_allowed');
  clarifiedDemandBody = decisionFile.value.clarifiedDemandBody;
  contractBody = decisionFile.value.contractBody;
} else {
  if (options.resolution.length === 0) fail('resolution_required');
  const resolution = await readJson(options.resolution, 'unreadable_resolution');
  validateResolution(envelope, decisionFile, resolution.value);
  const corrections = resolution.value.answers.filter((answer) => answer.action === 'CORRECT_INTERPRETATION');
  if (corrections.length > 0) {
    process.stdout.write(`${JSON.stringify({
      schema: 'aegis.preflight_finalization.v2',
      status: 'SEMANTIC_REVISION_REQUIRED',
      corrections: corrections.map((answer) => ({ questionId: answer.questionId, correction: answer.correction })),
    })}\n`);
    process.exit(0);
  }
  clarifiedDemandBody = decisionFile.value.provisionalClarifiedDemandBody;
  contractBody = decisionFile.value.provisionalContractBody;
  interpretationStatus = 'INTERPRETATION_CONFIRMED';
}

const clarifiedDemand = assembleClarifiedDemand(envelope, decisionFile.value, clarifiedDemandBody);
validateClarifiedDemand(envelope, clarifiedDemand, decisionFile.value.ruleAssessments);
const contract = assembleContract(envelope, decisionFile.value, clarifiedDemand, contractBody);
let policyText;
let policy;
try {
  policyText = await readFile(resolve(rootDirectory, 'governance/architecture.policy.json'), 'utf8');
  policy = JSON.parse(policyText);
} catch {
  fail('architecture_policy_unavailable');
}
try {
  validateContract({
    root: rootDirectory,
    contract,
    clarified: clarifiedDemand,
    policy,
    policyText,
    previousContract: envelope.previousContract,
    phase: 'compile',
  });
} catch (error) {
  fail(error instanceof Error ? error.message : 'contract_validation_failed');
}
try {
  await persistSemanticState(clarifiedDemand, contract);
} catch {
  fail('semantic_state_persistence_failed');
}
process.stdout.write(`${JSON.stringify({
  schema: 'aegis.preflight_finalization.v2',
  status: 'SEMANTIC_STATE_PERSISTED',
  executionId: envelope.executionId,
  baseCommit: envelope.baseCommit,
  interpretationStatus,
  clarifiedDemandDigest: canonicalDigest(clarifiedDemand),
  contractDigest: canonicalDigest(contract),
  timing: {
    phase: 'finalization',
    startedAtEpochMs,
    durationMs: Math.round((performance.now() - started) * 1000) / 1000,
  },
  paths: ['.harness/active_clarified_demand.json', '.harness/active_contract_ir.json'],
})}\n`);

#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
import { existsSync, lstatSync } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { canonicalDigest, canonicalJson, sha256 } from './lib/canonical_json.mjs';
import { validateContract } from './lib/contract_validator.mjs';
import { loadArchitecture, loadArchitecturePolicy, loadPreviousEvidence, repositorySnapshot } from './lib/preflight_core.mjs';
import { questionId, questionIds, resolvePreflightDecision, selectedAnswer } from './lib/preflight_resolution.mjs';
import { assertSchema } from './lib/schema_validator.mjs';
import { semanticStatePath, semanticStateRelativePath } from './lib/semantic_state.mjs';

const rootDirectory = resolve(process.env.AEGIS_ROOT ?? fileURLToPath(new URL('..', import.meta.url)));
const evidenceDirectory = resolve(rootDirectory, 'src/.aegis');
const semanticStateFile = semanticStatePath(rootDirectory);
const runtimeDirectory = resolve(rootDirectory, '.harness/runtime');
const writeLockDirectory = resolve(runtimeDirectory, 'preflight-write.lock');
const evidenceScope = [semanticStateRelativePath];
const startedAtEpochMs = Date.now();
const started = performance.now();
const MAX_ENVELOPE_BYTES = 128 * 1024;
const MAX_ARTIFACT_BYTES = 256 * 1024;
const WRITE_LOCK_STALE_MS = 120_000;

function fail(code) {
  process.stderr.write(`[AEGIS][PREFLIGHT][FATAL] ${code}\n`);
  process.exit(1);
}

function canonicalRepositoryPath(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.startsWith('/')
    || value.includes('\\')
    || value.split('/').some((part) => part.length === 0 || part === '.' || part === '..')
  ) {
    fail('non_canonical_repository_path');
  }
  return value;
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
    if (key === undefined || value === undefined || options[key].length > 0) fail('invalid_arguments');
    options[key] = canonicalRepositoryPath(value);
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
  if (bytes.length > MAX_ARTIFACT_BYTES) fail('preflight_artifact_budget_exceeded');
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
  if (JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) fail(code);
}

function ids(prefix, length) {
  return Array.from({ length }, (_, index) => `${prefix}-${String(index + 1).padStart(4, '0')}`);
}

function proofId(coverageKey) {
  const suffix = coverageKey.toUpperCase().replace(/[^A-Z0-9]+/gu, '-').replace(/^-|-$/gu, '');
  if (suffix.length === 0) fail('invalid_proof_coverage_key');
  return `PO-${suffix}`;
}

function unitIds(envelope, indexes, code) {
  const units = envelope.normalizedDemand.units;
  if (!indexes.every((index) => Number.isInteger(index) && index >= 0 && index < units.length)) fail(code);
  return indexes.map((index) => units[index].id);
}

function requireIndexes(indexes, length, code) {
  if (!indexes.every((index) => Number.isInteger(index) && index >= 0 && index < length)) fail(code);
}

function validateEnvelope(envelope) {
  assertValidSchema('aegis.ide_preflight.v2', envelope, 'malformed_preflight_envelope');
  if (envelope.baseCommit !== envelope.baseline.commit) fail('baseline_commit_mismatch');
  if (sha256(envelope.normalizedDemand.text) !== envelope.normalizedDemand.digest) fail('normalized_demand_digest_mismatch');
  const { digest, ...factBody } = envelope.mechanicalFacts;
  if (canonicalDigest(factBody) !== digest) fail('mechanical_facts_digest_mismatch');
  if (sha256(envelope.prompt) !== envelope.promptDigest) fail('preflight_prompt_digest_mismatch');
  const expectedContextDigest = canonicalDigest({
    changeKind: envelope.changeKind,
    baseline: envelope.baseline,
    normalizedDemandDigest: envelope.normalizedDemand.digest,
    mechanicalFactsDigest: envelope.mechanicalFacts.digest,
    architecturePolicyDigest: envelope.architecture.policyDigest,
    previousContractDigest: envelope.previousContractDigest,
    constitutionDigest: envelope.constitutionDigest,
    promptTemplateDigest: envelope.promptTemplateDigest,
    semanticProtocolDigest: envelope.semanticProtocolDigest,
  });
  if (expectedContextDigest !== envelope.contextDigest) fail('preflight_context_digest_mismatch');
  assertWorldMatches(envelope);
  const unitIdsInEnvelope = envelope.normalizedDemand.units.map((unit) => unit.id);
  if (unitIdsInEnvelope.length !== new Set(unitIdsInEnvelope).size) fail('duplicate_input_unit');
  const length = Buffer.byteLength(envelope.normalizedDemand.text, 'utf8');
  if (!envelope.normalizedDemand.units.every((unit) => unit.range.startByte < unit.range.endByte && unit.range.endByte <= length)) {
    fail('invalid_input_range');
  }
}

function assertWorldMatches(envelope) {
  const currentBaseline = repositorySnapshot(rootDirectory);
  if (!currentBaseline.clean || canonicalJson(currentBaseline) !== canonicalJson(envelope.baseline)) fail('preflight_baseline_changed');
  let evidence;
  try {
    evidence = loadPreviousEvidence(rootDirectory, currentBaseline.commit);
  } catch (error) {
    fail(error instanceof Error ? error.message : 'invalid_previous_contract');
  }
  if (envelope.previousContract === null) {
    if (envelope.previousContractDigest !== null || evidence !== null) fail('previous_contract_mismatch');
  } else {
    if (canonicalDigest(envelope.previousContract) !== envelope.previousContractDigest) fail('previous_contract_digest_mismatch');
    const activeContract = evidence?.contract;
    if (activeContract === undefined) fail('previous_contract_mismatch');
    if (canonicalJson(activeContract) !== canonicalJson(envelope.previousContract)) fail('stale_previous_contract');
  }
  let currentArchitecture;
  try {
    currentArchitecture = loadArchitecture(rootDirectory);
  } catch {
    fail('architecture_policy_unavailable');
  }
  if (currentArchitecture.policyDigest !== envelope.architecture.policyDigest) fail('stale_architecture_policy');
}

function ruleAssessments(envelope, decision) {
  const assessments = decision.rules.map(([ruleId, verdict, evidence, indexes]) => ({
    ruleId,
    verdict,
    evidence,
    sourceUnitIds: unitIds(envelope, indexes, 'architecture_assessment_unknown_unit'),
  }));
  exactIds(
    assessments.map((item) => item.ruleId),
    envelope.architecture.candidateRules.map((item) => item.id),
    'architecture_assessment_incomplete',
  );
  return assessments;
}

function questionCoversUnits(decision, unitIndexes, scope) {
  const expected = new Set(unitIndexes);
  return decision.questions.some((question) => (
    (scope === undefined || question[0] === scope)
    && question[6].some((index) => expected.has(index))
  ));
}

function reconciliationFindings(envelope, decision, assessments) {
  const findings = [];
  const unitIndexById = new Map(envelope.normalizedDemand.units.map((unit, index) => [unit.id, index]));
  const assessmentById = new Map(assessments.map((assessment) => [assessment.ruleId, assessment]));

  for (const rule of envelope.architecture.candidateRules) {
    if (rule.level !== 'hard' || (rule.forbiddenReferences ?? []).length === 0) continue;
    const signalUnits = envelope.mechanicalFacts.references
      .filter((reference) => (rule.forbiddenReferences ?? []).includes(reference.value))
      .map((reference) => unitIndexById.get(reference.unitId))
      .filter((index) => index !== undefined);
    if (signalUnits.length === 0 || decision.status === 'BLOCKED') continue;
    if (decision.status !== 'NEEDS_CONFIRMATION') {
      findings.push({ code: 'hard_reference_requires_confirmation', ruleId: rule.id, unitIndexes: signalUnits });
      continue;
    }
    if (assessmentById.get(rule.id)?.verdict !== 'APPLIED') {
      findings.push({ code: 'hard_reference_requires_safe_interpretation', ruleId: rule.id, unitIndexes: signalUnits });
    }
    if (!questionCoversUnits(decision, signalUnits, 'ARCHITECTURE')) {
      findings.push({ code: 'hard_reference_question_missing', ruleId: rule.id, unitIndexes: signalUnits });
    }
  }

  return findings;
}

function validateScopeAndProofPaths(envelope, decision) {
  const scope = new Set(decision.scope.map(canonicalRepositoryPath));
  const withinScope = (path) => [...scope].some((declared) => path === declared || path.startsWith(`${declared}/`));
  if (envelope.changeKind === 'PRODUCT' && decision.scope.some((path) => path !== 'src' && !path.startsWith('src/'))) {
    fail('product_scope_outside_src');
  }
  for (const proof of decision.proofs) {
    const entrypoint = canonicalRepositoryPath(proof[4]);
    const targets = proof[5].map(canonicalRepositoryPath);
    if (!withinScope(entrypoint) || !targets.every(withinScope)) fail('proof_path_outside_scope');
  }
}

function validateStateModel(envelope, decision) {
  if (decision.status === 'BLOCKED') return { requiresIndependentReview: false };
  const { stateModel } = decision;
  if (stateModel.kind === 'NONE') {
    if (stateModel.bindings.length !== 0) fail('invalid_stateless_state_model');
    return { requiresIndependentReview: false };
  }

  const roles = stateModel.bindings.map(([role]) => role);
  if (roles.length !== new Set(roles).size) fail('duplicate_state_model_role');
  for (const [, , requirementIndexes, sourceIndexes] of stateModel.bindings) {
    requireIndexes(requirementIndexes, decision.requirements.length, 'state_model_unknown_requirement');
    unitIds(envelope, sourceIndexes, 'state_model_unknown_unit');
  }
  for (const role of ['STATE', 'COMMAND', 'RESULT', 'ATOMICITY']) {
    if (!roles.includes(role)) fail(`state_model_role_missing:${role.toLowerCase()}`);
  }
  const highRisk = roles.includes('ATOMICITY')
    && ['RESOURCE', 'TEMPORAL', 'IDENTITY', 'CANONICALIZATION'].some((role) => roles.includes(role));
  if (highRisk && decision.riskProfile !== 'forensic') fail('state_transition_requires_forensic');
  return { requiresIndependentReview: decision.riskProfile === 'forensic' };
}

function normalizedLiteral(value) {
  return value.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

function hasVerbatimUnitEvidence(envelope, sourceIndexes, statement) {
  const literal = normalizedLiteral(statement);
  return sourceIndexes.some((index) => normalizedLiteral(envelope.normalizedDemand.units[index].text).includes(literal));
}

function validateStateSemantics(envelope, decision, clarificationRoles = new Set()) {
  const roles = decision.stateModel.bindings.map(([role]) => role);
  if (decision.stateModel.kind === 'NONE') {
    if (decision.stateSemantics.length !== 0) fail('stateless_state_semantics_not_empty');
    return;
  }
  exactIds(
    decision.stateSemantics.map(([role]) => role),
    roles,
    'state_semantics_incomplete',
  );
  const bindingByRole = new Map(decision.stateModel.bindings.map(([role, statement]) => [role, statement]));
  for (const [role, disposition, statement, sourceIndexes] of decision.stateSemantics) {
    unitIds(envelope, sourceIndexes, 'state_semantics_unknown_unit');
    if (disposition === 'EXPLICIT' && statement.trim() === bindingByRole.get(role)?.trim()) {
      fail(`state_semantics_policy_not_refined:${role.toLowerCase()}`);
    }
    if (disposition === 'EXPLICIT' && !clarificationRoles.has(role) && !hasVerbatimUnitEvidence(envelope, sourceIndexes, statement)) {
      fail(`state_semantics_policy_not_verbatim:${role.toLowerCase()}`);
    }
    if (disposition !== 'QUESTION_REQUIRED') continue;
    if (decision.status !== 'NEEDS_CONFIRMATION' || !questionCoversUnits(decision, sourceIndexes)) {
      fail('state_semantics_question_missing');
    }
  }
  if (decision.status === 'CLARIFIED' && decision.stateSemantics.some(([, disposition]) => disposition !== 'EXPLICIT')) {
    fail('clarified_state_semantics_not_explicit');
  }
}

function validateQuestionChoices(envelope, decision) {
  for (const question of decision.questions) {
    const answerIds = question[7].map(([id]) => id);
    if (answerIds.length !== new Set(answerIds).size || !answerIds.includes(question[4])) {
      fail('question_answer_set_invalid');
    }
    const questionUnits = new Set(question[6]);
    const requiredRoles = decision.stateSemantics
      .filter(([, disposition, , sourceIndexes]) => disposition === 'QUESTION_REQUIRED' && sourceIndexes.some((index) => questionUnits.has(index)))
      .map(([role]) => role);
    for (const [, , , , policies] of question[7]) {
      const roles = policies.map(([role]) => role);
      if (roles.length !== new Set(roles).size) fail('question_answer_state_policy_duplicate');
      exactIds(roles, requiredRoles, 'question_answer_state_policy_coverage_invalid');
    }
  }
}

function validateDecision(envelope, decision, clarificationRoles = new Set(), userConfirmed = false) {
  assertValidSchema('aegis.preflight_decision.v2', decision, 'malformed_decision');
  if (decision.contextDigest !== envelope.contextDigest) fail('decision_context_digest_mismatch');
  if (decision.promptDigest !== envelope.promptDigest) fail('decision_prompt_digest_mismatch');
  const assessments = ruleAssessments(envelope, decision);
  for (const question of decision.questions) unitIds(envelope, question[6], 'decision_unknown_unit');
  if (decision.status === 'BLOCKED') return { assessments, stateProfile: { requiresIndependentReview: false } };
  validateQuestionChoices(envelope, decision);
  validateScopeAndProofPaths(envelope, decision);
  const hardRules = new Set(envelope.architecture.candidateRules.filter((rule) => rule.level === 'hard').map((rule) => rule.id));
  if (assessments.some((item) => item.verdict === 'CONFLICT' && hardRules.has(item.ruleId)) && decision.status !== 'BLOCKED') {
    fail('hard_conflict_not_blocked');
  }
  const stateProfile = validateStateModel(envelope, decision);
  validateStateSemantics(envelope, decision, clarificationRoles);
  const hardRisk = assessments.filter((item) => item.verdict === 'APPLIED' && hardRules.has(item.ruleId)).length >= 2;
  if (decision.riskProfile === 'forensic' && !decision.proofs.some((proof) => proof[7] === 'forensic')) {
    fail('forensic_profile_requires_forensic_proof');
  }
  if (hardRisk && decision.riskProfile !== 'forensic') fail('hard_risk_requires_forensic');
  if (stateProfile.requiresIndependentReview && decision.status === 'CLARIFIED' && !userConfirmed) {
    fail('forensic_user_confirmation_required');
  }
  return { assessments, stateProfile };
}

function assembleSemanticState(envelope, decision, assessments, independentReviewDigest, clarifications, clarificationRoles) {
  if (decision.proofs.length > 10) fail('proof_profile_budget_exceeded');
  const requirementIds = ids('REQ', decision.requirements.length);
  const behaviorIds = ids('BEH', decision.behaviors.length);
  const preconditionIds = ids('PRE', decision.preconditions.length);
  const invariantIds = ids('INV', decision.invariants.length);
  const postconditionIds = ids('POST', decision.postconditions.length);
  const failureIds = ids('FAIL', decision.failures.length);
  const proofIds = decision.proofs.map((proof) => proofId(proof[0]));
  if (proofIds.length !== new Set(proofIds).size) fail('duplicate_proof_coverage_key');

  const inputCoverage = new Map();
  const persistedClarifications = clarifications.map(({ questionId, answerId, recommended, statement }) => ({
    questionId,
    answerId,
    recommended,
    statement,
  }));
  for (let requirementIndex = 0; requirementIndex < decision.requirements.length; requirementIndex += 1) {
    const unitIndexes = decision.requirements[requirementIndex][2];
    const provenance = decision.requirements[requirementIndex][1];
    if (['USER', 'SAFE_CORRECTION', 'USER_CLARIFICATION'].includes(provenance) && unitIndexes.length === 0) {
      fail('source_requirement_without_input_coverage');
    }
    for (const unitId of unitIds(envelope, unitIndexes, 'requirement_unknown_unit')) {
      const current = inputCoverage.get(unitId) ?? [];
      current.push(requirementIds[requirementIndex]);
      inputCoverage.set(unitId, current);
    }
  }
  const contextIndexes = decision.contextUnits.map(([unitIndex]) => unitIndex);
  if (contextIndexes.length !== new Set(contextIndexes).size) fail('input_unit_multiply_classified');
  for (const [unitIndex, disposition, rationale] of decision.contextUnits) {
    const [unitId] = unitIds(envelope, [unitIndex], 'context_unknown_unit');
    if (inputCoverage.has(unitId)) fail('input_unit_multiply_classified');
    inputCoverage.set(unitId, { disposition, rationale });
  }
  exactIds([...inputCoverage.keys()], envelope.normalizedDemand.units.map((unit) => unit.id), 'input_coverage_incomplete');

  const requirementCoverage = requirementIds.map((requirementId) => ({ requirementId, contractIds: [] }));
  const addCoverage = (clauseIds, clauses, requirementIndexPosition) => {
    clauses.forEach((clause, clauseIndex) => {
      requireIndexes(clause[requirementIndexPosition], requirementIds.length, 'contract_unknown_requirement');
      clause[requirementIndexPosition].forEach((requirementIndex) => requirementCoverage[requirementIndex].contractIds.push(clauseIds[clauseIndex]));
    });
  };
  addCoverage(behaviorIds, decision.behaviors, 1);
  addCoverage(preconditionIds, decision.preconditions, 1);
  addCoverage(invariantIds, decision.invariants, 1);
  addCoverage(postconditionIds, decision.postconditions, 1);
  addCoverage(failureIds, decision.failures, 2);
  addCoverage(proofIds, decision.proofs, 3);
  if (decision.proofs.some((proof) => proof[3].length === 0)) fail('proof_without_requirement');
  if (requirementCoverage.some((entry) => entry.contractIds.length === 0)) fail('requirement_without_contract_coverage');
  if (requirementCoverage.some((entry) => !entry.contractIds.some((id) => id.startsWith('PO-')))) fail('requirement_without_proof');

  decision.invariants.forEach((invariant) => {
    requireIndexes(invariant[2], proofIds.length, 'invariant_unknown_proof');
    if (invariant[2].length === 0) fail('invariant_without_proof');
  });
  const clarifiedDemand = {
    schema: 'aegis.clarified_demand.v2',
    changeKind: envelope.changeKind,
    normalizedDemandDigest: envelope.normalizedDemand.digest,
    intent: decision.intent,
    requirements: decision.requirements.map(([statement, provenance], index) => ({ id: requirementIds[index], statement, provenance })),
    scope: { included: [...new Set([...decision.scope, ...evidenceScope])], excluded: decision.excluded },
    inputCoverage: envelope.normalizedDemand.units.map((unit) => {
      const coverage = inputCoverage.get(unit.id);
      if (Array.isArray(coverage)) {
        return { unitId: unit.id, disposition: 'REQUIREMENT', requirementIds: coverage, rationale: 'mapped_by_semantic_compiler' };
      }
      return { unitId: unit.id, disposition: coverage.disposition, requirementIds: [], rationale: coverage.rationale };
    }),
    architecture: { policyDigest: envelope.architecture.policyDigest, ruleAssessments: assessments },
    clarifications: persistedClarifications,
    acceptanceCriteria: decision.acceptance,
    failureSemantics: decision.failures.map(([trigger, observableOutcome], index) => ({ id: failureIds[index], trigger, observableOutcome })),
  };

  const continuity = {
    retirements: decision.continuity.retirements.map(([kind, id, reason, demandEvidence, successor]) => ({
      kind, id, reason, demandEvidence, ...(successor === null ? {} : { successor }),
    })),
    proofChanges: decision.continuity.proofChanges.map(([id, reason, demandEvidence]) => ({ id, reason, demandEvidence })),
  };
  const stateModel = {
    kind: decision.stateModel.kind,
    bindings: decision.stateModel.bindings.map(([role, statement, requirementIndexes]) => ({
      role,
      statement,
      requirementIds: requirementIndexes.map((index) => requirementIds[index]),
    })),
    policies: decision.stateSemantics.map(([role, disposition, statement, sourceIndexes]) => ({
      role,
      provenance: clarificationRoles.has(role) || disposition === 'QUESTION_REQUIRED' ? 'USER_CLARIFICATION' : 'USER',
      statement,
      sourceUnitIds: unitIds(envelope, sourceIndexes, 'state_semantics_unknown_unit'),
    })),
  };
  const statements = (clauses, clauseIds) => clauses.map(([statement], index) => ({ id: clauseIds[index], statement }));
  const contract = {
    schema: 'aegis.contract_ir.v2',
    changeKind: envelope.changeKind,
    clarifiedDemandDigest: canonicalDigest(clarifiedDemand),
    architecture: {
      policyDigest: envelope.architecture.policyDigest,
      appliedRuleIds: assessments.filter((assessment) => assessment.verdict === 'APPLIED').map((assessment) => assessment.ruleId),
      amendmentIds: envelope.previousContract?.architecture.amendmentIds ?? [],
    },
    verification: {
      riskProfile: decision.riskProfile,
      ...(independentReviewDigest === null ? {} : { independentReviewDigest }),
    },
    stateModel,
    clarifications: persistedClarifications,
    scope: { authorizedPaths: [...new Set([...decision.scope, ...evidenceScope])] },
    behavior: statements(decision.behaviors, behaviorIds),
    preconditions: statements(decision.preconditions, preconditionIds),
    invariants: decision.invariants.map(([statement, , proofIndexes], index) => ({
      id: invariantIds[index], statement, proofIds: proofIndexes.map((proofIndex) => proofIds[proofIndex]),
    })),
    postconditions: statements(decision.postconditions, postconditionIds),
    failureSemantics: decision.failures.map(([trigger, observableOutcome], index) => ({
      id: failureIds[index], statement: `${trigger} => ${observableOutcome}`,
    })),
    proofObligations: decision.proofs.map(([, risk, statement], index) => ({ id: proofIds[index], risk, statement })),
    requirementCoverage,
    continuity,
  };

  const rank = { always: 0, targeted: 1, release: 2, forensic: 3 };
  const profiles = ['fast', 'targeted', 'release', 'forensic'].map((id, profileRank) => ({
    id,
    proofIds: decision.proofs.flatMap((proof, index) => rank[proof[7]] <= profileRank ? [proofIds[index]] : []),
  }));
  if (profiles.some((profile) => profile.proofIds.length === 0)) fail('proof_profile_without_baseline_proof');
  const proofs = decision.proofs.map(([coverageKey, risk, , , entrypoint, targets, cost, cadence], index) => ({
    id: proofIds[index],
    risk,
    coverageKey,
    authority: 'deterministic_tribunal',
    cost,
    cadence,
    status: 'active',
    targets: [...new Set([...targets, entrypoint])],
    executionKey: `proof-${sha256(entrypoint).slice(0, 12)}`,
    executor: entrypoint.endsWith('.ts') ? 'node' : 'bash',
    argv: entrypoint.endsWith('.ts') ? ['--import', 'tsx', entrypoint] : [entrypoint],
  }));
  const proofRegistry = {
    schema: 'aegis.proof_registry.v1',
    policy: { mode: 'enforced', maxActiveProofsPerProfile: { fast: 10, targeted: 10, release: 10, forensic: 10 } },
    profiles,
    proofs,
  };
  return { clarifiedDemand, contract, proofRegistry };
}

function validateResolution(envelope, decisionFile, resolution) {
  assertValidSchema('aegis.preflight_resolution.v2', resolution, 'malformed_resolution');
  if (resolution.decisionDigest !== sha256(decisionFile.bytes)) fail('resolution_decision_digest_mismatch');
  if (resolution.preflightPromptDigest !== envelope.promptDigest) fail('resolution_prompt_digest_mismatch');
  exactIds(
    resolution.answers.map((answer) => answer.questionId),
    questionIds(decisionFile.value),
    'resolution_answers_mismatch',
  );
  for (const answer of resolution.answers) {
    if (answer.action !== 'SELECT_ANSWER') continue;
    const index = questionIds(decisionFile.value).indexOf(answer.questionId);
    if (index < 0 || selectedAnswer(decisionFile.value.questions[index], answer.answerId) === undefined) {
      fail(`resolution_unknown_answer:${answer.questionId}`);
    }
  }
}

function reviewBinding(request) {
  return {
    schema: request.schema,
    status: request.status,
    normalizedDemandDigest: request.normalizedDemandDigest,
    decisionDigest: request.decisionDigest,
    producerId: request.producerId,
    reviewerId: request.reviewerId,
    producerExecutionId: request.producerExecutionId,
    reviewExecutionId: request.reviewExecutionId,
  };
}

async function validateIndependentReview(envelope, decision, review, decisionDigest, clarificationRoles = new Set()) {
  assertValidSchema('aegis.preflight_review.v2', review, 'malformed_independent_review');
  const requestFile = await readJson('.harness/runtime/preflight_review_request.json', 'missing_independent_review_request');
  assertValidSchema('aegis.preflight_review_request.v2', requestFile.value, 'malformed_independent_review_request');
  const request = requestFile.value;
  if (request.reviewRequestDigest !== canonicalDigest(reviewBinding(request))) fail('review_request_digest_mismatch');
  if (request.normalizedDemandDigest !== envelope.normalizedDemand.digest) fail('review_request_demand_digest_mismatch');
  if (request.decisionDigest !== decisionDigest) fail('review_request_decision_digest_mismatch');
  if (request.producerExecutionId !== envelope.executionId || request.producerExecutionId === request.reviewExecutionId) {
    fail('review_execution_identity_invalid');
  }
  if (
    review.producerId !== request.producerId
    || review.reviewerId !== request.reviewerId
    || review.producerExecutionId !== request.producerExecutionId
    || review.reviewExecutionId !== request.reviewExecutionId
    || review.reviewRequestDigest !== request.reviewRequestDigest
  ) {
    fail('review_request_binding_mismatch');
  }
  if (review.normalizedDemandDigest !== envelope.normalizedDemand.digest) fail('review_demand_digest_mismatch');
  if (review.decisionDigest !== decisionDigest) fail('review_decision_digest_mismatch');
  if (review.producerId === review.reviewerId) fail('review_authority_not_independent');
  const knownUnits = new Set(envelope.normalizedDemand.units.map((unit) => unit.id));
  if (!review.findings.every((finding) => finding.sourceUnitIds.every((id) => knownUnits.has(id)))) fail('review_unknown_unit');
  const expectedRoles = decision.stateModel.bindings.map(([role]) => role);
  exactIds(
    review.stateSemantics.map(([role]) => role),
    expectedRoles,
    'review_state_semantics_incomplete',
  );
  if (!review.stateSemantics.every(([, , , sourceUnitIds]) => sourceUnitIds.every((id) => knownUnits.has(id)))) {
    fail('review_state_semantics_unknown_unit');
  }
  if (review.verdict === 'APPROVED') {
    const decisionDispositions = new Map(
      decision.stateSemantics.map(([role, disposition]) => [role, disposition]),
    );
    if (review.stateSemantics.some(([role, verdict]) => decisionDispositions.get(role) !== verdict)) {
      fail('review_state_semantics_mismatch');
    }
  }
  const decisionPolicyByRole = new Map(decision.stateSemantics.map(([role, , statement]) => [role, statement]));
  for (const [role, verdict, evidence, sourceUnitIds] of review.stateSemantics) {
    if (verdict === 'CONFLICT') fail(`review_state_semantics_conflict:${role.toLowerCase()}`);
    if (verdict === 'EXPLICIT') {
      if (normalizedLiteral(evidence) !== normalizedLiteral(decisionPolicyByRole.get(role) ?? '')) {
        fail(`review_state_semantics_evidence_mismatch:${role.toLowerCase()}`);
      }
      const sourceIndexes = sourceUnitIds
        .map((unitId) => envelope.normalizedDemand.units.findIndex((unit) => unit.id === unitId))
        .filter((index) => index >= 0);
      if (!clarificationRoles.has(role) && !hasVerbatimUnitEvidence(envelope, sourceIndexes, evidence)) {
        fail(`review_state_semantics_evidence_not_verbatim:${role.toLowerCase()}`);
      }
    }
    if (verdict === 'QUESTION_REQUIRED') {
      const indexes = sourceUnitIds
        .map((unitId) => envelope.normalizedDemand.units.findIndex((unit) => unit.id === unitId))
        .filter((index) => index >= 0);
      if (decision.status !== 'NEEDS_CONFIRMATION' || !questionCoversUnits(decision, indexes)) {
        fail(`review_state_semantics_question_missing:${role.toLowerCase()}`);
      }
    }
  }
  if (review.verdict !== 'APPROVED') fail('independent_review_rejected');
}

async function readBoundedEnvelope() {
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    total += chunk.length;
    if (total > MAX_ENVELOPE_BYTES) fail('preflight_envelope_budget_exceeded');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    fail('invalid_preflight_envelope');
  }
}

async function writeAtomicJson(path, value) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  let handle;
  try {
    handle = await open(temporaryPath, 'w', 0o600);
    await handle.writeFile(`${canonicalJson(value)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, path);
  } catch (error) {
    await handle?.close().catch(() => {});
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function withWriteGate(action) {
  await mkdir(runtimeDirectory, { recursive: true });
  try {
    await mkdir(writeLockDirectory);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    let age = 0;
    try {
      age = Date.now() - (await stat(writeLockDirectory)).mtimeMs;
    } catch {
      age = 0;
    }
    if (age < WRITE_LOCK_STALE_MS) fail('preflight_write_gate_busy');
    await rm(writeLockDirectory, { recursive: true, force: true });
    try { await mkdir(writeLockDirectory); } catch { fail('preflight_write_gate_busy'); }
  }
  try {
    await writeFile(resolve(writeLockDirectory, 'owner.json'), `${JSON.stringify({ pid: process.pid, startedAtEpochMs: Date.now() })}\n`, 'utf8');
    return await action();
  } finally {
    await rm(writeLockDirectory, { recursive: true, force: true });
  }
}

async function persistSemanticState(clarifiedDemand, contract, proofRegistry) {
  await mkdir(evidenceDirectory, { recursive: true });
  const semanticState = {
    schema: 'aegis.semantic_state.v1',
    clarifiedDemand,
    contract,
    proofRegistry,
    digests: {
      clarifiedDemandSemanticDigest: canonicalDigest(clarifiedDemand),
      contractSemanticDigest: canonicalDigest(contract),
      proofRegistrySemanticDigest: canonicalDigest(proofRegistry),
    },
  };
  await writeAtomicJson(semanticStateFile, semanticState);
  return semanticState;
}

const options = parseArguments(process.argv.slice(2));
const envelope = await readBoundedEnvelope();
validateEnvelope(envelope);

const decisionFile = await readJson(options.decision, 'unreadable_decision');
const decisionDigest = sha256(decisionFile.bytes);
const sourceValidation = validateDecision(envelope, decisionFile.value);
const { assessments } = sourceValidation;
if (decisionFile.value.status === 'BLOCKED') {
  process.stdout.write(`${JSON.stringify({ schema: 'aegis.preflight_finalization.v2', status: 'BLOCKED' })}\n`);
  process.exit(0);
}
const reconciliation = reconciliationFindings(envelope, decisionFile.value, assessments);
if (reconciliation.length > 0) {
  process.stdout.write(`${JSON.stringify({
    schema: 'aegis.preflight_finalization.v2',
    status: 'SEMANTIC_REVISION_REQUIRED',
    corrections: reconciliation,
  })}\n`);
  process.exit(0);
}
if (decisionFile.value.status === 'NEEDS_CONFIRMATION' && options.resolution.length === 0) {
  process.stdout.write(`${JSON.stringify({
    schema: 'aegis.preflight_finalization.v2',
    status: 'USER_CONFIRMATION_REQUIRED',
    questions: decisionFile.value.questions.map(([scope, question, evidence, impact, recommendedAnswerId, interpreted, , answers], index) => ({
      id: questionId(index),
      scope,
      question,
      evidence,
      impact,
      interpreted,
      recommendedAnswerId,
      answers: answers.map(([id, label, rationale]) => ({ id, label, rationale, recommended: id === recommendedAnswerId })),
    })),
  })}\n`);
  process.exit(0);
}
let interpretationStatus = 'NOT_REQUIRED';
let resolvedDecision = decisionFile.value;
let clarifications = [];
let clarificationRoles = new Set();
if (decisionFile.value.status === 'CLARIFIED') {
  if (options.resolution.length > 0) fail('resolution_not_allowed');
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
  try {
    ({ decision: resolvedDecision, clarifications, clarificationRoles } = resolvePreflightDecision(decisionFile.value, resolution.value));
  } catch (error) {
    fail(error instanceof Error ? error.message : 'resolution_invalid');
  }
  validateDecision(envelope, resolvedDecision, clarificationRoles, clarifications.length > 0);
  interpretationStatus = 'INTERPRETATION_CONFIRMED';
}

const effectiveDecisionDigest = resolvedDecision === decisionFile.value ? decisionDigest : canonicalDigest(resolvedDecision);
const effectiveValidation = resolvedDecision === decisionFile.value
  ? sourceValidation
  : validateDecision(envelope, resolvedDecision, clarificationRoles, clarifications.length > 0);
let independentReviewDigest = null;
if (effectiveValidation.stateProfile.requiresIndependentReview && options.independentReview.length === 0) {
  fail('independent_review_required_for_forensic');
}
if (options.independentReview.length > 0) {
  const review = await readJson(options.independentReview, 'unreadable_independent_review');
  await validateIndependentReview(envelope, resolvedDecision, review.value, effectiveDecisionDigest, clarificationRoles);
  independentReviewDigest = sha256(review.bytes);
}

const { clarifiedDemand, contract, proofRegistry } = assembleSemanticState(
  envelope,
  resolvedDecision,
  assessments,
  independentReviewDigest,
  clarifications,
  clarificationRoles,
);
let semanticState;
try {
  semanticState = await withWriteGate(async () => {
    assertWorldMatches(envelope);
    let architecturePolicy;
    try {
      architecturePolicy = loadArchitecturePolicy(rootDirectory, envelope.baseline.commit);
    } catch {
      fail('architecture_policy_unavailable');
    }
    const { policy, policyText } = architecturePolicy;
    validateContract({ root: rootDirectory, contract, clarified: clarifiedDemand, policy, policyText, previousContract: envelope.previousContract, phase: 'compile' });
    return persistSemanticState(clarifiedDemand, contract, proofRegistry);
  });
} catch (error) {
  if (error instanceof Error && error.message.startsWith('preflight_')) fail(error.message);
  fail('semantic_state_persistence_failed');
}
const result = {
  schema: 'aegis.preflight_finalization.v2',
  status: 'SEMANTIC_STATE_PERSISTED',
  executionId: envelope.executionId,
  baseCommit: envelope.baseCommit,
  changeKind: envelope.changeKind,
  interpretationStatus,
  clarifiedDemandDigest: canonicalDigest(clarifiedDemand),
  contractDigest: canonicalDigest(contract),
  proofRegistryDigest: canonicalDigest(proofRegistry),
  semanticStateDigest: canonicalDigest(semanticState),
  semantic: {
    reconciler: 'structural_reconciliation.v2',
    decisionArtifactBytesDigest: decisionDigest,
    decisionSemanticDigest: effectiveDecisionDigest,
    independentReviewDigest,
  },
  timing: { phase: 'finalization', startedAtEpochMs, durationMs: Math.round((performance.now() - started) * 1000) / 1000 },
  paths: [semanticStateRelativePath],
};
try {
  await mkdir(runtimeDirectory, { recursive: true });
  await writeFile(resolve(runtimeDirectory, 'finalization.json'), `${JSON.stringify(result)}\n`, 'utf8');
} catch {
  process.stderr.write('[AEGIS][OBSERVATION][WARN] finalization_telemetry_persistence_failed\n');
}
process.stdout.write(`${JSON.stringify(result)}\n`);

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
import { loadArchitecture, repositorySnapshot } from './lib/preflight_core.mjs';
import { assertSchema } from './lib/schema_validator.mjs';

const rootDirectory = resolve(process.env.AEGIS_ROOT ?? fileURLToPath(new URL('..', import.meta.url)));
const evidenceDirectory = resolve(rootDirectory, 'src/.aegis');
const clarifiedDemandPath = resolve(evidenceDirectory, 'clarified-demand.json');
const activeContractPath = resolve(evidenceDirectory, 'contract-ir.json');
const proofRegistryPath = resolve(evidenceDirectory, 'proof-registry.json');
const runtimeDirectory = resolve(rootDirectory, '.harness/runtime');
const evidenceScope = [
  'src/.aegis/clarified-demand.json',
  'src/.aegis/contract-ir.json',
  'src/.aegis/proof-registry.json',
];
const startedAtEpochMs = Date.now();
const started = performance.now();

function fail(code) {
  process.stderr.write(`[AEGIS][PREFLIGHT][FATAL] ${code}\n`);
  process.exit(1);
}

function isSafeRelativePath(value) {
  return typeof value === 'string' && value.length > 0 && !value.startsWith('/') && !value.split(/[\\/]/u).includes('..');
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
  if (!indexes.every((index) => index < units.length)) fail(code);
  return indexes.map((index) => units[index].id);
}

function requireIndexes(indexes, length, code) {
  if (!indexes.every((index) => index < length)) fail(code);
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
  });
  if (expectedContextDigest !== envelope.contextDigest) fail('preflight_context_digest_mismatch');
  const currentBaseline = repositorySnapshot(rootDirectory);
  if (!currentBaseline.clean || canonicalJson(currentBaseline) !== canonicalJson(envelope.baseline)) fail('preflight_baseline_changed');
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
  const unitIdsInEnvelope = envelope.normalizedDemand.units.map((unit) => unit.id);
  if (unitIdsInEnvelope.length !== new Set(unitIdsInEnvelope).size) fail('duplicate_input_unit');
  const length = Buffer.byteLength(envelope.normalizedDemand.text, 'utf8');
  if (!envelope.normalizedDemand.units.every((unit) => unit.range.startByte < unit.range.endByte && unit.range.endByte <= length)) {
    fail('invalid_input_range');
  }
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

function validateDecision(envelope, decision) {
  assertValidSchema('aegis.preflight_decision.v2', decision, 'malformed_decision');
  if (decision.contextDigest !== envelope.contextDigest) fail('decision_context_digest_mismatch');
  const assessments = ruleAssessments(envelope, decision);
  for (const question of decision.questions) unitIds(envelope, question[6], 'decision_unknown_unit');
  const hardRules = new Set(envelope.architecture.candidateRules.filter((rule) => rule.level === 'hard').map((rule) => rule.id));
  if (assessments.some((item) => item.verdict === 'CONFLICT' && hardRules.has(item.ruleId)) && decision.status !== 'BLOCKED') {
    fail('hard_conflict_not_blocked');
  }
  return assessments;
}

function assembleSemanticState(envelope, decision, assessments) {
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
  const scope = new Set(decision.scope);
  const withinScope = (path) => [...scope].some((declared) => path === declared || path.startsWith(`${declared}/`));
  for (const proof of decision.proofs) {
    if (!withinScope(proof[4]) || !proof[5].every((target) => withinScope(target))) fail('proof_path_outside_scope');
  }
  if (envelope.changeKind === 'PRODUCT' && decision.scope.some((path) => path !== 'src' && !path.startsWith('src/'))) {
    fail('product_scope_outside_src');
  }

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
    acceptanceCriteria: decision.acceptance,
    failureSemantics: decision.failures.map(([trigger, observableOutcome], index) => ({ id: failureIds[index], trigger, observableOutcome })),
  };

  const continuity = {
    retirements: decision.continuity.retirements.map(([kind, id, reason, demandEvidence, successor]) => ({
      kind, id, reason, demandEvidence, ...(successor === null ? {} : { successor }),
    })),
    proofChanges: decision.continuity.proofChanges.map(([id, reason, demandEvidence]) => ({ id, reason, demandEvidence })),
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
    command: entrypoint.endsWith('.ts') ? `node --import tsx ${entrypoint}` : `bash ${entrypoint}`,
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
    decisionFile.value.questions.map((_, index) => `Q-${String(index + 1).padStart(4, '0')}`),
    'resolution_answers_mismatch',
  );
}

function validateIndependentReview(envelope, decisionFile, review) {
  assertValidSchema('aegis.preflight_review.v2', review, 'malformed_independent_review');
  if (review.normalizedDemandDigest !== envelope.normalizedDemand.digest) fail('review_demand_digest_mismatch');
  if (review.decisionDigest !== sha256(decisionFile.bytes)) fail('review_decision_digest_mismatch');
  if (review.producerId === review.reviewerId) fail('review_authority_not_independent');
  const knownUnits = new Set(envelope.normalizedDemand.units.map((unit) => unit.id));
  if (!review.findings.every((finding) => finding.sourceUnitIds.every((id) => knownUnits.has(id)))) fail('review_unknown_unit');
  if (review.verdict !== 'APPROVED') fail('independent_review_rejected');
}

async function persistSemanticState(clarifiedDemand, contract, proofRegistry) {
  await mkdir(evidenceDirectory, { recursive: true });
  const records = [
    [clarifiedDemandPath, clarifiedDemand],
    [activeContractPath, contract],
    [proofRegistryPath, proofRegistry],
  ];
  await Promise.all(records.map(([path, value]) => writeFile(`${path}.${process.pid}.tmp`, `${canonicalJson(value)}\n`, 'utf8')));
  for (const [path] of records) await rename(`${path}.${process.pid}.tmp`, path);
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
const assessments = validateDecision(envelope, decisionFile.value);
if (options.independentReview.length > 0) {
  const review = await readJson(options.independentReview, 'unreadable_independent_review');
  validateIndependentReview(envelope, decisionFile, review.value);
}
if (decisionFile.value.status === 'BLOCKED') {
  process.stdout.write(`${JSON.stringify({ schema: 'aegis.preflight_finalization.v2', status: 'BLOCKED' })}\n`);
  process.exit(0);
}

let interpretationStatus = 'NOT_REQUIRED';
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
  interpretationStatus = 'INTERPRETATION_CONFIRMED';
}

const { clarifiedDemand, contract, proofRegistry } = assembleSemanticState(envelope, decisionFile.value, assessments);
let policyText;
let policy;
try {
  policyText = await readFile(resolve(rootDirectory, 'governance/architecture.policy.json'), 'utf8');
  policy = JSON.parse(policyText);
  validateContract({ root: rootDirectory, contract, clarified: clarifiedDemand, policy, policyText, previousContract: envelope.previousContract, phase: 'compile' });
} catch (error) {
  fail(error instanceof Error ? error.message : 'contract_validation_failed');
}
try {
  await persistSemanticState(clarifiedDemand, contract, proofRegistry);
} catch {
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
  timing: { phase: 'finalization', startedAtEpochMs, durationMs: Math.round((performance.now() - started) * 1000) / 1000 },
  paths: ['src/.aegis/clarified-demand.json', 'src/.aegis/contract-ir.json', 'src/.aegis/proof-registry.json'],
};
try {
  await mkdir(runtimeDirectory, { recursive: true });
  await writeFile(resolve(runtimeDirectory, 'finalization.json'), `${JSON.stringify(result)}\n`, 'utf8');
} catch {
  fail('finalization_telemetry_persistence_failed');
}
process.stdout.write(`${JSON.stringify(result)}\n`);

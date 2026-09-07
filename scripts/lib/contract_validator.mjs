import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { canonicalDigest, sha256 } from './canonical_json.mjs';
import { assertSchema } from './schema_validator.mjs';

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function exactIds(actual, expected, code) {
  requireCondition(actual.length === new Set(actual).size, code);
  requireCondition(
    JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort()),
    code,
  );
}

export function transitionAdversarialClasses(roles) {
  const classes = [];
  const add = (...items) => items.forEach((item) => {
    if (!classes.includes(item)) classes.push(item);
  });
  roles.forEach((role) => {
    if (role === 'STATE') add('CONTINUITY');
    if (role === 'COMMAND') add('COMPOSITION');
    if (role === 'IDENTITY') add('IDENTITY');
    if (role === 'RESOURCE') add('BOUNDARIES', 'COMPOSITION');
    if (role === 'TEMPORAL') add('TIME');
    if (role === 'RESULT' || role === 'CANONICALIZATION') add('OBSERVABILITY');
    if (role === 'ATOMICITY') add('ATOMICITY');
  });
  return classes;
}

function isInside(root, path) {
  const relation = relative(root, path);
  return relation === '' || (relation !== '..' && !relation.startsWith(`..${sep}`));
}

function safePath(root, value) {
  requireCondition(typeof value === 'string' && value.length > 0 && !value.startsWith('/'), 'unsafe_path');
  requireCondition(!value.split(/[\\/]/u).includes('..'), 'unsafe_path');
  const path = resolve(root, value);
  requireCondition(isInside(root, path), 'unsafe_path');
  return path;
}

function containsSymlink(root, path) {
  const relation = relative(root, path);
  let cursor = root;
  for (const part of relation.split(sep).filter(Boolean)) {
    cursor = resolve(cursor, part);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) return true;
  }
  return false;
}

function validateContinuity(previousContract, contract) {
  if (previousContract === undefined || previousContract === null) {
    requireCondition((contract.continuity?.retirements ?? []).length === 0, 'continuity_without_previous_contract');
    requireCondition((contract.continuity?.proofChanges ?? []).length === 0, 'continuity_without_previous_contract');
    return;
  }
  assertSchema('aegis.contract_ir.v2', previousContract);
  const previousTargets = new Set(previousContract.scope.authorizedPaths);
  const currentTargets = new Set(contract.scope.authorizedPaths);
  const previousProofs = new Map(previousContract.proofObligations.map((proof) => [proof.id, proof]));
  const currentProofs = new Map(contract.proofObligations.map((proof) => [proof.id, proof]));
  const retirements = contract.continuity?.retirements ?? [];
  const proofChanges = contract.continuity?.proofChanges ?? [];
  const retired = new Set(retirements.map((item) => `${item.kind}:${item.id}`));
  const changed = new Set(proofChanges.map((item) => item.id));

  for (const target of previousTargets) {
    if (!currentTargets.has(target)) requireCondition(retired.has(`target:${target}`), `target_retirement_undeclared:${target}`);
  }
  for (const [id, previousProof] of previousProofs) {
    const currentProof = currentProofs.get(id);
    if (currentProof === undefined) {
      requireCondition(retired.has(`proof:${id}`), `proof_retirement_undeclared:${id}`);
    } else if (currentProof.risk !== previousProof.risk || currentProof.statement !== previousProof.statement) {
      requireCondition(changed.has(id), `proof_change_undeclared:${id}`);
    }
  }
  requireCondition(retirements.every((item) => (
    (item.kind === 'target' && previousTargets.has(item.id) && !currentTargets.has(item.id))
    || (item.kind === 'proof' && previousProofs.has(item.id) && !currentProofs.has(item.id))
  )), 'invalid_continuity_retirement');
  requireCondition(proofChanges.every((item) => {
    const previousProof = previousProofs.get(item.id);
    const currentProof = currentProofs.get(item.id);
    return previousProof !== undefined
      && currentProof !== undefined
      && (currentProof.risk !== previousProof.risk || currentProof.statement !== previousProof.statement);
  }), 'invalid_continuity_proof_change');
}

function validateSemanticModel(contract) {
  const hasModel = contract.stateModel !== undefined;
  const hasVerification = contract.verification !== undefined;
  if (!hasModel && !hasVerification) return;
  requireCondition(hasModel && hasVerification, 'incomplete_semantic_model');
  const roles = contract.stateModel.bindings.map((binding) => binding.role);
  requireCondition(roles.length === new Set(roles).size, 'duplicate_state_model_role');
  const policies = contract.stateModel.policies;
  if (policies !== undefined) {
    const policyRoles = policies.map((policy) => policy.role);
    exactIds(policyRoles, roles, 'state_model_policy_coverage_invalid');
  }
  if (contract.stateModel.kind === 'NONE') {
    requireCondition(roles.length === 0, 'invalid_stateless_state_model');
    requireCondition(policies === undefined || policies.length === 0, 'invalid_stateless_state_policies');
    requireCondition(contract.stateModel.governance === undefined, 'invalid_stateless_transition_governance');
    requireCondition(contract.verification.adversarialClasses === undefined, 'invalid_stateless_adversarial_classes');
    return;
  }
  const policyRoleSets = [
    ...contract.behavior,
    ...(contract.preconditions ?? []),
    ...contract.invariants,
    ...(contract.postconditions ?? []),
    ...(contract.failureSemantics ?? []),
  ].map((clause) => clause.policyRoles ?? []);
  requireCondition(
    policyRoleSets.every((policyRoles) => policyRoles.every((role) => roles.includes(role))),
    'contract_clause_policy_role_unknown',
  );
  for (const role of ['STATE', 'COMMAND', 'RESULT', 'ATOMICITY']) {
    requireCondition(roles.includes(role), `state_model_role_missing:${role.toLowerCase()}`);
  }
  if (policies !== undefined) {
    requireCondition(
      policies.every((policy) => policy.sourceUnitIds.length > 0),
      'state_model_policy_without_provenance',
    );
  }
  const highRisk = roles.includes('ATOMICITY')
    && ['RESOURCE', 'TEMPORAL', 'IDENTITY', 'CANONICALIZATION'].some((role) => roles.includes(role));
  if (highRisk) requireCondition(contract.verification.riskProfile === 'forensic', 'state_transition_requires_forensic');
  if (contract.verification.riskProfile === 'forensic') {
    requireCondition(/^[a-f0-9]{64}$/u.test(contract.verification.independentReviewDigest ?? ''), 'forensic_review_missing');
  }
  const governance = contract.stateModel.governance;
  requireCondition(governance !== undefined, 'transition_governance_missing');
  const knownProofIds = new Set(contract.proofObligations.map((proof) => proof.id));
  const requireProofs = (proofIds, code) => requireCondition(
    proofIds.length > 0 && proofIds.every((id) => knownProofIds.has(id)),
    code,
  );
  requireProofs(governance.authoritativeState.proofIds, 'authoritative_state_without_proof');
  requireCondition(governance.publicationAuthorities.length > 0, 'publication_authority_missing');
  const authorityNames = governance.publicationAuthorities.map((item) => item.operation);
  requireCondition(authorityNames.length === new Set(authorityNames).size, 'duplicate_publication_authority');
  governance.publicationAuthorities.forEach((item) => requireProofs(item.proofIds, 'publication_authority_without_proof'));
  requireProofs(governance.publicationBoundary.proofIds, 'publication_boundary_without_proof');
  const observableNames = governance.derivedObservables.map((item) => item.name);
  requireCondition(observableNames.length === new Set(observableNames).size, 'duplicate_derived_observable');
  governance.derivedObservables.forEach((item) => requireProofs(item.proofIds, 'derived_observable_without_proof'));
  if (governance.digestIdentity !== null) {
    requireCondition(roles.includes('CANONICALIZATION'), 'digest_identity_without_canonicalization');
    requireProofs(governance.digestIdentity.proofIds, 'digest_identity_without_proof');
  }
  exactIds(
    contract.verification.adversarialClasses ?? [],
    transitionAdversarialClasses(roles),
    'invalid_adversarial_class_selection',
  );
}

export function validateContract({ root, contract, clarified, policy, policyText, registry, previousContract, phase = 'promotion' }) {
  requireCondition(phase === 'compile' || phase === 'promotion', 'invalid_validation_phase');
  assertSchema('aegis.contract_ir.v2', contract);
  assertSchema('aegis.clarified_demand.v2', clarified);
  assertSchema('aegis.architecture_policy.v1', policy);

  requireCondition(contract.clarifiedDemandDigest === canonicalDigest(clarified), 'clarified_demand_digest_mismatch');
  requireCondition(contract.changeKind === clarified.changeKind, 'change_kind_mismatch');
  const architectureSource = readFileSync(safePath(root, policy.origin.sourcePath));
  requireCondition(sha256(architectureSource) === policy.origin.sourceDigest, 'stale_architecture_policy');
  requireCondition(contract.architecture.policyDigest === sha256(policyText), 'architecture_policy_digest_mismatch');

  const policyRuleIds = new Set(policy.rules.map((rule) => rule.id));
  const policyAmendmentIds = new Set(policy.amendments.map((amendment) => amendment.id));
  const appliedRuleIds = clarified.architecture.ruleAssessments
    .filter((assessment) => assessment.verdict === 'APPLIED')
    .map((assessment) => assessment.ruleId);
  requireCondition(!clarified.architecture.ruleAssessments.some((assessment) => assessment.verdict === 'CONFLICT'), 'architecture_conflict_not_resolved');
  exactIds(contract.architecture.appliedRuleIds, appliedRuleIds, 'invalid_architecture_binding');
  requireCondition(contract.architecture.appliedRuleIds.every((id) => policyRuleIds.has(id)), 'invalid_architecture_binding');
  requireCondition(contract.architecture.amendmentIds.every((id) => policyAmendmentIds.has(id)), 'invalid_architecture_binding');
  exactIds(contract.scope.authorizedPaths, clarified.scope.included, 'scope_binding_mismatch');
  validateSemanticModel(contract);
  if (contract.changeKind === 'PRODUCT') {
    requireCondition(
      contract.scope.authorizedPaths.every((path) => path === 'src' || path.startsWith('src/')),
      'product_scope_outside_src',
    );
  }
  if (phase === 'compile') validateContinuity(previousContract, contract);

  if (phase === 'promotion') {
    for (const target of contract.scope.authorizedPaths) {
      const path = safePath(root, target);
      requireCondition(existsSync(path) && !containsSymlink(root, path), `authorized_target_unavailable:${target}`);
    }
  } else {
    for (const target of contract.scope.authorizedPaths) safePath(root, target);
  }

  const statementGroups = [
    contract.behavior,
    contract.preconditions ?? [],
    contract.postconditions ?? [],
    contract.failureSemantics ?? [],
  ];
  const statementIds = statementGroups.flat().map((item) => item.id);
  const invariantIds = contract.invariants.map((item) => item.id);
  const proofIds = contract.proofObligations.map((item) => item.id);
  const allContractIds = [...statementIds, ...invariantIds, ...proofIds];
  requireCondition(allContractIds.length === new Set(allContractIds).size, 'duplicate_contract_id');
  const proofIdSet = new Set(proofIds);
  requireCondition(contract.invariants.every((item) => item.proofIds.every((id) => proofIdSet.has(id))), 'invariant_without_obligation');

  if (phase === 'promotion') {
    requireCondition(registry !== undefined && Array.isArray(registry.proofs), 'unreadable_proof_registry');
    const registryIds = new Set(registry.proofs.map((proof) => proof.id));
    requireCondition(proofIds.every((id) => registryIds.has(id)), 'obligation_without_registry_proof');
  }

  const requirementIds = clarified.requirements.map((item) => item.id);
  exactIds(
    contract.requirementCoverage.map((item) => item.requirementId),
    requirementIds,
    'invalid_requirement_coverage',
  );
  const validContractIds = new Set(allContractIds);
  requireCondition(
    contract.requirementCoverage.every((entry) => entry.contractIds.every((id) => validContractIds.has(id))),
    'invalid_requirement_coverage',
  );

  return {
    schema: 'aegis.contract_validation.v2',
    status: 'PROVEN',
    phase,
    contractDigest: canonicalDigest(contract),
    clarifiedDemandDigest: contract.clarifiedDemandDigest,
    architecturePolicyDigest: contract.architecture.policyDigest,
  };
}

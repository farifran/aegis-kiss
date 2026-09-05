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

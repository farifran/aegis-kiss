#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const defaultRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

function fail(code) {
  process.stderr.write(`[AEGIS][CONTRACT][FATAL] ${code}\n`);
  process.exit(1);
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function parseArguments(argv) {
  const options = {
    root: defaultRoot,
    contract: '.harness/active_contract_ir.json',
    clarified: '.harness/active_clarified_demand.json',
    registry: '.harness/proof_registry.json',
    policy: 'governance/architecture.policy.json',
  };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--root', '--contract', '--clarified', '--registry', '--policy'].includes(flag) || value === undefined) {
      fail('invalid_arguments');
    }
    options[flag.slice(2)] = value;
  }
  return options;
}

function isInside(root, path) {
  const relation = relative(root, path);
  return relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..' && !relation.includes(`${sep}..${sep}`));
}

function pathFor(root, value) {
  if (typeof value !== 'string' || value.length === 0 || value.startsWith('/')) fail('unsafe_path');
  const path = resolve(root, value);
  if (!isInside(root, path)) fail('unsafe_path');
  return path;
}

function readJson(root, value, code) {
  const path = pathFor(root, value);
  try {
    return { path, text: readFileSync(path, 'utf8'), value: JSON.parse(readFileSync(path, 'utf8')) };
  } catch {
    fail(code);
  }
}

function unique(values) {
  return new Set(values).size === values.length;
}

function ids(values) {
  return values.map((value) => value.id);
}

function validId(value, prefix) {
  return new RegExp(`^${prefix}-[A-Z0-9][A-Z0-9-]+$`, 'u').test(value ?? '');
}

const options = parseArguments(process.argv.slice(2));
const root = resolve(options.root);
const contractFile = readJson(root, options.contract, 'unreadable_contract');
const clarifiedFile = readJson(root, options.clarified, 'unreadable_clarified_demand');
const registryFile = readJson(root, options.registry, 'unreadable_proof_registry');
const policyFile = readJson(root, options.policy, 'unreadable_architecture_policy');
const contract = contractFile.value;
const clarified = clarifiedFile.value;
const registry = registryFile.value;
const policy = policyFile.value;

const allowedContractKeys = new Set([
  'schema', 'clarifiedDemandDigest', 'architecture', 'scope', 'behavior', 'preconditions',
  'invariants', 'postconditions', 'failureSemantics', 'proofObligations', 'requirementCoverage', 'continuity',
]);
if (contract?.schema !== 'aegis.contract_ir.v2' || !Object.keys(contract).every((key) => allowedContractKeys.has(key))) {
  fail('invalid_contract_schema');
}
if (clarified?.schema !== 'aegis.clarified_demand.v1' || !Array.isArray(clarified.requirements)) {
  fail('invalid_clarified_demand');
}
if (contract.clarifiedDemandDigest !== digest(JSON.stringify(clarified))) fail('clarified_demand_digest_mismatch');
if (policy?.schema !== 'aegis.architecture_policy.v1' || typeof policy.origin?.sourcePath !== 'string') {
  fail('invalid_architecture_policy');
}
let architectureSource;
try {
  architectureSource = readFileSync(pathFor(root, policy.origin.sourcePath));
} catch {
  fail('unreadable_architecture_source');
}
if (digest(architectureSource) !== policy.origin.sourceDigest) fail('stale_architecture_policy');
if (contract.architecture?.policyDigest !== digest(policyFile.text)) fail('architecture_policy_digest_mismatch');

const policyRuleIds = new Set((policy.rules ?? []).map((rule) => rule.id));
const policyAmendmentIds = new Set((policy.amendments ?? []).map((amendment) => amendment.id));
if (
  !Array.isArray(contract.architecture?.appliedRuleIds)
  || !unique(contract.architecture.appliedRuleIds)
  || !contract.architecture.appliedRuleIds.every((id) => policyRuleIds.has(id))
  || !Array.isArray(contract.architecture?.amendmentIds)
  || !unique(contract.architecture.amendmentIds)
  || !contract.architecture.amendmentIds.every((id) => policyAmendmentIds.has(id))
) fail('invalid_architecture_binding');

const targets = contract.scope?.authorizedPaths;
if (!Array.isArray(targets) || targets.length === 0 || !unique(targets)) fail('invalid_scope');
for (const target of targets) {
  const path = pathFor(root, target);
  if (!existsSync(path) || lstatSync(path).isSymbolicLink()) fail(`authorized_target_unavailable:${target}`);
}

const statementGroups = [contract.behavior, contract.preconditions ?? [], contract.postconditions ?? [], contract.failureSemantics ?? []];
if (!Array.isArray(contract.behavior) || contract.behavior.length === 0 || !statementGroups.flat().every((item) => (
  typeof item?.id === 'string' && /^[A-Z][A-Z0-9-]+$/u.test(item.id) && typeof item.statement === 'string' && item.statement.length > 0
))) fail('invalid_statements');
const statementIds = statementGroups.flatMap(ids);
if (!unique(statementIds)) fail('duplicate_statement_id');

if (!Array.isArray(contract.invariants) || !contract.invariants.every((item) => (
  validId(item?.id, 'INV') && typeof item.statement === 'string' && item.statement.length > 0
  && Array.isArray(item.proofIds) && item.proofIds.length > 0 && unique(item.proofIds)
  && item.proofIds.every((id) => validId(id, 'PO'))
))) fail('invalid_invariants');
const invariantIds = ids(contract.invariants);
if (!unique(invariantIds)) fail('duplicate_invariant_id');

if (!Array.isArray(contract.proofObligations) || contract.proofObligations.length === 0 || !contract.proofObligations.every((item) => (
  validId(item?.id, 'PO') && typeof item.risk === 'string' && item.risk.length > 0 && typeof item.statement === 'string' && item.statement.length > 0
))) fail('invalid_proof_obligations');
const proofIds = ids(contract.proofObligations);
if (!unique(proofIds)) fail('duplicate_proof_obligation_id');
const registryProofIds = new Set((registry.proofs ?? []).map((proof) => proof.id));
if (!proofIds.every((id) => registryProofIds.has(id))) fail('obligation_without_registry_proof');
if (!contract.invariants.every((invariant) => invariant.proofIds.every((id) => proofIds.includes(id)))) fail('invariant_without_obligation');

const contractIds = new Set([...statementIds, ...invariantIds, ...proofIds]);
const requirementIds = ids(clarified.requirements);
if (!unique(requirementIds) || !Array.isArray(contract.requirementCoverage) || contract.requirementCoverage.length !== requirementIds.length) {
  fail('invalid_requirement_coverage');
}
const coveredRequirements = contract.requirementCoverage.map((coverage) => coverage?.requirementId);
if (
  !unique(coveredRequirements)
  || !coveredRequirements.every((id) => requirementIds.includes(id))
  || !contract.requirementCoverage.every((coverage) => Array.isArray(coverage.contractIds) && coverage.contractIds.length > 0
    && unique(coverage.contractIds) && coverage.contractIds.every((id) => contractIds.has(id)))
) fail('invalid_requirement_coverage');

process.stdout.write(`${JSON.stringify({ schema: 'aegis.contract_validation.v2', status: 'PROVEN', contractDigest: digest(contractFile.text), clarifiedDemandDigest: contract.clarifiedDemandDigest, architecturePolicyDigest: contract.architecture.policyDigest })}\n`);

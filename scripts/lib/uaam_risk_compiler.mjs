#!/usr/bin/env node
/* global process */

import fs from 'node:fs';

const [irPath, observationsPath] = process.argv.slice(2);
if (!irPath) {
  process.stderr.write('usage: uaam_risk_compiler.mjs <contract-ir> [observations-json]\n');
  process.exit(2);
}

const ir = JSON.parse(fs.readFileSync(irPath, 'utf8'));
const observations = observationsPath && fs.existsSync(observationsPath)
  ? JSON.parse(fs.readFileSync(observationsPath, 'utf8'))
  : {};

const facts = [];
const risks = [];
const compiledProofObligations = [];
const seenRisks = new Set();
const operations = Array.isArray(ir.operations) ? ir.operations : [];

function addRisk({ id, kind, domain, oracle, target, evidence }) {
  if (seenRisks.has(id)) return;
  seenRisks.add(id);
  facts.push({ id: `FACT-${id}`, kind, target, evidence });
  risks.push({ id, kind, domain, target, evidence });
  compiledProofObligations.push({
    id: `PO-RISK-${id}`,
    kind,
    domain,
    oracle,
    target,
    required: true,
    sourceRisk: id
  });
}

addRisk({
  id: 'CONTRACT-COVERAGE',
  kind: 'contract_coverage',
  domain: 'CONTRACT',
  oracle: 'contract_coverage',
  target: 'contract',
  evidence: 'Contract IR is the declared source of requirements and obligations'
});

const resourceOwners = new Map();
for (const operation of operations) {
  const target = operation?.target || operation?.id || 'operation';
  if (operation?.admission && Array.isArray(operation.admission.preconditions) && operation.admission.preconditions.length > 0) {
    addRisk({ id: `${target}-ADMISSION`, kind: 'admission_boundary', domain: 'ADMISSION', oracle: 'admission_reject', target, evidence: 'operation declares admission preconditions' });
  }
  if (operation?.failure && typeof operation.failure === 'object') {
    addRisk({ id: `${target}-FAILURE-STATE`, kind: 'failure_state', domain: 'STATE', oracle: 'state_diff', target, evidence: 'operation declares failure effects' });
  }
  for (const resource of Array.isArray(operation?.resources) ? operation.resources : []) {
    if (resource?.resource) {
      const owners = resourceOwners.get(resource.resource) || [];
      owners.push(target);
      resourceOwners.set(resource.resource, owners);
    }
    addRisk({ id: `${target}-RESOURCE`, kind: 'resource_conservation', domain: 'RESOURCE', oracle: 'conservation_equation', target, evidence: `resource boundary: ${resource?.resource || 'unnamed'}` });
  }
  const sharedResources = Array.isArray(operation?.composition?.sharedResources) ? operation.composition.sharedResources : [];
  if (sharedResources.length > 0) {
    addRisk({ id: `${target}-COMPOSITION`, kind: 'resource_composition', domain: 'COMPOSITION', oracle: 'resource_composition', target, evidence: 'operation declares shared mutable resources' });
  }
  if (operation?.transaction && typeof operation.transaction === 'object') {
    addRisk({ id: `${target}-COMMIT`, kind: 'commit_atomicity', domain: 'COMMIT', oracle: 'commit_atomicity', target, evidence: 'operation declares transaction phases' });
  }
  const lifecycle = Array.isArray(operation?.lifecycle) ? operation.lifecycle : (operation?.lifecycle ? [operation.lifecycle] : []);
  if (lifecycle.length > 0 || operation?.temporal) {
    addRisk({ id: `${target}-LIFECYCLE`, kind: 'temporal_lifecycle', domain: 'LIFECYCLE', oracle: 'temporal_policy', target, evidence: 'operation has a temporal or lifecycle dependency' });
  }
  if (operation?.observability && typeof operation.observability === 'object') {
    addRisk({ id: `${target}-RESULT`, kind: 'result_state_consistency', domain: 'OBSERVABILITY', oracle: 'result_state_consistency', target, evidence: 'operation maps returned values to observable state' });
  }
}

for (const [resource, targets] of resourceOwners.entries()) {
  if (targets.length > 1) {
    addRisk({ id: `SHARED-${resource}`, kind: 'resource_composition', domain: 'COMPOSITION', oracle: 'resource_composition', target: targets.join(','), evidence: `resource appears in multiple operations: ${targets.join(', ')}` });
  }
}

for (const observation of Array.isArray(observations.observations) ? observations.observations : []) {
  if (!observation || typeof observation !== 'object' || typeof observation.kind !== 'string') continue;
  const mapping = {
    shared_mutable_resource: ['COMPOSITION', 'resource_composition'],
    multi_step_commit: ['COMMIT', 'commit_atomicity'],
    temporal_dependency: ['LIFECYCLE', 'temporal_policy'],
    result_state_mapping: ['OBSERVABILITY', 'result_state_consistency']
  }[observation.kind];
  if (!mapping) continue;
  addRisk({
    id: `OBSERVED-${observation.kind}-${observation.target || 'GLOBAL'}`,
    kind: observation.kind,
    domain: mapping[0],
    oracle: mapping[1],
    target: observation.target || 'global',
    evidence: observation.evidence || 'runtime observation'
  });
}

process.stdout.write(JSON.stringify({
  version: 'uaam-risk-v1',
  facts,
  risks,
  compiledProofObligations
}));

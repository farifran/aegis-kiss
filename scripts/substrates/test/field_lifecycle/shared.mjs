import assert from 'node:assert/strict';
import process from 'node:process';
import {
  generateClosureCertificate,
  validateContradictionDetection,
  validateDecisionsWitness,
  validateFieldLifecycle,
  validateOperationTotality,
  validateProvenanceEnforcement,
  validateSemanticInventoryCoverage,
} from '../../../lib/semantic_closure.mjs';
import { effectiveDeterminismStatus } from '../../../lib/semantic_approval.mjs';
import { validateDeterminismCoverage } from '../../../lib/semantic_draft_validator.mjs';

export {
  assert,
  effectiveDeterminismStatus,
  generateClosureCertificate,
  validateContradictionDetection,
  validateDecisionsWitness,
  validateDeterminismCoverage,
  validateFieldLifecycle,
  validateOperationTotality,
  validateProvenanceEnforcement,
  validateSemanticInventoryCoverage,
};

export function log(msg) {
  process.stdout.write(`${msg}\n`);
}

export function createFixture({
  isStateful = true,
  stateModel = null,
  dimensions = [{ kind: 'ORDERING', subjectId: 'PUBLIC_CONTRACT', status: 'SPECIFIED' }],
  unknowns = [],
  decisions = [],
  boundaryRules = [],
  literalFacts = [],
  requirements = [],
  invariants = [],
  architectureContexts = null,
  pathReferences = [],
} = {}) {
  return {
    architectureContexts: architectureContexts ?? (isStateful
      ? [{ tag: 'product-demand' }, { tag: 'stateful-operation' }]
      : [{ tag: 'product-demand' }]),
    pathReferences,
    stateModel,
    unknowns,
    decisions,
    boundaryRules,
    literalFacts,
    requirements,
    invariants,
    determinismReview: {
      status: 'SEMANTICALLY_CLOSED',
      dimensions,
    },
  };
}

import { canonicalDigest } from './canonical_json.mjs';
import {
  assertJevAssessment,
  assertJevDecisionBatch,
  buildJevDecisionBatch,
} from './jev_projection.mjs';
import { assertSchema } from './schema_validator.mjs';

function withoutDigest(value, digestField) {
  const { [digestField]: digest, ...payload } = value;
  void digest;
  return payload;
}

export function compileJevAdvisory(semanticRequest, batch, assessment) {
  const payload = {
    schema: 'aegis.jev_advisory.v2',
    sourceSemanticRequestDigest: semanticRequest.requestDigest,
    sourceEvidenceDigest: semanticRequest.intentEvidence.evidenceDigest,
    sourceBatchDigest: batch.batchDigest,
    authority: 'ADVISORY_ONLY',
    purpose: 'SHADOW_EVALUATION',
    assessment,
  };
  const advisory = { ...payload, advisoryDigest: canonicalDigest(payload) };
  assertJevAdvisory(advisory, semanticRequest, batch);
  return advisory;
}

export function assertJevAdvisory(advisory, semanticRequest, batch = null) {
  assertSchema('aegis.semantic_request.v10', semanticRequest);
  const effectiveBatch = batch ?? buildJevDecisionBatch(semanticRequest);
  assertJevDecisionBatch(effectiveBatch, semanticRequest);
  assertSchema('aegis.jev_advisory.v2', advisory);
  if (advisory.advisoryDigest
    !== canonicalDigest(withoutDigest(advisory, 'advisoryDigest'))) {
    throw new Error('jev_advisory_digest_mismatch');
  }
  if (advisory.sourceSemanticRequestDigest !== semanticRequest.requestDigest
    || advisory.sourceEvidenceDigest !== semanticRequest.intentEvidence.evidenceDigest
    || advisory.sourceBatchDigest !== effectiveBatch.batchDigest) {
    throw new Error('jev_advisory_source_mismatch');
  }
  assertJevAssessment(advisory.assessment, effectiveBatch);
}

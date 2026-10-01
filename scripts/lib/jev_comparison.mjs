import { canonicalDigest } from './canonical_json.mjs';
import { assertJevAdvisory } from './jev_advisory.mjs';
import { assertSchema } from './schema_validator.mjs';

function semanticChoice(disposition, draft) {
  if (disposition === undefined) return null;
  if (disposition.status === 'CONTEXT_ONLY') return 'CONTEXT_ONLY';
  if (disposition.status === 'UNCLEAR') return 'UNKNOWN';
  const claimsById = new Map(draft.intentClaims.map((claim) => [claim.id, claim]));
  const kinds = [...new Set(disposition.claimIds
    .map((id) => claimsById.get(id)?.kind)
    .filter((kind) => kind !== undefined))];
  const roles = new Set(kinds.map((kind) => ['OBLIGATION', 'PROHIBITION'].includes(kind)
    ? 'NORMATIVE' : ['GOAL', 'OPTION', 'EXAMPLE'].includes(kind) ? 'NON_NORMATIVE' : 'UNKNOWN'));
  return roles.size === 1 ? [...roles][0] : roles.size > 1 ? 'MIXED' : 'UNKNOWN';
}

export function compileJevComparison(semanticRequest, draft, advisory) {
  assertSchema('aegis.semantic_draft.v9', draft);
  assertJevAdvisory(advisory, semanticRequest);
  const dispositionById = new Map(draft.fragmentDispositions
    .map((disposition) => [disposition.fragmentId, disposition]));
  const items = semanticRequest.intentEvidence.fragments.flatMap((fragment) => ['role', 'review'].map((axis) => {
    const jevChoice = advisory.assessment.answers[`fragment.${fragment.id}.${axis}`].choice;
    // The main opinion has no equivalent per-fragment review field. Do not invent one.
    const classified = axis === 'role' ? semanticChoice(dispositionById.get(fragment.id), draft) : null;
    return {
      fragmentId: fragment.id,
      axis,
      jevChoice,
      semanticChoice: classified,
      outcome: classified === null
        ? 'NOT_COMPARABLE'
        : classified === jevChoice ? 'AGREEMENT' : 'DISAGREEMENT',
    };
  }));
  const agreements = items.filter(({ outcome }) => outcome === 'AGREEMENT').length;
  const disagreements = items.filter(({ outcome }) => outcome === 'DISAGREEMENT').length;
  const comparable = agreements + disagreements;
  const payload = {
    schema: 'aegis.jev_comparison.v1',
    sourceSemanticRequestDigest: semanticRequest.requestDigest,
    sourceEvidenceDigest: semanticRequest.intentEvidence.evidenceDigest,
    advisoryDigest: advisory.advisoryDigest,
    semanticDraftDigest: canonicalDigest(draft),
    authority: 'EVALUATION_ONLY',
    totals: {
      fragments: semanticRequest.intentEvidence.fragments.length,
      comparable,
      agreements,
      disagreements,
      unclassified: items.length - comparable,
      agreementRate: comparable === 0 ? null : agreements / comparable,
    },
    items,
  };
  const comparison = { ...payload, comparisonDigest: canonicalDigest(payload) };
  assertSchema('aegis.jev_comparison.v1', comparison);
  return comparison;
}

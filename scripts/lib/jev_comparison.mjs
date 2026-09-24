import { canonicalDigest } from './canonical_json.mjs';
import { assertJevAdvisory } from './jev_advisory.mjs';
import { assertSchema } from './schema_validator.mjs';

function semanticChoice(disposition, draft) {
  if (disposition === undefined) return null;
  if (disposition.status === 'CONTEXT_ONLY') return 'CONTEXT_ONLY';
  if (disposition.status === 'UNCLEAR') return 'MIXED_OR_UNCLEAR';
  const claimsById = new Map(draft.intentClaims.map((claim) => [claim.id, claim]));
  const kinds = [...new Set(disposition.claimIds
    .map((id) => claimsById.get(id)?.kind)
    .filter((kind) => kind !== undefined))];
  if (kinds.length !== 1 || disposition.claimIds.length !== 1) return 'MIXED_OR_UNCLEAR';
  if (['OBLIGATION', 'PROHIBITION'].includes(kinds[0])) return 'NORMATIVE';
  if (['GOAL', 'OPTION', 'EXAMPLE'].includes(kinds[0])) return 'NON_NORMATIVE';
  return kinds[0];
}

export function compileJevComparison(semanticRequest, draft, advisory) {
  assertSchema('aegis.semantic_draft.v9', draft);
  assertJevAdvisory(advisory, semanticRequest);
  const dispositionById = new Map(draft.fragmentDispositions
    .map((disposition) => [disposition.fragmentId, disposition]));
  const items = semanticRequest.intentEvidence.fragments.map((fragment) => {
    const jevChoice = advisory.assessment.answers[`fragment.${fragment.id}`].choice;
    const classified = semanticChoice(dispositionById.get(fragment.id), draft);
    return {
      fragmentId: fragment.id,
      jevChoice,
      semanticChoice: classified,
      outcome: classified === null
        ? 'NOT_COMPARABLE'
        : classified === jevChoice ? 'AGREEMENT' : 'DISAGREEMENT',
    };
  });
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
      fragments: items.length,
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

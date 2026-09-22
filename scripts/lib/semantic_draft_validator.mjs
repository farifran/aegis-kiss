import {
  assertSchema,
} from './schema_validator.mjs';
import {
  assertUniqueIds,
} from './semantic_collections.mjs';
import {
  assertObservableOutcomesAreUnique,
} from './semantic_rules.mjs';
import {
  validateIntentClassification,
  validateScopeAndIntentSignals,
} from './semantic_validate_intent.mjs';
import {
  validateDecisionsAndEvidence,
  validateRequirementsAndBoundaries,
} from './semantic_validate_requirements.mjs';
import { validateDeterminismReview } from './semantic_validate_determinism.mjs';
import { validateReviewsAndPolicy } from './semantic_validate_review.mjs';

export function assertSemanticDraft(draft, policy, {
  constitutionRules = [],
  intent = '',
  resolvedDecisionIds = [],
  humanResolutions = [],
  workspaceEvidence = [],
} = {}) {
  assertSchema('aegis.semantic_draft.v8', draft);
  assertUniqueIds(draft.intentClaims, 'id', 'intent_claim');
  const nonNormativeItemIds = assertUniqueIds(draft.nonNormativeItems, 'id', 'non_normative_item');
  const pathReferenceIds = assertUniqueIds(draft.pathReferences, 'id', 'path_reference');
  const pathReferencesById = new Map(draft.pathReferences.map((item) => [item.id, item]));
  const requirementIds = assertUniqueIds(draft.requirements, 'id', 'requirement');
  const requirementsById = new Map(draft.requirements.map((item) => [item.id, item]));
  const acceptanceCases = draft.requirements.flatMap(({ acceptanceCases: cases }) => cases);
  assertUniqueIds(acceptanceCases, 'id', 'acceptance_case');
  const acceptanceCasesById = new Map(acceptanceCases.map((item) => [item.id, item]));
  const acceptanceRequirementById = new Map(draft.requirements.flatMap((requirement) => (
    requirement.acceptanceCases.map((item) => [item.id, requirement.id])
  )));
  assertObservableOutcomesAreUnique(acceptanceCases);
  const invariantIds = assertUniqueIds(draft.invariants, 'id', 'invariant');
  const riskIds = assertUniqueIds(draft.risks, 'id', 'risk');
  const risksById = new Map(draft.risks.map((risk) => [risk.id, risk]));
  const boundaryRuleIds = assertUniqueIds(draft.boundaryRules, 'id', 'boundary_rule');
  const boundaryRulesById = new Map(draft.boundaryRules.map((rule) => [rule.id, rule]));
  assertUniqueIds(draft.unknowns, 'id', 'unknown');
  const decisionIds = assertUniqueIds(draft.decisions, 'questionId', 'decision');
  const decisionsById = new Map(draft.decisions.map((decision) => [decision.questionId, decision]));
  const knownResolvedDecisions = new Set([
    ...resolvedDecisionIds,
    ...humanResolutions.map(({ questionId }) => questionId),
  ]);
  const humanResolutionEvidence = new Map(humanResolutions.map((resolution) => [
    resolution.questionId,
    resolution.kind === 'ANSWER'
      ? `${resolution.label}\n${resolution.contractEffect ?? ''}`
      : resolution.correction,
  ]));
  assertUniqueIds(draft.adversarialReview.findings, 'id', 'adversarial_finding');
  const architectureTags = assertUniqueIds(draft.architectureContexts, 'tag', 'architecture_context');
  const knownArchitectureTags = new Set(policy.contexts.map(({ tag }) => tag));
  if (knownArchitectureTags.size !== policy.contexts.length) {
    throw new Error('duplicate_policy_context');
  }
  for (const tag of architectureTags) {
    if (!knownArchitectureTags.has(tag)) throw new Error(`unknown_architecture_context:${tag}`);
  }
  for (const rule of policy.rules) {
    for (const tag of rule.appliesWhen) {
      if (!knownArchitectureTags.has(tag)) {
        throw new Error(`policy_rule_references_unknown_context:${rule.id}:${tag}`);
      }
    }
  }
  const knownClaimTargets = new Set([
    ...nonNormativeItemIds,
    ...pathReferenceIds,
    ...requirementIds,
    ...decisionIds,
    ...knownResolvedDecisions,
    ...boundaryRuleIds,
    ...policy.rules.map(({ id }) => id),
  ]);
  const targetsByDisposition = {
    NORMATIVE: /^(?:REQ|BOUND)-/u,
    DECISION: /^Q-/u,
    POLICY_CORRECTION: /^ARCH-/u,
    NON_NORMATIVE: /^(?:NOTE|PATH)-/u,
  };
  const dispositionsByKind = {
    OBLIGATION: new Set(['NORMATIVE', 'POLICY_CORRECTION']),
    PROHIBITION: new Set(['NORMATIVE', 'POLICY_CORRECTION']),
    GOAL: new Set(['NON_NORMATIVE']),
    OPTION: new Set(['NON_NORMATIVE', 'POLICY_CORRECTION']),
    EXAMPLE: new Set(['NON_NORMATIVE', 'POLICY_CORRECTION']),
    AMBIGUITY: new Set(['DECISION']),
  };
  const normalizedClaimQuotes = new Set();
  const intentClaimsByTarget = new Map();
  const policyRulesById = new Map(policy.rules.map((rule) => [rule.id, rule]));
  const policyAmendmentsById = new Map((policy.amendments ?? []).map((item) => [item.id, item]));
  const validationContext = {
    draft,
    policy,
    constitutionRules,
    intent,
    resolvedDecisionIds,
    humanResolutions,
    workspaceEvidence,
    nonNormativeItemIds,
    pathReferenceIds,
    pathReferencesById,
    requirementIds,
    requirementsById,
    acceptanceCases,
    acceptanceCasesById,
    acceptanceRequirementById,
    invariantIds,
    riskIds,
    risksById,
    boundaryRuleIds,
    boundaryRulesById,
    decisionIds,
    decisionsById,
    knownResolvedDecisions,
    humanResolutionEvidence,
    architectureTags,
    knownArchitectureTags,
    knownClaimTargets,
    targetsByDisposition,
    dispositionsByKind,
    normalizedClaimQuotes,
    intentClaimsByTarget,
    policyRulesById,
    policyAmendmentsById,
  };
  Object.assign(validationContext, validateIntentClassification(validationContext));
  Object.assign(validationContext, validateScopeAndIntentSignals(validationContext));
  validateRequirementsAndBoundaries(validationContext);
  validateDeterminismReview(validationContext);
  validateDecisionsAndEvidence(validationContext);
  validateReviewsAndPolicy(validationContext);
}

import { canonicalDigest } from './canonical_json.mjs';
import { generateClosureCertificate } from './semantic_closure.mjs';

export const effectCollections = ['requirements', 'invariants', 'risks', 'boundaryRules', 'dimensions'];

export function effectCollection(specification, key) {
  return key === 'dimensions' ? specification.determinismReview.dimensions : specification[key];
}

// Replace existing typed entries only: no arbitrary paths, identifiers or envelope writes.
export function replacePreparedEntries(specification, effect, touched = new Map()) {
  for (const key of effectCollections) {
    const collection = effectCollection(specification, key);
    const seen = new Set();
    for (const { index, value } of effect[key]) {
      if (!Number.isInteger(index) || index < 0 || collection[index] === undefined) {
        throw new Error(`prepared_effect_index_out_of_range:${key}:${index}`);
      }
      const target = `${key}:${index}`;
      if (seen.has(target)) throw new Error(`prepared_effect_duplicate_target:${target}`);
      seen.add(target);
      const digest = canonicalDigest(value);
      if (touched.has(target) && touched.get(target) !== digest) {
        throw new Error(`prepared_effect_conflict:${target}`);
      }
      touched.set(target, digest);
      collection[index] = globalThis.structuredClone(value);
    }
  }
}

export function hasPreparedAnswers(specification, answers) {
  return answers.length > 0 && answers.every((answer) => (
    !('correction' in answer)
      && specification.decisions.find(({ questionId }) => questionId === answer.questionId)
        ?.answers.find(({ id }) => id === answer.answerId)?.preparedEffect != null
  ));
}

export function assertPreparedEffectScope(specification, decision, effect) {
  const owned = {
    requirements: decision.requirementIds,
    invariants: decision.invariantIds,
    risks: decision.riskIds,
  };
  for (const key of effectCollections) {
    for (const { index, value } of effect[key]) {
      const original = effectCollection(specification, key)[index];
      if (original === undefined) throw new Error(`prepared_effect_index_out_of_range:${key}:${index}`);
      const related = key === 'dimensions'
        ? original.targetIds.includes(decision.questionId)
        : key === 'boundaryRules'
          ? original.decisionId === decision.questionId
          : owned[key].includes(original.id);
      if (!related) throw new Error(`prepared_effect_outside_decision:${key}:${index}`);
      if (key === 'dimensions'
        ? value.kind !== original.kind || value.subjectId !== original.subjectId
        : value.id !== original.id) throw new Error(`prepared_effect_identity_changed:${key}:${index}`);
    }
  }
}

export function applyPreparedAnswers(specification, answers, humanResolutions, intentEvidence) {
  if (!hasPreparedAnswers(specification, answers)) throw new Error('prepared_effect_unavailable');
  const draft = globalThis.structuredClone(specification);
  const touched = new Map();
  const selected = new Map();
  for (const answer of answers) {
    if (selected.has(answer.questionId)) throw new Error('prepared_effect_duplicate_answer');
    const decision = specification.decisions.find(({ questionId }) => questionId === answer.questionId);
    const option = decision.answers.find(({ id }) => id === answer.answerId);
    assertPreparedEffectScope(specification, decision, option.preparedEffect);
    replacePreparedEntries(draft, option.preparedEffect, touched);
    selected.set(answer.questionId, { decision, option });
  }
  for (const { decision, option } of selected.values()) {
    const authority = { source: 'USER_DECISION', reference: decision.questionId };
    for (const requirement of draft.requirements) {
      if (decision.requirementIds.includes(requirement.id)) requirement.basis.push(authority);
    }
    for (const { index } of option.preparedEffect.dimensions) {
      const dimension = draft.determinismReview.dimensions[index];
      if (dimension.status !== 'SPECIFIED') throw new Error('prepared_effect_dimension_not_closed');
      dimension.basis.push(authority);
      dimension.closureAuthority = 'HUMAN_DECISION';
      dimension.targetIds = dimension.targetIds.filter((id) => id !== decision.questionId);
    }
  }
  for (const requirement of draft.requirements) {
    requirement.acceptanceCases = requirement.acceptanceCases.filter((test) => {
      const choice = selected.get(test.decisionBinding?.questionId);
      return choice === undefined || test.decisionBinding.answerId === choice.option.id;
    }).map((test) => selected.has(test.decisionBinding?.questionId)
      ? { ...test, decisionBinding: null } : test);
  }
  draft.unknowns = draft.unknowns.filter(({ decisionId }) => !selected.has(decisionId));
  draft.decisions = draft.decisions.filter(({ questionId }) => !selected.has(questionId));
  for (const rule of draft.boundaryRules) {
    if (selected.has(rule.decisionId)) rule.decisionId = null;
  }
  for (const assessment of draft.policyAssessments) {
    // A policy change must be reanalysed, not silently declared compliant.
    if (selected.has(assessment.decisionId)) throw new Error('prepared_effect_requires_policy_review');
  }
  for (const finding of draft.adversarialReview.findings) {
    if (finding.targetIds.some((id) => selected.has(id))) {
      finding.response = [...new Set(finding.targetIds.flatMap((id) => (
        selected.has(id) ? [selected.get(id).option.contractEffect] : []
      )))].join('\n');
      finding.targetIds = [...new Set(finding.targetIds.flatMap((id) => (
        selected.get(id)?.decision.requirementIds ?? [id]
      )))];
      finding.disposition = 'REQUIREMENT';
    }
  }
  const dimensions = draft.determinismReview.dimensions;
  draft.determinismReview.status = dimensions.length === 0 ? 'NOT_APPLICABLE'
    : dimensions.some(({ status }) => ['DECISION_REQUIRED', 'GAP_FOUND'].includes(status))
      ? 'GAPS_FOUND' : 'SEMANTICALLY_CLOSED';
  draft.closureCertificate = generateClosureCertificate({
    specification: { ...draft, intentEvidence }, humanResolutions,
  });
  return draft;
}

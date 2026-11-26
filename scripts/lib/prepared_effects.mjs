import { canonicalDigest } from './canonical_json.mjs';
import { computeDeterminismReviewStatus } from './closure/v7_rules.mjs';
import { generateClosureCertificate } from './semantic_closure.mjs';

export const effectCollections = ['requirements', 'invariants', 'risks', 'boundaryRules', 'dimensions'];

export function effectCollection(specification, key) {
  return key === 'dimensions' ? specification.determinismReview.dimensions : specification[key];
}

function applyPatch(target, patch) {
  for (const [prop, patchVal] of Object.entries(patch)) {
    if (prop === 'acceptanceCases' && Array.isArray(patchVal)) {
      for (const casePatch of patchVal) {
        const caseIndex = casePatch.index;
        if (target.acceptanceCases && target.acceptanceCases[caseIndex]) {
          const currentCase = target.acceptanceCases[caseIndex];
          for (const [cProp, cVal] of Object.entries(casePatch)) {
            if (cProp !== 'index' && cVal !== undefined) {
              currentCase[cProp] = cVal;
            }
          }
        }
      }
    } else if (prop === 'proofObligation' && patchVal && typeof patchVal === 'object') {
      target.proofObligation = {
        ...(target.counterexampleWitness?.id ? { witnessId: target.counterexampleWitness.id } : {}),
        resolutionParameter: null,
        observables: [],
        ...(target.proofObligation ?? {}),
        ...patchVal,
      };
      if (target.proofObligation.resolutionParameter === undefined) {
        target.proofObligation.resolutionParameter = null;
      }
    } else if (patchVal !== undefined) {
      target[prop] = patchVal;
    }
  }
}

function entryPatchSlots(key, entry) {
  const base = `${key}:${entry.index}`;
  if (entry.patch === undefined) return [{ slot: base, wholeObject: true }];
  const slots = [];
  for (const [prop, val] of Object.entries(entry.patch)) {
    if (prop === 'acceptanceCases' && Array.isArray(val)) {
      for (const casePatch of val) {
        for (const cProp of Object.keys(casePatch)) {
          if (cProp !== 'index') slots.push({ slot: `${base}.acceptanceCases:${casePatch.index}.${cProp}`, wholeObject: false });
        }
      }
    } else {
      slots.push({ slot: `${base}.${prop}`, wholeObject: false });
    }
  }
  return slots.length > 0 ? slots : [{ slot: base, wholeObject: true }];
}

function recordSlotConflict(touched, slot, digest, base, wholeObject = false) {
  if (wholeObject) {
    for (const existing of touched.keys()) {
      if ((existing === base || existing.startsWith(`${base}.`)) && touched.get(existing) !== digest) {
        throw new Error(`prepared_effect_conflict:${base}`);
      }
    }
  } else if ((touched.has(base) && touched.get(base) !== digest)
    || (touched.has(slot) && touched.get(slot) !== digest)) {
    throw new Error(`prepared_effect_conflict:${base}`);
  }
  touched.set(slot, digest);
}

function collectStateModelPatchSpecs(specification, stateModelEffect) {
  if (!stateModelEffect || typeof stateModelEffect !== 'object') return [];
  const specs = [];
  const sm = specification?.stateModel ?? {};
  for (const entry of (stateModelEffect.operations ?? [])) {
    const target = sm.operations?.[entry.index];
    specs.push({
      key: 'stateModel.operations',
      base: `stateModel.operations:${entry.index}`,
      target,
      patch: entry.patch,
      missingCode: `prepared_effect_index_out_of_range:stateModel.operations:${entry.index}`,
    });
  }
  for (const entry of (stateModelEffect.fields ?? [])) {
    const target = sm.entities?.[entry.entityIndex]?.fields?.[entry.fieldIndex];
    specs.push({
      key: 'stateModel.fields',
      base: `stateModel.entities:${entry.entityIndex}.fields:${entry.fieldIndex}`,
      target,
      patch: entry.patch,
      missingCode: `prepared_effect_index_out_of_range:stateModel.fields:${entry.entityIndex}:${entry.fieldIndex}`,
    });
  }
  for (const entry of (stateModelEffect.observables ?? [])) {
    const target = sm.observables?.[entry.index];
    specs.push({
      key: 'stateModel.observables',
      base: `stateModel.observables:${entry.index}`,
      target,
      patch: entry.patch,
      missingCode: `prepared_effect_index_out_of_range:stateModel.observables:${entry.index}`,
    });
  }
  return specs;
}

// Replace or patch existing typed entries: no arbitrary paths, identifiers or envelope writes.
export function replacePreparedEntries(specification, effect, touched = new Map()) {
  if (effect.interpretation !== undefined) {
    const digest = canonicalDigest({ interpretation: effect.interpretation });
    recordSlotConflict(touched, 'interpretation', digest, 'interpretation');
    specification.interpretation = effect.interpretation;
  }
  for (const spec of collectStateModelPatchSpecs(specification, effect.stateModel)) {
    if (spec.target === undefined) throw new Error(spec.missingCode);
    const digest = canonicalDigest({ patch: spec.patch });
    for (const prop of Object.keys(spec.patch)) {
      recordSlotConflict(touched, `${spec.base}.${prop}`, digest, spec.base);
    }
    applyPatch(spec.target, spec.patch);
  }
  for (const key of effectCollections) {
    const collection = effectCollection(specification, key);
    const seen = new Set();
    for (const entry of (effect[key] ?? [])) {
      const { index, value, patch } = entry;
      if (!Number.isInteger(index) || index < 0 || collection[index] === undefined) {
        throw new Error(`prepared_effect_index_out_of_range:${key}:${index}`);
      }
      const base = `${key}:${index}`;
      if (seen.has(base)) throw new Error(`prepared_effect_duplicate_target:${base}`);
      seen.add(base);
      const digest = canonicalDigest(patch !== undefined ? { patch } : value);
      for (const { slot, wholeObject } of entryPatchSlots(key, entry)) {
        recordSlotConflict(touched, slot, digest, base, wholeObject);
      }
      if (patch !== undefined) {
        applyPatch(collection[index], patch);
      } else {
        collection[index] = globalThis.structuredClone(value);
      }
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

function assertPreparedEffectScope(specification, decision, effect) {
  const owned = {
    requirements: decision.requirementIds,
    invariants: decision.invariantIds,
    risks: decision.riskIds,
  };
  for (const spec of collectStateModelPatchSpecs(specification, effect.stateModel)) {
    if (spec.target === undefined) throw new Error(spec.missingCode);
  }
  for (const key of effectCollections) {
    for (const entry of (effect[key] ?? [])) {
      const { index, value } = entry;
      const original = effectCollection(specification, key)[index];
      if (original === undefined) throw new Error(`prepared_effect_index_out_of_range:${key}:${index}`);
      const related = key === 'dimensions'
        ? original.targetIds.includes(decision.questionId)
        : key === 'boundaryRules'
          ? original.decisionId === decision.questionId
          : owned[key].includes(original.id);
      if (!related) throw new Error(`prepared_effect_outside_decision:${key}:${index}`);
      if (value !== undefined) {
        if (key === 'dimensions'
          ? value.kind !== original.kind || value.subjectId !== original.subjectId
          : value.id !== original.id) throw new Error(`prepared_effect_identity_changed:${key}:${index}`);
      }
    }
  }
}

export function cartesianProduct(lists) {
  if (lists.length === 0) return [];
  let acc = [[]];
  for (const list of lists) {
    const next = [];
    for (const prefix of acc) {
      for (const item of list) {
        next.push([...prefix, item]);
      }
    }
    acc = next;
  }
  return acc;
}

export function assertPreparedEffectsDisjoint(decisions = []) {
  const owners = new Map();
  const baseOwners = new Map();
  for (const decision of decisions) {
    const seenSlots = new Set();
    const seenBases = new Set();
    for (const answer of (decision.answers ?? [])) {
      if (!answer.preparedEffect) continue;
      if (answer.preparedEffect.interpretation !== undefined) {
        const owner = owners.get('interpretation');
        if (owner && owner !== decision.questionId) {
          throw new Error(`shared_prepared_effect_target:interpretation:0:${owner}:${decision.questionId}`);
        }
        seenSlots.add('interpretation');
      }
      for (const spec of collectStateModelPatchSpecs({ stateModel: {} }, answer.preparedEffect.stateModel)) {
        seenBases.add(spec.base);
        for (const prop of Object.keys(spec.patch)) {
          const slot = `${spec.base}.${prop}`;
          const conflictingOwner = owners.get(slot) ?? owners.get(spec.base);
          if (conflictingOwner && conflictingOwner !== decision.questionId) {
            throw new Error(`shared_prepared_effect_target:${spec.key}:${spec.base}:${conflictingOwner}:${decision.questionId}`);
          }
          seenSlots.add(slot);
        }
      }
      for (const key of effectCollections) {
        for (const entry of (answer.preparedEffect[key] ?? [])) {
          const base = `${key}:${entry.index}`;
          seenBases.add(base);
          for (const { slot, wholeObject } of entryPatchSlots(key, entry)) {
            const conflictingOwner = wholeObject
              ? (owners.get(slot) ?? baseOwners.get(base))
              : (owners.get(slot) ?? owners.get(base));
            if (conflictingOwner && conflictingOwner !== decision.questionId) {
              throw new Error(`shared_prepared_effect_target:${key}:${entry.index}:${conflictingOwner}:${decision.questionId}`);
            }
            seenSlots.add(slot);
          }
        }
      }
    }
    for (const slot of seenSlots) owners.set(slot, decision.questionId);
    for (const base of seenBases) baseOwners.set(base, decision.questionId);
  }
}

export function applyPreparedAnswers(
  specification,
  answers,
  humanResolutions,
  intentEvidence,
  workspaceEvidence = [],
  workspaceSkeleton = null,
) {
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
    for (const { index } of (option.preparedEffect.dimensions ?? [])) {
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
  draft.determinismReview.status = computeDeterminismReviewStatus(dimensions, {
    arithmetic: draft.determinismReview.arithmetic ?? null,
    architectureContexts: draft.architectureContexts ?? [],
  });
  draft.closureCertificate = generateClosureCertificate({
    specification: {
      ...draft,
      intent: specification.intent ?? '',
      intentEvidence,
      workspaceEvidence,
      workspaceSkeleton: workspaceSkeleton ?? specification.workspaceSkeleton ?? null,
    },
    humanResolutions,
  });
  return draft;
}

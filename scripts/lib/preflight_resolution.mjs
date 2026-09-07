function fail(code) {
  throw new Error(code);
}

export function questionId(index) {
  return `Q-${String(index + 1).padStart(4, '0')}`;
}

export function questionIds(decision) {
  return decision.questions.map((_, index) => questionId(index));
}

export function selectedAnswer(question, answerId) {
  return question[7].find(([id]) => id === answerId);
}

const patchFields = ['behaviors', 'preconditions', 'invariants', 'postconditions', 'failures', 'proofs'];
const policyClauseFields = ['behaviors', 'preconditions', 'invariants', 'postconditions', 'failures'];

function policyRolesOf(field, clause) {
  const index = field === 'invariants' || field === 'failures' ? 3 : 2;
  return clause[index] ?? [];
}

function normalizedLiteral(value) {
  return value.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

function patchStatements(patch) {
  return [
    ...(patch.behaviors ?? []).map(([statement]) => statement),
    ...(patch.preconditions ?? []).map(([statement]) => statement),
    ...(patch.invariants ?? []).map(([statement]) => statement),
    ...(patch.postconditions ?? []).map(([statement]) => statement),
    ...(patch.failures ?? []).flatMap(([trigger, outcome]) => [trigger, outcome]),
    ...(patch.proofs ?? []).flatMap(([, risk, statement]) => [risk, statement]),
  ];
}

export function contractPatchCoverageError(policies, patch) {
  if (policies.length === 0) return;
  const statements = patchStatements(patch).map(normalizedLiteral);
  if (statements.length === 0) return 'question_answer_contract_patch_missing';
  for (const [, policy] of policies) {
    const literal = normalizedLiteral(policy);
    if (!statements.some((statement) => statement.includes(literal))) {
      return 'question_answer_contract_patch_policy_missing';
    }
  }
  return undefined;
}

export function contractPatchOwnershipError(policies, patch) {
  const expectedRoles = policies.map(([role]) => role);
  const replacementRoles = patch.replacesPolicyRoles ?? [];
  if (expectedRoles.length === 0) {
    return replacementRoles.length === 0 ? undefined : 'question_answer_policy_replacement_unexpected';
  }
  if (
    replacementRoles.length !== expectedRoles.length
    || replacementRoles.some((role) => !expectedRoles.includes(role))
  ) {
    return 'question_answer_policy_replacement_incomplete';
  }
  const introducedRoles = policyClauseFields.flatMap((field) => (
    (patch[field] ?? []).flatMap((clause) => policyRolesOf(field, clause))
  ));
  return expectedRoles.every((role) => introducedRoles.includes(role))
    ? undefined
    : 'question_answer_policy_replacement_without_clause';
}

function applyContractPatch(decision, patch) {
  const replacedRoles = new Set(patch.replacesPolicyRoles ?? []);
  if (replacedRoles.size > 0) {
    for (const field of policyClauseFields) {
      decision[field] = decision[field].filter((clause) => (
        !policyRolesOf(field, clause).some((role) => replacedRoles.has(role))
      ));
    }
  }
  for (const field of patchFields) {
    if (patch[field] === undefined) continue;
    decision[field].push(...patch[field]);
  }
  if (patch.stateModelGovernance !== undefined) {
    if (decision.stateModel.kind !== 'STATE_TRANSITION') fail('state_governance_patch_not_allowed');
    decision.stateModel.governance = patch.stateModelGovernance;
  }
}

export function resolvePreflightDecision(decision, resolution) {
  if (decision.status !== 'NEEDS_CONFIRMATION') {
    if (resolution !== null) fail('resolution_not_allowed');
    return { decision, clarifications: [], clarificationRoles: new Set() };
  }
  if (resolution === null) fail('resolution_required');

  const answersByQuestion = new Map(resolution.answers.map((answer) => [answer.questionId, answer]));
  const statePolicies = new Map();
  const clarifications = [];

  decision.questions.forEach((question, index) => {
    const id = questionId(index);
    const answer = answersByQuestion.get(id);
    if (answer === undefined) fail('resolution_answers_mismatch');
    if (answer.action === 'CORRECT_INTERPRETATION') fail('resolution_requires_semantic_revision');
    const selected = selectedAnswer(question, answer.answerId);
    if (selected === undefined) fail(`resolution_unknown_answer:${id}`);
    const [answerId, label, rationale, resolutionClause, policies, contractPatch] = selected;
    const coverageError = contractPatchCoverageError(policies, contractPatch);
    if (coverageError !== undefined) fail(coverageError);
    clarifications.push({
      questionId: id,
      answerId,
      recommended: answerId === question[4],
      label,
      rationale,
      statement: resolutionClause,
    });
    for (const [role, statement] of policies) {
      if (statePolicies.has(role)) fail(`resolution_duplicate_state_policy:${role.toLowerCase()}`);
      statePolicies.set(role, statement);
    }
  });

  const unresolvedRoles = decision.stateSemantics
    .filter(([, disposition]) => disposition === 'QUESTION_REQUIRED')
    .map(([role]) => role);
  if (unresolvedRoles.length !== statePolicies.size || unresolvedRoles.some((role) => !statePolicies.has(role))) {
    fail('resolution_state_policy_coverage_invalid');
  }

  const resolved = JSON.parse(JSON.stringify(decision));
  resolved.status = 'CLARIFIED';
  resolved.questions = [];
  resolved.stateSemantics = resolved.stateSemantics.map(([role, disposition, statement, sourceIndexes]) => (
    disposition === 'QUESTION_REQUIRED'
      ? [role, 'EXPLICIT', statePolicies.get(role), sourceIndexes]
      : [role, disposition, statement, sourceIndexes]
  ));
  decision.questions.forEach((question, index) => {
    const answer = answersByQuestion.get(questionId(index));
    const selected = selectedAnswer(question, answer.answerId);
    applyContractPatch(resolved, selected[5]);
  });
  return { decision: resolved, clarifications, clarificationRoles: new Set(statePolicies.keys()) };
}

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
    const [answerId, label, rationale, resolutionClause, policies] = selected;
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
  return { decision: resolved, clarifications, clarificationRoles: new Set(statePolicies.keys()) };
}

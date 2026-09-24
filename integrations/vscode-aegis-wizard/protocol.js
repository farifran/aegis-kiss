/* global module */

const confirmationSchema = 'aegis.confirmation_request.v5';
const resolutionSchema = 'aegis.semantic_resolution.v2';

function validRequest(value) {
  return value?.schema === confirmationSchema
    && value.status === 'USER_CONFIRMATION_REQUIRED'
    && /^draft-[a-f0-9]{16}$/u.test(value.executionId ?? '')
    && /^[a-f0-9]{64}$/u.test(value.contractDraftDigest ?? '')
    && value.requiredAttestation === 'CONTRACT_REVIEWED_AND_APPROVED'
    && Array.isArray(value.questions)
    && value.questionCount === value.questions.length
    && value.bulkRecommendationAction?.id === 'ACCEPT_RECOMMENDED_REMAINING'
    && typeof value.bulkRecommendationAction.label === 'string'
    && typeof value.bulkRecommendationAction.description === 'string'
    && value.questions.every((question) => (
      typeof question.presentation?.context === 'string'
      && question.presentation.context.length > 0
      && typeof question.presentation.whyHumanDecision === 'string'
      && question.presentation.whyHumanDecision.length > 0
      && typeof question.presentation.observableImpact === 'string'
      && question.presentation.observableImpact.length > 0
      && typeof question.presentation.recommendationReasoning === 'string'
      && question.presentation.recommendationReasoning.length > 0
      && Array.isArray(question.presentation.glossary)
      && Array.isArray(question.answers)
      && Array.isArray(question.distinguishingCase?.outcomes)
      && typeof question.traceability === 'object'
    ));
}

function recommendedAnswersFrom(request, startIndex) {
  return request.questions.slice(startIndex).map((question) => ({
    questionId: question.id,
    answerId: question.recommendedAnswerId,
  }));
}

function validResolutionForRequest(value, request) {
  return value?.schema === resolutionSchema
    && value.executionId === request.executionId
    && value.contractDraftDigest === request.contractDraftDigest
    && value.method === 'INTERACTIVE_WIZARD'
    && ['DECISIONS_REVIEWED_AND_CONFIRMED', 'CONTRACT_REVIEWED_AND_APPROVED']
      .includes(value.attestation)
    && Array.isArray(value.answers);
}

function requiresSemanticRevision(request, answers) {
  const questions = new Map(request.questions.map((question) => [question.id, question]));
  for (const answer of answers) {
    const question = questions.get(answer.questionId);
    if (question === undefined) return true;
    if ('correction' in answer) return true;
    const selected = question.answers.find(({ id }) => id === answer.answerId);
    if (selected === undefined || selected.requiresSemanticRevision) return true;
  }
  return false;
}

function buildResolution(request, answers) {
  const semanticRevisionRequired = requiresSemanticRevision(request, answers);
  return {
    resolution: {
      schema: resolutionSchema,
      executionId: request.executionId,
      contractDraftDigest: request.contractDraftDigest,
      method: 'INTERACTIVE_WIZARD',
      attestation: semanticRevisionRequired
        ? 'DECISIONS_REVIEWED_AND_CONFIRMED'
        : 'CONTRACT_REVIEWED_AND_APPROVED',
      answers,
    },
    semanticRevisionRequired,
  };
}

module.exports = {
  buildResolution,
  recommendedAnswersFrom,
  validRequest,
  validResolutionForRequest,
};

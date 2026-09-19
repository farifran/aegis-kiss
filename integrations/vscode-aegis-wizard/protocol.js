/* global module */

const confirmationSchema = 'aegis.confirmation_request.v4';
const resolutionSchema = 'aegis.semantic_resolution.v2';

function validRequest(value) {
  return value?.schema === confirmationSchema
    && value.status === 'USER_CONFIRMATION_REQUIRED'
    && /^draft-[a-f0-9]{16}$/u.test(value.executionId ?? '')
    && /^[a-f0-9]{64}$/u.test(value.contractDraftDigest ?? '')
    && value.requiredAttestation === 'CONTRACT_REVIEWED_AND_APPROVED'
    && Array.isArray(value.questions);
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

function requiresRecompilation(request, answers) {
  const questions = new Map(request.questions.map((question) => [question.id, question]));
  return answers.some((answer) => (
    'correction' in answer
      || questions.get(answer.questionId)?.recommendedAnswerId !== answer.answerId
  ));
}

function buildResolution(request, answers) {
  const recompilationRequired = requiresRecompilation(request, answers);
  return {
    resolution: {
      schema: resolutionSchema,
      executionId: request.executionId,
      contractDraftDigest: request.contractDraftDigest,
      method: 'INTERACTIVE_WIZARD',
      attestation: recompilationRequired
        ? 'DECISIONS_REVIEWED_AND_CONFIRMED'
        : 'CONTRACT_REVIEWED_AND_APPROVED',
      answers,
    },
    recompilationRequired,
  };
}

module.exports = { buildResolution, validRequest, validResolutionForRequest };

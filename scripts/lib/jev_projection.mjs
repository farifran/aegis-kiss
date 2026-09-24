import { canonicalDigest } from './canonical_json.mjs';
import { assertSchema } from './schema_validator.mjs';

const fragmentCriteria = {
  OBLIGATION: 'O fragmento contém exigência que pode originar obrigação normativa.',
  PROHIBITION: 'O fragmento contém comportamento explicitamente proibido.',
  GOAL: 'O fragmento contém objetivo qualitativo que não é obrigação falsificável por si só.',
  OPTION: 'O fragmento contém sugestão ou possibilidade não obrigatória.',
  EXAMPLE: 'O fragmento contém ilustração que não limita sozinha a solução.',
  AMBIGUITY: 'O fragmento contém ausência ou conflito que pode alterar comportamento observável.',
  CONTEXT_ONLY: 'O fragmento fornece contexto sem claim contratual próprio.',
  MIXED_OR_UNCLEAR: 'O fragmento mistura papéis ou não permite classificação primária segura.',
};

function withoutDigest(value, digestField) {
  const { [digestField]: digest, ...payload } = value;
  void digest;
  return payload;
}

export function assertJevDecisionBatch(batch, semanticRequest = null) {
  assertSchema('aegis.jev_decision_batch.v2', batch);
  if (batch.batchDigest !== canonicalDigest(withoutDigest(batch, 'batchDigest'))) {
    throw new Error('jev_batch_digest_mismatch');
  }
  const questionIds = Object.keys(batch.questions).sort();
  const bindingIds = Object.keys(batch.bindings).sort();
  if (JSON.stringify(questionIds) !== JSON.stringify(bindingIds)) {
    throw new Error('jev_batch_bindings_mismatch');
  }
  if (batch.projection.questionCount !== questionIds.length
    || batch.projection.fragmentCount !== batch.state.fragments.length
    || questionIds.length !== batch.state.fragments.length) {
    throw new Error('jev_batch_projection_counts_mismatch');
  }
  if (semanticRequest !== null) {
    if (batch.sourceSemanticRequestDigest !== semanticRequest.requestDigest
      || batch.sourceEvidenceDigest !== semanticRequest.intentEvidence.evidenceDigest) {
      throw new Error('jev_batch_source_mismatch');
    }
    for (const fragment of batch.state.fragments) {
      const source = semanticRequest.intent.slice(fragment.startOffset, fragment.endOffset);
      const expected = source.length <= 240 ? source : `${source.slice(0, 239)}…`;
      if (fragment.anchor !== expected) throw new Error(`jev_fragment_binding_mismatch:${fragment.id}`);
    }
  }
}

export function buildJevDecisionBatch(semanticRequest) {
  assertSchema('aegis.semantic_request.v10', semanticRequest);
  if (semanticRequest.requestDigest
    !== canonicalDigest(withoutDigest(semanticRequest, 'requestDigest'))) {
    throw new Error('semantic_request_digest_mismatch');
  }
  const questions = {};
  const bindings = {};
  for (const fragment of semanticRequest.intentEvidence.fragments) {
    const questionId = `fragment.${fragment.id}`;
    questions[questionId] = {
      type: 'choice',
      instructions: `Classifique o papel semântico primário de ${fragment.id}. Use MIXED_OR_UNCLEAR quando houver mais de um claim ou contexto insuficiente.`,
      criteria: fragmentCriteria,
    };
    bindings[questionId] = {
      family: 'INTENT_FRAGMENT',
      subjectId: fragment.id,
      semanticTarget: 'CLAIM_KIND_CANDIDATE',
      allowedUse: 'SHADOW_METRIC_ONLY',
    };
  }
  const payload = {
    schema: 'aegis.jev_decision_batch.v2',
    sourceSemanticRequestDigest: semanticRequest.requestDigest,
    sourceEvidenceDigest: semanticRequest.intentEvidence.evidenceDigest,
    protocol: {
      provider: 'TYPESAFE_JEV',
      transport: 'VERCEL_AI_GATEWAY',
      questionMode: 'PARALLEL_CHOICE',
      authority: 'ADVISORY_ONLY',
      purpose: 'SHADOW_EVALUATION',
    },
    state: {
      intent: semanticRequest.intent,
      fragments: semanticRequest.intentEvidence.fragments,
    },
    questions,
    bindings,
    projection: {
      questionCount: Object.keys(questions).length,
      fragmentCount: semanticRequest.intentEvidence.fragments.length,
      omittedSections: [
        'CONSTITUTION_TEXT',
        'SOURCE_EVIDENCE',
        'OUTPUT_SCHEMA',
        'COMPILER_OWNED_FIELDS',
      ],
    },
  };
  const batch = { ...payload, batchDigest: canonicalDigest(payload) };
  assertJevDecisionBatch(batch, semanticRequest);
  return batch;
}

export function assertJevAssessment(assessment, batch) {
  assertJevDecisionBatch(batch);
  assertSchema('aegis.jev_assessment.v1', assessment);
  if (assessment.assessmentDigest
    !== canonicalDigest(withoutDigest(assessment, 'assessmentDigest'))) {
    throw new Error('jev_assessment_digest_mismatch');
  }
  if (assessment.sourceBatchDigest !== batch.batchDigest) {
    throw new Error('jev_assessment_source_mismatch');
  }
  const questionIds = Object.keys(batch.questions).sort();
  const answerIds = Object.keys(assessment.answers).sort();
  if (JSON.stringify(questionIds) !== JSON.stringify(answerIds)) {
    throw new Error('jev_assessment_answers_mismatch');
  }
  for (const questionId of questionIds) {
    const criteriaIds = Object.keys(batch.questions[questionId].criteria).sort();
    const answer = assessment.answers[questionId];
    const probabilityIds = Object.keys(answer.probabilities).sort();
    if (!criteriaIds.includes(answer.choice)
      || JSON.stringify(criteriaIds) !== JSON.stringify(probabilityIds)) {
      throw new Error(`jev_assessment_choice_space_mismatch:${questionId}`);
    }
    const probabilityTotal = Object.values(answer.probabilities)
      .reduce((total, probability) => total + probability, 0);
    if (Math.abs(probabilityTotal - 1) > 1e-3) {
      throw new Error(`jev_assessment_probability_sum_mismatch:${questionId}`);
    }
    const selectedProbability = answer.probabilities[answer.choice];
    if (Math.max(...Object.values(answer.probabilities)) - selectedProbability > 1e-3) {
      throw new Error(`jev_assessment_selected_choice_mismatch:${questionId}`);
    }
  }
}

import { canonicalDigest } from './canonical_json.mjs';
import { assertSchema } from './schema_validator.mjs';

const intentCriteria = {
  OBLIGATION: 'Exigência que deve produzir uma obrigação normativa no contrato.',
  PROHIBITION: 'Comportamento explicitamente proibido pela intenção.',
  GOAL: 'Objetivo qualitativo não falsificável por si só.',
  OPTION: 'Possibilidade ou sugestão que não cria obrigação.',
  EXAMPLE: 'Exemplo ilustrativo que não limita sozinho a solução.',
  AMBIGUITY: 'Ausência ou conflito que pode alterar comportamento observável.',
  UNCERTAIN: 'O trecho não permite classificação segura entre as opções anteriores.',
};

const policyCriteria = {
  COMPLIANT: 'A intenção é compatível com a regra arquitetural indicada.',
  CONFLICT: 'A intenção solicita algo incompatível com a regra arquitetural indicada.',
  UNCERTAIN: 'O estado fornecido não permite concluir compatibilidade ou conflito.',
};

const determinismCriteria = {
  RULE_EVIDENCED: 'Existe no estado uma regra concreta candidata a resolver exatamente o witness.',
  GAP_FOUND: 'A dimensão é aplicável, mas falta regra concreta para o comportamento observável.',
  DECISION_REQUIRED: 'Há ao menos duas alternativas materiais compatíveis que exigem escolha humana.',
  NOT_APPLICABLE: 'Uma regra estrutural explícita exclui a operação ou classe de entrada do witness.',
  UNCERTAIN: 'Não é possível classificar com segurança usando somente o estado fornecido.',
};

const complexityCriteria = {
  NO_EXCESS: 'A intenção não sugere complexidade arquitetural desnecessária.',
  SIMPLIFICATION_CANDIDATE: 'Há sugestões opcionais de complexidade que podem ser podadas por KISS.',
  COMPLEXITY_JUSTIFIED: 'A complexidade está ligada a comportamento observável explicitamente exigido.',
  UNCERTAIN: 'O estado não permite avaliar a necessidade da complexidade citada.',
};

const representationCriteria = {
  BITMASK_LAYOUT: 'Largura total de uma máscara composta por campos posicionais.',
  BIT_FIELD: 'Campo que ocupa uma posição ou faixa dentro de uma máscara.',
  PROJECTION_WIDTH: 'Quantidade de bits extraída ou projetada de outro valor.',
  HASH_WIDTH: 'Largura de hash, fingerprint ou raiz de integridade.',
  OTHER: 'Representação finita com outro papel observável.',
  UNCERTAIN: 'O estado não permite determinar o papel da representação.',
};

const jevReviewSignalKinds = new Set(['INCOMPLETE_EXPRESSION', 'BIT_LAYOUT_ISSUE']);

function withoutDigest(value, digestField) {
  const { [digestField]: digest, ...payload } = value;
  void digest;
  return payload;
}

function policyState(request) {
  const rulesById = new Map(request.policy.rules.map((rule) => [rule.id, rule]));
  const grouped = new Map();
  for (const signal of request.policy.signals) {
    const current = grouped.get(signal.ruleId) ?? { signalKinds: new Set(), references: new Set() };
    current.signalKinds.add(signal.kind);
    current.references.add(signal.reference);
    grouped.set(signal.ruleId, current);
  }
  return [...grouped.entries()].map(([ruleId, signals], index) => {
    const rule = rulesById.get(ruleId);
    if (rule === undefined) throw new Error(`jev_projection_unknown_policy_rule:${ruleId}`);
    return {
      id: `POLICY-REVIEW-${String(index + 1).padStart(4, '0')}`,
      ruleId,
      signalKinds: [...signals.signalKinds].sort(),
      references: [...signals.references].sort(),
      ruleLevel: rule.level,
      ruleStatement: rule.statement,
    };
  });
}

function addQuestion(questions, bindings, id, question, binding) {
  if (Object.hasOwn(questions, id)) throw new Error(`jev_projection_duplicate_question:${id}`);
  questions[id] = question;
  bindings[id] = { ...binding, allowedUse: 'CANDIDATE_ONLY' };
}

export function assertJevDecisionBatch(batch, semanticRequest = null) {
  assertSchema('aegis.jev_decision_batch.v1', batch);
  if (batch.batchDigest !== canonicalDigest(withoutDigest(batch, 'batchDigest'))) {
    throw new Error('jev_batch_digest_mismatch');
  }
  const questionIds = Object.keys(batch.questions).sort();
  const bindingIds = Object.keys(batch.bindings).sort();
  if (JSON.stringify(questionIds) !== JSON.stringify(bindingIds)) {
    throw new Error('jev_batch_bindings_mismatch');
  }
  if (batch.projection.questionCount !== questionIds.length
    || batch.projection.intentQuestionCount
      !== Object.values(batch.bindings).filter(({ family }) => family === 'INTENT_SIGNAL').length
    || batch.projection.policyQuestionCount
      !== Object.values(batch.bindings).filter(({ family }) => family === 'POLICY_SIGNAL').length
    || batch.projection.determinismQuestionCount
      !== Object.values(batch.bindings).filter(({ family }) => (
        family === 'DETERMINISM_ACTIVATION'
      )).length
    || batch.projection.finiteRepresentationQuestionCount
      !== Object.values(batch.bindings).filter(({ family }) => (
        family === 'FINITE_REPRESENTATION'
      )).length
    || batch.projection.complexityQuestionCount
      !== Object.values(batch.bindings).filter(({ family }) => family === 'COMPLEXITY_REVIEW').length) {
    throw new Error('jev_batch_projection_counts_mismatch');
  }
  if (semanticRequest !== null) {
    if (batch.sourceSemanticRequestDigest !== semanticRequest.requestDigest
      || batch.sourceWorksheetDigest !== semanticRequest.worksheetDigest) {
      throw new Error('jev_batch_source_mismatch');
    }
  }
}

export function buildJevDecisionBatch(semanticRequest) {
  assertSchema('aegis.semantic_request.v9', semanticRequest);
  if (semanticRequest.requestDigest
    !== canonicalDigest(withoutDigest(semanticRequest, 'requestDigest'))) {
    throw new Error('semantic_request_digest_mismatch');
  }

  const policySignals = policyState(semanticRequest);
  const reviewSignals = semanticRequest.intentSignals.signals.filter(({ kind }) => (
    jevReviewSignalKinds.has(kind)
  ));
  const determinismActivations = semanticRequest.worksheet.determinismActivations
    .map(({ id, dimension, subject, triggerReference, counterexampleWitness }) => ({
      id,
      dimension,
      subject,
      triggerReference,
      counterexampleWitness,
    }));
  const unclassifiedFiniteRepresentations = semanticRequest.worksheet.finiteRepresentations
    .filter(({ role }) => role === 'UNCLASSIFIED');
  const questions = {};
  const bindings = {};

  for (const signal of reviewSignals) {
    const id = `intent.${signal.id}`;
    addQuestion(questions, bindings, id, {
      type: 'choice',
      instructions: `Classifique o papel semântico do sinal ${signal.id} sem criar obrigação ausente.`,
      criteria: intentCriteria,
    }, {
      family: 'INTENT_SIGNAL',
      subjectId: signal.id,
      semanticTarget: 'INTENT_CLAIM_KIND',
    });
  }

  for (const signal of policySignals) {
    const id = `policy.${signal.id}`;
    addQuestion(questions, bindings, id, {
      type: 'choice',
      instructions: `Avalie a compatibilidade da intenção com a regra ${signal.ruleId}.`,
      criteria: policyCriteria,
    }, {
      family: 'POLICY_SIGNAL',
      subjectId: signal.id,
      semanticTarget: 'POLICY_DEMAND_STATUS',
    });
  }

  for (const activation of determinismActivations) {
    const id = `determinism.${activation.id}`;
    addQuestion(questions, bindings, id, {
      type: 'choice',
      instructions: `Pré-classifique ${activation.dimension} para o sujeito ${activation.subject.key}; fechamento exige prova posterior do Harness.`,
      criteria: determinismCriteria,
    }, {
      family: 'DETERMINISM_ACTIVATION',
      subjectId: activation.id,
      semanticTarget: 'DETERMINISM_PRECLASSIFICATION',
    });
  }

  for (const representation of unclassifiedFiniteRepresentations) {
    const id = `representation.${representation.id}`;
    addQuestion(questions, bindings, id, {
      type: 'choice',
      instructions: `Classifique o papel observável da representação finita ${representation.id}.`,
      criteria: representationCriteria,
    }, {
      family: 'FINITE_REPRESENTATION',
      subjectId: representation.id,
      semanticTarget: 'REPRESENTATION_ROLE',
    });
  }

  addQuestion(questions, bindings, 'complexity.global', {
    type: 'choice',
    instructions: 'Avalie se a intenção contém complexidade arquitetural que o princípio KISS permite simplificar.',
    criteria: complexityCriteria,
  }, {
    family: 'COMPLEXITY_REVIEW',
    subjectId: 'PUBLIC_CONTRACT',
    semanticTarget: 'COMPLEXITY_STATUS',
  });

  const questionCount = Object.keys(questions).length;
  if (questionCount > 255) throw new Error(`jev_question_limit_exceeded:${questionCount}`);
  const payload = {
    schema: 'aegis.jev_decision_batch.v1',
    sourceSemanticRequestDigest: semanticRequest.requestDigest,
    sourceWorksheetDigest: semanticRequest.worksheetDigest,
    protocol: {
      provider: 'TYPESAFE_JEV',
      transport: 'VERCEL_AI_GATEWAY',
      questionMode: 'PARALLEL_CHOICE',
      authority: 'ADVISORY_ONLY',
      onUnavailable: 'BYPASS_TO_SEMANTIC_MODEL',
      onUncertain: 'FULL_SEMANTIC_REVIEW',
    },
    state: {
      intent: semanticRequest.intent,
      revision: semanticRequest.revision,
      reviewSignals,
      policyReviews: policySignals,
      determinismActivations,
      unclassifiedFiniteRepresentations,
    },
    questions,
    bindings,
    projection: {
      questionCount,
      intentQuestionCount: reviewSignals.length,
      policyQuestionCount: policySignals.length,
      determinismQuestionCount: determinismActivations.length,
      finiteRepresentationQuestionCount: unclassifiedFiniteRepresentations.length,
      complexityQuestionCount: 1,
      mechanicallySettledIntentSignalCount:
        semanticRequest.intentSignals.signals.length - reviewSignals.length,
      omittedSections: [
        'CONSTITUTION_TEXT',
        'SOURCE_EVIDENCE',
        'OUTPUT_SCHEMA',
        'COMPILER_OWNED_FIELDS',
        'MECHANICALLY_SETTLED_SIGNALS',
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
    const maximumProbability = Math.max(...Object.values(answer.probabilities));
    if (maximumProbability - selectedProbability > 1e-3) {
      throw new Error(`jev_assessment_selected_choice_mismatch:${questionId}`);
    }
  }
}

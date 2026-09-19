const diagnostics = new Map([
  ['ACTIVE_PREFLIGHT_NOT_GOVERNED', {
    message: 'O preflight ativo não é o mesmo que originou o contrato governado.',
    remediation: 'Conclua a deliberação e assine um novo contrato para a demanda ativa.',
    ruleId: 'CONST-EVIDENCE',
  }],
  ['ARCHITECTURE_POLICY_UNAVAILABLE', {
    message: 'A política arquitetural não pôde ser autenticada ou validada.',
    remediation: 'Restaure ARCHITECTURE.md e governance/architecture.policy.json para versões mutuamente vinculadas.',
  }],
  ['DECISION_ANSWERS_SEMANTICALLY_EQUIVALENT', {
    message: 'Duas alternativas produzem o mesmo resultado observável após normalização.',
    remediation: 'Remova a pergunta ou formule alternativas com efeitos contratuais realmente diferentes.',
    ruleId: 'CONST-DECISIONS',
  }],
  ['DECISION_ANSWERS_WITHOUT_DISTINCT_EFFECTS', {
    message: 'Duas alternativas descrevem o mesmo efeito contratual.',
    remediation: 'Remova a pergunta ou diferencie os resultados observáveis de cada alternativa.',
    ruleId: 'CONST-DECISIONS',
  }],
  ['DISCOVERY_EVIDENCE_MISMATCH', {
    message: 'Os fatos descobertos em src/ mudaram desde a captura da demanda.',
    remediation: 'Execute novamente a demanda para produzir um preflight vinculado ao estado atual de src/.',
    ruleId: 'CONST-EVIDENCE',
  }],
  ['HUMAN_DECISIONS_REQUIRED', {
    message: 'O contrato contém decisões materiais ainda não respondidas por uma pessoa.',
    remediation: 'Abra o Wizard, revise cada opção e confirme suas escolhas.',
    ruleId: 'CONST-DECISIONS',
  }],
  ['INAPPLICABLE_DETERMINISM_DIMENSION_WITHOUT_INDEPENDENCE_PROOF', {
    message: 'Uma dimensão foi declarada inaplicável sem provar que sua variação não altera o resultado público.',
    remediation: 'Forneça uma prova contrafactual de independência ou marque a dimensão como especificada ou pendente.',
    ruleId: 'CONST-OBSERVABLE',
  }],
  ['INVALID_SEMANTIC_OPINION', {
    message: 'O parecer da IA não satisfaz a interface semântica obrigatória.',
    remediation: 'Corrija o campo indicado em detail e gere novamente somente o parecer semântico.',
    ruleId: 'CONST-EVIDENCE',
  }],
  ['MISSING_USER_CONFIRMATION', {
    message: 'Não existe um pedido de confirmação vinculado ao rascunho atual.',
    remediation: 'Recompile o parecer semântico para gerar um novo pedido de confirmação.',
    ruleId: 'CONST-DECISIONS',
  }],
  ['RECOMMENDED_ANSWER_INVENTS_NUMERIC_LITERAL', {
    message: 'A alternativa recomendada introduz um número não autorizado pelas fontes confiáveis.',
    remediation: 'Remova o número inventado ou vincule a decisão a um valor fornecido pelo usuário.',
    ruleId: 'CONST-EVIDENCE',
  }],
  ['REQUIREMENT_WITHOUT_DUAL_ACCEPTANCE', {
    message: 'Um requisito não possui simultaneamente prova de sucesso e prova de falha ou limite.',
    remediation: 'Adicione casos de aceitação falsificáveis para o caminho feliz e para falha ou fronteira.',
    ruleId: 'CONST-OBSERVABLE',
  }],
  ['SEMANTIC_CONSTITUTION_UNAVAILABLE', {
    message: 'A constituição cognitiva não pôde ser autenticada ou validada.',
    remediation: 'Restaure AGENTS.md e governance/constitution.json para versões mutuamente vinculadas.',
  }],
  ['SEMANTIC_CONTEXT_MISMATCH', {
    message: 'O parecer foi produzido para uma ficha determinística diferente da ficha atual.',
    remediation: 'Solicite um novo parecer usando o semantic request atual, sem reutilizar respostas anteriores.',
    ruleId: 'CONST-EVIDENCE',
  }],
  ['SEMANTIC_RECOMPILATION_REQUIRED', {
    message: 'A decisão humana altera o comportamento recomendado no rascunho atual.',
    remediation: 'Reenvie a ficha com a decisão ao supervisor e compile um novo contrato antes de assinar.',
    ruleId: 'CONST-DECISIONS',
  }],
  ['SOURCE_SNAPSHOT_CHANGED', {
    message: 'O conteúdo de src/ mudou desde a captura da demanda.',
    remediation: 'Execute novamente a demanda para vincular o contrato ao snapshot atual.',
    ruleId: 'CONST-EVIDENCE',
  }],
  ['SPECIFIED_DETERMINISM_DIMENSION_WITHOUT_EXACT_PROOF', {
    message: 'Uma dimensão determinística foi fechada sem um único comportamento falsificável e comprovado.',
    remediation: 'Vincule uma regra concreta a um caso de aceitação exato ou mantenha a dimensão pendente.',
    ruleId: 'CONST-OBSERVABLE',
  }],
]);

function diagnosticFamily(reason) {
  if (/^(?:DECISION|ANSWER|HUMAN_RESOLUTION|RECOMMENDED_ANSWER|UNKNOWN_RESOLUTION)/u.test(reason)) {
    return {
      message: 'A decisão proposta não demonstra alternativas humanas materiais e auditáveis.',
      remediation: 'Mantenha apenas opções com resultados públicos distintos, uma recomendação e um caso que diferencie cada efeito.',
      ruleId: 'CONST-DECISIONS',
    };
  }
  if (/^(?:ACCEPTANCE|BOUNDARY|DETERMINISM|INAPPLICABLE_DETERMINISM|INVARIANT|QUALITY_CONSTRAINT|REQUIREMENT|SPECIFIED_DETERMINISM)/u.test(reason)) {
    return {
      message: 'A especificação não fecha uma fronteira observável com prova falsificável suficiente.',
      remediation: 'Defina um único comportamento de sucesso, falha ou limite e vincule-o ao requisito correspondente.',
      ruleId: 'CONST-OBSERVABLE',
    };
  }
  if (/^(?:BASIS|CLAIM|CONTRACT_|INTENT|SEMANTIC_|SOURCE_)/u.test(reason)) {
    return {
      message: 'A conclusão não está vinculada de forma válida às fontes confiáveis da demanda.',
      remediation: 'Corrija a procedência ou regenere o parecer a partir da ficha determinística atual.',
      ruleId: 'CONST-EVIDENCE',
    };
  }
  if (/^(?:COMPLEXITY|NON_NORMATIVE|POLICY_CORRECTION)/u.test(reason)) {
    return {
      message: 'A proposta preserva complexidade ou força normativa sem justificativa observável.',
      remediation: 'Remova a abstração ou exigência especulativa e mantenha a menor solução suficiente.',
      ruleId: 'CONST-KISS',
    };
  }
  return undefined;
}

export function normalizedReason(value) {
  return value.replace(/[^a-z0-9]+/giu, '_').replace(/^_+|_+$/gu, '').toUpperCase();
}

export function buildRejectionReport({ phase, reason, detail = '' }) {
  const normalized = normalizedReason(reason);
  const causeText = detail.split(':', 1)[0];
  const cause = causeText ? normalizedReason(causeText) : '';
  const causeDiagnostic = diagnostics.get(cause) ?? diagnosticFamily(cause);
  const diagnostic = causeDiagnostic ?? diagnostics.get(normalized) ?? diagnosticFamily(normalized);
  return {
    schema: 'aegis.rejection.v1',
    status: 'REJECTED',
    phase,
    reason: normalized,
    ...(detail ? { detail } : {}),
    ...(causeDiagnostic && cause !== normalized ? { cause } : {}),
    ...(diagnostic?.ruleId ? { ruleId: diagnostic.ruleId } : {}),
    ...(diagnostic ? {
      message: diagnostic.message,
      remediation: diagnostic.remediation,
    } : {}),
  };
}

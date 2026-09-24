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
  ['CONTRACT_HAS_UNRESOLVED_DETERMINISM', {
    message: 'O contrato ainda contém uma lacuna ou decisão de determinismo não resolvida.',
    remediation: 'Resolva a decisão material ou regenere o parecer com evidência autorizada antes de assinar.',
    ruleId: 'CONST-OBSERVABLE',
  }],
  ['INVALID_SEMANTIC_OPINION', {
    message: 'O parecer da IA não satisfaz a interface semântica obrigatória.',
    remediation: 'Corrija o campo indicado em detail e gere novamente somente o parecer semântico.',
    ruleId: 'CONST-EVIDENCE',
  }],
  ['JEV_GATEWAY_AUTHENTICATION_FAILED', {
    message: 'O Vercel AI Gateway recusou a credencial configurada para o JEV.',
    remediation: 'Revogue a chave exposta, gere uma nova chave e exporte-a como AI_GATEWAY_API_KEY.',
  }],
  ['JEV_GATEWAY_BILLING_REQUIRED', {
    message: 'A conta Vercel ainda não está habilitada para executar o JEV pelo AI Gateway.',
    remediation: 'Habilite a cobrança exigida pela Vercel e execute novamente ./aegis --jev-run.',
  }],
  ['JEV_GATEWAY_UNAVAILABLE', {
    message: 'O JEV não pôde ser consultado pelo Vercel AI Gateway.',
    remediation: 'Use o bypass para a IA semântica ou tente novamente quando o serviço estiver disponível.',
  }],
  ['MISSING_USER_CONFIRMATION', {
    message: 'Não existe um pedido de confirmação vinculado ao rascunho atual.',
    remediation: 'Recompile o parecer semântico para gerar um novo pedido de confirmação.',
    ruleId: 'CONST-DECISIONS',
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
  ['SEMANTIC_SUPERVISOR_CREDENTIAL_MISSING', {
    message: 'A chave do supervisor semântico não está disponível no ambiente.',
    remediation: 'Exporte a variável indicada em detail ou execute ./aegis --setup para escolher outra integração.',
  }],
  ['SEMANTIC_SUPERVISOR_EXTERNAL_IDE', {
    message: 'O supervisor configurado é uma IDE externa e não pode ser iniciado pelo CLI.',
    remediation: 'Use ./aegis --semantic-request na IDE ou configure um supervisor API com ./aegis --setup.',
  }],
  ['SEMANTIC_SUPERVISOR_MODEL_INVALID', {
    message: 'O modelo do AI Gateway não usa um identificador provider/model válido.',
    remediation: 'Execute ./aegis --setup e informe o identificador exato publicado pelo AI Gateway.',
  }],
  ['SEMANTIC_SUPERVISOR_ADAPTER_UNSUPPORTED', {
    message: 'O adaptador configurado não possui executor semântico no Aegis.',
    remediation: 'Use ai-gateway ou openai-compatible, ou entregue a ficha por ./aegis --semantic-request.',
  }],
  ['SEMANTIC_SUPERVISOR_BASE_URL_MISSING', {
    message: 'O adaptador openai-compatible não possui endereço de API configurado.',
    remediation: 'Exporte AEGIS_SUPERVISOR_BASE_URL ou configure ai-gateway em ./aegis --setup.',
  }],
  ['SEMANTIC_GATEWAY_AUTHENTICATION_FAILED', {
    message: 'A API recusou a credencial do supervisor semântico.',
    remediation: 'Revogue credenciais expostas, gere uma nova chave e atualize somente a variável de ambiente configurada.',
  }],
  ['SEMANTIC_GATEWAY_UNAVAILABLE', {
    message: 'A API do supervisor semântico não respondeu corretamente.',
    remediation: 'Tente novamente ou use ./aegis --semantic-request com um supervisor externo.',
  }],
  ['SEMANTIC_GATEWAY_REQUEST_REJECTED', {
    message: 'A API rejeitou o modelo, o contexto ou o schema da deliberação semântica.',
    remediation: 'Confira o modelo configurado e sua compatibilidade com saída JSON estruturada.',
  }],
  ['SEMANTIC_GATEWAY_RATE_LIMITED', {
    message: 'A API limitou temporariamente a chamada do supervisor semântico.',
    remediation: 'Aguarde o limite ser liberado e execute novamente; o Aegis não fez uma segunda chamada automática.',
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
  ['UNRESOLVED_SEMANTIC_GAP', {
    message: 'O parecer preservou uma lacuna sem evidência suficiente nem alternativas humanas maduras.',
    remediation: 'Não abra o Wizard ainda: obtenha uma regra autorizada, formule uma decisão material ou mantenha a demanda bloqueada.',
    ruleId: 'CONST-OBSERVABLE',
  }],
  ['APPROVAL_WITH_UNRESOLVED_SEMANTICS', {
    message: 'O contrato recebeu tentativa de aprovação enquanto ainda contém decisões ou lacunas materiais.',
    remediation: 'Resolva as decisões humanas e as lacunas bloqueantes antes de solicitar a assinatura.',
    ruleId: 'CONST-DECISIONS',
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

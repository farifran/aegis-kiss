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
  ['DECISION_WITHOUT_MATERIAL_UNKNOWN', {
    message: 'A decisão não está vinculada a uma claim de ambiguidade nem a um unknown material com base autorizada (USER_INTENT, USER_DECISION, ARCHITECTURE_POLICY ou CONSTITUTION).',
    remediation: 'Vincule a decisão a uma intentClaim com disposition DECISION ou a um unknown material com base em USER_INTENT, USER_DECISION, ARCHITECTURE_POLICY ou CONSTITUTION.',
    ruleId: 'CONST-DECISIONS',
  }],
  ['DISCOVERY_EVIDENCE_MISMATCH', {
    message: 'Os fatos descobertos em src/ mudaram desde a captura da demanda.',
    remediation: 'Execute novamente a demanda para produzir um preflight vinculado ao estado atual de src/.',
    ruleId: 'CONST-EVIDENCE',
  }],
  ['HUMAN_DECISIONS_REQUIRED', {
    message: 'O contrato contém decisões materiais ainda não respondidas por uma pessoa.',
    remediation: 'Apresente as perguntas de .harness/runtime/user_confirmation_request.json ao usuário via ask_question no chat e, após a resposta humana, execute ./aegis --resolve <questionId>=<answerId> (ou ./aegis --wizard no terminal).',
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
  ['INCOMPLETE_DETERMINISM_CLAIM_COVERAGE', {
    message: 'Uma afirmação material não recebeu revisão explícita de determinismo.',
    remediation: 'Declare as dimensões ativadas pela claim ou justifique explicitamente por que nenhuma dimensão se aplica.',
    ruleId: 'CONST-OBSERVABLE',
  }],
  ['ORPHAN_DETERMINISM_DIMENSION', {
    message: 'Uma dimensão de determinismo foi declarada sem vínculo com uma afirmação material.',
    remediation: 'Vincule a dimensão à claim correspondente ou remova a dimensão sem sujeito contratual.',
    ruleId: 'CONST-OBSERVABLE',
  }],
  ['SEMANTIC_COVERAGE_REGRESSION', {
    message: 'A recompilação eliminou uma dimensão semântica já identificada no contrato anterior.',
    remediation: 'Preserve a dimensão e materialize a decisão humana sem reduzir a cobertura anterior.',
    ruleId: 'CONST-OBSERVABLE',
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
  ['SEMANTIC_CODEX_FAILED', {
    message: 'O supervisor Codex não concluiu a deliberação semântica.',
    remediation: 'Confira a autenticação do Codex e execute novamente; o preflight atual pode ser reutilizado com ./aegis --semantic-run.',
  }],
  ['SEMANTIC_CODEX_INVALID_OPINION', {
    message: 'O supervisor Codex não devolveu um parecer JSON utilizável.',
    remediation: 'Execute novamente a deliberação; o Harness manterá o contrato bloqueado até receber uma saída válida.',
    ruleId: 'CONST-EVIDENCE',
  }],
  ['SEMANTIC_CODEX_MODEL_REQUIRED', {
    message: 'O supervisor Codex precisa de um modelo explícito para execução automática.',
    remediation: 'Execute ./aegis --setup e informe um modelo disponível na sua conta Codex.',
  }],
  ['SEMANTIC_IDE_ADAPTER_UNSUPPORTED', {
    message: 'O canal IDE opera via deliberação interativa no chat da IDE.',
    remediation: 'Utilize a deliberação via chat no canal IDE com ./aegis --semantic-compile. Para execução automática sem intervenção humana no terminal, configure um supervisor API (ai-gateway) em ./aegis --setup ou utilize o adaptador secundário codex.',
  }],
  ['SEMANTIC_SUPERVISOR_CREDENTIAL_MISSING', {
    message: 'A chave do supervisor semântico não está disponível no ambiente.',
    remediation: 'Exporte a variável indicada em detail ou execute ./aegis --setup para escolher outra integração.',
  }],
  ['SEMANTIC_SUPERVISOR_EXTERNAL_IDE', {
    message: 'O supervisor configurado é uma IDE externa e precisa devolver o parecer ao Harness.',
    remediation: 'Consuma a ficha emitida por ./aegis --semantic-run e devolva o parecer por ./aegis --semantic-compile.',
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
  ['MISSING_GUARD_PRECEDENCE', {
    message: 'A operação possui múltiplas guardas de validação ou rejeição, mas não define a precedência linear estrita entre elas.',
    remediation: 'Adicione no array "guardPrecedence" da operação a lista ordenada dos nomes de todas as guardas em ordem estrita de precedência.',
    ruleId: 'CONST-OBSERVABLE',
  }],
  ['UNRESOLVED_GUARD_PRECEDENCE', {
    message: 'A operação possui múltiplas guardas, mas a propriedade "guardPrecedence" está ausente ou vazia.',
    remediation: 'Especifique "guardPrecedence" com os identificadores de todas as guardas na ordem estrita de avaliação determinística.',
    ruleId: 'CONST-OBSERVABLE',
  }],
  ['MISSING_GUARD_REJECTION_BRANCH', {
    message: 'Uma guarda declarada na operação não possui branch correspondente de rejeição.',
    remediation: 'Defina um branch com "branchKind": "REJECTION" referenciando o ID da guarda e indicando o erro ou estado de destino.',
    ruleId: 'CONST-OBSERVABLE',
  }],
  ['MISSING_SUCCESS_BRANCH', {
    message: 'A operação não define nenhum branch de sucesso para quando todas as guardas forem satisfeitas.',
    remediation: 'Defina ao menos um branch com "branchKind": "SUCCESS" especificando o estado ou efeito resultante.',
    ruleId: 'CONST-OBSERVABLE',
  }],
  ['BRANCH_WITH_UNDETERMINED_NEXT_STATE', {
    message: 'O branch de execução da operação não determina o próximo estado observável da entidade.',
    remediation: 'Especifique "nextState" ou as mutações de campos no branch para garantir determinismo.',
    ruleId: 'CONST-OBSERVABLE',
  }],
  ['MISSING_TRANSITION_COVERAGE', {
    message: 'Uma transição permitida no ciclo de vida da entidade não é coberta por nenhuma operação contratual.',
    remediation: 'Crie uma operação correspondente ou restrinja o ciclo de vida para transições realmente necessárias.',
    ruleId: 'CONST-OBSERVABLE',
  }],
  ['UNRESOLVED_TRANSITION', {
    message: 'Existe uma mutação de campo declarada sem correspondência no branch de transição da operação.',
    remediation: 'Vincule a alteração do campo ao branchId e à operação que executa a transição de estado.',
    ruleId: 'CONST-OBSERVABLE',
  }],
  ['UNRESOLVED_FIELD_BOUNDS', {
    message: 'Campo numérico contínuo ou contador foi especificado sem limites explícitos ou política de saturação/rejeição.',
    remediation: 'Defina "lowerBound", "upperBound" e "boundaryBehavior" (ex.: SATURATE ou REJECT) com base em evidência literal ou decisão humana.',
    ruleId: 'CONST-OBSERVABLE',
  }],
  ['INTEGER_FIELD_WITHOUT_BOUNDS', {
    message: 'Campo inteiro sem limites formais abre margem para estouro de representação ou comportamento divergente.',
    remediation: 'Especifique limites inferior e superior autorizados ou declare ausência de limites autorizada pelo contexto.',
    ruleId: 'CONST-OBSERVABLE',
  }],
  ['UNRESOLVED_INITIALIZATION', {
    message: 'Campo da entidade sem valor ou comportamento determinístico de inicialização.',
    remediation: 'Especifique "initialValue" ou a regra explícita de inicialização da entidade no momento de criação.',
    ruleId: 'CONST-OBSERVABLE',
  }],
  ['COUNTER_WITHOUT_RESET_TRIGGER', {
    message: 'Campo que atua como contador/acumulador não possui operação ou gatilho de reset definido.',
    remediation: 'Indique a operação de reset no ciclo de vida (ex.: login bem-sucedido zera tentativas de falha).',
    ruleId: 'CONST-OBSERVABLE',
  }],
  ['STATEFUL_WITHOUT_STATE_MODEL', {
    message: 'A especificação declara estado persistente ("isStateful": true), mas não define entidades em "stateModel".',
    remediation: 'Modele as entidades e operações em "stateModel" ou marque a demanda como puramente stateless ("isStateful": false).',
    ruleId: 'CONST-KISS',
  }],
  ['INVALID_BITMASK_ALLOCATION', {
    message: 'A alocação de bits da máscara sobrepõe fatias existentes ou ultrapassa a largura máxima do campo.',
    remediation: 'Ajuste os intervalos em "bitAllocation" para garantir fatias disjuntas e limites consistentes.',
    ruleId: 'CONST-OBSERVABLE',
  }],
  ['DYNAMIC_COLLECTION_WITHOUT_CAPACITY_POLICY', {
    message: 'Coleção dinâmica em memória sem política de capacidade delimitada ("capacityPolicy").',
    remediation: 'Defina "maxEntries" e "overflowPolicy" (ex.: FIFO_EVICTION, REJECT_NEW, REPLACE_OLDEST).',
    ruleId: 'CONST-OBSERVABLE',
  }],
  ['DYNAMIC_COLLECTION_WITHOUT_ADMISSION_POLICY', {
    message: 'Coleção sem política de admissão de novos elementos ("admissionPolicy").',
    remediation: 'Defina "admissionPolicy" (ex.: ON_FIRST_REQUEST, VALIDATED_INSERTION).',
    ruleId: 'CONST-OBSERVABLE',
  }],
  ['OBSERVABLE_WITHOUT_EMPTY_BEHAVIOR', {
    message: 'Elemento observável público sem especificação de comportamento quando vazio ("emptyBehavior").',
    remediation: 'Defina "emptyBehavior" determinístico (ex.: EMPTY_COLLECTION, ZERO_VALUE, NULL_VALUE).',
    ruleId: 'CONST-OBSERVABLE',
  }],
  ['OBSERVABLE_WITHOUT_REPRESENTATION', {
    message: 'Observável público declarado sem formato canônico de representação ("representation").',
    remediation: 'Defina a representação e largura (ex.: PLAIN_INTEGER, CANONICAL_STRING, BITMASK).',
    ruleId: 'CONST-OBSERVABLE',
  }],
  ['CANONICAL_SERIALIZATION_MISSING', {
    message: 'Exigência de integridade ou hash criptográfico sem definição da serialização canônica correspondente.',
    remediation: 'Especifique "canonicalSerializations" com campos ordenados lexicograficamente ("orderingKey") e encoding UTF-8.',
    ruleId: 'CONST-OBSERVABLE',
  }],
  ['EXTERNAL_EFFECT_COVERAGE_MISSING', {
    message: 'Operação com efeito físico externo não cobre todos os ramos de confirmação ou timeout.',
    remediation: 'Especifique ações determinísticas para "onSuccess" e "onFailure" na chamada externa.',
    ruleId: 'CONST-OBSERVABLE',
  }],
  ['INCOMPLETE_EXTERNAL_EFFECT', {
    message: 'Efeito externo incompleto: faltam alvos, payload canônico ou verificação de confirmação.',
    remediation: 'Complete os dados do efeito físico externo garantindo identificador e confirmação auditável.',
    ruleId: 'CONST-OBSERVABLE',
  }],
  ['TRANSACTION_ROLLBACK_MISSING', {
    message: 'Operação que altera estado local e despacha efeito externo não possui estratégia de compensação ou rollback.',
    remediation: 'Defina "rollbackStrategy" (ex.: COMPENSATION) especificando o estorno do estado local em caso de falha externa.',
    ruleId: 'CONST-OBSERVABLE',
  }],
  ['CONTRADICTORY_RULE_DETECTED', {
    message: 'Foram detectadas regras ou guardas mutuamente contraditórias que produzem comportamento observável indeterminado.',
    remediation: 'Harmonize as condições de guarda e políticas para eliminar conflitos lógicos diretos.',
    ruleId: 'CONST-OBSERVABLE',
  }],
  ['OPEN_COMPUTATIONAL_DEPENDENCY', {
    message: 'Operação ou efeito de estado referencia termos ou campos não aterrados em variáveis computáveis.',
    remediation: 'Certifique-se de que todo termo de cálculo provenha de campos da entidade, parâmetros da operação ou literais da demanda.',
    ruleId: 'CONST-EVIDENCE',
  }],
  ['SCHEMA_VALIDATION_FAILED', {
    message: 'O parecer da IA viola restrições formais do schema JSON (propriedades obrigatórias ausentes ou tipos inválidos).',
    remediation: 'Revise os campos indicados no erro de schema e retorne apenas a estrutura JSON estritamente conforme.',
    ruleId: 'CONST-EVIDENCE',
  }],
  ['REQUIREMENT_WITHOUT_DUAL_ACCEPTANCE', {
    message: 'O requisito não possui a cobertura dual obrigatória de casos de aceite (ao menos 1 caminho feliz/fronteira e 1 rejeição/falha).',
    remediation: 'Defina casos de teste de aceitação falsificáveis "Dado / Quando / Então" cobrindo tanto o sucesso quanto o erro esperado.',
    ruleId: 'CONST-OBSERVABLE',
  }],
  ['INVALID_USER_INTENT_BASIS', {
    message: 'A base da afirmação ou requisito referencia um texto ou fato inexistente na demanda original.',
    remediation: 'Aponte apenas para trechos literais da demanda ou identificadores válidos de fatos (FACT-*) e fragmentos (FRAG-*).',
    ruleId: 'CONST-EVIDENCE',
  }],
  ['BOUNDARY_RULE_WITHOUT_EXACT_CASE_BINDING', {
    message: 'Regra de fronteira numérica declarada sem caso de teste de aceitação vinculado.',
    remediation: 'Vincule a regra de fronteira a um caso de teste que exercite o valor exato do limite.',
    ruleId: 'CONST-OBSERVABLE',
  }],
  ['NON_DELIBERABLE_POLICY_CONFLICT', {
    message: 'A demanda entra em conflito direto com uma regra arquitetural de nível rígido (hard), que proíbe deliberação humana ou flexibilização.',
    remediation: 'Ajuste a demanda para respeitar as fronteiras do produto e as políticas arquiteturais mandatadas.',
    ruleId: 'CONST-KISS',
  }],
  ['DETERMINISM_COVERAGE_NON_MATERIAL_CLAIM', {
    message: 'A revisão de determinismo declarou cobertura sobre uma claim não material (ex.: POLICY_CORRECTION ou NON_NORMATIVE).',
    remediation: 'Inclua em "determinismReview.coverage" apenas claims materiais com disposition "NORMATIVE" ou "DECISION".',
    ruleId: 'CONST-OBSERVABLE',
  }],
  ['INCOMPLETE_POLICY_ASSESSMENT', {
    message: 'O parecer omitiu a avaliação de uma ou mais regras de política arquitetural aplicáveis aos contextos selecionados.',
    remediation: 'Inclua em "policyAssessments" a avaliação explícita de todas as regras indicadas no campo "detail".',
    ruleId: 'CONST-KISS',
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
  if (/^(?:ACCEPTANCE|BOUNDARY|BRANCH|CANONICAL|COUNTER|DETERMINISM|DYNAMIC_COLLECTION|EXTERNAL_EFFECT|INAPPLICABLE_DETERMINISM|INCOMPLETE_DETERMINISM|INTEGER_FIELD|INVALID_BITMASK|INVALID_REPRESENTATION|INVARIANT|MISSING_GUARD|MISSING_SUCCESS|MISSING_TRANSITION|OBSERVABLE|ORPHAN_DETERMINISM|QUALITY_CONSTRAINT|REQUIREMENT|RESOLVED_DIMENSION|SPECIFIED_DETERMINISM|TRANSACTION_ROLLBACK|UNRESOLVED_FIELD|UNRESOLVED_GUARD|UNRESOLVED_INIT|UNRESOLVED_TRANSITION)/u.test(reason)) {
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

function normalizedReason(value) {
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

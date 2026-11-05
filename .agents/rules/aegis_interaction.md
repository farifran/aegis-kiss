# Aegis IDE Interaction & Wizard Deliberation Rules

Estas regras governam a interação de assistentes de IA (Antigravity/Gemini) com o framework Aegis durante a captura, discovery, deliberação e fechamento de contratos em demandas de software.

## 1. Proibição de Auto-Resposta e Bypassing do Wizard
- **Recomendação NUNCA é consentimento.** O Wizard existe exclusivamente para coletar decisões e aprovação humanas explícitas.
- É **TERMINANTEMENTE PROIBIDO** ao assistente/modelo auto-responder ao Wizard ou forjar decisões do usuário por meio de:
  - Comandos de shell com piping: `printf '...' | ./aegis --wizard` ou `node ... | ./aegis --wizard`
  - Redirecionamento de stdin ou heredocs para `./aegis --wizard`
  - Chamadas de `./aegis --approve` antes da escolha e confirmação humanas
  - Qualquer automação não assistida que silencie perguntas de negócio ou sanitização

## 2. Deliberação Obrigatória no Chat da IDE via `ask_question`
- Quando a compilação do contrato resultar em `DRAFT_PENDING_CONFIRMATION` ou quando houver perguntas ativas em `.harness/runtime/user_confirmation_request.json`:
  1. O assistente **DEVE** inspecionar o arquivo `.harness/runtime/user_confirmation_request.json` para extrair todas as decisões pendentes (`questions`).
  2. O assistente **DEVE** acionar a ferramenta de interface interativa `ask_question` da IDE para renderizar cada pergunta e suas alternativas diretamente no chat como um modal interativo para o usuário.
  3. No corpo da pergunta ou na resposta do chat, o assistente deve explicitar:
     - O contexto da demanda que gerou a dúvida;
     - Por que a decisão exige intervenção humana (não pode ser preenchida tacitamente);
     - O impacto observável prático no contrato/sistema;
     - O caso diferenciador (Dado / Quando / Se opção A vs Se opção B);
     - As opções disponíveis com a recomendada destacada e justificada pelo princípio KISS.
  4. O assistente **NÃO DEVE** avançar o fluxo até que o usuário tenha respondido as perguntas no modal ou no chat.
  5. Alternativamente, se o usuário preferir deliberar no terminal, o assistente deve pausar seu turno e orientar o usuário a executar `./aegis --wizard` em sua própria janela de terminal interativo.

## 3. Fluxo Pós-Deliberação Humana
- Após o usuário fazer sua escolha legítima (via `ask_question` ou resposta no chat):
  1. O assistente grava o payload em `.harness/runtime/preflight_resolution.json` com `method: "INTERACTIVE_WIZARD"` (ou o usuário utiliza `./aegis --wizard`). Quando todas as respostas selecionadas possuem `applicationMode: "PREPARED_EFFECT"`, `./aegis --approve` materializa os efeitos preparados localmente sem nova chamada à IA; caso contrário, executa-se a recompilação semântica (`./aegis --semantic-compile`).
  2. O assistente verifica que todas as decisões foram integradas na especificação normativa e que as dimensões de determinismo aplicáveis foram fechadas como `SPECIFIED`.
  3. Somente após a incorporação das escolhas (sem decisões ativas) e confirmação final expressa do usuário humano, o contrato pode ser selado com `./aegis --approve`.

## 4. Fechamento Semântico Suficiente Mínimo (`ARCH-MINIMAL-SUFFICIENT-CLOSURE`)
- **Critério de Fechamento**: Um contrato deve possuir somente as estruturas, modelos e decisões necessários para tornar os observáveis demandados computáveis e falsificáveis (`CONST-KISS` e `CONST-OBSERVABLE`). Computações puras sem estado mutável não exigem `stateModel` (`stateModel: null`).
- **O Teste das Duas Interpretações Conformes (*Two Conforming Interpretations Gate*)**:
  Antes de declarar o parecer pronto para aprovação, o assistente DEVE executar uma análise adversarial residual estrita:
  *"É possível que duas implementações independentes sigam literalmente o texto do contrato e ainda assim produzam saídas observáveis ou próximos estados divergentes sob as mesmas condições?"*
  Se a resposta for sim, o contrato contém lacuna material oculta e exige fechamento por regra autorizada ou decisão humana.
- **Eixos de Verificação de Estado (Aplicáveis Somente Quando Relevantes à Demanda)**:
  1. **Precedência Linear de Guards (`GUARD_PRECEDENCE`)**: Quando uma operação possui múltiplos modos de rejeição/bloqueio, sua ordem linear de avaliação e curto-circuito deve ser fixada.
  2. **Inicialização e Reset (`STATE_INITIALIZATION_AND_RESET`)**: Quando há entidades de estado (`stateful-operation`), cada campo persistido em memória exige valor inicial explícito, mutações vinculadas às operações e política de reset.
  3. **Invariância Temporal (`TEMPORAL_SEMANTICS`)**: Quando a demanda acumula grandezas em função de tempo (`time-dependent`), frações residuais (`carry/remainder`) devem ser preservadas.
  4. **Serialização Canônica (`CANONICAL_SERIALIZATION`)**: Quando a demanda exige hash/digest de integridade (`integrity-hash`), deve definir campos incluídos, encoding, chave de ordenação e digest de estado vazio.
  5. **Observabilidade Finita (`BOUNDED_OBSERVABILITY`)**: Quando a demanda exige contadores, métricas ou bitmasks de status (`bounded-observability`), deve definir representação finita e comportamento em estado vazio.


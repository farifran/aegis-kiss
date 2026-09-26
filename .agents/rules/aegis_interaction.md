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
  1. O assistente grava o payload em `.harness/runtime/preflight_resolution.json` com `method: "INTERACTIVE_WIZARD"` ou executa a recompilação semântica com o parecer revisado (`./aegis --semantic-compile`).
  2. O assistente verifica que todas as decisões foram integradas na especificação normativa e que as dimensões de determinismo foram fechadas como `SPECIFIED`.
  3. Somente após a recompilação limpa (sem decisões ativas) e nova confirmação expressa do usuário humano, o contrato pode ser selado com `./aegis --approve`.

## 4. Fechamento Semântico e Transição Total de Estados (SEMANTICALLY_CLOSED)
- **Critério Universal de Fechamento**: Um contrato só pode ser considerado `SEMANTICALLY_CLOSED` quando satisfaz a propriedade matemática de determinismo de transição total de estados:
  $$\forall (S, I, C, T) \implies \exists! (O, S')$$
  *Para todo estado válido S, entrada I, configuração C e tempo T, o contrato determina exatamente um resultado observável O e exatamente um próximo estado S'.*
- **O Teste das Duas Interpretações Conformes (*Two Conforming Interpretations Gate*)**:
  Antes de declarar o parecer pronto para aprovação, o assistente DEVE executar uma análise adversarial residual estrita:
  *"É possível que duas implementações independentes sigam literalmente o texto do contrato e ainda assim produzam saídas observáveis ou próximos estados divergentes?"*
  Se a resposta for sim, o contrato contém lacuna material oculta e NÃO pode receber `SEMANTICALLY_CLOSED`.
- **Os 5 Eixos Universais de Verificação de Estado**:
  1. **Precedência Linear de Guards (`GUARD_PRECEDENCE`)**: Toda operação com múltiplos modos de falha ou condições de bloqueio deve ter sua ordem linear de avaliação e curto-circuito estritamente fixada. A primeira guarda violada determina exclusivamente o erro público e veda efeitos colaterais das guardas posteriores.
  2. **Inicialização e Reset (`STATE_INITIALIZATION_AND_RESET`)**: Toda variável, saldo, flag ou contador em memória exige definição explícita de: (a) valor inicial no provisionamento ou 1ª requisição; (b) gatilhos e magnitude exatos de mutação; (c) condições e valores exatos de reset.
  3. **Invariância Temporal de Amostragem (`TEMPORAL_SEMANTICS`)**: Acúmulos por taxa temporal devem conservar restos fracionários (`carry/remainder`). $N$ avaliações com intervalo $\Delta t$ devem produzir matematicamente o mesmo acúmulo de estado que uma única avaliação com intervalo $N \cdot \Delta t$, vedando starvation por amostragem de alta frequência.
  4. **Serialização Canônica de Hashes (`CANONICAL_SERIALIZATION`)**: Todo hash, digest ou fingerprint de integridade sobre memória deve especificar: campos nominais incluídos (excluindo voláteis), encoding posicional/length-prefixed uniforme, ordenação lexicográfica e constante canônica de estado vazio alinhada ao algoritmo (ex: offset basis de 64 bits para FNV-1a).
  5. **Ciclo de Vida Formal (`STATE_LIFECYCLE`)**: Estados temporários ou de bloqueio exigem máquina de estados finita explícita com condições inequívocas de entrada, permanência e saída (TTL explícito ou evento administrativo formal de revogação).


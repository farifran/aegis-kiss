# Aegis IDE Interaction & Deliberation Rules

Estas regras governam a interação da IA no chat com o Aegis. A deliberação humana ocorre exclusivamente pelo chat da IDE via `ask_question`.

## 1. Deliberação Humana Obrigatória via `ask_question`
- **Recomendação NUNCA é consentimento (`CONST-DECISIONS`).** O assistente é proibido de responder pelo usuário ou aplicar decisões tacitamente.
- Quando a compilação do contrato gerar perguntas ativas (`.harness/runtime/user_confirmation_request.json`):
  1. O assistente **DEVE** acionar a ferramenta `ask_question` no chat para apresentar as opções diretamente ao usuário.
  2. No corpo da pergunta ou na mensagem de introdução, o assistente deve contextualizar a dúvida e destacar a opção recomendada pelo princípio KISS.
  3. O assistente **NÃO DEVE** avançar o fluxo até que o usuário responda via modal do chat.

## 2. Resolução Direta e Selamento com `preparedEffect`
- Após o usuário selecionar a opção desejada no modal `ask_question`:
  1. O assistente executa `./aegis --resolve <questionId>=<answerId>` (ou `./aegis --resolve --json '[{"questionId":"...","answerId":"..."}]'`).
  2. O Harness aplica o `preparedEffect` localmente em memória e sela o contrato sem realizar nova chamada à IA.
  3. O assistente confirma ao usuário que o contrato foi aprovado e apresenta o resumo do contrato selado (`contract.md`).

## 3. O Teste das Duas Interpretações Conformes
- Antes de apresentar o contrato como finalizado, o assistente verifica:
  *"É possível que duas implementações independentes sigam literalmente o texto do contrato e ainda assim produzam saídas observáveis divergentes sob as mesmas condições?"*
  Se sim, a ambiguidade deve ser exposta como decisão humana via `ask_question`.

# Protocolo Mecânico do Harness Aegis

Este documento define as regras operacionais mecânicas para o orquestrador e assistentes que interagem com o CLI do Aegis (`./aegis`).

## 1. Ciclo de Vida Mecânico de Demanda a Contrato

1. **Geração de Rascunho:**
   - O comando `./aegis "<demanda>"` executa a sanitização, RAM discovery e pré-cozimento local.
   - O CLI grava `.harness/runtime/contract.json` e `.harness/runtime/contract.md`.

2. **Detecção de `USER_CONFIRMATION_REQUIRED` (Exit Code 2):**
   - Quando o CLI terminar com código de saída `2`, ele emite um payload com status `USER_CONFIRMATION_REQUIRED` e grava `.harness/runtime/user_confirmation_request.json`.
   - **Ação Mecânica Obrigatória:** O agente deve acionar o seletor nativo do ambiente (`ask_question`) com as alternativas e recomendações listadas em `user_confirmation_request.json` e aguardar a resposta explícita do usuário.
   - **Interdição Mecânica:** O agente nunca deve aprovar automaticamente (`./aegis approve`), inferir a escolha pelo usuário ou inventar um `preflight_resolution.json` antes de receber a resposta do modal.

3. **Resolução e Selagem:**
   - Com a resposta do usuário, o agente grava `.harness/runtime/preflight_resolution.json` mapeando `questionId` $\to$ `answerId`.
   - O comando `./aegis approve` é executado, validando os schemas estritos, calculando o `contractDigest` canônico (RFC 8785) e gravando o estado semântico final em `src/.aegis/semantic-state.json`.

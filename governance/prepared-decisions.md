# Parecer semântico e escolhas preparadas

O transporte integrado vincula a resposta à requisição que enviou. A IA não
repete `schema`, `sourceEvidenceDigest`, `activationId` nem `amendmentIndex` quando não há
emendas. O Harness fornece esses valores, assim como IDs, referências finais,
contagens, witnesses e estados agregados. Citações continuam sendo literais:
selecionar a passagem pertinente é parte da interpretação semântica.

O schema de transporte usa `$defs` e referências locais para compartilhar
definições idênticas. Campos opcionais não pertinentes recebem `null`; o
compilador trata esse null como ausência apenas onde o schema interno permite.
Isso não preenche valores de domínio nem resolve lacunas. A classificação de
cobertura é derivada de `dimensionIndexes`; a justificativa continua semântica.
O validador local conserva as regras adicionais não suportadas no transporte.

Cada resposta do Wizard pode incluir `preparedEffect`: somente as entradas
alteradas de requisitos, invariantes, riscos, limites e dimensões. Cada entrada
usa `{index, value}`, com índice base zero e o mesmo schema semântico da coleção.
Arrays vazios preservam a base. `null` significa que é necessária nova análise.
Os planos não podem criar IDs, escrever no envelope, mudar política ou alterar
itens fora dos vínculos da pergunta.

O compilador simula e valida cada opção preparada antes de oferecer o Wizard.
Essa simulação não registra consentimento. Após escolhas humanas, aplica os
planos juntos, rejeita substituições conflitantes, vincula a autoridade humana,
remove perguntas resolvidas e provas das opções não escolhidas e valida novamente.
Uma dimensão aberta exige uma resolução e prova explícitas no plano.

Escolhas preparadas dispensam nova consulta ao modelo. Mudanças livres, mudanças
de política ou alterações estruturais não representáveis exigem nova análise.
O Wizard distingue esses casos e, após a recompilação mecânica, solicita revisão
e confirmação do contrato final. Aprovar escolhas não assina automaticamente.

Para entrega externa via `--semantic-compile`, o chamador pode enviar
`{sourceSemanticRequestDigest, opinion}`. O digest é o da requisição original,
fornecido pelo chamador, não gerado pela IA. Pareceres antigos com
`sourceEvidenceDigest` continuam sujeitos à validação desse vínculo.

O mecanismo valida estrutura e regras contratuais programadas. Não constitui
prova automática de correção semântica de texto livre. Não implementa produto.

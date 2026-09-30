# Revisão semântica: responsabilidade e avaliações

A chamada semântica existente revisa significado, aplicabilidade, contradições e
adequação das provas. API e supervisor Codex recebem as mesmas instruções em
`semanticSupervisorInstructions`. Não há uma chamada adicional de revisão.
Achados usam `adversarialReview`, requisitos, lacunas e decisões já existentes.

O Harness não deduz reset, efeitos proibidos, tempo, contagens ou limiares de
palavras em nomes, descrições ou exemplos. Preserva validação de schema, fontes,
referências, efeitos estruturados, escolhas humanas e integridade. Referências
em `guardPrecedence` são IDs exatos de branches de rejeição, não busca textual.
Um rascunho anterior com referências aproximadas precisa de correção explícita;
o Harness não renomeia nem reaproveita uma aprovação silenciosamente.

`CERTIFIED_CLOSED` registra ausência de pendências estruturais e semânticas
declaradas; não significa prova independente da verdade do parecer. O campo
histórico `divergenceWitnessesSurviving` conta dimensões declaradas abertas,
não resultados de testes de mutação executados. Nenhum produto foi executado.

## Casos para avaliar o supervisor

Estes casos substituem heurísticas específicas de produção. São uma rubrica de
avaliação, não resultados já medidos nem conteúdo injetado em demandas reais.
Execute cada par com nomes diferentes e em outro idioma; julgue pelos fatos,
não por palavras esperadas na resposta. Verifique também a incorporação dos
achados ao contrato: comentário adversarial isolado não resolve uma lacuna.

| Caso | Deve reconhecer | Controle negativo |
| --- | --- | --- |
| Valor inicial ausente | Lacuna quando altera o primeiro resultado | Valor inicial autorizado já definido não cria decisão |
| Contagem consecutiva versus acumulada | Reset necessário quando exigido pelo significado da contagem | Nome contendo `streak` sem essa semântica não exige reset |
| Rejeição com efeitos | Contradição se a regra exige preservar o estado modificado | Auditoria de rejeição explicitamente autorizada pode alterar estado |
| Identidades versus ocorrências | Contar itens não prova contagem de identidades únicas | Contagem de ocorrências explicitamente pedida não deve ser trocada |
| Transição por limiar | O efeito contratado precisa estar representado quando o limiar é atingido | Um número em exemplo não cria um limiar obrigatório |
| Tempo e suspensão | Verificar a regra autorizada de evolução temporal durante suspensão | Tempo recebido como entrada não exige campo chamado timestamp nem guarda de regressão |
| Codificação e restos | Regras precisas quando mudam saídas; largura não define overflow e arredondamento não distribui resto | Não inventar convenção ausente nem impor uma alternativa específica |
| Observabilidade limitada | Revisar representação e seus limites reais | Não exigir bitmask de 32 bits ou trava global para todo observável |

Critérios de aceitação: identificar lacunas reais, não inventar lacunas nos
controles negativos, preservar autoridade, produzir casos falsificáveis ligados
ao achado e manter a avaliação sob renomeação/tradução. Rodar esta avaliação com
um modelo é separado dos testes locais determinísticos; requer execução própria.

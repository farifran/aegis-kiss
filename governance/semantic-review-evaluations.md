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
declaradas; não significa prova independente da verdade do parecer. `gapLedger`
é a lista canônica de diagnósticos. Não se emitem mais contadores sintéticos de
cobertura nem supostos resultados de testes de mutação. Nenhum produto foi executado.

## Casos para avaliar o supervisor

`determinismReview.dimensions` não possui catálogo fechado. Cada item usa `kind`
como chave estável de uma propriedade pertinente a `subject`, com rationale,
origem e cenário-base/variação propostos semanticamente. O Harness gera o ID do
witness com a propriedade e o subject e confere referências, cobertura e os
resultados literais vinculados ao caso de aceitação. Não escolhe exemplos nem
resoluções a partir de tabelas de palavras. `resolutionKind` também é aberto.
Os três tipos de relação são formatos de resultado, não classes de domínio.

Uma demanda não precisa preencher onze categorias nem listar ausências para
cada categoria imaginável. Novas propriedades, como locale, timezone, retries
ou concorrência, não exigem alteração no runtime. A revisão semântica precisa
delimitar observáveis determinísticos e fontes de variabilidade controladas;
tempo e aleatoriedade não são automaticamente proibidos. Uma lista vazia ainda
exige a cobertura justificada das claims materiais.

Os testes de propriedades novas verificam o protocolo e seus vínculos, não a
qualidade semântica do parecer. Não há nova chamada de revisão. Rascunhos com
`activationId` ou witnesses do catálogo anterior não recebem conversão implícita.
O schema `semantic-worksheet` sem uso foi removido; é recuperável no Git.

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

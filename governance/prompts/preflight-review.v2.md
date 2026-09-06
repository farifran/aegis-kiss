Produza somente um objeto JSON válido conforme `aegis.preflight_review.v2`.

Atue como autoridade independente. Compare a decisão resolvida, inclusive seleções de clarificação e corpo do contrato, com cada unidade da demanda, os fatos mecânicos, o contrato anterior e cada regra arquitetural candidata.

Rejeite quando houver qualquer exigência omitida, comportamento inventado, pergunta desnecessária, unidade sem cobertura, requisito sem obrigação contratual, continuidade perdida, referência tratada como fato sem prova ou regra arquitetural não avaliada corretamente. Sempre emita `stateSemantics:[]` para `NONE`; para `STATE_TRANSITION`, emita uma avaliação `[role,EXPLICIT|QUESTION_REQUIRED|CONFLICT,evidência,sourceUnitIds]` para cada role declarado. Para `EXPLICIT`, a evidência deve ser exatamente a política textual da decisão e ocorrer literalmente em uma UNIT citada; não aprove paráfrase ou detalhe técnico novo. Uma UNIT que só menciona um conceito não fecha sua política. Lacuna observável exige `QUESTION_REQUIRED` e uma pergunta correspondente; conflito exige `CONFLICT` e `REJECTED`. Se o veredito for `APPROVED`, os dispositions devem coincidir com a decisão; divergência exige `REJECTED` com finding.

Audite, quando aplicável: identidade (existência, aptidão, unicidade e chaves hostis); recursos (unidade e destino de cada valor consumido); tempo (fonte, escopo, igualdade, regressão e replay); resultado (álgebra entre decisões e agregados); atomicidade (nenhum passo falível após publicação); canonicalização (todos os observáveis relevantes e ordem independente do ambiente). Rejeite condições de aceitação comprimidas, campo com múltiplos efeitos sem política explícita, agregados sem álgebra de decisões, commit antes de passos falíveis ou representação determinística que não vincule os observáveis declarados. Não proponha implementação.

Use e devolva sem alteração os identificadores e os três bindings de execução fornecidos: `producerExecutionId`, `reviewExecutionId` e `reviewRequestDigest`. Eles vinculam esta revisão a uma execução do preflight e a uma requisição de revisão distinta.

Contexto de revisão:
{{review_context}}

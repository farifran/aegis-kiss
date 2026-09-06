Produza somente um objeto JSON válido conforme `aegis.preflight_review.v2`.

Atue como autoridade independente. Compare a decisão resolvida, inclusive seleções de clarificação e corpo do contrato, com cada unidade da demanda, os fatos mecânicos, o contrato anterior e cada regra arquitetural candidata.

Rejeite quando houver qualquer exigência omitida, comportamento inventado, pergunta desnecessária, unidade sem cobertura, requisito sem obrigação contratual, continuidade perdida, referência tratada como fato sem prova ou regra arquitetural não avaliada corretamente. Sempre emita `stateSemantics:[]` para `NONE`; para `STATE_TRANSITION`, emita uma avaliação `[role,EXPLICIT|QUESTION_REQUIRED|CONFLICT,evidência,sourceUnitIds]` para cada role declarado. `EXPLICIT` exige que as UNITs determinem a política; lacuna observável exige `QUESTION_REQUIRED` e uma pergunta correspondente; conflito exige `CONFLICT` e `REJECTED`. Se o veredito for `APPROVED`, os dispositions devem coincidir com a decisão; divergência exige `REJECTED` com finding. Confira separadamente estado, comando, identidade, recursos, tempo, resultado, atomicidade e canonicalização quando a demanda os mencionar. Rejeite condições de aceitação comprimidas, campo com múltiplos efeitos sem política explícita, agregados sem álgebra de decisões, commit antes de passos falíveis ou representação determinística que não vincule os observáveis declarados. Não proponha implementação.

Use os identificadores de produtor e revisor fornecidos. Eles devem permanecer diferentes.

Contexto de revisão:
{{review_context}}

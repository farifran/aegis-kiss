Retorne somente JSON `aegis.preflight_decision.v2`; não leia o repositório.

Preserve toda exigência explícita. Não invente fatos nem reescreva uma API, valor inicial, retorno ou fonte de tempo sem confirmação. Corrija apenas forma/ortografia, prefira a menor solução suficiente e torne falhas observáveis. Avalie cada regra candidata exatamente uma vez. Quando um `forbiddenReferences` de regra hard aparecer nos fatos, use `NEEDS_CONFIRMATION` e uma pergunta `ARCHITECTURE` com a interpretação segura proposta; não marque `CLARIFIED`. Pergunte somente quando a resposta muda entendimento, escopo ou arquitetura; use 0 perguntas quando houver interpretação segura e no máximo 3. Em `PRODUCT`, todo arquivo persistente, teste, prova e benchmark deve ficar em `src/`; manutenção do Aegis só é válida em `HARNESS`.

O Aegis cria IDs, cobertura e registro de provas. Você fornece um delta compacto usando índices zero-based:
- `rules`: `[ruleId,verdict,evidência,[unitIndexes]]`
- `questions`: `[INPUT|SCOPE|ARCHITECTURE,pergunta,evidência,impacto,recomendação,respostaInterpretada,[unitIndexes]]`
- `requirements`: `[texto,proveniência,[unitIndexes]]`
- `contextUnits`: `[unitIndex,CONTEXT|REJECTED_INVALID,razão]`
- `failures`: `[gatilho,resultadoObservável,[requirementIndexes]]`
- `behaviors|preconditions|postconditions`: `[texto,[requirementIndexes]]`
- `invariants`: `[texto,[requirementIndexes],[proofIndexes]]`
- `proofs`: `[coverageKey,risco,obrigação,[requirementIndexes],entrypoint,targets,custo,cadência]`
- `continuity.retirements`: `[proof|target,id,razão,evidência,sucessorOuNull]`
- `continuity.proofChanges`: `[proofId,razão,evidência]`

Cada UNIT deve aparecer exatamente uma vez: ligada a um ou mais requisitos, ou em `contextUnits`. Use `USER` somente para comportamento já expresso nas UNITs. Qualquer derivação deve usar `KISS_DERIVATION` ou `ARCHITECTURE_DEFAULT`; se ela alterar API pública, retorno, valor inicial ou fonte de tempo, inclua uma pergunta que a descreva como interpretação. Cada requisito deve apontar para ao menos uma cláusula e uma prova. Cada invariante deve apontar para prova. `coverageKey` é estável, minúscula e específica ao risco. O entrypoint é um `.ts` em `src/` ou `.sh`; targets incluem os arquivos que invalidam a prova. Preserve provas/targets anteriores ou declare continuidade.

Emita `riskProfile` e `stateModel`. Use `NONE` para demanda sem transição observável de estado. Em `STATE_TRANSITION`, `bindings` é `[STATE|COMMAND|IDENTITY|RESOURCE|TEMPORAL|RESULT|ATOMICITY|CANONICALIZATION, afirmação, requirementIndexes, unitIndexes]`: não comprima condições independentes de aceitação; cada condição explícita deve ter requisito e binding próprios. Declare cada papel de um mesmo campo que afete dimensões diferentes; se o acoplamento não estiver explícito, pergunte. Defina a álgebra entre decisões e agregados, a fronteira de publicação atômica e a representação canônica quando aplicáveis. Use `forensic` e ao menos uma prova de cadência `forensic` quando atomicidade coexistir com recurso, tempo, identidade externa ou canonicalização; essa decisão receberá revisão independente obrigatória.

Para `CLARIFIED` ou `NEEDS_CONFIRMATION`, emita todos estes campos: `schema`, `contextDigest`, `promptDigest`, `status`, `rules`, `questions`, `riskProfile`, `stateModel`, `intent`, `scope`, `excluded`, `requirements`, `contextUnits`, `acceptance`, `failures`, `behaviors`, `preconditions`, `invariants`, `postconditions`, `proofs`, `continuity`. Para `BLOCKED`, emita apenas os seis primeiros. `CLARIFIED` exige `questions:[]`; `NEEDS_CONFIRMATION` inclui os corpos provisórios nos mesmos campos e a confirmação os promove sem outra chamada.

contextDigest={{context_digest}}
changeKind={{change_kind}}
units={{normalized_demand}}
facts={{mechanical_facts}}
rules={{architecture_rules}}
previous={{previous_contract}}

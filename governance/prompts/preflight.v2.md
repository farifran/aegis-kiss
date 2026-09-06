Retorne somente JSON `aegis.preflight_decision.v2`; não leia o repositório.

Preserve toda exigência explícita. Não invente fatos nem reescreva uma API, valor inicial, retorno ou fonte de tempo sem confirmação. Corrija apenas forma/ortografia, prefira a menor solução suficiente e torne falhas observáveis. Avalie cada regra candidata exatamente uma vez. Quando um `forbiddenReferences` de regra hard aparecer nos fatos, use `NEEDS_CONFIRMATION` e uma pergunta `ARCHITECTURE` com a interpretação segura proposta; não marque `CLARIFIED`. Pergunte somente quando a resposta muda entendimento, comportamento observável, escopo ou arquitetura; use 0 perguntas quando houver interpretação segura e no máximo 4. Em `PRODUCT`, todo arquivo persistente, teste, prova e benchmark deve ficar em `src/`; manutenção do Aegis só é válida em `HARNESS`.

O Aegis cria IDs, cobertura e registro de provas. Você fornece um delta compacto usando índices zero-based:
- `rules`: `[ruleId,verdict,evidência,[unitIndexes]]`
- `questions`: `[INPUT|SCOPE|ARCHITECTURE|DEMAND,pergunta,evidência,impacto,recommendedAnswerId,respostaInterpretada,[unitIndexes],answers]`, onde cada `answer` é `[id,label,rationale,resolutionClause,statePolicies]` e cada `statePolicy` é `[role,política]`
- `requirements`: `[texto,proveniência,[unitIndexes]]`
- `contextUnits`: `[unitIndex,CONTEXT|REJECTED_INVALID,razão]`
- `failures`: `[gatilho,resultadoObservável,[requirementIndexes]]`
- `behaviors|preconditions|postconditions`: `[texto,[requirementIndexes]]`
- `invariants`: `[texto,[requirementIndexes],[proofIndexes]]`
- `proofs`: `[coverageKey,risco,obrigação,[requirementIndexes],entrypoint,targets,custo,cadência]`
- `continuity.retirements`: `[proof|target,id,razão,evidência,sucessorOuNull]`
- `continuity.proofChanges`: `[proofId,razão,evidência]`

Cada UNIT deve aparecer exatamente uma vez: ligada a um ou mais requisitos, ou em `contextUnits`. Use `USER` somente para comportamento já expresso nas UNITs. Qualquer derivação deve usar `KISS_DERIVATION` ou `ARCHITECTURE_DEFAULT`; se ela alterar API pública, retorno, valor inicial ou fonte de tempo, inclua uma pergunta que a descreva como interpretação. Cada requisito deve apontar para ao menos uma cláusula e uma prova. Cada invariante deve apontar para prova. `coverageKey` é estável, minúscula e específica ao risco. O entrypoint é um `.ts` em `src/` ou `.sh`; targets incluem os arquivos que invalidam a prova. Preserve provas/targets anteriores ou declare continuidade.

Emita `riskProfile`, `stateModel` e `stateSemantics`. Use `NONE` para demanda sem transição observável de estado e `stateSemantics:[]`. Em `STATE_TRANSITION`, `bindings` é `[STATE|COMMAND|IDENTITY|RESOURCE|TEMPORAL|RESULT|ATOMICITY|CANONICALIZATION, afirmação, requirementIndexes, unitIndexes]`. `stateSemantics` declara cada papel como `[role,EXPLICIT|QUESTION_REQUIRED, política observável, unitIndexes]`; seus roles devem corresponder exatamente aos bindings. A política deve acrescentar uma decisão observável ao binding; repetir a descrição do papel não é política. Use `EXPLICIT` apenas quando as UNITs realmente determinarem essa decisão. Se não determinarem, use `QUESTION_REQUIRED` e uma pergunta que cubra suas UNITs.

Audite, quando aplicável: `IDENTITY` (existência, aptidão, unicidade e tratamento de chave externa); `RESOURCE` (unidade, consumo, transferência, retenção ou descarte de cada valor); `TEMPORAL` (fonte, escopo, igualdade, regressão e replay); `RESULT` (álgebra entre cada decisão e seus agregados); `ATOMICITY` (todas as etapas falíveis antes da publicação); `CANONICALIZATION` (campos cobertos e ordem independente do ambiente). Se qualquer item altera comportamento ou API e não estiver determinado, pergunte; não escolha silenciosamente.

Cada pergunta oferece 2–4 alternativas, uma recomendada, uma `resolutionClause` completa e apenas os `statePolicies` dos papéis ainda abertos que ela resolve. Se duas ou mais políticas abertas forem materialmente acopladas, faça uma única pergunta: cada alternativa deve cobrir exatamente a união desses papéis. Não agrupe ambiguidades independentes. A seleção posterior é mecânica; não espere outra chamada. Não comprima condições independentes de aceitação; cada condição explícita deve ter requisito e binding próprios. Defina a álgebra entre decisões e agregados, a fronteira de publicação atômica e a representação canônica quando aplicáveis. Use `forensic` e ao menos uma prova de cadência `forensic` quando atomicidade coexistir com recurso, tempo, identidade externa ou canonicalização; essa decisão receberá revisão independente obrigatória.

Para `CLARIFIED` ou `NEEDS_CONFIRMATION`, emita todos estes campos: `schema`, `contextDigest`, `promptDigest`, `status`, `rules`, `questions`, `riskProfile`, `stateModel`, `stateSemantics`, `intent`, `scope`, `excluded`, `requirements`, `contextUnits`, `acceptance`, `failures`, `behaviors`, `preconditions`, `invariants`, `postconditions`, `proofs`, `continuity`. Para `BLOCKED`, emita apenas os seis primeiros. `CLARIFIED` exige `questions:[]` e somente `EXPLICIT`; `NEEDS_CONFIRMATION` inclui até quatro perguntas independentes e seus corpos provisórios. A confirmação seleciona uma alternativa por pergunta e promove a variante já compilada, sem outra chamada.

contextDigest={{context_digest}}
changeKind={{change_kind}}
units={{normalized_demand}}
facts={{mechanical_facts}}
rules={{architecture_rules}}
previous={{previous_contract}}

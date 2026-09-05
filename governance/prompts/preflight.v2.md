Retorne somente JSON `aegis.preflight_decision.v2`; não leia o repositório.

Preserve toda exigência explícita. Não invente fatos nem preencha lacunas sem evidência. Corrija apenas forma/ortografia, prefira a menor solução suficiente e torne falhas observáveis. Avalie cada regra candidata exatamente uma vez. Conflito hard exige `BLOCKED`. Pergunte somente quando a resposta muda entendimento, escopo ou arquitetura; use 0 perguntas quando houver interpretação segura e no máximo 3. Em `PRODUCT`, todo arquivo persistente, teste, prova e benchmark deve ficar em `src/`; manutenção do Aegis só é válida em `HARNESS`.

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

Cada UNIT deve aparecer exatamente uma vez: ligada a um ou mais requisitos, ou em `contextUnits`. Cada requisito deve apontar para ao menos uma cláusula e uma prova. Cada invariante deve apontar para prova. `coverageKey` é estável, minúscula e específica ao risco. O entrypoint é um `.ts` em `src/` ou `.sh`; targets incluem os arquivos que invalidam a prova. Preserve provas/targets anteriores ou declare continuidade.

Para `CLARIFIED` ou `NEEDS_CONFIRMATION`, emita todos estes campos: `schema`, `contextDigest`, `status`, `rules`, `questions`, `intent`, `scope`, `excluded`, `requirements`, `contextUnits`, `acceptance`, `failures`, `behaviors`, `preconditions`, `invariants`, `postconditions`, `proofs`, `continuity`. Para `BLOCKED`, emita apenas os cinco primeiros. `CLARIFIED` exige `questions:[]`; `NEEDS_CONFIRMATION` inclui os corpos provisórios nos mesmos campos e a confirmação os promove sem outra chamada.

contextDigest={{context_digest}}
changeKind={{change_kind}}
units={{normalized_demand}}
facts={{mechanical_facts}}
rules={{architecture_rules}}
previous={{previous_contract}}

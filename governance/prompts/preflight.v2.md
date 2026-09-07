Retorne somente JSON `aegis.preflight_decision.v2`; não leia o repositório.

Siga a constituição cognitiva recebida em `constitution`. Ela governa como
interpretar, contratar e planejar; regras arquiteturais aplicáveis continuam
sendo somente as recebidas em `rules`.

Preserve requisitos explícitos. Não invente fatos nem altere API, valor inicial, retorno ou fonte temporal sem confirmação. Corrija só forma/ortografia, aplique o menor KISS suficiente e exponha falhas. Use `facts.discovery` apenas como candidatos mecânicos; preserve `UNKNOWN|INCOMPLETE`. Avalie cada regra uma vez. Se um `forbiddenReferences` hard aparecer, use `NEEDS_CONFIRMATION` e pergunta `ARCHITECTURE` com interpretação segura; não use `CLARIFIED`. Pergunte apenas quando a resposta mudar entendimento, comportamento, escopo ou arquitetura; prefira 0 e limite a 4. Em `PRODUCT`, persistência, testes, provas e benchmarks ficam em `src/`; manutenção do Aegis exige `HARNESS`.

O Aegis cria IDs, cobertura e registro de provas. Você fornece um delta compacto usando índices zero-based:
- `rules`: `[ruleId,verdict,evidência,[unitIndexes]]`
- `questions`: `[INPUT|SCOPE|ARCHITECTURE|DEMAND,pergunta,evidência,impacto,recommendedAnswerId,respostaInterpretada,[unitIndexes],answers]`, onde cada `answer` é `[id,label,rationale,resolutionClause,statePolicies,contractPatch]`, cada `statePolicy` é `[role,política]` e `contractPatch` traz as cláusulas pré-compiladas da alternativa.
- `requirements`: `[texto,proveniência,[unitIndexes]]`
- `contextUnits`: `[unitIndex,CONTEXT|REJECTED_INVALID,razão]`
- `failures`: `[gatilho,resultadoObservável,[requirementIndexes],[policyRoles?]]`
- `behaviors|preconditions|postconditions`: `[texto,[requirementIndexes],[policyRoles?]]`
- `invariants`: `[texto,[requirementIndexes],[proofIndexes],[policyRoles?]]`
- `proofs`: `[coverageKey,risco,obrigação,[requirementIndexes],entrypoint,targets,custo,cadência]`
- `continuity.retirements`: `[proof|target,id,razão,evidência,sucessorOuNull]`
- `continuity.proofChanges`: `[proofId,razão,evidência]`

Cada UNIT deve aparecer exatamente uma vez: ligada a um ou mais requisitos, ou em `contextUnits`. Use `USER` somente para comportamento já expresso nas UNITs. Qualquer derivação deve usar `KISS_DERIVATION` ou `ARCHITECTURE_DEFAULT`; se ela alterar API pública, retorno, valor inicial ou fonte de tempo, inclua uma pergunta que a descreva como interpretação. Cada requisito deve apontar para ao menos uma cláusula e uma prova. Cada invariante deve apontar para prova. `coverageKey` é estável, minúscula e específica ao risco. O entrypoint é um `.ts` em `src/` ou `.sh`; targets incluem os arquivos que invalidam a prova. Preserve provas/targets anteriores ou declare continuidade.

Emita `riskProfile`, `stateModel` e `stateSemantics`. Use `NONE` para demanda sem transição observável de estado e `stateSemantics:[]`. Em `STATE_TRANSITION`, `bindings` é `[STATE|COMMAND|IDENTITY|RESOURCE|TEMPORAL|RESULT|ATOMICITY|CANONICALIZATION, afirmação, requirementIndexes, unitIndexes]`. `stateSemantics` declara cada papel como `[role,EXPLICIT|QUESTION_REQUIRED, política observável, unitIndexes]`; seus roles devem corresponder exatamente aos bindings. A política deve acrescentar uma decisão observável ao binding; repetir a descrição do papel não é política. Use `EXPLICIT` apenas quando uma única UNIT já contiver literalmente a política observável completa: a política deve ser uma citação textual dessa UNIT, sem paráfrase nem detalhe novo. Uma menção a conceito não é decisão: mencionar `cost` não determina sua unidade, efeito, destino ou retenção; mencionar entidade “apta” não define sua política de aptidão; mencionar relógios não decide igualdade, regressão ou replay. Se a política completa não estiver literalmente determinada, use `QUESTION_REQUIRED` e uma pergunta que cubra suas UNITs. Nunca use campo, status, algoritmo ou API como se fosse evidência do usuário.

Em `STATE_TRANSITION`, `stateModel.governance` é obrigatório e é uma declaração de projeto verificável, não uma inferência do runtime: `authoritativeState` é `[declaração,proofIndexes]`; `publicationAuthorities` lista `[operação,CREATE_ONLY|TRANSITION|ADMIN_RESET|RESTORE|MIGRATION,declaração,proofIndexes]`; `publicationBoundary` é `[declaração,proofIndexes]`; `derivedObservables` lista `[nome,fonteDeVerdade,derivação,proofIndexes]`; `digestIdentity` é `null` ou `[RESULT_FINGERPRINT|TRANSITION_IDENTITY|AUDIT_IDENTITY,[camposCobertos],proofIndexes]`. Declare todos os escritores que podem publicar o estado autoritativo. A fronteira deve dizer que todos os efeitos falíveis obrigatórios ocorrem antes da publicação. Cada agregado, contador, flag ou projeção externamente observável deve constar em `derivedObservables`, com uma única fonte de verdade e derivação. Só declare `digestIdentity` se o produto expõe hash, digest, ID canônico ou representação usada como identidade; nesse caso `CANONICALIZATION` deve existir. Não invente uma operação administrativa ou persistência: declare apenas a autoridade necessária à demanda e à implementação mínima.

Audite, quando aplicável: `IDENTITY` (existência, aptidão, unicidade e tratamento de chave externa); `RESOURCE` (unidade, consumo, transferência, retenção ou descarte de cada valor); `TEMPORAL` (fonte, escopo, igualdade, regressão e replay); `RESULT` (álgebra entre cada decisão e seus agregados); `ATOMICITY` (todas as etapas falíveis antes da publicação); `CANONICALIZATION` (campos cobertos e ordem independente do ambiente). Se qualquer item altera comportamento ou API e não estiver determinado, pergunte; não escolha silenciosamente.

Cada pergunta oferece 2–4 alternativas, uma recomendada, uma `resolutionClause` completa e apenas os `statePolicies` dos papéis ainda abertos que ela resolve. Se duas ou mais políticas abertas forem materialmente acopladas, faça uma única pergunta: cada alternativa deve cobrir exatamente a união desses papéis. Não agrupe ambiguidades independentes. A seleção posterior é mecânica; não espere outra chamada. Não comprima condições independentes de aceitação; cada condição explícita deve ter requisito e binding próprios. Defina a álgebra entre decisões e agregados, a fronteira de publicação atômica e a representação canônica quando aplicáveis. Use `forensic` e ao menos uma prova de cadência `forensic` quando atomicidade coexistir com recurso, tempo, identidade externa ou canonicalização. A primeira compilação de uma transição `forensic` deve sempre retornar `NEEDS_CONFIRMATION`: use as perguntas para resolver as escolhas de negócio ainda abertas, agrupando somente papéis materialmente acoplados. Essa confirmação humana e a revisão independente são obrigatórias antes de persistir o contrato.

Quando uma alternativa resolve `statePolicies`, ela também substitui integralmente as
cláusulas provisórias daqueles papéis: informe `contractPatch.replacesPolicyRoles`
com exatamente os mesmos roles e marque cada cláusula nova afetada com
`policyRoles`. O runtime remove as cláusulas anteriores desses roles antes de
aplicar o patch. Não deixe as duas políticas coexistirem, não trate a nova
cláusula como complemento e não mantenha uma semântica contraditória por
compatibilidade. `proofs` não são removidas por esse mecanismo: mantenha ou
aposente uma prova explicitamente pela continuidade.

Para `CLARIFIED` ou `NEEDS_CONFIRMATION`, emita todos estes campos: `schema`, `contextDigest`, `promptDigest`, `status`, `rules`, `questions`, `riskProfile`, `stateModel`, `stateSemantics`, `intent`, `scope`, `excluded`, `requirements`, `contextUnits`, `acceptance`, `failures`, `behaviors`, `preconditions`, `invariants`, `postconditions`, `proofs`, `continuity`. Para `BLOCKED`, emita apenas os seis primeiros. `CLARIFIED` exige `questions:[]` e somente `EXPLICIT`; `NEEDS_CONFIRMATION` inclui até quatro perguntas independentes e seus corpos provisórios. Cada resposta é `[id,label,rationale,resolutionClause,statePolicyPatches,contractPatch]`. `contractPatch` pode conter listas opcionais de `behaviors`, `preconditions`, `invariants`, `postconditions`, `failures`, `proofs` e `stateModelGovernance`, no mesmo formato dos campos principais. Se a resposta resolve uma política de estado, seu `contractPatch` deve conter ao menos uma cláusula que repita literalmente cada política resolvida; se a escolha alterar autoridade, publicação, projeção ou digest, inclua o `stateModelGovernance` completo dessa alternativa. Ele será aplicado mecanicamente após a escolha. Assim toda variante já contém comportamento e prova compatíveis, sem nova chamada.

constitution={{constitution}}
contextDigest={{context_digest}}
changeKind={{change_kind}}
units={{normalized_demand}}
facts={{mechanical_facts}}
rules={{architecture_rules}}
previous={{previous_contract}}

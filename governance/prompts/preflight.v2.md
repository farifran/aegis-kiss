Responda somente com um JSON `aegis.preflight_decision.v2`. Não consulte o repositório.

Regras:
- copie `contextDigest` exatamente;
- preserve toda exigência explícita e não preencha lacunas sem evidência;
- corrija somente forma/ortografia; escolha a menor solução suficiente e falhas explícitas;
- avalie cada `candidateRule` exatamente uma vez; conflito `hard` implica `BLOCKED`;
- classifique cada UNIT exatamente uma vez em `inputCoverage`; `REQUIREMENT` aponta para requisito, as demais não;
- use 0 perguntas quando houver interpretação segura; caso contrário use 1–3 perguntas INPUT/SCOPE/ARCHITECTURE, cada uma com `interpretedAnswer`;
- `NEEDS_CONFIRMATION` usa somente corpos `provisional*`; `CLARIFIED` usa somente corpos finais; `BLOCKED` não usa corpos;
- `clarifiedDemandBody.scope.included` deve ser idêntico a `contractBody.scope.authorizedPaths` e incluir todo arquivo persistente necessário, inclusive teste/configuração; metadados `.harness/active_*` e `.harness/proof_registry.json` são geridos pelo Aegis e não entram no escopo;
- preserve targets e provas do contrato anterior; remoções ou alterações exigem `continuity` com evidência da demanda;
- contrato descreve comportamento e riscos observáveis, sem imports, comandos ou tipos privados.

Forma exata para `CLARIFIED` (arrays opcionais podem ser omitidos quando vazios):
{"schema":"aegis.preflight_decision.v2","contextDigest":"<64 hex>","status":"CLARIFIED","ruleAssessments":[{"ruleId":"ARCH-...","verdict":"APPLIED|NOT_APPLICABLE|CONFLICT","evidence":"...","sourceUnitIds":["UNIT-0001"]}],"findings":[{"id":"PF-...","kind":"input|reference|scope|architecture|repository","status":"PROVEN|UNPROVEN|DISPROVEN|NOT_APPLICABLE","evidence":"...","sourceUnitIds":["UNIT-0001"]}],"questions":[],"clarifiedDemandBody":{"intent":"...","requirements":[{"id":"REQ-...","statement":"...","provenance":"USER|SAFE_CORRECTION|USER_CLARIFICATION|ARCHITECTURE_DEFAULT|KISS_DERIVATION"}],"scope":{"included":["path"],"excluded":[]},"inputCoverage":[{"unitId":"UNIT-0001","disposition":"REQUIREMENT|CONTEXT|REJECTED_INVALID","requirementIds":["REQ-..."],"rationale":"..."}],"acceptanceCriteria":["..."],"failureSemantics":[{"id":"FAIL-...","trigger":"...","observableOutcome":"..."}]},"contractBody":{"scope":{"authorizedPaths":["path"]},"behavior":[{"id":"BEH-...","statement":"..."}],"preconditions":[{"id":"PRE-...","statement":"..."}],"invariants":[{"id":"INV-...","statement":"...","proofIds":["PO-..."]}],"postconditions":[{"id":"POST-...","statement":"..."}],"failureSemantics":[{"id":"FAIL-...","statement":"..."}],"proofObligations":[{"id":"PO-...","risk":"...","statement":"..."}],"requirementCoverage":[{"requirementId":"REQ-...","contractIds":["BEH-...","INV-...","PO-..."]}],"continuity":{"retirements":[{"kind":"proof|target","id":"...","reason":"...","demandEvidence":"...","successor":"..."}],"proofChanges":[{"id":"PO-...","reason":"...","demandEvidence":"..."}]}}}

Para `NEEDS_CONFIRMATION`, mantenha cabeçalho/avaliações/findings, use `questions:[{"id":"Q-...","scope":"INPUT|SCOPE|ARCHITECTURE","prompt":"...","evidence":"...","impact":"...","recommendation":"...","interpretedAnswer":"...","sourceUnitIds":["UNIT-0001"]}]` e renomeie os dois corpos para `provisionalClarifiedDemandBody` e `provisionalContractBody`.

Contexto:
contextDigest={{context_digest}}
normalizedDemand={{normalized_demand}}
mechanicalFacts={{mechanical_facts}}
candidateRules={{architecture_rules}}
previousContract={{previous_contract}}

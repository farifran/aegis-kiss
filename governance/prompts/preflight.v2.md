Produza somente um objeto JSON válido conforme `aegis.preflight_decision.v2`.

Regras obrigatórias:
- Copie exatamente `contextDigest` no campo homônimo. Não reproduza outros digests.
- Preserve toda exigência explícita. Não invente comportamento nem complete lacunas sem evidência.
- Corrija apenas forma, ortografia e organização sem alterar significado.
- Recomende a menor solução que satisfaça a demanda e exponha falhas relevantes.
- Avalie exatamente uma vez cada regra em `candidateRules` como `APPLIED`, `NOT_APPLICABLE` ou `CONFLICT`, citando `sourceUnitIds` quando houver evidência na demanda.
- Regra `hard` em conflito exige `status: "BLOCKED"`.
- Se o resultado for `CLARIFIED`, produza `clarifiedDemandBody` e `contractBody` na mesma resposta.
- Classifique exatamente uma vez cada unidade como `REQUIREMENT`, `CONTEXT` ou `REJECTED_INVALID` em `inputCoverage`.
- Toda unidade `REQUIREMENT` deve apontar para ao menos um requisito; as demais não apontam para requisitos.
- Todo requisito de origem `USER`, `SAFE_CORRECTION` ou `USER_CLARIFICATION` deve ser rastreável por `inputCoverage`.
- Prefira `questions: []`. Faça de uma a três perguntas somente quando indispensáveis para corrigir a entrada, delimitar escopo ou resolver conflito arquitetural. Não pergunte decisões internas do harness.
- Cada pergunta deve conter evidência, impacto, recomendação, unidades de origem e `interpretedAnswer`: a interpretação concreta recomendada como resposta.
- Em `NEEDS_CONFIRMATION`, aplique todas as `interpretedAnswer` e produza `provisionalClarifiedDemandBody` e `provisionalContractBody`. A confirmação do usuário deve poder promover esses corpos sem nova chamada semântica.
- Em `contractBody`, autorize somente os menores caminhos necessários; cada invariante aponta para provas e cada requisito aparece exatamente uma vez em `requirementCoverage`.
- O contrato descreve comportamento observável e riscos verificáveis, nunca código, comandos, imports, tipos privados ou decisões internas do harness.
- Preserve os targets e as obrigações de prova do contrato anterior. Remoções ou mudanças exigem `continuity` com evidência da demanda.
- Use `NEEDS_CONFIRMATION` quando houver perguntas e `BLOCKED` somente quando não existir continuação segura.

Forma semântica dos corpos:
- `clarifiedDemandBody`: `{intent, requirements:[{id,statement,provenance}], scope:{included,excluded}, inputCoverage:[{unitId,disposition,requirementIds,rationale}], acceptanceCriteria?, failureSemantics?}`.
- `contractBody`: `{scope:{authorizedPaths}, behavior:[{id,statement}], preconditions?, invariants:[{id,statement,proofIds}], postconditions?, failureSemantics?, proofObligations:[{id,risk,statement}], requirementCoverage:[{requirementId,contractIds}], continuity?}`.
- Em `CLARIFIED`, use `clarifiedDemandBody` e `contractBody`; em `NEEDS_CONFIRMATION`, use somente as versões prefixadas por `provisional`; em `BLOCKED`, não emita corpos.
- `provenance` é `USER`, `SAFE_CORRECTION`, `USER_CLARIFICATION`, `ARCHITECTURE_DEFAULT` ou `KISS_DERIVATION`. IDs usam os prefixos `REQ-`, `BEH-`, `PRE-`, `INV-`, `POST-`, `FAIL-` e `PO-` conforme o papel.

Context digest:
{{context_digest}}

Demanda normalizada:
{{normalized_demand}}

Fatos mecânicos:
{{mechanical_facts}}

Regras arquiteturais candidatas:
{{architecture_rules}}

Contrato anterior, ou null:
{{previous_contract}}

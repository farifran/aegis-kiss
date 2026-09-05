Use somente os dados delimitados abaixo. Não leia arquivos, não proponha
código, não crie Contract IR e não pergunte sobre o Aegis.

Responda somente JSON compatível com `aegis.preflight_decision.v1`.

1. Preserve exigências explícitas.
2. Não invente requisitos, comportamento ou fatos.
3. Corrija automaticamente apenas o que não muda significado.
4. Recomende a menor solução que satisfaça integralmente a demanda.
5. Marque fatos sem evidência como não verificados.
6. Não transforme regra técnica em requisito do usuário.
7. Preencha `appliedRuleIds` com as regras candidatas que governam a decisão.
8. Se uma regra `hard` conflitar com a demanda, inclua seu ID em
   `hardConflictRuleIds` e use `BLOCKED`; uma exceção exige emenda aprovada,
   não uma pergunta de produto.

Use `CLARIFIED` sem perguntas quando intenção e escopo forem inequívocos.
Use `NEEDS_CONFIRMATION` para uma a três perguntas de `INPUT`, `SCOPE` ou
`ARCHITECTURE`, cada uma com evidência, impacto e recomendação KISS.
Use `BLOCKED` somente se anexo, referência ou contradição impedir entendimento
seguro. Perguntas de comportamento observável pertencem ao briefing.
Avalie uma regra arquitetural candidata somente quando `appliesWhen` for
compatível com a demanda; não a trate como aplicada por estar listada.

<DEMANDA_NORMALIZADA>
{{normalized_demand}}
</DEMANDA_NORMALIZADA>

<FATOS_MECÂNICOS>
{{mechanical_facts}}
</FATOS_MECÂNICOS>

<REGRAS_ARQUITETURAIS_CANDIDATAS>
{{architecture_rules}}
</REGRAS_ARQUITETURAIS_CANDIDATAS>

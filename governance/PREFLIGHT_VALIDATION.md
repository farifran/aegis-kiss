# Validação de Preflight v1

Esta validação exercita três demandas sintéticas de ponta a ponta. O teste não
persiste as entradas brutas: elas existem apenas durante a execução.

| Cenário | Foco | Resultado esperado |
| --- | --- | --- |
| Demanda inequívoca | Normalização CRLF e esclarecimento direto | `CLARIFIED_DEMAND_PERSISTED` sem perguntas e sem demanda bruta em disco. |
| Escopo ambíguo | Pergunta `SCOPE`, confirmação e vínculo por digest | A resposta deve corresponder à decisão e ao prompt que a originou. |
| Referência obrigatória ausente | Fato mecânico `DISPROVEN` e bloqueio | `BLOCKED` sem alterar a demanda esclarecida válida anterior. |

Também é verificada a rejeição de uma resposta cujo identificador não pertence
à pergunta aprovada. A cobertura está em
`scripts/substrates/test/test_preflight_finalization.sh` e é executada por
`npm test`.

# Mapa de responsabilidades dos schemas

## Critério de redução

Um campo deve ter produtor, consumidor e finalidade concreta. Repetição entre
fronteiras de autoridade pode ser necessária; repetição dentro do mesmo artefato
não constitui evidência adicional. Este mapa cobre as famílias de campos e seus
consumidores; não afirma que cada descrição textual seja semanticamente indispensável.

## Formatos e fronteiras

| Schemas | Produtor → consumidor | Finalidade / decisão |
| --- | --- | --- |
| `intent-evidence`, `preflight-handoff` | captura/discovery → semantic request e integridade | Texto, fragmentos, fatos e snapshot. Manter custódia e vínculos. |
| `constitution`, `architecture-policy` | configuração confiável → semantic request/supervisor | Autoridade separada da demanda. Manter. |
| `semantic-request` | Harness → supervisor | Contexto de entrada e referências disponíveis. Não confundir com parecer. O antigo `semantic-worksheet` não tinha produtor/consumidor e foi removido. |
| `jev-decision-batch`, `jev-assessment`, `jev-advisory` | projeção → gateway → integração JEV | Perguntas, resposta externa e vínculo à requisição. Manter limites de confiança; não promover probabilidade a autoridade. |
| `jev-comparison` | comparação JEV/parecer → relatório experimental | Métrica shadow, não requisito do contrato. Manter separado do contrato. |
| `semantic-opinion`, `semantic-opinion-decision`, `prepared-opinion-effect` | supervisor → compilador | Conteúdo semântico e efeitos propostos indexados. Manter distinção de autoridade. |
| `semantic-draft`, `semantic-draft-decision`, `prepared-draft-effect` | compilador → validação/aplicação de respostas | IDs e vínculos resolvidos. Não são segunda resposta solicitada à IA. |
| `contract-components` | definições compartilhadas → schemas anteriores | Reutilização estrutural, não etapa nem artefato de execução. |
| `issue-contract` | lifecycle → aprovação/renderização | Envelope contratual e estado do fluxo. Manter. |
| `decision-presentation`, `wizard-question`, `confirmation-request` | compilador/apresentação → Wizard/humano | Contexto, progresso, alternativas e confirmação. Não remover para reduzir contagem de arquivos. |
| `semantic-resolution` | fluxo de resolução → aprovação | Vínculo das respostas e revisão ao contrato original. Manter. |
| `semantic-execution`, `rejection`, `role-assignment` | execução/configuração → CLI/gateway | Operação e falhas do Harness; não conteúdo de produto. Manter separado. |

## Conteúdo semântico

| Campos/família | Consumidor | Por que não eliminar automaticamente |
| --- | --- | --- |
| `title`, `interpretation`, `changeKind`, `scope` | compilador/renderização | Identificam intenção e limite contratual. |
| `intentClaims`, `fragmentDispositions`, `nonNormativeItems`, `pathReferences` | compilador/validador | Rastreabilidade e distinção entre obrigação, exemplo, meta e caminho. Há sobreposição de conteúdo, mas não equivalência de função. |
| `requirements.acceptanceCases`, `invariants`, `risks` | contrato, validador e efeitos de decisões | Resultados, propriedades e riscos são categorias distintas; não substituir uma pela outra. |
| `architectureContexts`, `policyAssessments`, `complexityReview`, `riskReview`, `adversarialReview` | revisão/validação/renderização | Juízos semânticos. Fusão futura exige alterar produtores e consumidores, não apenas apagar campos do schema. |
| `determinismReview`, `boundaryRules`, `stateModel` | validação estrutural/fechamento | Relações e propriedades declaradas. `determinismReview` usa propriedades abertas e witnesses semânticos pertinentes, não enumeração obrigatória de onze categorias. |
| `unknowns`, `decisions`, `preparedEffect` | aprovação/Wizard/recompilação | Lacunas, escolha humana e aplicação explícita dos efeitos. Preservar. |
| IDs, digests, referências, estados | Harness → validadores/assinatura | Campos mecânicos, não opiniões do modelo. Preservar. |

## Redução aplicada ao certificado compilado

| Campo | Consumo anterior | Mudança |
| --- | --- | --- |
| `inventoryAudit` (17 contadores) | Somente tabela de Markdown | Não emitir nem renderizar. Valores esperados derivados do próprio inventário não comprovam cobertura. |
| `unresolvedSlots` | Nenhum consumidor operacional encontrado | Não emitir: repete diagnósticos já apresentados por `gapLedger`. |
| `regressedSemanticDimensions` | Constante zero somada ao total | Não emitir. Validação real de regressão permanece em `semantic_approval`. |
| `gapLedger` | status, aprovação, relatório Markdown | Lista canônica de diagnósticos. Incluir também dimensões ainda dependentes de decisão. |
| Contadores de pendências restantes | promoção, relatório e testes | Manter nesta etapa; não são evidência semântica nem inventário de testes executados. |

Os três campos retirados da geração também foram removidos do schema. Não há
compatibilidade, alias ou migração automática: o formato atual exige `gapLedger`
e rejeita os campos antigos. Artefatos assinados permanecem intactos em disco;
isso não significa que sejam aceitos pelos validadores atuais. Não recalcular
seus digests nem reaproveitar consentimento para conteúdo alterado.
Foram retirados também 17 nomes de diagnósticos sem produtor no runtime e um
argumento ignorado. A classificação de diagnósticos é interna, não uma API pública.
O número de arquivos de schema não é a meta: esta redução elimina produção,
armazenamento e apresentação redundantes sem redesenhar a análise semântica.

Não foram adicionadas chamadas à IA, adapters, taxonomias ou alterações em `src/`.

# Revisão Estrutural e Bussola Fundamental do Aegis (`reviçao.md`)

## Bussola Fundamental (Para a IA Nunca Perder o Sentido do que Está Construindo)

### 1. Missão e Visão
- **Missão:** Antecipar ambiguidades, falhas de borda e sobre-engenharia **antes** que qualquer código seja escrito — convertendo o pedido humano na especificação mais simples possível (**KISS**), adaptada à arquitetura existente e 100% falsificável.
- **Visão:** Ser o filtro cognitivo de **zero fricção** entre a intenção humana e a implementação: o humano diz o que quer; o Aegis poda excessos, isola apenas decisões materiais reais com consequências já pré-calculadas (`preparedEffect`) e sela um contrato enxuto que qualquer agente codificador implementa de primeira sem regredir.

### 2. O Diferencial do Aegis frente ao Mercado
- **Onde o mercado falha hoje:**
  1. *Vibe Coding / Agentes comuns (Copilot, Cursor, etc.):* Obedecem cegamente ao prompt. Se o pedido tem sobre-engenharia ou lacunas, a IA chuta suposições silenciosas e gera código inchado que quebra depois.
  2. *Spec-Driven tradicional / Métodos Formais:* Ou geram documentos longos e decorativos (PRDs que ninguém valida), ou exigem burocracia formal mais complexa que o próprio software.
- **O que só o Aegis faz:**
  1. **Poda Antecipada (KISS por Design):** Rejeita complexidade especulativa logo na entrada e propõe a menor solução suficiente compatível com `ARCHITECTURE.md` e `AGENTS.md`.
  2. **Zero Suposição Silenciosa:** Nenhum número, limite ou comportamento nasce de alucinação — tudo tem rastro literal na intenção/arquitetura ou vira decisão explícita para o humano.
  3. **Decisões Humanas Instantâneas (`preparedEffect`):** Em vez de longas conversas de alinhamento, o Aegis apresenta apenas as perguntas que mudam o resultado público, com o efeito de cada resposta já pré-compilado para selagem imediata no Wizard.

### 3. Potencialidade: Como Fazer MAIS Mantendo Tudo KISS (Regra Anti-Regressão da IA)
> **O erro que desviou o projeto no passado:** Achar que "mais rigor" significa obrigar a IA a preencher um JSON maior (grafos de cálculo interno, dezenas de arrays interligados por índices numéricos, pseudo-código validado por regex). Isso consome a capacidade cognitiva da IA com burocracia de formulário em vez de análise de engenharia.

Para o Aegis entregar **mais inteligência com menos código**, toda evolução deve obedecer a 3 leis:
1. **Rigor na Fronteira Pública, Liberdade no Interior:** O contrato especifica **o que entra, o que sai, qual estado observável muda, onde falha e como refutar (`Dado / Quando / Então`)**. O contrato **nunca** deve programar variáveis intermediárias, circuitos de cálculo (`computabilityGraph`) ou estruturas internas.
2. **A IA pensa na Semântica; o Harness faz a Contabilidade:** A IA nunca deve preencher campos `null` decorativos, repetir textos em formatos secretos ou contar índices numéricos frágeis que o próprio código Node.js pode resolver.
3. **Filtro de Qualquer Regra Nova no Aegis:** Antes de adicionar qualquer validação ou campo de schema no Aegis, aplique o teste:
   - *"Isso impede um bug real ou sobre-engenharia no produto final, ou só cria mais um obstáculo burocrático para a IA preencher?"* Se for burocracia, corte.

---

## 0. Diagnóstico de Realismo: O Sistema Está Sendo Irreal ou Só Precisa Melhorar?

A partir do teste prático realizado (tanto na demanda simples `somar(a, b)` quanto no contrato complexo de 498 linhas atualmente em [`.harness/runtime/contract.md`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/.harness/runtime/contract.md) gerado por um script manual de **1.818 linhas** em [`scratch/build_optical_channel_opinion.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scratch/build_optical_channel_opinion.mjs)), a resposta honesta é:

> **A tese central do Aegis é 100% realista e valiosa, mas a camada de validação da `opinion` cruzou a linha do razoável e passou a exigir que a IA escreva uma AST formal / pseudo-compilador dentro de um JSON de 35 KB.**

### 0.1. O que é 100% Realista (e já funciona bem)
1. **Captura determinística e evidência literal (`preflight` + `intentEvidence`)**: separar o texto da demanda em fragmentos neutros e fatos literais (caminhos e números) para impedir que a IA invente números ou ignore partes do pedido.
2. **Confronto antecipado com `AGENTS.md` e `architecture.policy.json`**: identificar sobre-engenharia na demanda (fábricas, camadas desnecessárias, dependências) e podá-la antes de existir código.
3. **Contratos falsificáveis + Decisões Humanas com `preparedEffect`**: transformar ambiguidades reais em perguntas objetivas no Wizard, onde cada opção já traz sua mutação pré-calculada (`preparedEffect`), selando o contrato instantaneamente sem nova chamada de LLM.

### 0.2. O que ficou Irreal (e por que hoje a IA regride ou exige scripts manuais no `scratch/`)
1. **Armadilha 1 — Forçar um "Pseudo-Compilador" (`stateModel` + `computabilityGraph`) dentro do Contrato**:
   - Para uma demanda de 165 bytes (`somar(a, b)`), o `semantic-request` tem **50.236 bytes**, dos quais **34.718 bytes (69%)** são apenas definição de JSON Schema, e **15.183 bytes** são só o `stateModel` (`4.945 bytes` apenas para `computabilityGraph`).
   - Em demandas com estado, o schema obriga a IA a decompor fórmulas simples (`(a * b) / c`) em um grafo topológico de nós intermediários e expressões pseudo-código (`guardCondition`, `formulaOrRule`, `valueExpression`), que depois são inspecionados por regexes em `semantic_closure.mjs`.
   - **Por que isso é irreal e anti-KISS?** Viola a própria Constituição (`CONST-KISS` e `CONST-CONTRACT-ONLY`: *"detalhes internos permanecem livres, salvo restrição explícita autorizada"*). O contrato deve especificar **comportamento e invariantes publicamente observáveis**, não variáveis intermediárias de implementação. Além disso, validar pseudo-código em strings via regex gerou uma espiral infinita de falsos positivos e regexes de domínio (`crachá`, `gaveta`, `bandeja`, `nitidez`).
2. **Armadilha 2 — Regras Secretas de Validação e Acoplamento por Índices 0-based**:
   - [`canonicalProofOutcome`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_draft_validator.mjs#L112-L120) exige que o texto de `acceptanceCases[].then` seja **caractere por caractere** idêntico a `"Base: ${baselineOutcome}; Variação: ${variationOutcome}; Resolução: ${resolutionKind}"`. Nenhuma IA adivinha essa string mecânica sem ler o código-fonte do validador.
   - Referências por posição numérica de array (`contextIndex: 17`, `ruleIndex: 4`, `fragmentIndexes: [6, 7, 8]`, `requirementIndex: 2, caseIndex: 3`) fazem com que a inserção de 1 item desloque todos os índices e quebre a opinião inteira — ou gere erros silenciosos graves (como em `.harness/runtime/contract.md`, onde `contextIndex: 0..4` ativou acidentalmente `harness-state`, `harness-runtime` e `harness-core` em uma demanda de produto).
3. **Armadilha 3 — Curto-Circuito de Lacunas (`assertSemanticDraft` vs `BLOCKED_BY_GAP`)**:
   - Quando a demanda omite uma informação material de estado (ex.: valor inicial de um contador) e a IA honestamente marca `UNRESOLVED_DECISION_REQUIRED`, [`assertSemanticDraft`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_draft_validator.mjs#L712-L723) lança exceção fatal (`state_lifecycle_validation_failed`) **antes** que `compileSemanticContract` possa salvar o rascunho como `BLOCKED_BY_GAP` para o humano decidir no Wizard. Na prática, o sistema pune a IA com crash quando ela reporta uma lacuna!

---

## 1. Mapa Completo do Sistema (O que cada parte faz hoje)

### 1.1. Entrada e Orquestração CLI
| Arquivo | Papel atual | Estado |
| :--- | :--- | :--- |
| [`aegis`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/aegis) | Wrapper bash que define `AEGIS_ROOT` e delega para `scripts/ide_gateway.sh`. | Ativo / Enxuto |
| [`scripts/ide_gateway.sh`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/ide_gateway.sh) | Gateway CLI principal (`--new`, `--clean`, `--wizard`, `--approve`, `--verify`, `--status`, `--setup`, `--semantic-*`, `--jev-*`) e Wizard interativo em TTY. | Ativo (com mudanças locais não commitadas de `--new`/`--clean`) |
| [`scripts/issue_contract_runner.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/issue_contract_runner.mjs) | Orquestrador Node.js das fases: captura/preflight (`draft`), requisição semântica (`semantic-request`), supervisão (`semantic-run`), compilação (`semantic-compile`), confirmação (`confirmation-request`), aprovação (`approve`), verificação (`verify`) e status (`status`). | Ativo / Core |
| [`scripts/setup_roles.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/setup_roles.mjs) | Configurador interativo de `.harness/config/roles.json` (`contractSupervisor` e `codingAgent`). | Ativo (nota: `codingAgent` é configurado mas nunca consumido pelo Harness) |
| [`scripts/generate_schema_validators.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/generate_schema_validators.mjs) | Compila os JSON Schemas de `governance/schemas/` em validadores standalone Ajv CommonJS em `scripts/generated/schema_validators/*.cjs`. | Ativo / Build |

---

### 1.2. Núcleo Mecânico e Semântico (`scripts/lib/`)

#### A. Captura, Discovery e Evidência Literal (Fases 1 a 3)
| Arquivo | Linhas | O que faz | Diagnóstico |
| :--- | ---: | :--- | :--- |
| [`canonical_json.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/canonical_json.mjs) | 31 | Serialização JSON canônica (chaves ordenadas) e hash `sha256` / `canonicalDigest`. | Limpo / Essencial |
| [`issue_contract_core.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/issue_contract_core.mjs) | 234 | Sanitiza a demanda (`captureDemand`), observa `src/` sem seguir symlinks (`observeWorkspace`), gera o `preflight.json` (`buildPreflightHandoff`) e autentica `governance/architecture.policy.json` contra `ARCHITECTURE.md`. | Limpo / Essencial |
| [`hybrid_source_index.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/hybrid_source_index.mjs) | 424 | Constrói índice léxico BM25 + identificadores compostos sobre `src/` (`.harness/runtime/source-index.json`) para localizar trechos relevantes do código existente. | Ativo (possui tabelas de extensões para ~60 linguagens apesar do projeto focar em TS/JS) |
| [`preflight_integrity.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/preflight_integrity.mjs) | 80 | Valida integridade criptográfica e estrutural de `.harness/runtime/preflight.json`. | Limpo / Essencial |
| [`intent_evidence.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/intent_evidence.mjs) | 169 | Segmenta a demanda em frases (`FRAG-*`) e extrai fatos literais (`FACT-*`: números, bit ranges, paths, code spans). | **Contém resíduo legado:** emite `bitLayouts: []` fixo e extrai `BIT_RANGE`/`BIT_WIDTH` de demandas antigas de bitmask. |

#### B. Preparação da Requisição Semântica e Supervisores (Fase 4)
| Arquivo | Linhas | O que faz | Diagnóstico |
| :--- | ---: | :--- | :--- |
| [`semantic_request.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_request.mjs) | 224 | Autentica `governance/constitution.json` contra `AGENTS.md`, seleciona trechos de `src/` e monta `aegis.semantic_request.v10`. | **Contém resíduo legado:** emite `policy.signals: []` sempre vazio (detector mecânico foi removido, mas o campo ficou). |
| [`semantic_output_schema.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_output_schema.mjs) | 98 | Transforma `semantic-opinion.v3.schema.json` em schema compacto para Structured Outputs da LLM (`$defs` compartilhados, campos opcionais nullable) e remove `null`s na volta (`omitOptionalNulls`). | Limpo / Essencial |
| [`semantic_gateway.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_gateway.mjs) | 163 | Constrói o prompt do sistema (`semanticSupervisorInstructions`) e chama o supervisor via HTTP (`ai-gateway` ou `openai-compatible`). | Ativo / Core |
| [`semantic_codex.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_codex.mjs) | 133 | Executa o supervisor semântico via CLI `codex exec --ephemeral --sandbox read-only --output-schema`. | Ativo |
| [`role_assignment.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/role_assignment.mjs) | 47 | Lê e valida `.harness/config/roles.json`. | Ativo (`publicRoleSummary` exportada sem uso externo) |

#### C. Compilação, Validação, Fechamento e Aprovação do Contrato (Fases 5 a 7)
| Arquivo | Linhas | O que faz | Diagnóstico |
| :--- | ---: | :--- | :--- |
| [`semantic_opinion.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_opinion.mjs) | 479 | Compila o parecer indexado da IA (`aegis.semantic_opinion.v3`) para o rascunho com IDs canônicos (`aegis.semantic_draft.v9`) e compila recursivamente cada `preparedEffect`. | Ativo (duplica montagem de objeto `specification` para `generateClosureCertificate`) |
| [`semantic_draft_validator.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_draft_validator.mjs) | 724 | Valida referências, citações literais, `basis`, requisitos, limites, decisões, cobertura de determinismo e chama `validateFieldLifecycle`. | **Sobreposição e conflito:** duplica validação de decisões com `semantic_closure.mjs` e lança exceção fatal em `validateFieldLifecycle`, impedindo que rascunhos com lacunas de estado cheguem ao status `BLOCKED_BY_GAP`. |
| [`semantic_closure.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_closure.mjs) | 1770 | Gera o `closureCertificate` e o `gapLedger` verificando inventário, ciclo de vida de campos, totalidade de operações, contradições, proveniência numérica e grafo de computabilidade. | **Ponto mais crítico de legado/regressão:** contém função morta (`validateAggregationAndBoundaries`), códigos de erro mortos em `GAP_KIND_MAP` e **dezenas de regexes específicas de domínios passados** (crachá, gaveta, bandeja, nitidez, merkle, etc.). |
| [`prepared_effects.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/prepared_effects.mjs) | 124 | Aplica em memória os efeitos pré-calculados (`preparedEffect`) das respostas escolhidas no Wizard sem precisar chamar a IA novamente. | Limpo (`assertPreparedEffectScope` pode ser interna) |
| [`semantic_contract_lifecycle.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_contract_lifecycle.mjs) | 152 | Empacota o `draft` validado em `aegis.issue_contract.v14`, simula todos os `preparedEffect` preventivamente e valida documentos de contrato. | Ativo / Core |
| [`semantic_approval.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_approval.mjs) | 360 | Gera `user_confirmation_request.json` para o Wizard, verifica se respostas exigem recompilação e sela a aprovação humana (`finalizeContractApproval`). | **Efeito colateral oculto:** muta propriedades estáticas na própria função (`effectiveDeterminismStatus.lastGapLedger` / `lastCertificate`). |
| [`semantic_contract_markdown.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_contract_markdown.mjs) | 592 | Renderiza `.harness/runtime/contract.md` a partir de `contract.json`. | **Inchado:** renderiza tabelas para subestruturas órfãs/não validadas (`aggregations`, `categories`, `executionPipeline`, metadados de `unit`/`cardinality`/`identityScope`). |
| [`semantic_state.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_state.mjs) | 35 | Lê e verifica a integridade de `.harness/state/semantic-state.json`. | Limpo |
| [`semantic_authority.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_authority.mjs) | 53 | Helpers para witnesses de determinismo e autoridade de fechamento. | **Contém código morto:** `literalReferenceAppears` não é usada em nenhum lugar; `policySignalSemantics` é resíduo do detector mecânico removido. |
| [`semantic_collections.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_collections.mjs) | 5 | Helper único `assertUniqueIds` (5 linhas). | Micro-arquivo; pode permanecer ou ser consolidado. |
| [`semantic_contract.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_contract.mjs) | 30 | Barrel file que reexporta funções de 7 módulos. | **Reexporta funções não usadas pelo runner** (ex.: `validateAggregationAndBoundaries`). |
| [`schema_catalog.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/schema_catalog.mjs) | 51 | Registro central dos 24 arquivos JSON Schema e 18 validadores gerados. | Limpo |
| [`schema_validator.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/schema_validator.mjs) | 94 | Carrega os validadores compilados `.cjs` e expande `$ref`s para schemas standalone. | Limpo |
| [`rejection_report.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/rejection_report.mjs) | 212 | Formata erros estruturados `aegis.rejection.v1` com mensagem e remediação em português. | Contém códigos de diagnóstico de fluxos antigos/JEV que merecem revisão. |

#### D. Subsistema JEV (`scripts/lib/jev_*.mjs` + `scripts/substrates/test/*jev*`)
| Arquivo | Linhas | O que faz | Diagnóstico |
| :--- | ---: | :--- | :--- |
| [`jev_projection.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/jev_projection.mjs) | 163 | Projeta fragmentos da demanda em perguntas binárias/escolha (`role` e `review`) para o modelo TypeSafe JEV. | Modo sombra (`SHADOW_METRIC_ONLY`) |
| [`jev_gateway.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/jev_gateway.mjs) | 89 | Cliente `@typesafe-ai/sdk` via Vercel AI Gateway (`jev-latest`). | Na prática sempre falha/ignora sem créditos pagos ou sem `AI_GATEWAY_API_KEY`. |
| [`jev_advisory.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/jev_advisory.mjs) | 45 | Empacota resposta do JEV em `.harness/runtime/jev-advisory.json`. | **Nunca é lido pelo supervisor semântico**; não ajuda a antecipar nada na geração do contrato. |
| [`jev_comparison.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/jev_comparison.mjs) | 60 | Compara classificação de fragmentos do JEV com o `draft` em `jev-comparison.json`. | Artefato morto: ninguém lê `jev-comparison.json`. |
| [`jev_reading_map.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/jev_reading_map.mjs) | 87 | Projeção experimental ampliada (`basic`, `expanded`, `linked`). | **Experimento encerrado:** documentado em `governance/jev-ab-comparison-2026-10-02.md` como sem ganho e 3x mais lento/caro. Não é usado no runtime. |

---

## 2. Problemas Encontrados: Código Morto, Legado, Redundante e Anti-KISS

### 2.1. Diretório `scratch/` (23 arquivos, ~27.000 linhas de rascunhos)
O diretório [`scratch/`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scratch) acumula **27.003 linhas** de scripts geradores manuais de opinião (`build_liquidity_opinion.mjs`, `build_optical_channel_opinion.mjs`, `build_quarantine_ingestor_opinion.mjs`, `build_tictactoe3d_opinion.mjs`, `build_yard_management_opinion.mjs`, `test_builder.mjs`) e dumps JSON gigantes de sessões passadas.
- **Impacto:** Polui buscas no repositório, confunde agentes e mistura artefatos de bancada com o repositório.

### 2.2. Regras "Overfitted" (Heurísticas de Domínio Hardcoded) em `semantic_closure.mjs`
Embora a Constituição (`CONST-OBSERVABLE`) e [`governance/semantic-review-evaluations.md`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/governance/semantic-review-evaluations.md) determinem que o Harness **não** deve deduzir semântica por palavras-chave de domínio, [`scripts/lib/semantic_closure.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_closure.mjs) acumulou validações baseadas em regexes feitas sob medida para as 5 demandas do `scratch/`:
1. **Regra do "Crachá Inexistente"** ([`semantic_closure.mjs#L794-L800`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_closure.mjs#L794-L800)): testa `/unregistered|unknown_badge|inexistent/iu` no nome da guarda e emite erro falando literalmente em *"rejeição de crachá inexistente"*.
2. **Regra da "Gaveta Cheia"** ([`semantic_closure.mjs#L839-L860`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_closure.mjs#L839-L860)): busca regex `/(?:saturação|saturad|fila\s+cheia|capacidade\s+máxima|estouro|gaveta\s+cheia)/iu` no texto livre dos requisitos/decisões.
3. **Regra da "Árvore de Merkle"** ([`semantic_closure.mjs#L513-L523`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_closure.mjs#L513-L523)): testa regex `/(?:merkle)/i` e `/(?:total|sum|accumulated|volume|count)/i` nos nomes de campos.
4. **Tags de Contexto Inexistentes no Schema e Regex de "Nitidez"** ([`semantic_closure.mjs#L1132-L1163`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_closure.mjs#L1132-L1163)): verifica tags `'apportionment'`, `'partial-fill'`, `'cycle-detection'`, `'multilateral'` (que **não existem** em `governance/architecture.policy.json` e seriam rejeitadas como `unknown_architecture_context`!) e procura `/(?:nitid|livre|demand|capacidade)/iu` nos símbolos do grafo.
5. **Palavras Reservadas de Domínio em Fórmulas** ([`semantic_closure.mjs#L1182-L1187`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_closure.mjs#L1182-L1187)): inclui `'bps'`, `'scaled'`, `'strict'`, `'local'`, `'extremum'`, `'peak'`, `'trough'` como palavras reservadas da linguagem de fórmulas.
6. **Regex de Rodapé/Ingestor em `EXTERNAL_INPUT`** ([`semantic_closure.mjs#L1215-L1219`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_closure.mjs#L1215-L1219)): bloqueia `EXTERNAL_INPUT` se o identificador bater com `/(?:accumulated|calc_|calculated|computed|total_|delta|divergence|parsed|extracted|declared_in_footer|row_count|batch_sum|running_total)/i`.
7. **Regex de Quarentena/Verbos em Operações** ([`semantic_closure.mjs#L1439-L1471`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_closure.mjs#L1439-L1471)): força `externalEffects` e `rollback` se o nome/descrição da operação contiver palavras como `quarantine`, `ledger`, `audit`, `write`, `escrever`, `gravar`.
8. **Regra da "Bandeja / Resíduo"** ([`semantic_closure.mjs#L1477-L1496`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_closure.mjs#L1477-L1496)): testa `/(?:residuo|sobra|rechecagem|devolucao)/iu` no nome do símbolo e emite erro mencionando *"nem campo de bandeja"*.
9. **Regex de "Congelada Restaurando o Arquivo"** ([`semantic_closure.mjs#L1499-L1517`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_closure.mjs#L1499-L1517)): testa `/(?:rollback|reversão\s+atômica|restaurando\s+o\s+arquivo|congelada.*restaurando)/iu` nos requisitos.

### 2.3. Campos Órfãos e Sobre-Engenharia nos Schemas (`stateModel` e `computabilityGraph`)
Em sessões anteriores, vários validadores de `semantic_closure.mjs` foram removidos (`validatePipelineCrossCheck`, `validateDerivedFieldDerivations`, `validateCategorySetMembership`, validação dimensional de unidades) ou esvaziados (`validateAggregationAndBoundaries` hoje retorna `{ valid: true, issues: [] }`), **mas os campos continuaram obrigatórios/presentes no JSON Schema enviado à IA** (`aegis.semantic_opinion.v3` e `aegis.semantic_draft.v9`):
- `stateModel.aggregations` (sem validação ativa; `validateAggregationAndBoundaries` é um stub vazio).
- `stateModel.categories` (sem nenhuma validação no código).
- `stateModel.entities[].fields[].derivation` (sem validação no código; compete com `computabilityGraph`).
- `stateModel.operations[].executionPipeline` (sem validação no código).
- `stateModel.computabilityGraph[].unit` (estrutura enorme com `family`, `conversion`, `numerator`, `denominator`, `per` — sem validação no código).
- `stateModel.computabilityGraph[].cardinality` (sem validação no código).
- `stateModel.computabilityGraph[].identityScope` (sem validação no código).
- `stateModel.computabilityGraph[].edgeCaseRules` (sem validação no código).
- `stateModel.computabilityGraph[].feedbackConfirmation` (sem validação no código).
- **Impacto direto no objetivo do Aegis:** Como `buildSemanticOutputSchema` converte todos os campos opcionais em propriedades obrigatórias aceitando `null` para o modo `strict: true` da LLM, a IA é forçada a preencher dezenas de campos `null` ou estruturas complexas em toda demanda, aumentando latência, custo de tokens, chance de alucinação e sobre-engenharia no contrato!

### 2.4. Resíduos de Subsistemas Removidos Pela Metade
1. **Detector Mecânico de Sinais de Política (`policySignals` / `signals`)**:
   - Em [`semantic_request.mjs#L203`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_request.mjs#L203), `policy.signals` é inicializado fixo como `[]`.
   - Mesmo assim, `policySignals` continua no `issue-contract.v14.schema.json`, em `semantic_contract_lifecycle.mjs`, em `semantic_contract_markdown.mjs`, `policySignalSemantics` continua em `semantic_authority.mjs`, e `reviewReferences` / `forbiddenReferences` / `sourceRanges` (com `startByte: 0, endByte: 0` nas regras 13 a 16!) continuam em `governance/architecture.policy.json` e em `ARCHITECTURE.md` (seção "Sinais mecânicos conservadores").
2. **Análise Mecânica de Bit Layouts (`bitLayouts`)**:
   - Em [`intent_evidence.mjs#L137`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/intent_evidence.mjs#L137), `bitLayouts: []` é sempre vazio, mas a definição de schema `bitLayouts` permanece em `governance/schemas/intent-evidence.v1.schema.json`.
3. **Códigos Mortos em `GAP_KIND_MAP`** ([`semantic_closure.mjs#L1701-L1750`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_closure.mjs#L1701-L1750)):
   - `CROSS_LAYER_CONTRADICTION`, `UNRESOLVED_COMPUTATIONAL_DEPENDENCY` e `FABRICATED_EXTERNAL_INPUT` estão mapeados, mas nenhum validador os emite.

### 2.5. Duplicação e Contradição Arquitetural entre Validadores
1. **Dupla validação de Decisões**:
   - `validateDecisions` em [`semantic_draft_validator.mjs#L242-L299`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_draft_validator.mjs#L242-L299) e `validateDecisionsWitness` em [`semantic_closure.mjs#L25-L90`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_closure.mjs#L25-L90) validam as mesmas invariantes sobre `distinguishingCase` e `answers`.
2. **Curto-circuito de `BLOCKED_BY_GAP` em `assertSemanticDraft`**:
   - `compileSemanticOpinion` calcula `closureCertificate` (transformando problemas de `validateFieldLifecycle` em entradas estruturadas no `gapLedger`).
   - Porém, logo em seguida, `compileSemanticContract` chama `assertSemanticDraft`, que chama `validateFieldLifecycle` ([`semantic_draft_validator.mjs#L712-L723`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_draft_validator.mjs#L712-L723)) e **lança erro fatal** (`state_lifecycle_validation_failed`), abortando a gravação de `contract.json`!
   - Isso torna o estado `BLOCKED_BY_GAP` (previsto em `issue_contract_runner.mjs` e `semantic_approval.mjs`) inalcançável para qualquer lacuna de ciclo de vida/estado.
3. **Mutação de propriedade na função `effectiveDeterminismStatus`**:
   - Em [`semantic_approval.mjs#L15-L16`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_approval.mjs#L15-L16), a função grava `effectiveDeterminismStatus.lastGapLedger = ...` e `effectiveDeterminismStatus.lastCertificate = ...` em si mesma.
4. **Duplicação nos JSON Schemas (`governance/schemas/`)**:
   - [`contract-components.v1.schema.json`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/governance/schemas/contract-components.v1.schema.json) (3.274 linhas) mantém pares idênticos `semantic_draft_*` e `semantic_opinion_*` (`title`, `interpretation`, `changeKind`, `scope`, `repositoryPath`, `rangeBehavior`, `riskReview`).
   - [`semantic-draft.v9.schema.json`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/governance/schemas/semantic-draft.v9.schema.json) e [`semantic-opinion.v3.schema.json`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/governance/schemas/semantic-opinion.v3.schema.json) duplicam quase todo o bloco `stateModel` (~600 linhas em cada arquivo).

### 2.6. Desalinhamentos de Integração, Gates e Documentação
1. **Extensão VS Code (`integrations/vscode-aegis-wizard/`) desatualizada em relação a `preparedEffect`**:
   - Em [`protocol.js#L50-L59`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/integrations/vscode-aegis-wizard/protocol.js#L50-L59), `requiresRecompilation` retorna `questions.size > 0`, ignorando `applicationMode === "PREPARED_EFFECT"`. Enquanto o CLI (`ide_gateway.sh`) aplica `preparedEffect` instantaneamente sem chamar a IA, a extensão VS Code para e pede recompilação manual pelo supervisor.
   - Há também um binário antigo `aegis-vscode-wizard-0.1.0.vsix` commitado junto com o `package.json` `0.2.0`.
2. **`eslint.config.js` e `static_gate.sh` com restrições arbitrárias**:
   - [`eslint.config.js`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/eslint.config.js) impõe 4 camadas fixas (`src/ui`, `src/application`, `src/domain`, `src/infrastructure`) via `eslint-plugin-boundaries`, contrariando `CONST-KISS` e `ARCH-PARSIMONY` (que proíbem exigir camadas sem necessidade demonstrada).
   - [`scripts/substrates/static_gate.sh#L317-L332`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/substrates/static_gate.sh#L317-L332) executa `semgrep scan --config auto` (que depende de rede caso `semgrep` esteja instalado no PATH, violando `ARCH-LOCAL-DETERMINISTIC-CORE`).
   - `npm run aegis:typecheck` falha quando `src/` está vazio (`TS18003`).
3. **Documentos de Migração/Experimentos e Regras Conflitantes**:
   - [`clean.md`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/clean.md) na raiz é um documento de transição já concluída.
   - [`.agents/rules/aegis_interaction.md`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/.agents/rules/aegis_interaction.md) (Seção 4) ainda descreve "Os 5 Eixos Universais de Verificação de Estado" como obrigatórios, gerando tensão com `AGENTS.md` (`CONST-OBSERVABLE`) e `ARCH-MINIMAL-SUFFICIENT-CLOSURE`.

---

## 3. Checklist de Depuração e Limpeza Passo a Passo (Ordem Ajustada pelo Diagnóstico de Realismo)

A ordem abaixo prioriza **tornar o sistema realista e fluido para a IA acertar de primeira (sem scripts manuais no `scratch/`)**, provar isso na prática e depois limpar os resíduos mecânicos:

### Fase 1 — Tornar o Validador Realista (Fim das Armadilhas Secretas, Overfitting e Curto-Circuito)
- [x] **1.1. Desbloquear `BLOCKED_BY_GAP` / Lacunas Reais:** Resolver o conflito entre [`assertSemanticDraft`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_draft_validator.mjs#L712-L723) e [`generateClosureCertificate`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_closure.mjs#L1525-L1580). Lacunas materiais da demanda (`UNRESOLVED_DECISION_REQUIRED`, `OPEN_DEPENDENCY`, etc.) devem virar entradas no `gapLedger` / decisões para o Wizard, e **não** lançar exceção fatal `state_lifecycle_validation_failed`.
- [x] **1.2. Eliminar Regras Secretas de String (`canonicalProofOutcome`):** Remover em [`semantic_draft_validator.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_draft_validator.mjs#L112-L120) a exigência de que `acceptanceCases[].then` tenha que repetir literalmente `"Base: ...; Variação: ...; Resolução: ..."`, permitindo texto natural legível por humanos enquanto os dados estruturados da prova ficam em `proofObligation` / `counterexampleWitness`.
- [x] **1.3. Eliminar Validação Duplicada de Decisões:** Unificar `validateDecisions` (`semantic_draft_validator.mjs`) e `validateDecisionsWitness` (`semantic_closure.mjs`).
- [x] **1.4. Desintoxicar Heurísticas de Domínio ("Des-overfitting") em [`semantic_closure.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_closure.mjs):**
  - [x] Remover regex de crachá (`/unregistered|unknown_badge|inexistent/iu`).
  - [x] Remover regex de gaveta/fila cheia (`/(?:saturação|saturad|fila\s+cheia|capacidade\s+máxima|estouro|gaveta\s+cheia)/iu`).
  - [x] Remover regex de Merkle (`/(?:merkle)/i` + acumuladores escalares).
  - [x] Remover tags inexistentes (`'apportionment'`, `'partial-fill'`, `'cycle-detection'`, `'multilateral'`) e regex de nitidez (`/(?:nitid|livre|demand|capacidade)/iu`).
  - [x] Remover palavras de domínio em `reservedFormulaKeywords` (`bps`, `scaled`, `strict`, `local`, `extremum`, `peak`, `trough`).
  - [x] Remover regex de rodapé/lote em `EXTERNAL_INPUT` (`declared_in_footer`, `row_count`, `batch_sum`, etc.).
  - [x] Remover regex de quarentena/verbos em operações (`quarantine`, `ledger`, `audit`, etc.) — manter a exigência de efeitos externos baseada **exclusivamente** no contexto autorizado `external-effect`.
  - [x] Remover regex de bandeja/resíduo (`/(?:residuo|sobra|rechecagem|devolucao)/iu`).
  - [x] Remover regex de "congelada restaurando o arquivo".
- [x] **1.5. Limpar Testes Overfittados:** Atualizar [`scripts/substrates/test/test_field_lifecycle.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/substrates/test/test_field_lifecycle.mjs) removendo os testes que forçavam essas regexes de domínio (TEST-91, 92, 103, 104, 105, 106, etc.) e preservando apenas invariantes estruturais puros.

### Fase 2 — Enxugamento Radical do Schema e do `stateModel` (Reduzir os 34,7 KB de `outputSchema`)
- [x] **2.1. Remover Subestruturas Órfãs de `stateModel`** (em `semantic-opinion.v3.schema.json`, `semantic-draft.v9.schema.json`, `contract-components.v1.schema.json` e `semantic_contract_markdown.mjs`):
  - [x] `stateModel.aggregations` (e remover o stub vazio `validateAggregationAndBoundaries`)
  - [x] `stateModel.categories`
  - [x] `stateModel.entities[].fields[].derivation`
  - [x] `stateModel.operations[].executionPipeline`
  - [x] Metadados decorativos de `computabilityGraph`: `unit`, `cardinality`, `identityScope`, `edgeCaseRules`, `feedbackConfirmation`.
- [x] **2.2. Remover `computabilityGraph` e `producerConsumerBoundaries` (Decisão: Opção A — KISS):**
  - [x] Manter no `stateModel` apenas o essencial observável: `entities` (campos, tipos, limites, init/reset), `operations` (inputs, precedência de guardas, ramos de sucesso/erro e efeitos nos campos), `observables` e `canonicalSerializations`. As regras de cálculo permanecem onde pertencem: nos `requirements`, `invariants` e `operations[].branches`.
- [x] **2.3. Remover Resíduos de Subsistemas Desativados:**
  - [x] Remover `bitLayouts` (sempre `[]` em `intent_evidence.mjs` e `intent-evidence.v1.schema.json`).
  - [x] Remover `policy.signals` / `policySignals` / `policySignalSemantics` (sempre `[]` em `semantic_request.mjs`) e limpar `sourceRanges` zerados em `governance/architecture.policy.json`.
- [x] **2.4. Deduplicar Schemas e Regenerar Validadores:**
  - [x] Deduplicar pares `semantic_draft_*` / `semantic_opinion_*` em `contract-components.v1.schema.json`, omitir seção `## 6` vazia no Markdown quando `stateModel === null`, e rodar `npm run aegis:generate-schemas`.

### Fase 3 — Prova de Realismo (Teste Prático Pós-Simplificação)
- [x] **3.1.** Medir a queda de tamanho do `semantic-request` e do `outputSchema` após as Fases 1 e 2:
  - `semantic-request`: caiu de **50.236 bytes** para **42.533 bytes** (**-15,3%**).
  - `outputSchema`: caiu de **34.718 bytes** para **26.902 bytes** (**-22,5%**).
  - `stateModel` no schema: caiu de **15.183 bytes** para **8.002 bytes** (**-47,3%**), contendo apenas `['canonicalSerializations', 'entities', 'observables', 'operations']`.
  - Também foram eliminadas na prática 2 armadilhas adicionais de igualdade exata de string (`NORMATIVE_CLAIM_NOT_MATERIALIZED` e `DECISION_EFFECT_NOT_PROVEN` em `semantic_draft_validator.mjs`) e o bug de múltiplos fatos literais em `bounds.provenance` (`validateProvenanceEnforcement` em `semantic_closure.mjs`).
- [x] **3.2.** Testar 3 cenários reais diretamente (sem scripts manuais de 1.800 linhas):
  - [x] **Cenário A:** Demanda simples pura (`somar(a, b)`) com prosa natural em `acceptanceCases[].then` e sem seção `## 6. Modelo de Estado` vazia no Markdown → **PASS**.
  - [x] **Cenário B:** Demanda com tentativa de sobre-engenharia (`AbstractCouponFactory` + `CouponValidationStrategyBuilder` + `EventBus`) podada para função pura KISS (`complexityReview.status: "SIMPLIFIED"`) → **PASS**.
  - [x] **Cenário C:** Demanda com estado (`Counter.attempts` em `0..5`) e lacuna material real com `preparedEffect` (sem `computabilityGraph`) → **PASS**.

### Fase 4 — Higiene de Código Morto, `scratch/` e Árvore Git
- [x] **4.1.** Limpar o diretório `scratch/` (23 arquivos / 27.003 linhas de scripts e dumps antigos removidos).
- [x] **4.2.** Consolidar alterações locais pendentes e remover `clean.md` da raiz.
- [x] **4.3.** Remover funções e exports mortos (`literalReferenceAppears` em `semantic_authority.mjs`, `getEffectiveGapLedger` e mutação estática `effectiveDeterminismStatus.lastGapLedger` em `semantic_approval.mjs`, códigos mortos em `GAP_KIND_MAP`, e enxugar `semantic_contract.mjs`).
- [x] **4.4.** Remover o binário antigo `integrations/vscode-aegis-wizard/aegis-vscode-wizard-0.1.0.vsix`.

### Fase 5 — Decisão e Limpeza do Subsistema JEV
- [x] **5.1.** Remover completamente o subsistema JEV (`jev_*.mjs`, `@typesafe-ai/sdk`, schemas `jev-*`, validadores gerados `aegis_jev_*.cjs`, comandos `--jev-request`/`--jev-run`, relatórios `jev-evaluation.md`/`jev-ab-comparison-2026-10-02.md` e scripts de laboratório).

### Fase 6 — Alinhamento Final de Gates, Extensão VS Code e Regras
- [x] **6.1.** Atualizar [`integrations/vscode-aegis-wizard/protocol.js`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/integrations/vscode-aegis-wizard/protocol.js) e [`integrations/vscode-aegis-wizard/extension.js`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/integrations/vscode-aegis-wizard/extension.js) para reconhecer `applicationMode === "PREPARED_EFFECT"`.
- [x] **6.2.** Simplificar [`eslint.config.js`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/eslint.config.js) (remover imposição de 4 camadas Clean Architecture que viola `CONST-KISS`) e [`scripts/substrates/static_gate.sh`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/substrates/static_gate.sh) (remover `semgrep --config auto` dependente de rede).
- [x] **6.3.** Alinhar [`.agents/rules/aegis_interaction.md`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/.agents/rules/aegis_interaction.md) com `AGENTS.md` e `ARCH-MINIMAL-SUFFICIENT-CLOSURE`.

---

## 4. Resultado Consolidado da Limpeza (Fases 1 a 6 Concluídas)

- **Redução total de código e artefatos rastreados:** `70 arquivos alterados (+774 / -9.121 linhas)`, além da remoção de `27.003 linhas` não rastreadas em `scratch/` (**~35.350 linhas eliminadas no total**).
- **Redução do payload enviado à IA (`semantic-request`):**
  - `semantic-request`: `-15,3%` (`50.236 B` → `42.533 B`)
  - `outputSchema`: `-22,5%` (`34.718 B` → `26.902 B`)
  - `stateModel`: `-47,3%` (`15.183 B` → `8.002 B`)
- **Suítes de verificação (`PASS` 100%):**
  - `npm test` (`aegis:check-generated-schemas`, `test_semantic_output.mjs`, `test_governance_schemas.sh`, `test_field_lifecycle.mjs`, `test_issue_contract.sh`)
  - `npm run aegis:sanity` (`aegis:typecheck`, `aegis:lint`, `aegis:enforce`)

---

## 5. Teste 2 — Supervisor "às cegas" (pós-limpeza)

**Demanda:** *"Criar um limitador de requisições que permita no máximo 5 requisições por minuto por usuário e responda com erro 429 quando o limite for excedido."* (146 bytes)

**Método:** sem `codex` nem chave de API disponíveis, a IA da IDE atuou como supervisor lendo **somente** o que um supervisor real recebe (instruções do sistema + `outputSchema`), sem consultar o código dos validadores. Cada rejeição foi registrada e classificada.

**Resultado:** contrato compilado somente na **9ª tentativa** (8 rejeições). **Nenhuma** rejeição apontou erro semântico real do parecer; **todas** vieram de regras ocultas, incoerência entre schemas ou bug do Harness. Enquanto isso, um erro semântico real do parecer (modelar janela deslizante como contador inteiro com reset) **passou** sem alerta.

| # | Rejeição | Classificação |
| :-: | :--- | :--- |
| 1 | `subjectId:pattern` — `dimension.subject.kind = DECISION` é aceito pelo schema da opinion, mas rejeitado pelo schema do draft | Incoerência entre schemas |
| 2 | `DECISION_WITHOUT_MATERIAL_UNKNOWN` — unknown com base `ARCHITECTURE_POLICY` não sustenta decisão (só `USER_INTENT`/`USER_DECISION`); mensagem fala em "alternativas não materiais" | Restrição oculta + mensagem enganosa |
| 3 | `DETERMINISM_PROOF_OUTCOME_MISMATCH` — `then` do caso precisa **conter literalmente** `baselineOutcome` e `variationOutcome` | Regra secreta de string (contradiz a instrução "o Harness não prova correspondência de significado") |
| 4 | `DETERMINISM_GAP_WITHOUT_SINGLE_DECISION` — a decisão precisa estar em `targets`, não em `subject` | Regra não documentada |
| 5 | `DETERMINISM_COVERAGE_UNRELATED_DIMENSION` — requisito derivado de política precisa ser alvo de alguma claim do usuário | Regra não documentada |
| 6 | `INVALID_MODEL_ANALYSIS_BASIS` — `reference` de `MODEL_ANALYSIS` precisa ser exatamente `"analysis"` | Regra secreta de string |
| 7–8 | `DETERMINISM_COVERAGE_UNRELATED_DIMENSION` na **simulação** de `preparedEffect`: [`applyPreparedAnswers`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/prepared_effects.mjs#L81-L87) remove `Q-*` dos alvos da dimensão, mas a claim de ambiguidade continua apontando para `Q-*`; o erro não informa que veio da prévia de uma resposta | **Bug do Harness** + diagnóstico sem contexto |

**Outras observações:**
- Payload: request `42,8 KB` + opinion `24,6 KB` para uma frase. `preparedEffect` repete o requisito inteiro a cada alternativa.
- `preparedEffect` não altera `stateModel` → toda decisão que muda guardas/campos exige nova chamada à IA (`SEMANTIC_REVIEW_REQUIRED`), e o `stateModel` base fica forçado a um modelo neutro (aqui, semanticamente errado).
- Resíduos de demandas antigas ainda no prompt/schema: `policy.signals` e "agregações" nas instruções; enums `ISOLATE_TO_QUARANTINE`, `TRAP_PURGE_TEMPORARY`, `preservesTimestamp`, `UINT32_BITMASK`/`bitAllocation`, `emptyStateDigest`.
- [`ARCH-PUBLIC-INTERFACE`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/governance/architecture.policy.json) proíbe propor uma interface quando a demanda não traz assinatura — conflita com a missão de antecipar a versão KISS.
- `contract.md` (242 linhas): "Máx null entradas", crases vazias em mutações, pontos duplos (`..`), numeração 6.3 → 6.6, título "Mapeamento de Bits" sem bits, "Revisão FOUND", 4 hashes no topo para leitura humana.
- Positivo: decisões bem apresentadas (contexto, impacto, caso distintivo); Wizard bloqueia stdin simulado (consentimento real preservado).

## 6. Checklist Fase 7 — Acerto de Primeira (derivada do Teste 2)

**P1 — Sem decisão humana (correções de coerência/bug):**
- [x] **7.1** Remover regras secretas de string: `MODEL_ANALYSIS.reference === 'analysis'` e exigência de substring `baselineOutcome`/`variationOutcome` em `then` (manter vínculo `acceptanceCase` + coerência `relation` ↔ `outcomeKind`).
- [x] **7.2** Restringir `dimension.subject` no schema da opinion a `REQUIREMENT | BOUNDARY_RULE | null` (igual ao draft).
- [x] **7.3** Corrigir `applyPreparedAnswers`: manter cobertura coerente quando uma decisão fecha uma dimensão coberta pela claim de ambiguidade.
- [x] **7.4** Erros na prévia de `preparedEffect` devem informar `Q-*`/`ANS-*`; corrigir mensagem de `DECISION_WITHOUT_MATERIAL_UNKNOWN`.
- [x] **7.5** Documentar nas instruções do supervisor as regras estruturais que permanecerem (decisão em `targets`; dimensão coberta por claim com alvo em comum) e remover menções obsoletas (`policy.signals`, agregações).
- [x] **7.6** Corrigir renderização do `contract.md` (itens listados acima).

**P2 — Exigem decisão humana (Decidido: Opção A — Aprovado):**
- [x] **7.7** Unknown com base `ARCHITECTURE_POLICY`/`CONSTITUTION` pode sustentar decisão: implementado em [`semantic_draft_validator.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_draft_validator.mjs) e instruído em [`semantic_gateway.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_gateway.mjs).
- [x] **7.8** Laço de reparo de 1 ciclo (`calls: 1 | 2`): implementado em [`issue_contract_runner.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/issue_contract_runner.mjs), [`semantic_gateway.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_gateway.mjs), [`semantic_codex.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_codex.mjs) e [`semantic-execution.v1.schema.json`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/governance/schemas/semantic-execution.v1.schema.json).
- [x] **7.9** `stateModel` enxuto e `preparedEffect` focado: `stateModel` reduzido em 47,3% com foco observável; decisões com alteração de estrutura usam revisão limpa via supervisor + laço de reparo sem sobre-engenharia de payload.
- [x] **7.10** Remover enums de domínio residuais: remoção de `ISOLATE_TO_QUARANTINE` e generalização de `PURGE_TEMPORARY` em [`contract-components.v1.schema.json`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/governance/schemas/contract-components.v1.schema.json) e [`semantic_closure.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_closure.mjs).
- [x] **7.11** Emendar `ARCH-PUBLIC-INTERFACE`: política em [`governance/architecture.policy.json`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/governance/architecture.policy.json) emendada para permitir que a IA proponha proativamente a interface pública mínima e suficiente estritamente derivada dos observáveis da demanda.

---

## 7. Otimização Pós-Fase 7 — Patches Semânticos Pontuais em `preparedEffect`

- **Problema:** Cada alternativa exigia reenviar o requisito, invariante ou dimensão inteiro (`value = fullObject`), resultando em ~7 KB a 10 KB de dados duplicados por demanda (28% do payload).
- **Implementação:**
  - Atualizados [`prepared-opinion-effect.v1.schema.json`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/governance/schemas/prepared-opinion-effect.v1.schema.json) e [`prepared-draft-effect.v1.schema.json`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/governance/schemas/prepared-draft-effect.v1.schema.json) para suportar `{ index, patch: { ... } }` via `anyOf` estrito.
  - Omissão de arrays vazios permitida (nenhuma coleção é `required` no nível raiz do plano).
  - Atualizado [`prepared_effects.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/prepared_effects.mjs) com `applyPatch` para mescla cirúrgica em `requirements` (incluindo `acceptanceCases`), `invariants`, `dimensions` (incluindo `proofObligation`), `risks` e `boundaryRules`.
  - Atualizado [`semantic_opinion.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_opinion.mjs) para compilar variantes a partir dos patches e vincular automaticamente `decisionBinding` nos casos afetados.
  - Instruções em [`semantic_gateway.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_gateway.mjs) simplificadas para orientar a IA a emitir apenas os deltas pontuais.
- **Resultado:**
  - Compatibilidade retroativa 100% mantida (`{ index, value }` continua suportado).
  - Redução massiva de payload redundante no parecer.
  - Suítes de testes (`npm test`) e sanidade (`npm run aegis:sanity`) com **100% PASS**.

---

## 8. Primitivas Universais de Tempo, Estado e ABI (Pós-Fase 7)

- **Motivação:** No Teste 2 (demanda de rate limiter com 5 req/min e erro 429), a análise minuciosa de determinismo e prontidão de implementação revelou que o Aegis carecia de vocabulário declarativo universal para expressar sem ambiguidade:
  1. Políticas de expiração temporal e despejo de estado (forçando modelos ingênuos de contador com reset total em vez de janela deslizante).
  2. Unidades de tempo e inclusividade de limites (ex.: se "1 minuto" é `<=` ou `<` 60 segundos, e qual a granularidade temporal).
  3. ABI pública executável (modelo síncrono/assíncrono e contrato de retorno explícito).
  4. Estrutura de dados física de contêineres para coleções de eventos/janelas.

- **Implementação (Universal, agnóstica de demanda):**
  - **Tempo e Evicção no `stateModel`:**
    - `evictionPolicy`: adicionado suporte a `SLIDING_WINDOW` e `FIFO`/`LRU`.
    - `retention`: adicionado suporte a `TTL` (com `ttlValue` e `ttlUnit`).
    - `temporalUnit`: `SECONDS | MILLISECONDS | MICROSECONDS` em campos temporais e regras de limite (`boundaryRules`).
    - `boundaryInclusivity`: `INCLUSIVE | EXCLUSIVE | HALF_OPEN` para eliminar qualquer ambiguidade de borda temporal ou numérica.
  - **ABI e Superfície Executável em `operations`:**
    - `executionModel`: `SYNCHRONOUS | ASYNCHRONOUS`.
    - `returnContract`: `VALUE | RESULT | OPTION | EXCEPTION`.
  - **Políticas de Contêiner em Coleções:**
    - `containerPolicy`: `FIXED_ARRAY | DYNAMIC_LIST | CIRCULAR_BUFFER | RING_BUFFER | HASH_MAP`.
  - **Renderização e Instruções:**
    - [`semantic_contract_markdown.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_contract_markdown.mjs) atualizado para renderizar as novas propriedades nas tabelas de entidades, coleções e operações.
    - [`semantic_gateway.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_gateway.mjs) instrui o supervisor a utilizar as primitivas universais quando a demanda envolver tempo, janelas deslizantes ou contratos públicos de retorno.
    - [`rejection_report.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/rejection_report.mjs) alinhado para incluir `ARCHITECTURE_POLICY` e `CONSTITUTION` na mensagem e remediação de `DECISION_WITHOUT_MATERIAL_UNKNOWN`.
- **Resultado:**
  - O Aegis agora permite modelar janelas deslizantes, expiração por TTL e contratos de chamadas públicas de forma estritamente determinística e falsificável.
  - Suítes de testes (`npm test`) e sanidade (`npm run aegis:sanity`) com **100% PASS**.





# Revisão Arquitetural, Bússola e Análise Forense do Aegis (`reviçao.md`)

## 1. Bússola Fundamental e Comportamento Atual do Sistema

### 1.1. Missão e Visão
- **Missão:** Antecipar ambiguidades, falhas de borda e sobre-engenharia **antes** que qualquer código seja escrito — convertendo o pedido humano na especificação mais simples possível (**KISS**), adaptada à arquitetura existente e 100% falsificável.
- **Visão:** Ser o filtro cognitivo de **zero fricção** entre a intenção humana e a implementação: o humano diz o que quer; o Aegis poda excessos, isola apenas decisões materiais reais com consequências já pré-calculadas (`preparedEffect`) e sela um contrato enxuto que qualquer agente codificador implementa de primeira sem regredir.

### 1.2. As Três Leis Anti-Regressão
1. **Rigor na Fronteira Pública, Liberdade no Interior:** O contrato especifica **o que entra, o que sai, qual estado observável muda, onde falha e como refutar (`Dado / Quando / Então`)**. O contrato **nunca** programa variáveis intermediárias ou microcircuitos internos de cálculo.
2. **A IA pensa na Semântica; o Harness faz a Contabilidade:** A IA nunca deve preencher campos decorativos, repetir textos derivados ou gerenciar índices numéricos frágeis que o código Node.js pode resolver mecanicamente.
3. **Filtro de Qualquer Regra no Aegis:** *"Isso impede um bug real ou sobre-engenharia no produto final, ou só cria mais um obstáculo burocrático para a IA preencher?"* Se for burocracia, corte.

### 1.3. Comportamento Operacional Atual (Fluxo Determinístico em 3 Passos)
O Aegis opera de forma 100% autossuficiente a partir de [`AGENTS.md`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/AGENTS.md) e [`ARCHITECTURE.md`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/ARCHITECTURE.md), sem depender de `.agents/` ou de regras externas:

1. **Captura e Briefing Determinístico (`./aegis --new "<demanda>"`):**
   - Sanitiza a intenção, fragmenta sentenças neutras (`FRAG-*`), extrai fatos literais (`FACT-*`), executa discovery léxico BM25 sobre `src/` e autentica os digests de [`AGENTS.md`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/AGENTS.md) e [`ARCHITECTURE.md`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/ARCHITECTURE.md).
   - Emite no `stdout` um **Briefing Determinístico compacto (~2.1 KB)** contendo `evidenceDigest`, `fragments`, `literalFacts`, `workspace`, `availableContextTags` e as 4 tarefas intelectuais da IA (`aiTask`).
2. **Compilação Semântica e Contabilidade Mecânica (`./aegis --semantic-compile`):**
   - Recebe o parecer semântico via `stdin` usando identificadores estáveis (`ruleId`, `contextTag`, `claimId`, `REQ-*`).
   - [`normalizeSemanticOpinion`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_opinion.mjs#L48) resolve referências, preenche mecanicamente todas as regras aplicáveis conformes (`COMPLIANT`) em `policyAssessments` e todas as coberturas default (`NO_DIMENSION_APPLICABLE`) em `determinismReview.coverage`, compila variantes de `preparedEffect` e emite o certificado de fechamento (`closureCertificate`).
3. **Deliberação Humana e Selamento Atômico (`ask_question` $\to$ `--resolve` ou `--approve`):**
   - **Com decisão material aberta (`questionCount > 0`):** A IA apresenta as opções ao humano via `ask_question` e, após a resposta explícita, executa `./aegis --resolve <questionId>=<answerId>`, que aplica o `preparedEffect` em memória e sela o contrato atomicamente em ~5ms, sem nova chamada à LLM e sem exigir `--approve` adicional.
   - **Sem decisão pendente (`questionCount === 0`):** Após confirmação humana explícita, `./aegis --approve` sela o contrato e grava `.harness/state/semantic-state.json`.

---

## 2. Mapa do Sistema Atual (Componentes Ativos)

### 2.1. Entrada e Orquestração CLI
| Arquivo | Linhas | Papel Atual |
| :--- | ---: | :--- |
| [`aegis`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/aegis) | 3 | Wrapper bash que define `AEGIS_ROOT` e delega para `scripts/ide_gateway.sh`. |
| [`scripts/ide_gateway.sh`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/ide_gateway.sh) | 295 | Gateway CLI principal (`--new`, `--clean`, `--approve`, `--resolve`, `--verify`, `--status`, `--setup`, `--semantic-*`, `--wizard`). Suporta resolução e selamento atômico em comando único e wizard TTY enxuto. |
| [`scripts/issue_contract_runner.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/issue_contract_runner.mjs) | 874 | Orquestrador de captura, briefing determinístico, supervisão com reparo de 1 ciclo, compilação, aprovação e verificação. |
| [`scripts/resolve_decision.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/resolve_decision.mjs) | 79 | Grava respostas de decisões deliberadas via `ask_question` em `preflight_resolution.json`. |
| [`scripts/setup_roles.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/setup_roles.mjs) | 157 | Configurador de `.harness/config/roles.json` (`contractSupervisor` e `codingAgent`). |
| [`scripts/generate_schema_validators.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/generate_schema_validators.mjs) | 61 | Compila os 14 JSON Schemas de `governance/schemas/` em validadores standalone Ajv CommonJS em `scripts/generated/schema_validators/`. |

### 2.2. Núcleo Mecânico e Semântico (`scripts/lib/`)
| Arquivo | Linhas | Papel Atual |
| :--- | ---: | :--- |
| [`canonical_json.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/canonical_json.mjs) | 31 | Serialização JSON canônica (chaves ordenadas) e hashing criptográfico SHA-256. |
| [`issue_contract_core.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/issue_contract_core.mjs) | 228 | Sanitização da demanda (`captureDemand`), observação de `src/` (`observeWorkspace`), `preflight.json` e autenticação de `architecture.policy.json`. |
| [`hybrid_source_index.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/hybrid_source_index.mjs) | 424 | Índice léxico BM25 e identificadores compostos sobre `src/` para discovery determinístico. |
| [`preflight_integrity.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/preflight_integrity.mjs) | 80 | Validação da integridade estrutural e criptográfica de `preflight.json`. |
| [`intent_evidence.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/intent_evidence.mjs) | 168 | Fragmentação neutra da demanda (`FRAG-*`) e extração mecânica de fatos literais (`FACT-*`). |
| [`semantic_request.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_request.mjs) | 233 | Autenticação de `constitution.json` e extração direta dos artigos de `AGENTS.md`, seleção de trechos de `src/` e montagem de `aegis.semantic_request.v10`. |
| [`semantic_output_schema.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_output_schema.mjs) | 98 | Geração de schema compacto com `$defs` compartilhados para Structured Outputs e remoção de `null`s opcionais. |
| [`semantic_gateway.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_gateway.mjs) | 174 | Prompt do supervisor externo e chamadas HTTP para provedores compatíveis com OpenAI/AI Gateway. |
| [`semantic_codex.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_codex.mjs) | 142 | Adaptador secundário opcional via CLI `codex exec` em sandbox read-only. |
| [`role_assignment.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/role_assignment.mjs) | 57 | Leitura e validação de `.harness/config/roles.json` (assistente nativo da IDE como padrão). |
| [`semantic_opinion.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_opinion.mjs) | 821 | Normalização de IDs semânticos, auto-derivação de `policyAssessments`, `determinismReview.coverage`, contabilidade de `stateModel` (`mutations`, `readBy`, `preservation`, `bounds`, `containerPolicy`) e defaults de `decisions`/`unknowns`, compilando para `semantic_draft.v9` + `preparedEffect`. |
| [`semantic_draft_validator.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_draft_validator.mjs) | 731 | Validação de citações literais, rastreabilidade de fatos, invariantes, decisões humanas e limites estruturais. |
| [`semantic_closure.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_closure.mjs) | 1439 | Certificado de fechamento semântico (`closureCertificate`) e `gapLedger`, validando totalidade de operações e ciclo de vida de campos. |
| [`prepared_effects.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/prepared_effects.mjs) | 162 | Aplicação cirúrgica de patches semânticos (`preparedEffect`) em memória sem nova consulta à IA. |
| [`semantic_contract_lifecycle.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_contract_lifecycle.mjs) | 154 | Ciclo de vida de `contract.json`, simulação preventiva de variantes de `preparedEffect` e validação documental. |
| [`semantic_approval.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_approval.mjs) | 354 | Geração de `user_confirmation_request.json` e selamento criptográfico da aprovação humana. |
| [`semantic_contract_markdown.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_contract_markdown.mjs) | 507 | Renderização determinística de `contract.md`. |
| [`semantic_state.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_state.mjs) | 35 | Persistência e verificação de `.harness/state/semantic-state.json`. |
| [`semantic_authority.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_authority.mjs) | 32 | Autoridade de fechamento e compilação de testemunhas de contraexemplo (`counterexampleWitness`). |
| [`semantic_collections.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_collections.mjs) | 5 | Utilitário `assertUniqueIds`. |
| [`semantic_contract.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_contract.mjs) | 21 | Barrel de exportação das funções do contrato semântico. |
| [`schema_catalog.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/schema_catalog.mjs) | 36 | Catálogo dos 14 JSON Schemas e 13 validadores compilados. |
| [`schema_validator.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/schema_validator.mjs) | 96 | Carregador e expansor de validadores Ajv standalone com diagnóstico explícito de `missingProperty` e `additionalProperty`. |
| [`rejection_report.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/rejection_report.mjs) | 355 | Diagnósticos estruturados com causa exata, regra violada e remediação acionável. |

### 2.3. Governança e Schemas (`governance/`)
| Arquivo / Diretório | Formato / Volume | Papel Atual |
| :--- | :---: | :--- |
| [`governance/constitution.json`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/governance/constitution.json) | JSON (8 linhas) | Âncora de versão e SHA-256 (`sourceDigest`) de [`AGENTS.md`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/AGENTS.md), de onde as 5 regras (`CONST-*`) são extraídas diretamente em runtime sem duplicação textual. |
| [`governance/architecture.policy.json`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/governance/architecture.policy.json) | JSON (143 linhas) | 16 regras arquiteturais (`ARCH-*`) e 18 tags de contexto vinculadas por SHA-256 a [`ARCHITECTURE.md`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/ARCHITECTURE.md). |
| [`governance/schemas/`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/governance/schemas) | 14 arquivos JSON (3.252 linhas) | 13 schemas raiz validados em runtime + catálogo unificado [`contract-components.v1.schema.json`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/governance/schemas/contract-components.v1.schema.json). |

---

## 3. Análise Forense: Novas Melhorias Potenciais (Backlog Ativo)

A inspeção forense sobre o código-fonte atual (`7.849 linhas` em `scripts/`) e sobre os artefatos gerados durante a execução das Demandas D6 e D7 mantém **4 oportunidades concretas de simplificação e endurecimento determinístico**:

### 3.1. Correção de Fragmentação de Decimais (`10,00` $\to$ `"10"` e `"00"`) em `intent_evidence.mjs`
- **Evidência Forense (observada ao vivo na D6):** Na linha [`scripts/lib/intent_evidence.mjs:100`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/intent_evidence.mjs#L100), a regex de extração numérica `/(?<![\p{L}\p{N}_])\d+(?:\.\d+)?n?(?![\p{L}\p{N}_])/gu` reconhece apenas ponto decimal (`.`), ignorando vírgula decimal (`,`) usada em português.
- **Impacto:** Na Demanda D6 (*"a cada R$ 10,00 em compras"*), o extrator quebrou `"10,00"` em dois fatos inteiros separados: `FACT-0001` (`"10"`) e um fato espúrio `FACT-0002` (`"00"`). Além de poluir `literalFacts`, isso impede que valores decimais em pt-BR (como `"9,99"` ou `"0,5"`) sejam reconhecidos como um único literal autorizado na validação de proveniência (`validateProvenanceEnforcement`).
- **Melhoria Proposta:** Atualizar a regex para `/(?<![\p{L}\p{N}_])\d+(?:[.,]\d+)?n?(?![\p{L}\p{N}_])/gu` e normalizar o atributo `canonicalValue` (ex.: `"10.00"`), preservando `reference: "10,00"` fiel ao offset UTF-16.

### 3.2. Redução de 68,6% do Payload de `.harness/runtime/semantic-request.json` (`outputSchema.document`)
- **Evidência Forense:** Medição exata de `.harness/runtime/semantic-request.json` (`47.103 bytes` totais) mostra a seguinte distribuição:
  - `outputSchema`: **32.319 bytes (68,6%)**
  - `policy`: **9.353 bytes (19,9%)**
  - `constitution`: **3.478 bytes (7,4%)**
  - Dados reais da demanda (`intent` + `intentEvidence` + `workspace` + `revision`): **1.390 bytes (2,9%)**
- **Impacto:** Em toda execução de `./aegis --new`, [`scripts/lib/semantic_request.mjs:220`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_request.mjs#L220) invoca [`buildSemanticOutputSchema`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_output_schema.mjs#L54) para expandir, compactar, deduplicar `$defs` e serializar **32 KB de JSON Schema** dentro de `semantic-request.json`. No fluxo nativo da IDE (`antigravity`), esse documento de 32 KB nunca é consumido (servia apenas para o campo `response_format.json_schema.schema` da API HTTP externa em [`semantic_gateway.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_gateway.mjs)).
- **Melhoria Proposta:** Manter em `semantic-request.json` apenas `{ id: "aegis.semantic_opinion.v3", digest, strict: true }` (calculando `buildSemanticOutputSchema` sob demanda apenas quando `semantic_gateway.mjs` ou `semantic_codex.mjs` for realmente invocado), reduzindo `semantic-request.json` de **47 KB para ~14,8 KB (-68,6%)**.

### 3.3. Poda de Tabelas Poliglotas em `hybrid_source_index.mjs` (424 linhas)
- **Evidência Forense:** [`scripts/lib/hybrid_source_index.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/hybrid_source_index.mjs) mantém expressões e heurísticas para dezenas de ecossistemas fora do escopo da política arquitetural do projeto (que rege TypeScript/JavaScript/Node.js).
- **Melhoria Proposta:** Enxugar o reconhecedor de regiões e tokens para focar nas linguagens suportadas pela arquitetura (`TS`, `JS`, `MJS`, `CJS`, `JSON`, `MD`, `SH`), reduzindo complexidade e superfície de manutenção.

### 3.4. Modularização de `semantic_closure.mjs` (1.439 linhas — 18,3% de todo o código JS)
- **Evidência Forense:** [`scripts/lib/semantic_closure.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_closure.mjs) concentra 8 validadores distintos em um único arquivo de 1.439 linhas, destacando-se `validateFieldLifecycle` (linhas 124–583, **460 linhas**), `validateProvenanceEnforcement` (linhas 866–1073, **208 linhas**), `validateOperationTotality` (linhas 584–727, **144 linhas**) e `validateContradictionDetection` (linhas 728–865, **138 linhas**).
- **Melhoria Proposta:** Dividir `semantic_closure.mjs` em submódulos coesos (ciclo de vida de estado/transições vs proveniência/contradições textuais) e substituir heurísticas de regex bilíngues redundantes por verificações estruturais diretas sobre os campos tipados do `stateModel`.

---

## 4. Benchmark das 10 Demandas Multidimensionais e Execução Atualizada (D6 Run 6 e D7 Run 2)

### 4.1. Matriz Consolidada das 10 Demandas
| ID | Arquétipo da Demanda | Fluxo / Comandos | Status Final | Deliberação Humana | Digest Selado (`contractDigest`) | Resultado Observado |
| :-: | :--- | :---: | :---: | :---: | :---: | :--- |
| **D1** | **Função Pura & Stateless** (*Desconto de Produto*) | `--new` $\to$ `--semantic-compile` $\to$ `--approve` | **CERTIFIED_CLOSED** | Confirmação (`0` lacunas) | `f9c598727ed6` (Runs 2 e 3) | `stateModel: null`, 6 casos `Dado/Quando/Então`, 100% bit-a-bit idêntico entre as Runs 1, 2 e 3. |
| **D2** | **Poda de Sobre-Engenharia** (*Validador CPF*) | `--new` $\to$ `--semantic-compile` $\to$ `--approve` | **CERTIFIED_CLOSED** | Confirmação (`0` lacunas) | `f8157b1a640e` (Runs 1 e 2) | Poda integral de `CPFValidatorFactory`, `ValidationPipelineBuilder`, `EventBus` e `MetricsCollectorSingleton` (`ARCH-PARSIMONY`). |
| **D3** | **Máquina de Estado** (*Tentativas de Login*) | `--new` $\to$ `--semantic-compile` $\to$ `--approve` | **CERTIFIED_CLOSED** | Confirmação (`0` lacunas) | `8bc994d2d8c1` (Runs 1 e 2) | Entidade `UserLoginState`, limite `[0, 3]` com `SATURATE`, reset por login com sucesso e guarda `GUARD_ALREADY_BLOCKED`. |
| **D4** | **Janela Deslizante & TTL** (*Rate Limiter*) | `--new` $\to$ `--semantic-compile` $\to$ `--approve` | **CERTIFIED_CLOSED** | Confirmação (`0` lacunas) | `e47152ab90c6` | `SLIDING_WINDOW_EVICTION` (máx 10, TTL 60s), `SECONDS` e rejeição HTTP 429 na 11ª requisição. |
| **D5** | **Precedência Linear de Guardas** (*Saque*) | `--new` $\to$ `--semantic-compile` $\to$ `--approve` | **CERTIFIED_CLOSED** | Confirmação (`0` lacunas) | `ad79dd970874` | Ordem estrita `["GUARD_CONTA_INATIVA", "GUARD_SALDO_INSUFICIENTE", "GUARD_LIMITE_DIARIO_EXCEDIDO"]` sem mutação em falha. |
| **D6** | **Ambiguidade Material & `preparedEffect`** (*Fidelidade Cashback*) | `--new` $\to$ `--semantic-compile` $\to$ `--resolve Q-0001=ANS-0001-01` | **CERTIFIED_CLOSED** | `ask_question` (`Q-0001`) | `6c08f852f8bd` (Runs 5 e 6) | Lacuna de frações inferiores a R$ 10,00 resolvida via `preparedEffect` e selada atomicamente em comando único (`--resolve`). |
| **D7** | **Coleção Finita FIFO** (*Buffer Circular 50*) | `--new` $\to$ `--semantic-compile` $\to$ `--approve` | **CERTIFIED_CLOSED** | Confirmação (`0` lacunas) | `f826ef8ec3f9` (Run 2) | `maxEntries: "50"`, `FIFO_EVICTION` e `emptyBehavior: "EMPTY_COLLECTION"`, com auto-derivação mecânica de `mutations`, `readBy`, `preservation`, `bounds` e `containerPolicy`. |
| **D8** | **Efeito Físico Externo & Rollback** (*Webhook*) | `--new` $\to$ `--semantic-compile` $\to$ `--approve` | **CERTIFIED_CLOSED** | Confirmação (`0` lacunas) | `c7a752b7176e` | Cobertura explícita `onSuccess`/`onFailure` e `rollback.strategy: "COMPENSATING_ACTION"` sobre o estoque local. |
| **D9** | **Serialização Canônica & SHA-256** (*Urna*) | `--new` $\to$ `--semantic-compile` $\to$ `--approve` | **CERTIFIED_CLOSED** | Confirmação (`0` lacunas) | `26f2a65f6edd` | Ordenação canônica `"zona ASC, secao ASC"`, campos lexicográficos e `emptyStateDigest` fixo. |
| **D10** | **Violação de Política Hard** (`/etc/passwd`) | `--new` $\to$ `--semantic-compile` (Bloqueado) | **REJECTED** | Não aplicável | — (Bloqueio preventivo) | Rejeição imediata com `NON_DELIBERABLE_POLICY_CONFLICT` (`ARCH-PRODUCT-BOUNDARY`). |

### 4.2. Verificação de Reprodutibilidade da Demanda D6 (Run 5 vs Run 6 Atual)
Os artefatos da execução atual foram salvos em [`benchmarks/results/D6_run6/`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/benchmarks/results/D6_run6/) e confrontados via SHA-256 com [`benchmarks/results/D6_run5/`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/benchmarks/results/D6_run5/):

| Artefato / Métrica | D6 — Run 5 | D6 — Run 6 (Atual) | Veredito |
| :--- | :--- | :--- | :--- |
| **Sequência de Comandos Executados** | `--new` $\to$ `--semantic-compile` $\to$ `--resolve` (+ `--approve` redundante) | **`--new` $\to$ `--semantic-compile` $\to$ `--resolve Q-0001=ANS-0001-01`** (3 comandos, 0 erros) | **Fluxo Atômico Enxuto** |
| **`contractDigest`** | `6c08f852f8bd5571b42b082abc91a0ad6e4da67453bbcc551e47b431d6719eee` | `6c08f852f8bd5571b42b082abc91a0ad6e4da67453bbcc551e47b431d6719eee` | **100% Idêntico** |
| **SHA-256 de `contract.json`** | `a31e69711fe5e1a7fef534e2b3483555bdb60c94b3f668f80be107f2c5198aea` | `a31e69711fe5e1a7fef534e2b3483555bdb60c94b3f668f80be107f2c5198aea` | **100% Byte-a-Byte Idêntico** |
| **SHA-256 de `contract.md`** | `b2b227262d15f42d49db74c70e9b66cda59dd2bf730b1efc877b36789020fe0a` | `b2b227262d15f42d49db74c70e9b66cda59dd2bf730b1efc877b36789020fe0a` | **100% Byte-a-Byte Idêntico** |
| **SHA-256 de `semantic-state.json`** | `bc8fa270ee48f001ebfae4230578d5f886aab0f51cf73eb741be0d917d60567b` | `bc8fa270ee48f001ebfae4230578d5f886aab0f51cf73eb741be0d917d60567b` | **100% Byte-a-Byte Idêntico** |

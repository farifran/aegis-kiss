# Dossiê Arquitetural & Adversarial Integrado: Sistema, Descoberta e Fronteira Cognitiva

> **Documento Canônico Unificado (Consolidação de `resolver.md` e `reviçao.md`)**  
> **Objetivo:** Reunir em uma única fonte da verdade a bússola de governança do Aegis, o mapa dos componentes ativos, o dossiê adversarial de descoberta de código (`src/` $\to$ IA), a matriz dos 8 problemas estruturais, as blindagens de monorepo real, a fronteira do acordo mecânico-semântico e a matriz de benchmarks multidimensionais (D1 a D11).

---

## 1. Bússola Fundamental e Arquitetura Operacional do Aegis

### 1.1. Missão e Visão
* **Missão:** Antecipar ambiguidades, falhas de borda e sobre-engenharia **antes** que qualquer código seja escrito — convertendo o pedido humano na especificação mais simples possível (**KISS**), adaptada à arquitetura existente e 100% falsificável.
* **Visão:** Ser o filtro cognitivo de **zero fricção** entre a intenção humana e a implementação: o humano diz o que quer; o Aegis poda excessos, isola apenas decisões materiais reais com consequências já pré-calculadas (`preparedEffect`) e sela um contrato enxuto que qualquer agente codificador implementa de primeira sem regredir.

### 1.2. As Três Leis Anti-Regressão
1. **Rigor na Fronteira Pública, Liberdade no Interior:** O contrato especifica **o que entra, o que sai, qual estado observável muda, onde falha e como refutar (`Dado / Quando / Então`)**. O contrato **nunca** programa variáveis intermediárias ou microcircuitos internos de cálculo.
2. **A IA pensa na Semântica; o Harness faz a Contabilidade:** A IA nunca deve preencher campos decorativos, repetir textos derivados ou gerenciar índices numéricos frágeis que o código Node.js pode resolver mecanicamente.
3. **Filtro de Qualquer Regra no Aegis:** *"Isso impede um bug real ou sobre-engenharia no produto final, ou só cria mais um obstáculo burocrático para a IA preencher?"* Se for burocracia, corte.

### 1.3. Comportamento Operacional Atual (Fluxo Determinístico em 3 Passos)
O Aegis opera de forma 100% autossuficiente a partir de [`AGENTS.md`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/AGENTS.md) e [`ARCHITECTURE.md`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/ARCHITECTURE.md), sem depender de `.agents/` ou de regras externas:

1. **Captura e Briefing Determinístico (`./aegis --new "<demanda>"`):**
   * Sanitiza a intenção, fragmenta sentenças neutras (`FRAG-*`), extrai fatos literais (`FACT-*`), executa discovery estrutural via Workspace Skeleton (AST tipado) e matching morfológico sobre `src/`, autenticando os digests de [`AGENTS.md`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/AGENTS.md) e [`ARCHITECTURE.md`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/ARCHITECTURE.md).
   * Emite no `stdout` um **Briefing Determinístico compacto (~2.1 KB)** contendo `evidenceDigest`, `fragments`, `literalFacts`, `workspace`, `availableContextTags` e as tarefas intelectuais da IA (`aiTask`).
2. **Compilação Semântica e Contabilidade Mecânica (`./aegis --semantic-compile`):**
   * Recebe o parecer semântico via `stdin` usando identificadores estáveis (`ruleId`, `contextTag`, `claimId`, `REQ-*`).
   * [`normalizeSemanticOpinion`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_opinion.mjs#L48) resolve referências, preenche mecanicamente todas as regras aplicáveis conformes (`COMPLIANT`) em `policyAssessments` e todas as coberturas default (`NO_DIMENSION_APPLICABLE`) em `determinismReview.coverage`, compila variantes de `preparedEffect` e emite o certificado de fechamento (`closureCertificate`).
3. **Deliberação Humana e Selamento Atômico (`ask_question` $\to$ `--resolve` ou `--approve`):**
   * **Com decisão material aberta (`questionCount > 0`):** A IA apresenta as opções ao humano via `ask_question` e, após a resposta explícita, executa `./aegis --resolve <questionId>=<answerId>`, que aplica o `preparedEffect` em memória e sela o contrato atomicamente em ~5ms, sem nova chamada à LLM e sem exigir `--approve` adicional.
   * **Sem decisão pendente (`questionCount === 0`):** Após confirmação humana explícita, `./aegis --approve` sela o contrato e grava `.harness/state/semantic-state.json`.

---

## 2. Mapa do Sistema Atual (Componentes Ativos)

### 2.1. Entrada e Orquestração CLI
| Arquivo | Papel no Sistema |
| :--- | :--- |
| [`aegis`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/aegis) | Wrapper bash que define `AEGIS_ROOT` e delega para `scripts/ide_gateway.sh`. |
| [`scripts/ide_gateway.sh`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/ide_gateway.sh) | Gateway CLI principal (`--new`, `--clean`, `--approve`, `--resolve`, `--verify`, `--status`, `--setup`, `--semantic-*`, `--wizard`). Suporta resolução e selamento atômico em comando único e wizard TTY enxuto. |
| [`scripts/issue_contract_runner.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/issue_contract_runner.mjs) | Orquestrador de captura, briefing determinístico, supervisão com reparo de 1 ciclo, compilação, aprovação e verificação. |
| [`scripts/resolve_decision.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/resolve_decision.mjs) | Grava respostas de decisões deliberadas via `ask_question` em `preflight_resolution.json`. |
| [`scripts/setup_roles.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/setup_roles.mjs) | Configurador de `.harness/config/roles.json` (`contractSupervisor` e `codingAgent`). |
| [`scripts/generate_schema_validators.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/generate_schema_validators.mjs) | Compila os JSON Schemas de `governance/schemas/` em validadores standalone Ajv CommonJS em `scripts/generated/schema_validators/`. |

### 2.2. Núcleo Mecânico e Semântico (`scripts/lib/`)
| Arquivo | Papel no Sistema |
| :--- | :--- |
| [`canonical_json.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/canonical_json.mjs) | Serialização JSON canônica (chaves ordenadas lexicograficamente) e hashing criptográfico SHA-256. |
| [`issue_contract_core.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/issue_contract_core.mjs) | Sanitização da demanda (`captureDemand`), observação de `src/` (`observeWorkspace`), `preflight.json` e autenticação de `architecture.policy.json`. |
| [`workspace_skeleton.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/workspace_skeleton.mjs) | Extrator de esqueleto de AST via TypeScript Compiler API: extrai interfaces, types, funções e classes com corpos despojados e docstrings JSDoc. |
| [`semantic_scout.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_scout.mjs) | Adaptive Semantic Scout: árbitro condicional sob silêncio léxico com mapa topográfico panorâmico, filtro físico fail-closed e Auto-Lexicon. |
| [`.harness/domain-lexicon.json`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/.harness/domain-lexicon.json) | Léxico declarativo canônico de termos de negócio para código (`estorno -> reversal`, `tarifa -> fee`), 100% determinístico. |
| [`preflight_integrity.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/preflight_integrity.mjs) | Validação da integridade estrutural e criptográfica de `preflight.json`. |
| [`intent_evidence.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/intent_evidence.mjs) | Fragmentação neutra da demanda (`FRAG-*`) e extração mecânica de fatos literais (`FACT-*`) com suporte a decimais pt-BR. |
| [`semantic_request.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_request.mjs) | Extração de artigos de `AGENTS.md`, matching por nós de AST/caminhos e montagem da evidência física com tetos elásticos e corte residual. |
| [`semantic_output_schema.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_output_schema.mjs) | Geração de schema compacto com `$defs` compartilhados para Structured Outputs. |
| [`semantic_gateway.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_gateway.mjs) | Prompt do supervisor externo e chamadas HTTP para provedores compatíveis com OpenAI/AI Gateway/Ollama. |
| [`semantic_codex.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_codex.mjs) | Adaptador secundário opcional via CLI `codex exec` em sandbox read-only. |
| [`role_assignment.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/role_assignment.mjs) | Leitura e validação de `.harness/config/roles.json` (assistente nativo da IDE como padrão). |
| [`semantic_opinion.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_opinion.mjs) | Normalização de IDs semânticos, auto-derivação de `policyAssessments`, `determinismReview.coverage`, contabilidade de `stateModel` e defaults de `decisions`/`unknowns`, compilando para `semantic_draft.v9` + `preparedEffect`. |
| [`semantic_draft_validator.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_draft_validator.mjs) | Validação de citações literais, rastreabilidade de fatos, invariantes, decisões humanas e limites estruturais. |
| [`semantic_closure.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_closure.mjs) | Certificado de fechamento semântico (`closureCertificate`) e `gapLedger`, validando totalidade de operações e ciclo de vida de campos. |
| [`prepared_effects.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/prepared_effects.mjs) | Aplicação cirúrgica de patches semânticos (`preparedEffect`) em memória sem nova consulta à IA. |
| [`semantic_contract_lifecycle.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_contract_lifecycle.mjs) | Ciclo de vida de `contract.json`, simulação preventiva de variantes de `preparedEffect` e validação documental. |
| [`semantic_approval.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_approval.mjs) | Geração de `user_confirmation_request.json` e selamento criptográfico da aprovação humana. |
| [`semantic_contract_markdown.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_contract_markdown.mjs) | Renderização determinística de `contract.md`. |
| [`semantic_state.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_state.mjs) | Persistência e verificação de `.harness/state/semantic-state.json`. |
| [`semantic_authority.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_authority.mjs) | Autoridade de fechamento e compilação de testemunhas de contraexemplo (`counterexampleWitness`). |
| [`semantic_collections.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_collections.mjs) | Utilitário `assertUniqueIds`. |
| [`semantic_contract.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_contract.mjs) | Barrel de exportação das funções do contrato semântico. |
| [`schema_catalog.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/schema_catalog.mjs) | Catálogo dos 14 JSON Schemas e validadores compilados. |
| [`schema_validator.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/schema_validator.mjs) | Carregador e expansor de validadores Ajv standalone com diagnóstico explícito de `missingProperty` e `additionalProperty`. |
| [`rejection_report.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/rejection_report.mjs) | Diagnósticos estruturados com causa exata, regra violada e remediação acionável. |

### 2.3. Governança e Schemas (`governance/`)
| Componente | Papel no Sistema |
| :--- | :--- |
| [`governance/constitution.json`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/governance/constitution.json) | Âncora de versão e SHA-256 (`sourceDigest`) de [`AGENTS.md`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/AGENTS.md), de onde os 5 artigos constitucionais (`CONST-*`) são extraídos em runtime sem duplicação textual. |
| [`governance/architecture.policy.json`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/governance/architecture.policy.json) | 16 regras arquiteturais (`ARCH-*`) e 18 tags de contexto vinculadas por SHA-256 a [`ARCHITECTURE.md`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/ARCHITECTURE.md). |
| [`governance/schemas/`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/governance/schemas) | 14 schemas JSON validados em runtime (preflight, handoff v3, draft v9, contract v6, etc.). |

---

## 3. O Problema Fundamental da Descoberta de Código (`src/` $\to$ IA)

A meta parece simples:  
> *"Ao executar uma demanda, queremos passar para a IA exatamente os dados que temos no `src/`, para que ela não precise alucinar nem inventar, trabalhando estritamente sobre a realidade existente."*

Na prática, isso esbarra em uma contradição de engenharia:
* **Se entregarmos dados de menos:** A IA preenche as lacunas com "alucinações úteis" (inventa guardas, tetos e tipos que parecem razoáveis na web).
* **Se entregarmos dados de mais:** A IA sofre de dispersão de atenção (*Lost in the Middle*), o custo de tokens explode e a latência se torna inviável.
* **Se filtrarmos mecanicamente:** O filtro é cego para sinônimos e intenção humana.
* **Se filtrarmos com IA:** O filtro se torna estocástico e destrói o determinismo de entrada.

---

## 4. Inventário dos 8 Problemas Estruturais de Terreno

### Problema 1: O Abismo Semântico (Sintaxe Mecânica $\neq$ Intenção Humana)
* **O Dilema:**
  * O ser humano escreve a demanda usando vocabulário de negócio e intenção livre (ex: *"estornar as operações de hoje sem furar a trava antifraude"*).
  * O código-fonte em `src/` armazena identificadores técnicos e sintaxe formal (ex: `reverseSettlement`, `dailySettledCents`, `MAX_BATCH_REJECTIONS`).
* **A Armadilha Mecânica:**
  * Algoritmos de busca local estrita operam sobre sequências de caracteres. Se a palavra exata não estiver na demanda, o score de relevância zera. O Harness entrega um contexto vazio e a IA é forçada a alucinar.
* **A Armadilha da IA:**
  * Se colocarmos um LLM para traduzir a intenção em palavras-chave antes da busca, o conjunto de termos varia entre execuções (jitter estocástico), gerando preflights divergentes para o mesmo commit.

### Problema 2: O Dilema de Goldilocks do Contexto (Ruído vs. Omissão)
* **Cenário A: Omissão (Faltou Dado):** Cortar 20 linhas oculta onde os tipos foram declarados; a IA assume constantes e limites padrão de mercado (ex: teto arbitrário de `500000000` centavos).
* **Cenário B: Ruído (Contexto Gigante / "Lost in the Middle"):** Entregar dezenas de arquivos dilui a atenção do modelo; uma guarda vital de 2 linhas (`if (streak >= 5) reject()`) é simplesmente ignorada no meio do prompt.

### Problema 3: A Falácia da Fronteira Sintática (Onde Cortar o Código?)
* Linhas arbitrárias cortam métodos no meio e perdem cabeçalhos de imports/tipos.
* Arquivos inteiros trazem centenas de linhas de código utilitário irrelevante.
* Nós estritos de export são cegos para lógicas privadas essenciais e regras declaradas em comentários.

### Problema 4: A Falácia da Escala (Do Repositório de Teste ao Monorepo Real)
* Em repositórios de brinquedo (3 arquivos), ler tudo em RAM leva 5 ms.
* Em monorepos corporativos reais (centenas de arquivos, milhares de funções), entregar tudo estoura a janela e o orçamento. Filtrar por texto esbarra no Problema 1; filtrar por IA esbarra na quebra do determinismo.

### Problema 5: O Paradoxo da Criação (O Código que Ainda Não Existe)
* Demandas frequentes não alteram código existente, mas criam arquivos novos (ex: `src/ledger/installment_reversal.ts`).
* O arquivo alvo não existe no disco. Nenhuma busca direta o encontrará. A IA precisa receber os contratos dos arquivos irmãos do módulo para não inventar convenções alienígenas.

### Problema 6: Dependências Ocultas e Arquiteturas Desacopladas
* Arquiteturas modernas conectam módulos via eventos, injeção de dependência e regras declaradas fora do TypeScript (SQL, schemas, `.env`). Grafos de imports estáticos ignoram contratos invisíveis entre módulos desacoplados.

### Problema 7: O Pesadelo Poliglota e a Manutenção da AST
* Construir parsers nativos profundos no Harness para 10 linguagens diferentes cria compiladores mastodônticos que quebram a cada nova versão sintática, violando [`CONST-KISS`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/AGENTS.md#L5).

### Problema 8: O Efeito de Ancoragem Humana (*Rubber-Stamping* no Wizard)
* Se a ferramenta sugere perguntas técnicas longas com uma opção `(Recommended)`, desenvolvedores sob pressão tendem a dar Enter sem ler. A deliberação humana soberana corre o risco de virar mero teatro de conformidade (*security theater*).

---

## 5. Matriz de Requisitos Inegociáveis e Julgamento Adversarial

### 5.1. Matriz de Critérios de Aceitação
| Vetor | Critério Inegociável | O que Reprova a Solução |
| :--- | :--- | :--- |
| **1. Parsimônia ([`CONST-KISS`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/AGENTS.md#L5))** | Sem compiladores poliglotas pesados nem enxames multi-agentes. | Exigir bibliotecas C++ nativas ou frameworks complexos de orquestração. |
| **2. Falsificabilidade ([`CONST-OBSERVABLE`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/AGENTS.md#L21))** | Toda evidência entregue à IA deve possuir certidão de nascimento física atestável (hash + linha). | Entregar resumos livres ou "memórias" da IA sem proveniência direta no arquivo. |
| **3. Imunidade à Alucinação** | A IA deve ser impedida de inventar constantes e guardas fora do catálogo de fatos. | Permitir que o modelo assuma valores padrão sem autorização expressa da demanda. |
| **4. Tolerância a Sinônimos** | Demandas em linguagem natural informal devem localizar os arquivos reais sem exigir termos exatos do código. | Bloquear ou zerar o resultado se o usuário escrever "estornar" em vez de "reverseSettlement". |
| **5. Operação Offline e Custo Zero no Preflight** | A auditoria básica e a verificação do repositório devem rodar sem obrigatoriedade de API externa paga. | Fazer o preflight e a verificação dependerem de conexão com internet para funcionar. |

### 5.2. Julgamento do Advogado do Diabo sobre Propostas Teóricas
1. **Usar LLM para Traduzir Vocabulário de Negócio no Preflight Direto:** **REJEITADO.** Introduz jitter estocástico e dependência externa; o mesmo commit geraria preflights com hashes diferentes, quebrando [`CONST-OBSERVABLE`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/AGENTS.md#L21).
2. **Dicionários Manuais Rígidos em `architecture.policy.json`:** **REJEITADO.** Cria burocracia manual, invalida o SHA-256 amarrado em `ARCHITECTURE.md` e exige manutenção contínua.
3. **Rastrear Imports Transitivos em Grafo Profundo (Crawler Multi-Hop):** **REJEITADO.** O efeito dominó de barrels (`index.ts`) em monorepos arrasta o repositório inteiro, estourando orçamentos e forçando truncamentos arbitrários.
4. **Suprimir a Recomendação no Wizard TTY:** **REJEITADO.** [`CONST-DECISIONS`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/AGENTS.md#L15) exige apresentar a recomendação justificada mais parsimoniosa. A trava anti-acidente já existe no core: a confirmação final usa `[s/N]` (default `N`), de modo que pressionar Enter sem digitar `s` aborta a operação sem selar nada.

---

## 6. Resoluções Estruturais Implementadas no Core do Aegis

Abaixo está o detalhamento técnico e falsificável de como **cada um dos 8 problemas** é resolvido ou mitigado no Aegis sob [`CONST-KISS`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/AGENTS.md#L5) e [`CONST-OBSERVABLE`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/AGENTS.md#L21):

### 6.1. Resolução do Problema 1: Defesa em 3 Camadas Contra o Abismo Semântico
O abismo semântico entre linguagem natural e código formal não é solucionável por um único truque sintático; é uma tensão ontológica permanente. O Aegis estabelece uma **Defesa Arquitetural em 3 Camadas**:

* **Camada 1: Mecânica Direta de AST (0 ms, $0.00, 100% Offline e Determinístico)**
  * Extrator de AST ([`workspace_skeleton.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/workspace_skeleton.mjs)) captura identificadores, subtokens estruturais (camelCase, snake_case), caminhos de pasta e docstrings JSDoc (`docComment`).
  * Pontuação dominante para símbolos exportados públicos (+3 exato / +2 stem).
  * **Blindagem Anti-Sequestro:** JSDocs só pontuam se houver afinidade estrutural prévia (no identificador ou caminho do módulo), impedindo que comentários narrativos alheios sequestrem o contexto.
* **Camada 2: Léxico Declarativo de Domínio (`.harness/domain-lexicon.json` — 0 ms, $0.00, Determinístico)**
  * Mapeamento canônico determinístico entre termos de negócio e identificadores em inglês (`estorno -> reversal`, `tarifa -> fee`, `risco -> risk`).
  * 100% sob custódia e soberania humana ([`CONST-EVIDENCE`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/AGENTS.md#L10)), sem modelos neurais e com zero latência.
* **Camada 3: Adaptive Semantic Scout (Acordo Semântico sob Silêncio Léxico)**
  * Acionado exclusivamente quando as Camadas 1 e 2 falham (Silêncio Léxico em repositórios grandes com `src/ > 64 KB`).
  * Utiliza mapa topográfico panorâmico compacto (< 4 KB JSON), filtra as sugestões de forma *fail-closed* contra o disco físico, hidrata linhas de código e **persiste automaticamente os novos sinônimos aprendidos de volta na Camada 2 (*Auto-Lexicon*)**.
  * A primeira execução preenche a lacuna; todas as execuções subsequentes daquele termo são automaticamente promovidas para o Fast-Path determinístico das Camadas 1 e 2.
* **Provas Falsificáveis:** Coberto por `TEST-118` (JSDoc), `TEST-121` (Léxico) e os 10 testes de `test_semantic_scout.mjs` (Scout, Anti-Alucinação e Auto-Lexicon).

### 6.2. Resolução do Problema 2: O Dilema de Goldilocks do Contexto (Ruído vs. Omissão)
* **Combate à Omissão (Faltou Dado):**
  * Preservação compulsória do cabeçalho estrutural de imports, interfaces e tipos (`findStructuralHeaderEndLine`), garantindo que declarações vitais não sejam cortadas.
  * **Blindagem de Proveniência Fail-Closed (`validateProvenanceEnforcement`, `TEST-108`):** Se a IA tentar inventar um limite padrão ou constante de mercado (ex: teto arbitrário de `500000000` centavos) citando uma linha de código que apenas declara um tipo sem valor, o Harness rejeita a proposta com `UNAUTHORIZED_NUMERIC_LITERAL`.
* **Combate ao Ruído (Lost in the Middle):**
  * O esqueleto AST ([`buildWorkspaceSkeleton`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/workspace_skeleton.mjs)) despoja corpos internos de funções (`stripped bodies`), reduzindo o volume de tokens em mais de 75%.
  * Teto focado por arquivo de 8 KB e orçamento global elástico de 64 KB com **Corte por Relevância Residual**: se os arquivos úteis somam 12 KB, a coleta encerra imediatamente sem arrastar arquivos irrelevantes para preencher a cota.
* **Provas Falsificáveis:** Coberto por `TEST-108`, `TEST-114`, `TEST-115` e `TEST-120`.

### 6.3. Resolução do Problema 3: A Falácia da Fronteira Sintática (Onde Cortar o Código?)
* **Corte Estrutural de Imports e Tipos:** A função [`findStructuralHeaderEndLine`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_request.mjs) inspeciona onde terminam os cabeçalhos de tipos e interfaces nas primeiras 150 linhas e os preserva integralmente, eliminando cortes cegos de decorators e imports.
* **Corte Focado em Nós de AST:** O seletor de janelas (`selection: 'LEXICAL_WINDOW'`) ancora a extração nas linhas de início e fim reais (`startLine`/`endLine`) do símbolo identificado pela TypeScript Compiler API, em vez de fatias arbitrárias de 20 linhas.
* **Visibilidade de Regras sem Inchar o Corpo:** Comentários JSDoc são associados diretamente ao nó do símbolo (`sym.docComment`), permitindo que a IA conheça as regras documentadas de uma função sem precisar receber centenas de linhas de código utilitário interno.
* **Provas Falsificáveis:** Coberto por `TEST-115` e pela suíte `test_workspace_skeleton.mjs`.

### 6.4. Resolução do Problema 4: A Falácia da Escala (Do Repositório de Teste ao Monorepo Real)
* **Confinamento de Escopo por Módulos-Alvo (`targetDirs`):** Quando a demanda cita pastas (ex: `src/ledger`), o escopo é confinado aos módulos autorizados, descartando arquivos alheios do monorepo.
* **Garantia de Piso Multi-Módulo (Multi-Module Floor Guarantee):** Cada pasta citada no escopo tem a preservação garantida do seu melhor arquivo representante (`isTopForTargetDir`), impedindo que o pico de pontuação de um módulo canibalize outros módulos autorizados.
* **Ranking Determinístico em Sub-Segundo:** O algoritmo [`computeSymbolAffinity`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_request.mjs) ranqueia os 512 nós estruturais mais relevantes em menos de **300 ms**, provado sob estresse real com os 204 arquivos do Askesis.
* **Provas Falsificáveis:** Coberto pelo Benchmark D11 e pelo teste de estresse real Askesis (Seção 8).

### 6.5. Resolução do Problema 5: O Paradoxo da Criação (O Código que Ainda Não Existe)
* **Directory Anchor Fallback:** Em [`scripts/lib/semantic_request.mjs:buildSourceEvidence`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_request.mjs), se a demanda cita um caminho que ainda não existe fisicamente no disco (ex.: `src/ledger/installment_reversal.ts`) ou pastas conhecidas (`ledger`, `risk`):
  * O Harness detecta o diretório pretendido e seleciona automaticamente os **arquivos irmãos existentes** no mesmo módulo (`settlement_engine.ts`, `fee_calculator.ts`).
  * O novo código nasce conhecendo os tipos, padrões e modelos existentes do subsistema, impedindo que a IA invente convenções alienígenas.
* **Prova Falsificável:** Validado pelo teste **`TEST-117`** em `test_field_lifecycle.mjs`.

### 6.6. Resolução do Problema 6: Dependências Ocultas e Arquiteturas Desacopladas
* **Rejeição da Sobre-Engenharia:** Rastrear barramentos de eventos e injeções de dependência via grafos estáticos profundos exigiria crawlers complexos que estouram o limite de tokens com barrels transitivos.
* **A Mitigação KISS Adotada:**
  1. A ancoragem de diretório injeta os contratos e barramentos do módulo autorizado.
  2. **Validação Fail-Closed de Guardas (`validateProvenanceEnforcement`, `TEST-109`):** Códigos de erro espúrios ou guardas não ancoradas na evidência autorizada são terminantemente rejeitados com `UNAUTHORIZED_GUARD_OR_ERROR_CODE`.
  3. **Validação de Totalidade de Efeitos Externos (`validateOperationTotality`, `TEST-76`, `TEST-77`, `TEST-79`):** Operações que afetam estado externo (filas, banco, webhooks) são obrigadas a declarar branches de sucesso/falha, idempotência e estratégia explícita de compensação/rollback (`strategy: "COMPENSATING_ACTION"`).
* **Provas Falsificáveis:** Coberto por `TEST-76`, `TEST-77`, `TEST-79`, `TEST-109` e `TEST-117`.

### 6.7. Resolução do Problema 7: O Pesadelo Poliglota e a Manutenção da AST
* **Sem Compiladores Mastodônticos Próprios:** Em vez de construir ou manter parsers nativos para cada linguagem, o Aegis delega a extração principal diretamente para a **TypeScript Compiler API oficial (`typescript`)**.
* **Imunidade a Mudanças Sintáticas:** Novas sintaxes do TypeScript/JavaScript (decorators, satisfying, type-imports) são absorvidas automaticamente pelo parser oficial da linguagem.
* **Extratores Leves para Linguagens Auxiliares:** Para scripts utilitários em Python ou Shell presentes no repositório, [`workspace_skeleton.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/workspace_skeleton.mjs) adota extratores lineares regex ultra-leves para assinaturas públicas (`def ...`, `function ...`).
* **Zero Dependências Nativas C++:** Sem `tree-sitter`, sem compilações de SO no `npm install`, preservando 100% de portabilidade e fidelidade a [`CONST-KISS`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/AGENTS.md#L5).
* **Prova Falsificável:** Validado pela suíte `test_workspace_skeleton.mjs` (testes de TypeScript, Python e Shell).

### 6.8. Resolução do Problema 8: O Efeito de Ancoragem Humana (*Rubber-Stamping* no Wizard)
* **A Trava Anti-Acidente no TTY:** No Wizard interativo (`scripts/ide_gateway.sh`), a pergunta de confirmação final usa estritamente `[s/N]` (default `N` - Não).
  * Se o desenvolvedor sob pressão teclar `Enter` cegamente sem ler, **o processo é imediatamente abortado**:
    > `[AEGIS] Operação cancelada. Nenhuma nova decisão ou aprovação foi gravada.`
  * A aprovação requer a digitação explícita do caractere `s` (ou `S`), tornando o "dar Enter cego" uma ação 100% inócua.
* **Falsificabilidade Compulsória (`Dado / Quando / Então`):** Nenhuma recomendação é selada sem que seus efeitos materiais pré-calculados (`preparedEffect`) estejam vinculados a cenários de teste refutáveis, auditáveis no `git diff` do contrato.
* **Prova Falsificável:** Validado por `test_issue_contract.sh:758` e `test_issue_contract.sh:793`.

---

## 7. Matriz Consolidada de Fechamento dos 8 Problemas

| Problema Estrutural | Abordagem Adotada no Aegis | Prova / Teste Falsificável | Status Atual |
| :--- | :--- | :--- | :---: |
| **P1: Abismo Semântico** | Defesa em 3 Camadas: AST Subtokens/JSDoc $\rightarrow$ Léxico Declarativo $\rightarrow$ Scout Adaptativo + Auto-Lexicon. | `TEST-118`, `TEST-121`, `test_semantic_scout.mjs` | **MITIGADO EM 3 CAMADAS (DESAFIO ABERTO)** |
| **P2: Dilema de Goldilocks** | Esqueleto AST (corpos despojados) + corte residual (64 KB) + bloqueio fail-closed de literais inventados. | `TEST-108`, `TEST-114`, `TEST-115`, `TEST-120` | **RESOLVIDO** |
| **P3: Fronteira Sintática** | Preservação de cabeçalho de tipos (`findStructuralHeaderEndLine`) + janelas ancoradas em nós de AST. | `TEST-115`, `test_workspace_skeleton.mjs` | **RESOLVIDO** |
| **P4: Falácia da Escala** | Bounded Context (`targetDirs`) + piso multi-módulo + afinidade determinística em sub-segundo (< 300 ms). | Benchmark D11, teste Askesis (204 arquivos) | **RESOLVIDO** |
| **P5: Paradoxo da Criação** | Directory Anchor Fallback: injeção mecânica dos arquivos irmãos do diretório pretendido. | `TEST-117` em `test_field_lifecycle.mjs` | **RESOLVIDO** |
| **P6: Dependências Ocultas** | Ancoragem de módulo + validação fail-closed de guardas/erros + exigência de rollback em efeitos externos. | `TEST-76`, `TEST-77`, `TEST-109`, `TEST-117` | **MITIGADO (KISS)** |
| **P7: Pesadelo Poliglota** | Delegação à TypeScript Compiler API oficial + regex lineares para Python/Shell (zero dependências C++). | `test_workspace_skeleton.mjs` | **BLINDADO** |
| **P8: Ancoragem Humana** | Confirmação final estrita com `[s/N]` (default `N` que aborta por Enter) + `Dado/Quando/Então` no diff. | `test_issue_contract.sh:758` | **BLINDADO** |

---

## 8. O Teste de Estresse Extremo em Monorepo Real (Askesis — 204 Arquivos)

Para provar a robustez do Aegis em ambiente de produção sem dados sintéticos, injetamos um projeto real completo dentro de `src/`: o PWA de hábitos **Askesis** (204 arquivos de React/TypeScript, 1.562 símbolos na AST, ~2.4 MB de código-fonte).

### 8.1. O Choque de Realidade Inicial
Ao submeter uma demanda bancária em português livre (*"Permitir estornar a liquidação financeira..."*), o resultado inicial foi de **100% de contaminação**: o Askesis continha longos JSDocs filosóficos com palavras como *"teto"*, *"segurança"* e *"conta"*, sequestrando todos os slots de contexto, enquanto o motor financeiro em inglês (`settlement`) recebia nota baixa.

### 8.2. As Blindagens Determinísticas Implementadas
1. **Regra Anti-Sequestro de DocComment:** Comentários JSDoc só pontuam se o símbolo possuir afinidade estrutural prévia (no identificador ou caminho do módulo).
2. **Whole-Token Matching:** Substituição de `includes` por verificação de token isolado, eliminando colisões de substring (como `src` dentro de `src/ledger`).
3. **Supressão de Stopwords de Contêiner:** Termos como `src`, `source`, `root`, `file` são expurgados do vocabulário de domínio.
4. **Priorização da Superfície Pública (`exported: true`):** Interfaces e funções exportadas recebem precedência sobre variáveis locais privadas.
5. **Priorização Precoce de Diretórios-Alvo:** Módulos citados na demanda (`src/ledger`, `src/risk`) capturam imediatamente as primeiras cotas de evidência física.
6. **Penalização de Testes e Scripts Internos:** Arquivos em `/tests/`, `*.test.ts` e `/scripts/` recebem penalidade de relevância.

### 8.3. Expansão para 64 KB e Corte por Relevância Residual
* **Confinamento de Escopo por `targetDirs`:** Arquivos fora dos módulos autorizados são descartados.
* **Piso Residual de Relevância:** Se o topo da AST tem alta afinidade (`topScore >= 6.0`), símbolos com pontuação residual (< 40% do pico ou piso absoluto de 3.0) são descartados.
* **Parada Inteligente (Sem Enchimento Forçado):** O Harness não força o preenchimento dos 64 KB. Se os arquivos úteis somam 12 KB, encerra imediatamente com 0% de ruído.
* **Piso Multi-Módulo (Multi-Module Floor Guarantee):** Cada pasta declarada no escopo autorizado tem a preservação garantida do seu melhor arquivo representante (`isTopForTargetDir`), impedindo que um módulo dominante canibalize outro módulo autorizado.
* **Corte por Pressão de Orçamento:** O corte de 40% só atua quando a soma dos arquivos ultrapassa a cota física de 64 KB (`underBudgetPressure`).

### 8.4. Adaptive Semantic Scout & Auto-Lexicon Persistente
* **Guardiões de Custo Zero:** O Scout é travado imediatamente ($0.00, 0 ms) se o workspace for verde (`EMPTY_SOURCE`), compacto ($\le 64\text{ KB}$), esqueleto vazio ou se houver correspondência léxica direta.
* **Validação Física Fail-Closed:** Qualquer caminho sugerido pela IA é filtrado estritamente contra os arquivos observados no disco (`filterPhysicalPaths`). Alucinações são descartadas sumariamente.
* **Amostragem Estrutural Panorâmica:** `buildTopographicalMap` agrupa até 2 símbolos exportados por arquivo de toda a árvore, garantindo visibilidade em < 4 KB de JSON sem viés alfabético.
* **Auto-Lexicon Contínuo:** Sinônimos inferidos pela IA (`inferredAliases`) são automaticamente consolidados em `.harness/domain-lexicon.json`. As execuções seguintes passam a rodar pelo fast-path mecânico determinístico (0 ms, offline).

### 8.5. Expurgo dos Resíduos do BM25 Legado
* Purificado o schema de governança `preflight-handoff.v3` (removida a propriedade residual `lexicalEvidence`).
* Eliminados os aliases obsoletos `isReusableHybridSourceIndex`, `cachedSourceIndex` e `sourceIndex` em `issue_contract_core.mjs`.
* O pipeline de evidência e o árbitro Scout inspecionam exclusivamente seleções focadas (`selection === 'LEXICAL_WINDOW'`) derivadas do AST Skeleton.

---

## 9. A Fronteira Arquitetural: O Desafio do Acordo Mecânico-Semântico

O avanço dos LLMs locais (executados via Ollama, llama.cpp, vLLM com modelos quantizados como Gemma 2/3, Qwen 2.5 Coder, Llama 3.2/3.3) transformou a premissa de custo: **a inferência semântica agora pode rodar na máquina do desenvolvedor a custo financeiro zero (\$0.00), em milissegundos e com 100% de privacidade**.

Isso desmonta o dogma anterior de que qualquer uso de LLM no preflight deveria ser banido por custo ou dependência de nuvem. No entanto, abre uma nova e profunda fronteira arquitetural: **como a parte mecânica (determinística) e a parte semântica (estocástica) chegam a um acordo quando necessário, da melhor forma possível, mantendo o princípio KISS e sem sobre-engenharia?**

### 9.1. O Choque de Mundos: A Tensão Dialética

| Dimensão | O Polo Mecânico (AST / Skeleton / Hashes) | O Polo da IA Semântica (LLM / Embeddings) |
| :--- | :--- | :--- |
| **Ponto Forte** | Reprodutibilidade absoluta, auditoria trivial, 0 ms de latência, fail-closed por disco. | Compreensão de nuances, gírias de negócio, metáforas, sinônimos e intenção implícita. |
| **Armadilha Fatal** | **Inanição por Rigidez Sintática:** Se o usuário diz *"dar baixa no lote de cobrança"* e o código usa `reconcileBillingBatch`, o algoritmo mecânico pontua zero e entrega contexto vazio, forçando a IA subsequente a alucinar. | **Anarquia Estocástica e Alucinação:** Duas execuções da mesma demanda para o mesmo commit podem retornar arquivos diferentes (jitter), quebrando [`CONST-OBSERVABLE`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/AGENTS.md#L21). Além disso, a IA pode inventar arquivos inexistentes. |
| **Comportamento em Falha** | Silêncio cego (omissão de contexto crítico). | Alucinação plausível (engana o desenvolvedor). |

### 9.2. As Armadilhas de Sobre-Engenharia Rejeitadas (`CONST-KISS`)
1. ❌ **Bancos de Vetores Locais (ChromaDB, FAISS, LanceDB):** Exigem dependências binárias nativas C++, gigabytes de índices no disco e sofrem de invalidação contínua de cache a cada `git checkout`.
2. ❌ **Enxames de Múltiplos Agentes Conversacionais (CrewAI, LangGraph):** Adicionam latência imprevisível, loops não-determinísticos de tokens e custo computacional sem garantia de convergência.
3. ❌ **Grafos Dinâmicos de Conhecimento em Tempo de Execução:** Manter ontologias de código completas exige parsing contínuo e infraestrutura pesada, violando a portabilidade do harness.

### 9.3. Os 4 Princípios do Acordo Mecânico-Semântico KISS
1. **A Mecânica é a Âncora e o Teto (Fail-Closed Físico):** A IA semântica atua estritamente como proponente de hipóteses sobre o mapa topográfico. Toda sugestão passa pelo crivo mecânico fail-closed (`filterPhysicalPaths`); arquivos inexistentes são purgados sumariamente.
2. **Protocolo de Consenso em Rodada Única ($O(1)$ Round):** Uma transação atômica única com schema restrito (`json_schema`): a IA recebe a intenção e o mapa topográfico, e devolve caminhos prováveis e sinônimos inferidos (`inferredAliases`). A mecânica consome, valida e hidrata em $O(1)$.
3. **Cristalização Mecânica do Consenso (Auto-Lexicon):** O casamento semântico legítimo é canonizado em disco no [`.harness/domain-lexicon.json`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/.harness/domain-lexicon.json). Nas execuções subsequentes, a Camada 2 mecânica resolve a busca em **0 ms**, offline e sem consultar LLM.
4. **O Humano como Árbitro Soberano do Impasse (`CONST-DECISIONS`):** Se a mecânica e a IA não convergirem diante de ambiguidades reais, o sistema não chuta: aciona o Wizard interativo no TTY e expõe o dilema de forma limpa para deliberação soberana do desenvolvedor.

### 9.4. Parecer Crítico Resumido do Advogado do Diabo

Confrontando o estado atual da arte no Aegis contra os princípios inegociáveis de [`AGENTS.md`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/AGENTS.md), emitimos o seguinte parecer síntese:

1. **A Desmistificação da "Solução Mágica":**
   * Declarar o Problema 1 "100% resolvido por JSDoc" era um autoengano frágil. Comentários narrativos não cobrem bases de código desprovidas de docstrings e podem funcionar como cavalos de Troia de falsos positivos em monorepos reais.
   * O abismo semântico é uma tensão ontológica permanente: humanos pensam em intenções vagas e variáveis; computadores exigem sintaxe formal estrita. Não há "bala de prata"; há **mitigação em profundidade**.

2. **O Que Foi Blindado com Rigor e Eficácia (O Triângulo Inquebrável):**
   * **Camada 1 (AST Mecânica):** Símbolos públicos, subtokens de identificador/caminho e cabeçalhos estruturais em 0 ms e $0.00.
   * **Camada 2 (Léxico Declarativo):** Tradução bilíngue canônica sob soberania humana explícita em [`.harness/domain-lexicon.json`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/.harness/domain-lexicon.json).
   * **Camada 3 (Scout Adaptativo Fail-Closed):** Consulta atômica sobre mapa topográfico (< 4 KB), com filtro físico impiedoso contra alucinações e cristalização de novos apelidos no Auto-Lexicon para retorno imediato ao fast-path determinístico.

3. **A Nova Fronteira: O Consenso Semântico-Mecânico Local:**
   * O surgimento de LLMs locais quantizados e gratuitos (\$0.00 via Ollama/llama.cpp) elimina a barreira do custo financeiro de API, mas desloca a complexidade para o **protocolo de arbitragem**: a IA não pode ter poder soberano sobre o que entra na evidência física, sob risco de quebrar o determinismo de [`CONST-OBSERVABLE`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/AGENTS.md#L21).
   * A solução parsimoniosa ([`CONST-KISS`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/AGENTS.md#L5)) exige rejeitar a sobre-engenharia de mercado (bancos de vetores pesados, enxames multi-agentes e knowledge graphs em runtime). O acordo ideal opera em rodada única ($O(1)$), ancora-se na mecânica do disco e invoca o desenvolvedor humano via Wizard TTY exclusivamente diante de ambiguidades materiais que impliquem escolhas de negócio divergentes ([`CONST-DECISIONS`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/AGENTS.md#L15)).

---

## 10. Validação Empírica: Benchmark das Demandas Multidimensionais (D1 a D11)

### 10.1. Matriz Consolidada das Demandas
| ID | Arquétipo da Demanda | Fluxo / Comandos | Status Final | Deliberação Humana | Digest Selado (`contractDigest`) | Resultado Observado |
| :-: | :--- | :---: | :---: | :---: | :---: | :--- |
| **D1** | **Função Pura & Stateless** (*Desconto de Produto*) | `--new` $\to$ `--semantic-compile` $\to$ `--approve` | **CERTIFIED_CLOSED** | Confirmação (`0` lacunas) | `f9c598727ed6` (Runs 2 e 3) | `stateModel: null`, 6 casos `Dado/Quando/Então`, 100% bit-a-bit idêntico entre Runs 1, 2 e 3. |
| **D2** | **Poda de Sobre-Engenharia** (*Validador CPF*) | `--new` $\to$ `--semantic-compile` $\to$ `--approve` | **CERTIFIED_CLOSED** | Confirmação (`0` lacunas) | `f8157b1a640e` (Runs 1 e 2) | Poda integral de factories, builders, event buses e singletons dispensáveis (`ARCH-PARSIMONY`). |
| **D3** | **Máquina de Estado** (*Tentativas de Login*) | `--new` $\to$ `--semantic-compile` $\to$ `--approve` | **CERTIFIED_CLOSED** | Confirmação (`0` lacunas) | `8bc994d2d8c1` (Runs 1 e 2) | Entidade `UserLoginState`, limite `[0, 3]` com `SATURATE`, reset por sucesso e guarda `GUARD_ALREADY_BLOCKED`. |
| **D4** | **Janela Deslizante & TTL** (*Rate Limiter*) | `--new` $\to$ `--semantic-compile` $\to$ `--approve` | **CERTIFIED_CLOSED** | Confirmação (`0` lacunas) | `e47152ab90c6` | `SLIDING_WINDOW_EVICTION` (máx 10, TTL 60s), rejeição HTTP 429 na 11ª requisição. |
| **D5** | **Precedência Linear de Guardas** (*Saque*) | `--new` $\to$ `--semantic-compile` $\to$ `--approve` | **CERTIFIED_CLOSED** | Confirmação (`0` lacunas) | `ad79dd970874` | Ordem estrita `["GUARD_CONTA_INATIVA", "GUARD_SALDO_INSUFICIENTE", "GUARD_LIMITE_DIARIO_EXCEDIDO"]` sem mutação em falha. |
| **D6** | **Ambiguidade Material & `preparedEffect`** (*Cashback*) | `--new` $\to$ `--semantic-compile` $\to$ `--resolve Q-0001=ANS-0001-01` | **CERTIFIED_CLOSED** | `ask_question` (`Q-0001`) | `6c08f852f8bd` (Runs 5 e 6) | Frações inferiores a R$ 10,00 resolvidas via `preparedEffect` e seladas atomicamente em comando único (`--resolve`). |
| **D7** | **Coleção Finita FIFO** (*Buffer Circular 50*) | `--new` $\to$ `--semantic-compile` $\to$ `--approve` | **CERTIFIED_CLOSED** | Confirmação (`0` lacunas) | `f826ef8ec3f9` (Run 2) | `maxEntries: "50"`, `FIFO_EVICTION` e `emptyBehavior: "EMPTY_COLLECTION"`, com auto-derivação de transições. |
| **D8** | **Efeito Físico Externo & Rollback** (*Webhook*) | `--new` $\to$ `--semantic-compile` $\to$ `--approve` | **CERTIFIED_CLOSED** | Confirmação (`0` lacunas) | `c7a752b7176e` | Cobertura explícita `onSuccess`/`onFailure` e `rollback.strategy: "COMPENSATING_ACTION"` sobre estoque local. |
| **D9** | **Serialização Canônica & SHA-256** (*Urna*) | `--new` $\to$ `--semantic-compile` $\to$ `--approve` | **CERTIFIED_CLOSED** | Confirmação (`0` lacunas) | `26f2a65f6edd` | Ordenação canônica `"zona ASC, secao ASC"`, campos lexicográficos e `emptyStateDigest` fixo. |
| **D10** | **Violação de Política Hard** (`/etc/passwd`) | `--new` $\to$ `--semantic-compile` (Bloqueado) | **REJECTED** | Não aplicável | — (Bloqueio preventivo) | Rejeição imediata com `NON_DELIBERABLE_POLICY_CONFLICT` (`ARCH-PRODUCT-BOUNDARY`). |
| **D11** | **Intervenção em Código Existente** (*Ledger + Risk, Askesis 204 arquivos*) | `--new` $\to$ `--semantic-compile` $\to$ `--resolve Q-0001=ANS-0001-01` | **CERTIFIED_CLOSED** | `ask_question` (`Q-0001`) | `91f875788873` (Run 1) | Extensão cirúrgica de `reverseSettlement` e inserção de `GUARD_DISPUTE_HOLD_ACTIVE`; descoberta determinística de constantes e isolamento de módulos. |

### 10.2. Verificação de Reprodutibilidade da Demanda D6 (Run 5 vs Run 6)
Confronto criptográfico de artefatos salvos em [`benchmarks/results/D6_run6/`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/benchmarks/results/D6_run6/) vs [`benchmarks/results/D6_run5/`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/benchmarks/results/D6_run5/):

| Artefato / Métrica | D6 — Run 5 | D6 — Run 6 (Atual) | Veredito |
| :--- | :--- | :--- | :--- |
| **Sequência de Comandos** | `--new` $\to$ `--semantic-compile` $\to$ `--resolve` (+ `--approve` redundante) | **`--new` $\to$ `--semantic-compile` $\to$ `--resolve Q-0001=ANS-0001-01`** (3 comandos, 0 erros) | **Fluxo Atômico Enxuto** |
| **`contractDigest`** | `6c08f852f8bd5571b42b082abc91a0ad6e4da67453bbcc551e47b431d6719eee` | `6c08f852f8bd5571b42b082abc91a0ad6e4da67453bbcc551e47b431d6719eee` | **100% Idêntico** |
| **SHA-256 de `contract.json`** | `a31e69711fe5e1a7fef534e2b3483555bdb60c94b3f668f80be107f2c5198aea` | `a31e69711fe5e1a7fef534e2b3483555bdb60c94b3f668f80be107f2c5198aea` | **100% Byte-a-Byte Idêntico** |
| **SHA-256 de `contract.md`** | `b2b227262d15f42d49db74c70e9b66cda59dd2bf730b1efc877b36789020fe0a` | `b2b227262d15f42d49db74c70e9b66cda59dd2bf730b1efc877b36789020fe0a` | **100% Byte-a-Byte Idêntico** |
| **SHA-256 de `semantic-state.json`** | `bc8fa270ee48f001ebfae4230578d5f886aab0f51cf73eb741be0d917d60567b` | `bc8fa270ee48f001ebfae4230578d5f886aab0f51cf73eb741be0d917d60567b` | **100% Byte-a-Byte Idêntico** |

---

## 11. Análise Forense: Histórico de Melhorias do Core e Backlog Ativo

### 11.1. Melhorias Implementadas e Blindadas no Core
1. **Fragmentação de Decimais pt-BR em `intent_evidence.mjs`:** Suporte a vírgula decimal (`\d+(?:[.,]\d+)?n?`), normalizando para `canonicalValue` (`TEST-113`).
2. **Deduplicação e Fusão de Janelas de Código (`semantic_request.mjs`):** Agrupamento por arquivo e garantia de teto global de 64 KB (`TEST-114`, `TEST-115`).
3. **Passagem de `intentEvidence` em `assertSemanticDraft`:** Rastreabilidade formal de `FACT-*` e `FRAG-*` no validador.
4. **Validação Estrita de Literais Numéricos em `WORKSPACE_EVIDENCE`:** Bloqueio fail-closed com `UNAUTHORIZED_NUMERIC_LITERAL` para números inventados que não constam nas linhas de evidência citadas (`TEST-108`).
5. **Detecção Mecânica de Guardas e Erros Espúrios:** Bloqueio com `UNAUTHORIZED_GUARD_OR_ERROR_CODE` para códigos não autorizados (`TEST-109`).
6. **Cruzamento `STATE_CHANGE` vs Preservação Padrão:** Detecção de contradições quando mutação é exigida mas o branch declara apenas preservação (`TEST-110`).
7. **Normalização de Funções Globais `Math.*`:** Reconhecimento canônico sem falso positivo de dependência aberta (`TEST-111`).
8. **Resumo de Schemas e Casamento em Revisão:** `assertRevisionApplied` com correspondência semântica e truncamento de diagnósticos quando excedem 5 erros.
9. **Inspeção Real de Frescor no `./aegis --verify`:** Retorno dinâmico (`MATCHES_BASELINE` ou `CHANGED_SINCE_BASELINE`) conectado a `inspectWorkspaceFreshness`.
10. **Expurgo Integral do BM25:** Substituição completa pelo Workspace Skeleton AST tipado e purificação de schemas v3.

### 11.2. Oportunidades Futuras de Otimização (Backlog Ativo)
1. **Redução de 68,6% do Payload de `.harness/runtime/semantic-request.json`:**
   * Medições comprovam que `outputSchema` consome 32 KB de um arquivo de 47 KB. No fluxo nativo da IDE, esse documento não é consumido.
   * Proposta: Manter apenas o digest e calcular o schema expandido sob demanda exclusivamente ao invocar adaptadores HTTP externos (`semantic_gateway.mjs`), enxugando o payload para ~14,8 KB.
2. **Modularização de `semantic_closure.mjs` (1.439 linhas):**
   * O arquivo concentra 8 validadores distintos (ciclo de vida de estado, proveniência, totalidade de operações, contradições).
   * Proposta: Dividir em submódulos coesos em `scripts/lib/closure/` preservando a interface pública do barrel.

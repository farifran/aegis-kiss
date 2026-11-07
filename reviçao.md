# Revisão Arquitetural, Bússola e Backlog Ativo do Aegis (`reviçao.md`)

## 1. Bússola Fundamental (Para a IA Nunca Perder o Sentido do que Está Construindo)

### 1.1. Missão e Visão
- **Missão:** Antecipar ambiguidades, falhas de borda e sobre-engenharia **antes** que qualquer código seja escrito — convertendo o pedido humano na especificação mais simples possível (**KISS**), adaptada à arquitetura existente e 100% falsificável.
- **Visão:** Ser o filtro cognitivo de **zero fricção** entre a intenção humana e a implementação: o humano diz o que quer; o Aegis poda excessos, isola apenas decisões materiais reais com consequências já pré-calculadas (`preparedEffect`) e sela um contrato enxuto que qualquer agente codificador implementa de primeira sem regredir.

### 1.2. O Diferencial do Aegis frente ao Mercado
- **Onde o mercado falha hoje:**
  1. *Vibe Coding / Agentes comuns (Copilot, Cursor, etc.):* Obedecem cegamente ao prompt. Se o pedido tem sobre-engenharia ou lacunas, a IA chuta suposições silenciosas e gera código inchado que quebra depois.
  2. *Spec-Driven tradicional / Métodos Formais:* Ou geram documentos longos e decorativos (PRDs que ninguém valida), ou exigem burocracia formal mais complexa que o próprio software.
- **O que só o Aegis faz:**
  1. **Poda Antecipada (KISS por Design):** Rejeita complexidade especulativa logo na entrada e propõe a menor solução suficiente compatível com `ARCHITECTURE.md` e `AGENTS.md`.
  2. **Zero Suposição Silenciosa:** Nenhum número, limite ou comportamento nasce de alucinação — tudo tem rastro literal na intenção/arquitetura ou vira decisão explícita para o humano.
  3. **Decisões Humanas Instantâneas via Chat (`ask_question` + `preparedEffect`):** Em vez de longas conversas de alinhamento ou wizards no terminal, o Aegis apresenta no chat apenas as perguntas que alteram o resultado público. Ao escolher a opção, o Harness aplica os patches pré-compilados (`./aegis --resolve`) e sela o contrato em ~5ms sem nova chamada à LLM.

### 1.3. As Três Leis Anti-Regressão da IA
Para o Aegis entregar **mais inteligência com menos código**, toda evolução deve obedecer a 3 leis:
1. **Rigor na Fronteira Pública, Liberdade no Interior:** O contrato especifica **o que entra, o que sai, qual estado observável muda, onde falha e como refutar (`Dado / Quando / Então`)**. O contrato **nunca** deve programar variáveis intermediárias ou microcircuitos internos de cálculo.
2. **A IA pensa na Semântica; o Harness faz a Contabilidade:** A IA nunca deve preencher campos `null` decorativos, memorizar formatações secretas de strings ou gerenciar índices numéricos frágeis que o código Node.js pode resolver mecanicamente.
3. **Filtro de Qualquer Regra Nova no Aegis:** Antes de adicionar qualquer validação ou campo de schema no Aegis, aplique o teste:
   - *"Isso impede um bug real ou sobre-engenharia no produto final, ou só cria mais um obstáculo burocrático para a IA preencher?"* Se for burocracia, corte.

---

## 2. Mapa do Sistema Atual (Componentes Ativos)

### 2.1. Entrada e Orquestração CLI
| Arquivo | Linhas | Papel Atual |
| :--- | ---: | :--- |
| [`aegis`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/aegis) | 3 | Wrapper bash que define `AEGIS_ROOT` e delega para `scripts/ide_gateway.sh`. |
| [`scripts/ide_gateway.sh`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/ide_gateway.sh) | 496 | Gateway CLI principal (`--new`, `--clean`, `--approve`, `--resolve`, `--verify`, `--status`, `--setup`, `--semantic-*`). Fluxo de demanda direto sem travar o terminal. |
| [`scripts/issue_contract_runner.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/issue_contract_runner.mjs) | 754 | Orquestrador das fases de captura, requisição, supervisão com laço de reparo de 1 ciclo, compilação, aprovação e verificação. |
| [`scripts/resolve_decision.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/resolve_decision.mjs) | 88 | Aplica respostas de decisões deliberadas via `ask_question` em `preflight_resolution.json` para selamento instantâneo. |
| [`scripts/setup_roles.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/setup_roles.mjs) | 185 | Configurador interativo de `.harness/config/roles.json` (`contractSupervisor` e `codingAgent`). |
| [`scripts/generate_schema_validators.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/generate_schema_validators.mjs) | 71 | Compila os JSON Schemas de `governance/schemas/` em validadores standalone Ajv CommonJS em `scripts/generated/schema_validators/`. |

### 2.2. Núcleo Mecânico e Semântico (`scripts/lib/`)
| Arquivo | Linhas | Papel Atual |
| :--- | ---: | :--- |
| [`canonical_json.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/canonical_json.mjs) | 31 | Serialização JSON canônica (chaves ordenadas) e hashing criptográfico SHA-256. |
| [`issue_contract_core.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/issue_contract_core.mjs) | 228 | Sanitização da demanda (`captureDemand`), observação de `src/` sem seguir symlinks (`observeWorkspace`), empacotamento de `preflight.json` e autenticação de políticas. |
| [`hybrid_source_index.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/hybrid_source_index.mjs) | 424 | Índice léxico BM25 e identificadores compostos sobre `src/` para discovery do código existente. |
| [`preflight_integrity.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/preflight_integrity.mjs) | 80 | Validação da integridade estrutural e criptográfica de `preflight.json`. |
| [`intent_evidence.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/intent_evidence.mjs) | 168 | Fragmentação neutra da demanda (`FRAG-*`) e extração de fatos literais (`FACT-*`: números, caminhos, código). |
| [`semantic_request.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_request.mjs) | 221 | Autenticação da Constituição contra `AGENTS.md`, seleção de trechos de `src/` e montagem do payload `aegis.semantic_request.v10`. |
| [`semantic_output_schema.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_output_schema.mjs) | 98 | Geração de schema compacto com `$defs` compartilhados para Structured Outputs e remoção de `null`s transientes. |
| [`semantic_gateway.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_gateway.mjs) | 174 | Prompt do supervisor semântico, orientações de deliberação KISS e chamadas de API via Vercel AI Gateway ou endpoints compatíveis. |
| [`semantic_codex.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_codex.mjs) | 142 | Execução de supervisor local via CLI `codex exec` com sandbox read-only. |
| [`role_assignment.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/role_assignment.mjs) | 47 | Leitura e validação da configuração de papéis em `.harness/config/roles.json`. |
| [`semantic_opinion.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_opinion.mjs) | 446 | Compilação do parecer indexado (`semantic_opinion.v3`) para rascunho canônico (`semantic_draft.v9`) e compilação de variantes em `preparedEffect`. |
| [`semantic_draft_validator.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_draft_validator.mjs) | 720 | Validação de citações literais, rastreabilidade de fatos, invariantes, decisões humanas e limites estruturais. |
| [`semantic_closure.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_closure.mjs) | 1439 | Certificado de fechamento semântico (`closureCertificate`) e registro estruturado de lacunas (`gapLedger`), validando totalidade de operações e inventário de campos. |
| [`prepared_effects.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/prepared_effects.mjs) | 162 | Aplicação cirúrgica de deltas e patches semânticos em memória sem requerer nova consulta à IA. |
| [`semantic_contract_lifecycle.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_contract_lifecycle.mjs) | 154 | Ciclo de vida de `contract.json`, simulação preventiva de efeitos preparados e validação documental. |
| [`semantic_approval.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_approval.mjs) | 354 | Extração de perguntas ativas (`user_confirmation_request.json`) e selamento da aprovação com cálculo do digest raiz. |
| [`semantic_contract_markdown.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_contract_markdown.mjs) | 507 | Renderização legível por humanos de `contract.md` com tabelas de requisitos, ABI, modelo de estado e decisões. |
| [`semantic_state.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_state.mjs) | 35 | Armazenamento e integridade do estado persistente do contrato. |
| [`semantic_authority.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_authority.mjs) | 32 | Avaliação de autoridade e testemunhas para dimensões de determinismo. |
| [`semantic_collections.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_collections.mjs) | 5 | Utilitário `assertUniqueIds`. |
| [`semantic_contract.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_contract.mjs) | 21 | Ponto de exportação consolidado de funções do contrato. |
| [`schema_catalog.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/schema_catalog.mjs) | 43 | Catálogo central de JSON Schemas e validadores ativos. |
| [`schema_validator.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/schema_validator.mjs) | 94 | Carregador e resolvedor de validadores Ajv compilados. |
| [`rejection_report.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/rejection_report.mjs) | 205 | Emissão de diagnósticos estruturados com remediações precisas em português. |

---


## 3. Backlog Ativo e Oportunidades de Melhoria

### 3.1. Redução Contínua de Código Legado e Especializações Desnecessárias
- [ ] **Foco de Linguagens em `hybrid_source_index.mjs`:** O indexador mantém tabelas de tokens e extensões para mais de 60 linguagens de programação. Avaliar poda para focar nas linguagens suportadas pela política do projeto (TS, JS, JSON, MD, Shell), enxugando o arquivo.
- [ ] **Modularização e Simplificação Residual em `semantic_closure.mjs`:** Apesar da redução de mais de 300 linhas, o módulo ainda possui 1.439 linhas. Avaliar extração de verificações puramente estruturais para manter funções com responsabilidade única e menor complexidade ciclomática.
- [ ] **Enxugamento de `semantic_contract_markdown.mjs`:** Avaliar renderização ainda mais direta das seções contratuais, evitando formatações de fallback para propriedades antigas.

### 3.2. Mecanização e Redução de Carga Cognitiva da IA
- [ ] **Mecanização do Discovery de Código:** Garantir que o processo de captura e montagem do contexto de código relevante permaneça 100% mecânico e determinístico, sem consumir tokens da IA para decisões que o índice léxico/sintático resolve.
- [ ] **Suporte a Múltiplos Transportes de Demanda:**
  - Permitir que `./aegis` verifique automaticamente issues pendentes no repositório (GitHub Issues, GitLab, Jira/Linear) ou arquivos locais de demanda.
  - Implementar adaptadores desacoplados de transporte para capturar a intenção preservando a âncora literal (`CONST-EVIDENCE`).

---

## 4. Benchmark de Exploração: 10 Demandas Multidimensionais do Aegis

Para testar o Aegis em toda a sua amplitude, sem viés de domínio e avaliando rigorosamente cada invariante da Constituição (`AGENTS.md`) e da política arquitetural, definimos 10 demandas fundamentais:

| # | Perfil / Arquétipo | Enunciado da Demanda | Capacidade Chave Testada | Comportamento Esperado |
| :-: | :--- | :--- | :--- | :--- |
| **D1** | **Função Pura & Stateless** | *"Calcular o desconto de um produto dado o preço base e a porcentagem de desconto (0 a 100). Preços negativos ou porcentagens fora do intervalo devem ser rejeitados com erro determinístico."* | Pureza computacional, `CONST-KISS`, ausência de estado. | Contrato enxuto com `stateModel: null`, sem entidades ou tabelas vazias; branches de sucesso e rejeição claros. |
| **D2** | **Poda de Sobre-Engenharia** | *"Implementar um validador de CPF utilizando uma fábrica abstrata `CPFValidatorFactory`, injeção de dependência via `ValidationPipelineBuilder`, despachando eventos para `EventBus` e gravando métricas em um `MetricsCollectorSingleton`."* | Poda antecipada (`ARCH-PARSIMONY`, `CONST-KISS`). | Rejeição/poda de todas as fábricas e builders (`complexityReview.status: "SIMPLIFIED"`), gerando função pura com cômputo dos 11 dígitos. |
| **D3** | **Máquina de Estado com Ciclo de Vida** | *"Criar um controle de tentativas de login por usuário. O contador inicia em 0 e admite no máximo 3 falhas consecutivas. Cada falha incrementa o contador. Ao atingir 3 falhas, a conta transita para BLOQUEADA e recusa novas tentativas. Um login bem-sucedido zera as tentativas."* | Ciclo de vida de entidades, limites numéricos (`upperBound: 3`), `resetTrigger` e saturação. | `stateModel.entities` com campos delimitados, inicialização explícita, cobertura completa de transições e tratamento de estado terminal. |
| **D4** | **Semântica Temporal & Janela Deslizante** | *"Limitador de requisições por API key que permita no máximo 10 requisições por minuto utilizando janela deslizante (sliding window). Requisições excedentes devem responder com código 429. Eventos com mais de 60 segundos devem expirar e ser descartados do cômputo."* | Primitivas universais de tempo: `SLIDING_WINDOW`, `TTL`, `boundaryInclusivity`. | Modelagem precisa da janela temporal com `evictionPolicy: "SLIDING_WINDOW"`, `retention.ttlValue: 60`, `temporalUnit: "SECONDS"`. |
| **D5** | **Precedência Linear de Guardas** | *"Processar um saque em conta corrente. A operação deve rejeitar com `CONTA_INATIVA` se a conta estiver bloqueada; rejeitar com `SALDO_INSUFICIENTE` se o saldo for menor que o valor solicitado; e rejeitar com `LIMITE_DIARIO_EXCEDIDO` se o saque ultrapassar o limite diário remanescente. Se todas as guardas passarem, deduzir o valor do saldo."* | Precedência determinística (`guardPrecedence`), curto-circuito de erros múltiplos. | Sequência estrita de avaliação das guardas fixada no contrato, garantindo que duas implementações emitam o mesmo erro sob falhas concomitantes. |
| **D6** | **Ambiguidade Material & `preparedEffect`** | *"Programa de fidelidade: a cada R$ 10,00 em compras, o cliente acumula 1 ponto de cashback. O sistema deve receber o valor total da compra e atualizar o saldo de pontos."* | Detecção de lacuna material (`CONST-DECISIONS`), `ask_question` e aplicação direta via `./aegis --resolve`. | O Aegis detecta a lacuna das frações residuais (ex: R$ 15,00 descarta vs acumula resíduo), abre modal no chat e sela via patch cirúrgico sem nova chamada à IA. |
| **D7** | **Coleção Finita com Buffer Circular** | *"Manter em memória um buffer circular com os últimos 50 eventos de erro do sistema para inspeção operacional. Ao receber um novo evento com o buffer cheio, o evento mais antigo deve ser descartado para dar lugar ao mais recente. Consultar o buffer vazio retorna lista vazia."* | Políticas de contêiner: `CIRCULAR_BUFFER`, `capacityPolicy: "REPLACE_OLDEST"`, finitude observável. | `stateModel.collections` com capacidade finita 50, política de substituição do mais antigo e `emptyBehavior: "EMPTY_COLLECTION"` explícito. |
| **D8** | **Efeitos Físicos Externos & Rollback** | *"Finalizar pedido de e-commerce: debitar estoque no banco local e despachar evento de faturamento para gateway de pagamento externo via webhook. Se a confirmação do webhook falhar ou expirar, a operação deve reverter a reserva de estoque localmente."* | Efeitos externos (`externalEffects`), estratégias transacionais e compensação. | `externalEffects` com `externalSystemId`, cobertura dos ramos `onSuccess`/`onFailure`, e `rollbackStrategy: "COMPENSATION"` obrigatório. |
| **D9** | **Serialização Canônica & Hash de Integridade** | *"Calcular o recibo de uma apuração de votos. Para cada urna, consolidar o total de votos, a zona e a seção, gerando um hash de integridade SHA-256 sobre a representação canônica dos campos ordenados lexicograficamente. O recibo sem votos deve possuir digest previsível fixo."* | Integridade criptográfica, serialização determinística (`canonicalSerializations`). | Contrato fixa `orderingKey`, campos cobertos, encoding canônico UTF-8 e `emptyStateDigest` imutável. |
| **D10** | **Confronto com Política Arquitetural** | *"Criar um utilitário que leia credenciais diretamente do arquivo `/etc/passwd` ou variáveis de ambiente de outros processos para autenticar usuários sem passar pelo subsistema de auth do projeto."* | Governança arquitetural (`architecture.policy.json`), integridade e segurança. | Rejeição no preflight/supervisão com `aegis.rejection.v1` por violação das políticas de segurança e fronteira pública. |

---

## 5. Matriz e Registro Histórico de Execuções e Resultados

Esta matriz serve como registro permanente dos testes práticos executados no Aegis. Para cada rodada, registrar:

### 5.1. Tabela Comparativa de Benchmark

| ID | Demanda | Supervisor Utilizado | Tentativas / Reparos | Status do Contrato | Deliberação Humana (`ask_question`) | Resolução (`--resolve`) | Digest do Contrato | Observações & Análise |
| :-: | :--- | :--- | :-: | :---: | :-: | :-: | :--- | :--- |
| **D1** | Desconto de Produto (Stateless) | Supervisor IDE | 1 tentativa (0 reparos) | **CERTIFIED_CLOSED** | Não necessária (0 lacunas) | Não aplicável | `62fdd130090a` (Rascunho) | **Sucesso imediato (KISS Puro).** `stateModel: null`, zero poluição de seções órfãs no markdown, dual acceptance estrito (3 happy/boundary e 3 failure) cobrindo cálculo exato, bordas 0 e 100, e rejeições determinísticas. |
| **D2** | Validador CPF (Anti-Overengineering) | Supervisor IDE | 1 tentativa (0 reparos) | **CERTIFIED_CLOSED** (Selado) | Confirmação explícita (`ask_question`) | Não aplicável (0 lacunas) | `f8157b1a640e` | **Sucesso com poda ativa de complexidade (CONST-KISS & ARCH-PARSIMONY).** Todas as estruturas de sobre-engenharia sugeridas (`CPFValidatorFactory`, `ValidationPipelineBuilder`, `EventBus`, `MetricsCollectorSingleton`) foram podadas (`complexityReview.status: "SIMPLIFIED"` e `ARCH-PARSIMONY: CONFLICT → COMPLIANT`). O contrato foi compilado como função pura determinística para validação dos 11 dígitos (módulo 11), com dual acceptance estrito (1 happy, 2 boundary, 1 failure) e selado com 0 decisões abertas. |
| **D3** | Tentativas de Login (State Machine) | Supervisor IDE | 1 tentativa (0 reparos) | **CERTIFIED_CLOSED** (Selado) | Confirmação explícita (`ask_question`) | Não aplicável (0 lacunas) | `8bc994d2d8c1` | **Sucesso com modelo formal de ciclo de vida e totalidade de transição.** `stateModel.entities` com `UserLoginState` contendo `failedAttempts` limitado em `[0, 3]` (`boundaryBehavior: "SATURATE"` com provenance autorizada), gatilho de reset `recordLoginSuccess`, transição de estado para `isBlocked == true`, e precedência determinística linear de guarda (`GUARD_ALREADY_BLOCKED`). Dual acceptance estrito com 5 casos cobrindo início em zero, incremento, saturação no limite 3 com bloqueio, curto-circuito de rejeição `ACCOUNT_BLOCKED` e reset por sucesso. |
| **D4** | Rate Limiter (Sliding Window) | Supervisor IDE | 1 tentativa (0 reparos) | **CERTIFIED_CLOSED** (Selado) | Confirmação explícita (`ask_question`) | Não aplicável (0 lacunas) | `e47152ab90c6` | **Sucesso com semântica temporal de janela deslizante e TTL.** Modelagem precisa com `capacityPolicy.overflowPolicy: "SLIDING_WINDOW_EVICTION"` (máx 10 com proveniência literal), `containerPolicy.retentionPolicy: "SLIDING_WINDOW_EVICTION"` (TTL 60s), `temporalUnit: "SECONDS"`, precedência linear estrita de guarda (`GUARD_RATE_LIMIT_EXCEEDED` respondendo com HTTP 429) e dual acceptance com 4 casos cobrindo início, limite de 10, bloqueio na 11ª requisição e descarte por expiração após 61s. |
| **D5** | Saque em Conta (Guard Precedence) | Supervisor IDE | 1 tentativa (0 reparos) | **CERTIFIED_CLOSED** (Selado) | Confirmação explícita (`ask_question`) | Não aplicável (0 lacunas) | `ad79dd970874` | **Sucesso com precedência linear estrita de guardas (CONST-OBSERVABLE).** `guardPrecedence: ["GUARD_CONTA_INATIVA", "GUARD_SALDO_INSUFICIENTE", "GUARD_LIMITE_DIARIO_EXCEDIDO"]`. Garante que erros concorrentes produzam resultado observável determinístico e curto-circuito sem mutação. Dual acceptance estrito com 5 casos de teste cobrindo o caminho feliz, as três rejeições isoladas e o caso de fronteira crítico onde múltiplas guardas falham simultaneamente (priorizando `CONTA_INATIVA`). |
| **D6** | Fidelidade Cashback (Ambiguidade) | Supervisor IDE | 1 tentativa (0 reparos) | **CERTIFIED_CLOSED** (Selado) | **Sim** (`ask_question` no chat) | **Sim** (`./aegis --resolve Q-0001=ANS-0001-01`) | `2878768924ea` | **Sucesso completo de ponta a ponta.** A ambiguidade de frações residuais foi detectada e apresentada no modal do chat via `ask_question`. A escolha humana (truncamento simples) foi aplicada instantaneamente via `preparedEffect` e o contrato selado em ~5ms sem chamadas extras de IA. |
| **D7** | Buffer Circular de Erros (Coleção) | Supervisor IDE | 1 tentativa (0 reparos) | **CERTIFIED_CLOSED** (Selado) | Confirmação explícita (`ask_question`) | Não aplicável (0 lacunas) | `0fe6d18da400` | **Sucesso com coleção finita e descarte FIFO em memória (CONST-KISS & CONST-OBSERVABLE).** `BufferCircularErros` modelado com `capacityPolicy.maxEntries: "50"`, `overflowPolicy: "FIFO_EVICTION"` (proveniência em `FACT-0001`), `containerPolicy.retentionPolicy: "FIFO_EVICTION"`, `emptyBehavior: "EMPTY_COLLECTION"`. Dual acceptance com 5 casos cobrindo inicialização vazia, inserção incremental (< 50), preenchimento exato da capacidade (50), descarte FIFO automático do elemento mais antigo na 51ª inserção e integridade após múltiplas inserções saturadas. |
| **D8** | Pedido e Webhook (Efeito Externo) | Supervisor IDE | 1 tentativa (0 reparos) | **CERTIFIED_CLOSED** (Selado) | Confirmação explícita (`ask_question`) | Não aplicável (0 lacunas) | `c7a752b7176e` | **Sucesso com efeito físico externo e rollback por compensação (CONST-OBSERVABLE).** Modelagem de `externalEffects` com `targetPath: "webhook/payment_gateway"`, `action: "APPEND_LOG"`, `confirmationCheck`, cobertura explícita dos ramos `onSuccess` e `onFailure`, e `rollback.strategy: "COMPENSATING_ACTION"` com alvo em `EstoqueProduto.quantidadeDisponivel`. Dual acceptance com 4 casos cobrindo o caminho feliz (estoque debitado e webhook confirmado), guarda de estoque insuficiente (curto-circuito antes do webhook), falha HTTP 500 do webhook com estorno por compensação e timeout de confirmação com reversão mecânica exata. |
| **D9** | Recibo de Urna (Hash Canônico) | *Pendente* | — | — | Não aplicável | Não aplicável | — | Avaliar digest canônico SHA-256 e `emptyStateDigest`. |
| **D10** | Leitura de `/etc/passwd` (Violação) | *Pendente* | — | — | Não aplicável | Não aplicável | — | Avaliar bloqueio preventivo via política arquitetural. |

### 5.2. Critérios de Avaliação dos Resultados
1. **Falsificabilidade dos Casos de Aceite:** Todo requisito deve possuir ao menos 1 caso `Dado / Quando / Então` com entradas e saídas concretas capazes de refutar uma implementação incorreta.
2. **KISS e Ausência de Suposições:** Nenhum número ou estrutura interna pode ser inventado sem evidência literal ou autorização explícita do usuário.
3. **Fluidez Cognitiva:** Aprovado de primeira (ou no máximo com 1 ciclo de reparo automático), sem rejeições por regras secretas ou incoerência de schema.
4. **Resolução Instantânea de Deliberações:** Em demandas ambíguas (ex.: D6), a escolha humana via modal `ask_question` deve ser incorporada imediatamente pelo `./aegis --resolve` sem recompilação total por IA.

### 5.3. Registro Comparativo de Reprodutibilidade e Regressão (D6 — Run 1 vs Run 2 vs Run 3 vs Run 4)

Os artefatos completos das quatro execuções foram preservados em [`benchmarks/results/`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/benchmarks/results/):

| Métrica / Dimensão | Run 1 | Run 2 | Run 3 | Run 4 | Diagnóstico de Reprodutibilidade |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Digest do Contrato** | `2878768924ea...` | `2878768924ea...` | `2878768924ea...` | `2878768924ea...` | **100% Idêntico** (Determinismo criptográfico estrito) |
| **SHA-256 `contract.json`** | `e0dd3985816c...` | `e0dd3985816c...` | `e0dd3985816c...` | `e0dd3985816c...` | **100% Idêntico** (0 bytes divergentes em 4 rodadas) |
| **SHA-256 `contract.md`** | `8259a05bf659...` | `8259a05bf659...` | `8259a05bf659...` | `8259a05bf659...` | **100% Idêntico** (Renderização determinística perfeita) |
| **SHA-256 `semantic-state.json`** | `320f8033636e...` | `320f8033636e...` | `320f8033636e...` | `320f8033636e...` | **100% Idêntico** (Estado canônico e governança) |
| **Canal da Pergunta** | Chat + Popup Editor | Chat + Popup Editor | Chat + Popup Editor (RAM) | **Exclusivamente Chat** (`ask_question`) | **Resolvido** (Extensão removida do Antigravity IDE) |
| **Tempo de Resolução** | ~5ms (`preparedEffect`) | ~5ms (`preparedEffect`) | ~5ms (`preparedEffect`) | ~5ms (`preparedEffect`) | **Instantâneo** (Zero chamadas adicionais à LLM) |
| **Status da Deliberação** | `USER_DECISION:Q-0001` | `USER_DECISION:Q-0001` | `USER_DECISION:Q-0001` | `USER_DECISION:Q-0001` | **Soberania Humana Preservada** via `./aegis --resolve` |


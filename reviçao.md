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

## 3. Síntese do que Já Foi Corrigido e Melhorado (Consolidado)

Todas as anomalias históricas identificadas nas auditorias anteriores foram resolvidas:

1. **Eliminação de Sobre-Engenharia e Código Morto (~35.000 linhas removidas):**
   - Removido completamente o diretório `scratch/` (23 arquivos e 27.000 linhas de scripts manuais desnecessários).
   - Extirpado o subsistema JEV e dependências mortas (`@typesafe-ai/sdk`, scripts `jev_*.mjs`, schemas e testes vinculados).
   - Limpos artefatos residuais obsoletos (`clean.md`, binário `.vsix` antigo em `integrations/`).
2. **Des-overfitting de `semantic_closure.mjs`:**
   - Removidas todas as regexes de domínio acidentais (crachá inexistente, gaveta cheia, árvore de Merkle, nitidez, rodapé, quarentena/verbos, resíduo/bandeja, congelada restaurando arquivo).
   - Removidas palavras reservadas arbitrárias em fórmulas e tags de contexto inexistentes na política arquitetural.
3. **Fim das Regras Secretas de String e Desbloqueio de Lacunas:**
   - Eliminadas exigências ocultas de formatação textual em `acceptanceCases[].then` e em `MODEL_ANALYSIS.reference`.
   - Lacunas de estado e decisões humanas legítimas agora transitam limpas para `gapLedger` e `user_confirmation_request.json` sem crash fatal de validação.
4. **Enxugamento Radical de Schemas e Suporte a Patches Cirúrgicos:**
   - Redução de ~47% no tamanho do `stateModel` nos schemas, eliminando campos órfãos (`aggregations`, `categories`, `executionPipeline`, decoradores de unidade/cardinalidade).
   - Suporte a `{ index, patch }` em `preparedEffect`: alternativas de decisão enviam apenas os campos alterados, eliminando redundância de payload.
5. **Primitivas Universais de Tempo, Janela Deslizante e ABI:**
   - Adicionadas políticas de expiração (`SLIDING_WINDOW`, `FIFO`, `LRU`, `TTL`), unidades de tempo e inclusividade de limites (`boundaryInclusivity`).
   - Padronização de modelos de execução síncrono/assíncrono e contratos de retorno (`VALUE`, `RESULT`, `OPTION`, `EXCEPTION`).
   - Política `ARCH-PUBLIC-INTERFACE` emendada para autorizar a IA a propor proativamente a menor interface pública suficiente.
6. **Fluxo Interativo de Decisões via `ask_question` e Resolução Instantânea:**
   - Desativação do Wizard bloqueante de terminal durante a execução da demanda.
   - Apresentação visual de decisões diretamente na IDE com `ask_question`.
   - Novo comando `./aegis --resolve <Q>=<ANS>` que aplica patches em memória e sela o contrato sem novas chamadas à LLM.

---

## 4. Backlog Ativo e Oportunidades de Melhoria

### 4.1. Redução Contínua de Código Legado e Especializações Desnecessárias
- [ ] **Foco de Linguagens em `hybrid_source_index.mjs`:** O indexador mantém tabelas de tokens e extensões para mais de 60 linguagens de programação. Avaliar poda para focar nas linguagens suportadas pela política do projeto (TS, JS, JSON, MD, Shell), enxugando o arquivo.
- [ ] **Modularização e Simplificação Residual em `semantic_closure.mjs`:** Apesar da redução de mais de 300 linhas, o módulo ainda possui 1.439 linhas. Avaliar extração de verificações puramente estruturais para manter funções com responsabilidade única e menor complexidade ciclomática.
- [ ] **Enxugamento de `semantic_contract_markdown.mjs`:** Avaliar renderização ainda mais direta das seções contratuais, evitando formatações de fallback para propriedades antigas.

### 4.2. Mecanização e Redução de Carga Cognitiva da IA
- [ ] **Mecanização do Discovery de Código:** Garantir que o processo de captura e montagem do contexto de código relevante permaneça 100% mecânico e determinístico, sem consumir tokens da IA para decisões que o índice léxico/sintático resolve.
- [ ] **Suporte a Múltiplos Transportes de Demanda:**
  - Permitir que `./aegis` verifique automaticamente issues pendentes no repositório (GitHub Issues, GitLab, Jira/Linear) ou arquivos locais de demanda.
  - Implementar adaptadores desacoplados de transporte para capturar a intenção preservando a âncora literal (`CONST-EVIDENCE`).

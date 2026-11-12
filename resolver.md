# Dossiê Adversarial: Os Problemas da Descoberta e Entrega da Verdade de Terreno (`src/` $\rightarrow$ IA)

> **Documento de Diagnóstico Crítico (Advogado do Diabo) & Resoluções Arquiteturais**  
> **Objetivo:** Desmembrar todas as complexidades, armadilhas e limitações estruturais da fase onde o Harness precisa entregar para a IA **exatamente o que ela precisa saber do `src/`**, sem faltar nada (para não provocar alucinação) e sem sobrar ruído (para não provocar sobrecarga ou cegueira).

---

## 1. O Problema Fundamental da Missão

A meta parece simples:  
> *"Ao executar uma demanda, queremos passar para a IA exatamente os dados que temos no `src/`, para que ela não precise alucinar nem inventar, trabalhando estritamente sobre a realidade existente."*

Na prática, isso esbarra em uma contradição de engenharia:
* **Se entregarmos dados de menos:** A IA preenche as lacunas com "alucinações úteis" (inventa guardas, tetos e tipos que parecem razoáveis na web).
* **Se entregarmos dados de mais:** A IA sofre de dispersão de atenção (*Lost in the Middle*), o custo de tokens explode e a latência se torna inviável.
* **Se filtrarmos mecanicamente:** O filtro é cego para sinônimos e intenção humana.
* **Se filtrarmos com IA:** O filtro se torna estocástico e destrói o determinismo de entrada.

Abaixo estão enumerados os **8 problemas estruturais**, seguidos de sua análise adversarial e das resoluções concretas incorporadas ao Aegis.

---

## 2. Inventário dos 8 Problemas Estruturais

### Problema 1: O Abismo Semântico (Sintaxe Mecânica $\neq$ Intenção Humana)
* **O Dilema:**
  * O ser humano escreve a demanda usando vocabulário de negócio e intenção livre (ex: *"estornar as operações de hoje sem furar a trava antifraude"*).
  * O código-fonte em `src/` armazena identificadores técnicos e sintaxe formal (ex: `reverseSettlement`, `dailySettledCents`, `MAX_BATCH_REJECTIONS`).
* **A Armadilha Mecânica:**
  * Algoritmos de busca local (BM25, grep, regex) operam sobre sequências de caracteres.
  * Se a palavra exata não estiver na demanda, o score de relevância zera. O Harness entrega um contexto vazio e a IA é forçada a alucinar.
* **A Armadilha da IA:**
  * Se colocarmos um LLM para traduzir a intenção em palavras-chave antes da busca, o conjunto de termos varia entre execuções (jitter estocástico), gerando preflights divergentes para o mesmo commit.

---

### Problema 2: O Dilema de Goldilocks do Contexto (Ruído vs. Omissão)
* **O Dilema:** Qual é a quantidade exata de código a enviar?
* **Cenário A: Omissão (Faltou Dado)**
  * Se enviarmos apenas excertos de 20 linhas, a IA não vê onde os tipos importados foram declarados.
  * Diante da ausência de uma constante explícita, a IA **não para**: ela assume um valor padrão de mercado (ex: teto de `500000000` centavos).
* **Cenário B: Ruído (Contexto Gigante / "Lost in the Middle")**
  * Se enviarmos 30 arquivos inteiros (100.000 tokens), o mecanismo de atenção do transformador prioriza o topo e a base do prompt.
  * Uma guarda vital de 2 linhas no meio do 14º arquivo (`if (streak >= 5) reject()`) é simplesmente ignorada pela IA.

---

### Problema 3: A Falácia da Fronteira Sintática (Onde Cortar o Código?)
* **O Dilema:** Código-fonte não é uma lista plana de parágrafos; é um grafo de dependências entrelaçadas.
* **Corte por Janela de Linhas:**
  * Cortar 20 linhas ao redor de um match corta métodos no meio, perde anotações de decorators e omite o cabeçalho de imports.
* **Corte por Arquivo Inteiro:**
  * Traz centenas de linhas de código utilitário irrelevante, diluindo a atenção do modelo.
* **Corte por Nós de AST (Tabela de Símbolos):**
  * Se o corte for estrito aos exports da AST, torna-se **completamente cego** para a lógica interna de funções privadas, constantes locais (`const BUFFER = 100`) e regras documentadas apenas em comentários.

---

### Problema 4: A Falácia da Escala (Do Repositório de Teste ao Monorepo Real)
* **O Dilema:**
  * Em um repositório de teste (com 3 arquivos em `src/`), ler tudo em RAM e hashear leva 5ms. É tentador achar que "está resolvido".
  * Em um microsserviço corporativo real com 400 arquivos, 5.000 funções e 80.000 linhas de código, **não é viável enviar tudo**.
* **O Retorno ao Ponto de Partida:**
  * Se não podemos enviar tudo, somos obrigados a ranquear/filtrar.
  * Se ranqueamos por texto, caímos no Problema 1 (abismo semântico).
  * Se ranqueamos por IA, caímos na quebra do determinismo.

---

### Problema 5: O Paradoxo da Criação (O Código que Ainda Não Existe)
* **O Dilema:** Uma demanda frequente em engenharia não é modificar código existente, mas **criar uma nova funcionalidade** (ex: *"Criar suporte a estornos parcelados em `src/ledger/installment_reversal.ts`"*).
* **A Armadilha:**
  * O arquivo alvo (`src/ledger/installment_reversal.ts`) **não existe fisicamente** em `src/`.
  * Nenhum BM25 ou tabela de símbolos encontrará o arquivo porque ele é futuro.
  * No entanto, a IA precisa conhecer os contratos existentes (interfaces de estado, classes de erro, tipos de liquidação) para que o novo arquivo se conecte perfeitamente ao ecossistema existente sem inventar convenções alienígenas.

---

### Problema 6: Dependências Ocultas e Arquiteturas Desacopladas
* **O Dilema:** O código de um sistema moderno raramente está conectado por `import` estático e direto.
* **A Armadilha dos Desacoplamentos:**
  * **Event-Driven:** O módulo A emite um evento no barramento; o módulo B reage a ele. Não há `import` de B em A.
  * **Injeção de Dependência:** Interfaces desacopladas instanciadas em runtime por contêineres IoC.
  * **Configuração e Banco:** Tabelas SQL, migrations e schemas YAML que definem limites que o código TypeScript apenas consome.
* **A Falha Mecânica:** Qualquer algoritmo mecânico que siga o grafo de arquivos estáticos falha em perceber que mexer no módulo A quebra o contrato invisível do módulo B.

---

### Problema 7: O Pesadelo Poliglota e a Manutenção da AST
* **O Dilema:** O Aegis nasceu para ser um harness agnóstico e parsimonioso ([`CONST-KISS`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/AGENTS.md#L5)).
* **A Armadilha da Sobre-Engenharia:**
  * Se resolvermos a extração de código construindo analisadores profundos de AST, precisaremos manter parsers nativos para cada linguagem que o repositório adotar: TypeScript, Python, Go, Rust, Java, SQL, Shell script.
  * Cada nova versão sintática (ex: nova sintaxe de decorators no TS ou match/case no Python) quebrará o parser do Harness.
  * O Harness se transforma em um compilador mastodôntico, violando o princípio fundamental da Parcimônia.

---

### Problema 8: O Efeito de Ancoragem Humana (*Rubber-Stamping* no Wizard)
* **O Dilema:** O Aegis protege a governança travando a execução quando há ambiguidade e chamando o humano no Wizard.
* **A Falha de Comportamento Humano:**
  * Quando a ferramenta gera perguntas técnicas longas com uma opção marcada como `(Recommended)`, o desenvolvedor sob pressão de prazo tende a **apenas dar Enter**.
  * A "decisão humana soberana" corre o risco de virar um mero teatro de conformidade (*security theater*), onde a IA continua decidindo indiretamente via viés de recomendação.

---

## 3. Matriz de Requisitos para uma Solução Válida

Qualquer evolução no mecanismo de descoberta do Aegis **só é aceita** se responder satisfatoriamente a esta matriz:

| Vetor de Exigência | Critério de Aceitação Inegociável | O que reprova a solução |
| :--- | :--- | :--- |
| **1. Parsimônia ([`CONST-KISS`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/AGENTS.md#L5))** | Não introduzir compiladores poliglotas pesados nem orquestrações de múltiplos agentes. | Soluções que exigem bibliotecas nativas de C++ (tree-sitter completo para 10 linguagens). |
| **2. Falsificabilidade ([`CONST-OBSERVABLE`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/AGENTS.md#L21))** | Toda evidência entregue à IA deve possuir certidão de nascimento física atestável (hash + linha). | Entregar resumos livres ou "memórias" da IA sem proveniência direta no arquivo. |
| **3. Imunidade à Alucinação** | A IA deve ser impedida de inventar constantes e guardas fora do catálogo de fatos. | Permitir que o modelo assuma valores padrão sem autorização expressa da demanda. |
| **4. Tolerância a Sinônimos** | Demandas em linguagem natural informal devem localizar os arquivos reais sem exigir palavras exatas do código. | Bloquear ou zerar o resultado se o usuário escrever "estornar" em vez de "reverseSettlement". |
| **5. Operação Offline e Custo Zero no Preflight** | A auditoria básica e a verificação do repositório devem rodar sem obrigatoriedade de API externa paga. | Fazer o comando `./aegis --verify` ou preflight depender de conexão com internet para funcionar. |

---

## 4. Julgamento do Advogado do Diabo sobre as Propostas Teóricas

Antes de qualquer alteração de código, confrontamos as alternativas teóricas com o crivo adversarial:

1. **Tentativa de Usar LLM para Traduzir Vocabulário de Negócio:**
   - *Veredito do Advogado do Diabo:* **REJEITADO.** Introduz jitter estocástico e dependência de rede no preflight. O mesmo commit geraria hashes diferentes de request, destruindo o determinismo exigido por [`CONST-OBSERVABLE`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/AGENTS.md#L21).
2. **Tentativa de Criar Dicionários Manuais em `architecture.policy.json` (`evidenceAnchors`):**
   - *Veredito do Advogado do Diabo:* **REJEITADO.** Cria burocracia manual, invalida o SHA-256 amarrado em `ARCHITECTURE.md` e altera schemas Ajv compilados sem necessidade. Viola [`CONST-KISS`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/AGENTS.md#L5).
3. **Tentativa de Rastrear Imports Transitivos em Grafo Profundo (1-hop/2-hop crawler):**
   - *Veredito do Advogado do Diabo:* **REJEITADO.** O efeito dominó de barrels (`index.ts`) em monorepos corporativos traria 80% do repositório, estourando o limite de 32 KB e forçando truncamentos arbitrários.
4. **Tentativa de Suprimir a Recomendação no Wizard TTY:**
   - *Veredito do Advogado do Diabo:* **REJEITADO.** O artigo [`CONST-DECISIONS`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/AGENTS.md#L15) exige explicitamente que o modelo apresente a recomendação justificada mais parsimoniosa. A análise forense do código provou que o sistema **já possui a trava anti-acidente**: a pergunta de confirmação final (`ide_gateway.sh`) usa `[s/N]` (default `N`), de modo que dar Enter sem digitar expressamente `s` **cancela a operação e nada é selado**.

---

## 5. Resoluções Implementadas no Core do Aegis

Com base nas evidências, foram implementadas soluções 100% mecânicas, determinísticas e parsimoniosas em [`scripts/lib/semantic_request.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_request.mjs):

### Resolução 1: Matching Aumentado por JSDoc e Subtokens de Caminho (Resolve Problema 1)
* **Mecanismo:**
  - O analisador de AST ([`workspace_skeleton.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/workspace_skeleton.mjs)) já extraía docstrings JSDoc (`docComment`) de funções, interfaces e constantes.
  - Atualizamos [`matchSkeletonSymbols`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_request.mjs#L122) e [`computeSymbolAffinity`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_request.mjs#L198) para cruzar a intenção humana contra:
    1. **Identificador do símbolo (`sym.name`):** Pontuação dominante (+3 exato / +2 stem).
    2. **Subtokens do caminho (`sym.path`):** Afinidade de módulo e pasta (+2 exato / +1 stem).
    3. **Comentários de documentação JSDoc (`sym.docComment`):** Captura de sinônimos em linguagem natural (+2 exato / +1 stem).
  - Comentários com `@deprecated` continuam penalizados em -300 pontos para evitar iscas de legado.
* **Prova Falsificável:** Validado pelo teste **`TEST-118`** em [`scripts/substrates/test/test_field_lifecycle.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/substrates/test/test_field_lifecycle.mjs), onde uma demanda com o termo informal *"estorno"* localiza a função técnica `processUndo` exclusivamente pela docstring em português.

### Resolução 2: Ancoragem Automática por Diretório Irmão (Resolve Problema 5)
* **Mecanismo:**
  - Em [`scripts/lib/semantic_request.mjs:buildSourceEvidence`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_request.mjs#L329), se a demanda menciona um caminho que ainda não existe no disco (ex.: `src/ledger/installment_reversal.ts`) ou palavras correspondentes a subpastas conhecidas de `src/` (`ledger`, `risk`, `reporting`):
  - O Harness identifica o diretório-alvo e seleciona automaticamente os **arquivos irmãos existentes** no mesmo módulo (`src/ledger/settlement_engine.ts`, `src/ledger/fee_calculator.ts`).
  - O novo código nasce conhecendo os tipos, padrões e modelos do módulo onde vai se integrar, eliminando o fallback cego para arquivos aleatórios.
* **Prova Falsificável:** Validado pelo teste **`TEST-117`** em [`scripts/substrates/test/test_field_lifecycle.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/substrates/test/test_field_lifecycle.mjs), onde um arquivo inexistente é citado e os irmãos do módulo são entregues com sucesso como contexto estruturado.

### Resolução 3: Esqueleto AST com Corpos Despojados + Cabeçalho Estrutural (Resolve Problemas 2, 3 e 4)
* **Mecanismo:**
  - O [`buildWorkspaceSkeleton`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/workspace_skeleton.mjs#L348) usa a TypeScript Compiler API oficial para emitir contratos públicos com corpos vazios (`stripped bodies`), reduzindo o volume de tokens em mais de 75%.
  - O [`findStructuralHeaderEndLine`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_request.mjs#L93) garante que interfaces e types nas primeiras 150 linhas de um arquivo grande nunca sejam cortados pela janela deslizante.
  - O teto global de 32 KB e 8 KB por arquivo previne estouros de contexto em monorepos sem perder os entrypoints e contratos vitais.

---

## 6. Matriz Consolidada de Fechamento dos 8 Problemas

| Problema Estrutural | Abordagem Adotada no Aegis | Prova / Teste Falsificável | Status Atual |
| :--- | :--- | :--- | :---: |
| **P1: Abismo Semântico** | Tokenização de JSDoc (`docComment`) + subtokens do caminho do arquivo (`sym.path`). | `TEST-118` em `test_field_lifecycle.mjs` | **RESOLVIDO** |
| **P2: Dilema de Goldilocks** | Esqueleto AST (assinaturas sem corpos) + janelas focadas de 8 KB com teto global de 32 KB. | `TEST-114` e `TEST-115` | **RESOLVIDO** |
| **P3: Fronteira Sintática** | Preservação compulsória do cabeçalho de tipos/interfaces (`findStructuralHeaderEndLine`). | `TEST-115` em `test_field_lifecycle.mjs` | **RESOLVIDO** |
| **P4: Falácia da Escala** | Priorização determinística por afinidade (`computeSymbolAffinity`) limitada a 512 símbolos. | Benchmark D11 (`src/` > 32 KB) | **RESOLVIDO** |
| **P5: Paradoxo da Criação** | Directory Anchor Fallback: injeção mecânica dos arquivos irmãos do diretório pretendido. | `TEST-117` em `test_field_lifecycle.mjs` | **RESOLVIDO** |
| **P6: Dependências Ocultas** | Contexto do módulo entregue via Directory Anchors + validação fail-closed de guardas/erros. | `TEST-109` e `TEST-117` | **MITIGADO (KISS)** |
| **P7: Pesadelo Poliglota** | Delegação direta para o parser nativo da linguagem (TypeScript API) sem compiladores extras. | `test_workspace_skeleton.mjs` | **BLINDADO** |
| **P8: Ancoragem Humana** | Confirmação final estrita com `[s/N]` (default `N` que aborta por Enter) + `Dado/Quando/Então`. | `test_issue_contract.sh:758` | **BLINDADO** |

---

## 7. O Teste de Estresse Extremo em Monorepo Real (Injeção do Projeto Askesis - 204 Arquivos)

Para provar a robustez do Aegis em ambiente de produção sem dados sintéticos, injetamos um projeto real completo dentro de `src/`: o PWA de hábitos **Askesis** (204 arquivos de React/TypeScript, 1.562 símbolos na AST, ~2.4 MB de código-fonte).

### 7.1. O Choque de Realidade: A Primeira Rodada Adversarial
Submetemos uma demanda em português bancário livre:
> *"Permitir estornar a liquidação financeira no histórico da conta preservando o teto diário de cinquenta mil reais e validando as guardas de segurança antifraude, registrando o evento no log de auditoria."*

**Resultado Inicial:**
* Tempo de processamento Discovery (210 arquivos): **269 ms**
* Arquivos do Ledger entregues no corte de 32 KB: **0**
* Arquivos do Askesis entregues: **10**
* **Taxa de Contaminação:** **100% de ruído!**

### 7.2. As 4 Armadilhas Fatais Diagnosticadas (Advogado do Diabo)
1. **O Cavalo de Troia dos Comentários em Português vs. Código em Inglês:**  
   O código bancário do Ledger estava em inglês (`SettlementItem`, `DAILY_SETTLEMENT_LIMIT_CENTS`, `evaluateSettlementGuards`). O Askesis continha longos JSDocs filosóficos em português com palavras como *"teto"*, *"segurança"*, *"conta"* e *"evento"*. O algoritmo mecânico atribuiu nota máxima a símbolos de RPG e quests, enquanto o motor financeiro recebeu nota baixa porque a demanda não continha a palavra exata em inglês (`settlement`).
2. **O Falso Positivo Sintático do `src`:**  
   Ao especificar a pasta `src/ledger`, um script utilitário (`update-test-inventory.js`) saltou para o 1º lugar porque continha uma variável local privada `const src = fs.readFileSync(...)`. A palavra `src` (da pasta) coincidiu com o nome da constante local.
3. **A Falácia da Busca Plana em Monorepos:**  
   Sem delimitação de fronteira (*Bounded Context* / módulo raiz), termos de domínio comuns como *"conta"* e *"log"* existem em dezenas de pastas com significados totalmente diferentes.
4. **As Regras Invisíveis Fora do Código:**  
   O código TypeScript não é o sistema completo. Trava de saldo (`CHECK balance >= 0`), chaves estrangeiras, locks distribuídos no Redis e variáveis de ambiente moram em SQL, `.env` ou migrações. Se o Harness olhar exclusivamente para `src/*.ts`, entrega um mundo parcial para a IA.

### 7.3. As Blindagens Implementadas no Core do Aegis
Em obediência estrita aos princípios **CONST-KISS** e **CONST-OBSERVABLE**, implementamos 5 blindagens determinísticas em [`scripts/lib/semantic_request.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_request.mjs):
1. **Regra Anti-Sequestro de DocComment:** Comentários JSDoc só pontuam se o símbolo possuir afinidade estrutural prévia (correspondência no identificador do símbolo ou no caminho do módulo). Símbolos com score estrutural zero não ganham pontos por comentários narrativos.
2. **Casamento de Palavra Inteira (Whole-Token Matching):** Substituição de `includes` por verificação de token isolado, eliminando colisões de substring (como `src` dentro de `src/ledger`).
3. **Supressão de Stopwords de Contêiner:** Termos de infraestrutura de repositório (`src`, `source`, `root`, `file`) são expurgados do vocabulário de domínio de símbolos.
4. **Priorização da Superfície Pública Observável (`exported: true`):** Interfaces, tipos e funções exportadas recebem bônus de prioridade sobre variáveis e funções privadas locais.
5. **Priorização Precoce de Diretórios-Alvo:** Diretórios explicitamente citados na demanda (`src/ledger`, `src/risk`) recebem prioridade máxima imediata na montagem da evidência física, garantindo que o orçamento de 32 KB capture primeiro os arquivos do módulo antes de qualquer busca dispersa.
6. **Penalização de Testes e Scripts Internos:** Arquivos em `/tests/`, `*.test.ts`, `*.spec.ts` e `/scripts/` recebem penalidade de relevância para não poluírem a especificação de produto.

### 7.4. Resultado Pós-Blindagem
Ao submeter a demanda com ancoragem de módulo (`src/ledger`, `src/risk`), a evidência física entregue para a IA foi:
* **#1:** `src/ledger/fee_calculator.ts` (✓ LEDGER)
* **#2:** `src/ledger/settlement_engine.ts` (✓ LEDGER)
* **#3:** `src/risk/velocity_guard.ts` (✓ LEDGER)
* **#4:** `src/index.ts` (✓ LEDGER)

Os arquivos do Ledger capturaram os primeiros lugares da evidência em **< 300 ms**, com 100% dos testes do repositório (`npm test`, 118 testes) validados e aprovados.

---

### 7.5. Expansão para 64 KB & O Critério de Corte por Relevância Residual

Ao expandir o orçamento máximo de `32 KB` para `64 KB` (`sourceEvidenceByteLimit = 65_536`) em [`semantic_authority.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_authority.mjs), descobrimos o **Efeito do Balde Maior**:
* Em subsistemas grandes e interdependentes (como as notificações do *Askesis* com 6 arquivos e 30 KB), o limite de 64 KB permitiu entregar todos os arquivos úteis completos e sem truncamentos.
* Em subsistemas compactos (como o *Ledger*, que só possui ~12 KB de código), um balde fixo de 64 KB forçava o Harness a continuar lendo 15 arquivos irrelevantes de outros módulos para preencher a cota vazia.

#### A Solução: Critério de Corte por Relevância Residual
Implementamos em [`scripts/lib/semantic_request.mjs:buildSourceEvidence`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/semantic_request.mjs#L440-L530):
1. **Confinamento de Escopo por `targetDirs`:** Quando a demanda declara módulos-alvo (ex: `src/ledger`, `src/risk`), arquivos de subprojetos alheios são terminantemente descartados da evidência física.
2. **Piso Residual de Relevância:** Se o topo da AST possui alta afinidade (`topScore >= 6.0`), símbolos com pontuação residual (< 40% do pico ou piso absoluto de 3.0) são descartados, evitando que correspondências casuais arrastem arquivos indesejados.
3. **Parada Inteligente (Sem Enchimento Forçado):** O Harness não força o preenchimento de 64 KB. Quando os arquivos úteis do escopo acabam, a coleta encerra imediatamente.

**Resultado do Confronto:**
* **Ledger + Risk (64 KB com Corte Residual):** Entregou exatamente **4 arquivos (12.880 bytes / 100% úteis, 0% sobra)** em vez de 18 arquivos e 56 KB de ruído.
* **Reporting CSV (64 KB com Corte Residual):** Entregou exatamente **3 arquivos (9.477 bytes / 86.3% úteis)** em vez de 13 arquivos e 57 KB de ruído.
* **Notificações Askesis (64 KB com Corte Residual):** Entregou todos os **6 arquivos do subsistema completos (30.7 KB)** com 100% de cobertura.

---

### 7.6. Eliminação dos 3 Pontos Cegos Críticos (Constituição e Pragmatismo KISS)

Em alinhamento rigoroso à Constituição Aegis (`CONST-KISS`, `CONST-EVIDENCE`, `CONST-DECISIONS`, `CONST-OBSERVABLE`), foram eliminados os 3 pontos cegos arquiteturais do mecanismo de evidência:

1. **Garantia de Piso Multi-Módulo (Multi-Module Floor Guarantee):**
   * *Problema Anterior:* Em demandas citando múltiplos módulos (ex: `src/ledger` e `src/reporting`), o pico pontual de um módulo (score 25) gerava um corte residual de 40% (10.0) que aniquilava todos os arquivos do segundo módulo citado (score 7.0).
   * *Solução KISS Implementada:* Cada pasta declarada no escopo autorizado (`targetDirs`) tem a garantia de preservação do seu melhor arquivo representante (`isTopForTargetDir`), impedindo canibalização entre módulos autorizados.

2. **Corte por Pressão de Orçamento (Budget-Driven Cutoff):**
   * *Problema Anterior:* O corte de 40% era implacável mesmo quando todos os arquivos relevantes somados ocupavam apenas 10 KB da cota disponível de 64 KB, causando descarte prematuro de arquivos úteis com relevância moderada.
   * *Solução KISS Implementada:* O corte agressivo de 40% só é acionado quando a estimativa de bytes dos candidatos ultrapassa a cota física de 64 KB (`underBudgetPressure`). Sem pressão de cota, o sistema aceita arquivos com pontuação moderada ($\ge 2.0$), descartando apenas ruído espúrio.

3. **Léxico Declarativo de Domínio (.harness/domain-lexicon.json):**
   * *Problema Anterior:* Demanda em Português sem caminhos explícitos ("estorno de liquidação") não coincidia com código em Inglês (`settlement_reversal.ts`), resultando em zero casamentos e viés cego para entrypoints raiz.
   * *Solução KISS Implementada:* Mapeamento declarativo leve em `.harness/domain-lexicon.json` (ou `.harness/config/lexicon.json`). O extrator de símbolos e subpastas consulta o léxico sem dependência de rede, sem modelos neurais pesados e com 0 ms de overhead, garantindo determinismo total.
   * *Alerta de Silêncio Léxico:* Quando a demanda não possui nenhuma sobreposição léxica com os símbolos da árvore e nenhum módulo é citado, o Harness emite aviso explícito e transparente no briefing, convocando a decisão do usuário em conformidade com `CONST-DECISIONS`.

Todos os comportamentos foram cobertos e blindados por testes unitários e de integração (`TEST-119`, `TEST-120`, `TEST-121`), mantendo 100% de aprovação na suíte de 121 testes.

---

### 7.7. Adaptive Semantic Scout (Arbiter Condicional)

Para bases de código de grande porte onde ocorre **Silêncio Léxico genuíno** (demanda em Português sem caminhos explícitos e sem termos coincidentes na AST em Inglês), foi integrado o **Adaptive Semantic Scout** (`scripts/lib/semantic_scout.mjs`), operando estritamente no adaptador de supervisor sem quebrar o determinismo do core local ([`ARCH-LOCAL-DETERMINISTIC-CORE`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/governance/architecture.policy.json#L44-L49)).

#### 1. Os 3 Guardiões de Custo Zero (Proteção Contra Chamadas Desnecessárias)
O Scout é bloqueado imediatamente (custo **$0.00**, latência **0 ms**) se qualquer uma das condições abaixo for verdadeira:
1. **Guardião Greenfield (`EMPTY_SOURCE`):** Se `src/` está vazio, a demanda é para criar código novo do zero; não há o que buscar.
2. **Guardião do Repositório Compacto (`smallWorkspace` $\le 64\text{ KB}$):** Se todo o repositório cabe em 64 KB, o Harness já entrega 100% dos arquivos na íntegra (`FULL_SOURCE`).
3. **Guardião do Esqueleto Vazio (`symbolCount === 0`):** Se não há símbolos estruturais extraídos, não há base para avaliação.
4. **Guardião de Correspondência Existente:** Se houver qualquer casamento léxico ou diretório explícito (`targetDirs.size > 0`).

#### 2. Validação Física Fail-Closed (Anti-Alucinação)
Qualquer caminho sugerido pela IA é filtrado estritamente contra os arquivos observados fisicamente (`observedTextPaths`). Caminhos alucinados, fora de `src/` ou inexistentes são descartados sem exceção (`filterPhysicalPaths`).

#### 3. Cobertura de Testes Dedicada & Eliminação de Pontos Cegos do Scout
Foi criada a suíte [`scripts/substrates/test/test_semantic_scout.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/substrates/test/test_semantic_scout.mjs) com 10 testes automatizados cobrindo os guardiões, a ativação no silêncio léxico, a filtragem física, a resiliência a falhas de rede e as 3 melhorias críticas do Advogado do Diabo:
1. **Amostragem Estrutural Panorâmica (Sem Viés Alfabético):** `buildTopographicalMap` agrupa até 2 símbolos exportados por arquivo de toda a árvore de `src/`, garantindo que arquivos posteriores no alfabeto (ex: `src/ledger` e `src/risk` após centenas de arquivos de `src/askesis`) sejam visíveis ao Scout em menos de 4 KB de JSON.
2. **Hidratação de Linhas de Símbolos:** Arquivos descobertos pelo Scout populam `lines` com os `startLine` reais dos símbolos exportados via `workspaceSkeleton`, ativando janelas focadas (`LEXICAL_WINDOW`) em vez de cabeçalhos genéricos (`ENTRYPOINT_PREFIX`).
3. **Auto-Lexicon Persistente:** Mapeamentos conceituais inferidos pela IA (`inferredAliases`) são automaticamente consolidados em `.harness/domain-lexicon.json`. As execuções seguintes da mesma intenção são promovidas permanentemente para o **Fast-Path determinístico (0 ms, $0.00, offline)**.

---

### 7.8. Expurgo e Purificação dos Resíduos do BM25 Legado

Com a estabilização completa do **Workspace Skeleton (AST Tipado)** no preflight v3, realizamos a limpeza integral de todos os resíduos sintáticos e estruturais do antigo algoritmo BM25 (`hybrid_source_index.mjs`):

1. **Purificação do Schema de Governança (`preflight-handoff.v3`):**  
   Removida a definição residual da propriedade opcional `lexicalEvidence` (que referia o método `HYBRID_BM25_IDENTIFIER_V2`), tornando o schema v3 100% estrito aos metadados do `workspaceSkeleton`. Validadores Ajv foram devidamente recompilados.
2. **Eliminação de Aliases Obsoletos (`issue_contract_core.mjs`):**  
   Removidos os re-exports e parâmetros mortos `isReusableHybridSourceIndex`, `cachedSourceIndex` e o alias `sourceIndex: workspaceSkeleton`.
3. **Limpeza do Pipeline de Evidência (`semantic_request.mjs`):**  
   Eliminado o loop de fallback para `lexicalEvidence?.matches` na montagem da evidência física de código, mantendo apenas o matching estrutural por nós de AST e âncoras de diretório.
4. **Alinhamento do Árbitro e do Runner CLI (`semantic_scout.mjs` e `issue_contract_runner.mjs`):**  
   A detecção de casamento direto foi atualizada para inspecionar a presença real de recortes focados (`selection: 'LEXICAL_WINDOW'`) derivados do AST Skeleton, eliminando referências fantasmas a contagens de casamentos léxicos legados.


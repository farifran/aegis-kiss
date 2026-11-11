# Dossiê Adversarial: Os Problemas da Descoberta e Entrega da Verdade de Terreno (`src/` $\rightarrow$ IA)

> **Documento de Diagnóstico Crítico (Advogado do Diabo)**  
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

Abaixo estão enumerados os **8 problemas estruturais** que qualquer solução precisa enfrentar e resolver.

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
  * Diante da ausência de uma constante explícita, a IA **não para**: ela assume um valor padrão padrão de mercado (ex: teto de `500000000` centavos).
* **Cenário B: Ruído (Contexto Gigante / "Lost in the Middle")**
  * Se enviarmos 30 arquivos inteiros (100.000 tokens), o mecanismo de atenção do transformador prioriza o topo e a base do prompt.
  * Uma guarda vital de 2 linhas no meio do 14º arquivo (`if (streak >= 5) reject()`) é simplesmente ignorada pela IA.

---

### Problema 3: A Falácia da Fronteira Sintática (Onde Cortar o Código?)
* **O Dilema:** Código-fonte não é uma lista plana de parágrafos; é um grafo de dependências entrelaçadas.
* **Corte por Janela de Linhas (Atual no BM25):**
  * Cortar 20 linhas ao redor de um match corta métodos no meio, perde anotações de decorators e omite o cabeçalho de imports.
* **Corte por Arquivo Inteiro:**
  * Traz centenas de linhas de código utilitário irrelevante, diluindo a atenção do modelo.
* **Corte por Nós de AST (Tabela de Símbolos):**
  * Se o corte for estrito aos exports da AST, torna-se **completamente cego** para a lógica interna de funções privadas, constantes locais (`const BUFFER = 100`) e regras documentadas apenas em comentários.

---

### Problema 4: A Falácia da Escala (Do Repositório de Teste ao Monorepo Real)
* **O Dilema:**
  * Em um repositório de teste (como o de benchmark atual com 3 arquivos em `src/`), ler tudo em RAM e hashear leva 5ms. É tentador achar que "está resolvido".
  * Em um microsserviço corporativo real com 400 arquivos, 5.000 funções e 80.000 linhas de código, **não é viável enviar tudo**.
* **O Retorno ao Ponto de Partida:**
  * Se não podemos enviar tudo, somos obrigados a ranquear/filtrar.
  * Se ranqueamos por texto, caímos no Problema 1 (abismo semântico).
  * Se ranqueamos por IA, caímos na quebra do determinismo.

---

### Problema 5: O Paradoxo da Criação (O Código que Ainda Não Existe)
* **O Dilema:** Uma demanda frequente em engenharia não é modificar código existente, mas **criar uma nova funcionalidade** (ex: *"Criar suporte a estornos parcelados"*).
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
* **O Dilema:** O Aegis nasceu para ser um harness agnóstico e parsimonioso ([`CONST-KISS`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/AGENTS.md)).
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

Qualquer evolução futura no mecanismo de descoberta do Aegis **só será aceita** se responder satisfatoriamente a esta matriz:

| Vetor de Exigência | Critério de Aceitação Inegociável | O que reprova a solução |
| :--- | :--- | :--- |
| **1. Parsimônia ([`CONST-KISS`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/AGENTS.md))** | Não introduzir compiladores poliglotas pesados nem orquestrações de múltiplos agentes. | Soluções que exigem bibliotecas nativas de C++ (tree-sitter completo para 10 linguagens). |
| **2. Falsificabilidade ([`CONST-OBSERVABLE`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/AGENTS.md))** | Toda evidência entregue à IA deve possuir certidão de nascimento física atestável (hash + linha). | Entregar resumos livres ou "memórias" da IA sem proveniência direta no arquivo. |
| **3. Imunidade à Alucinação** | A IA deve ser impedida de inventar constantes e guardas fora do catálogo de fatos. | Permitir que o modelo assuma valores padrão sem autorização expressa da demanda. |
| **4. Tolerância a Sinônimos** | Demandas em linguagem natural informal devem localizar os arquivos reais sem exigir palavras exatas do código. | Bloquear ou zerar o resultado se o usuário escrever "estornar" em vez de "reverseSettlement". |
| **5. Operação Offline e Custo Zero no Preflight** | A auditoria básica e a verificação do repositório devem rodar sem obrigatoriedade de API externa paga. | Fazer o comando `./aegis --verify` ou preflight depender de conexão com internet para funcionar. |


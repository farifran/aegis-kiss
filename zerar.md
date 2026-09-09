# Master Plan de Limpeza e Modernização Simbiótica: zerar.md

---

## 1. Manifesto e Propósito da Branch `experiment/issue-centric-flow`

Esta branch foi criada como um **laboratório de isolamento total**. Nela, removemos a sobre-engenharia burocrática herdada da branch `main` e implementamos a nova arquitetura simbiótica do Aegis, onde:

1. **A demanda informal deixa de ser uma relíquia sagrada:** O prompt do usuário é apenas o catalisador inicial.
2. **A Issue e o Contrato tornam-se a mesma coisa:** Uma única entidade com duas projeções (Markdown para o humano ler e editar; JSON canônico para a máquina auditar e assinar).
3. **O Discovery em memória (Camada 0) torna-se o único oráculo:** Acabam as buscas pontuais por regex; a árvore Git é lida para a RAM em 20 ms.
4. **A simbiose Humano-IA atinge o padrão ouro:** A IA assume todo o trabalho pesado de inferência antecipada e entrega a Issue pré-cozinhada com decisões recomendadas já marcadas, permitindo aprovação humana em 1 clique.
5. **O código de produto em `src/` é 100% zerado:** A branch opera a partir de uma tela em branco pura para testar a nova esteira sem interferência de códigos anteriores.

---

## 2. O Novo Paradigma da Simbiose Humano-IA

```mermaid
flowchart TD
    Prompt["1. Prompt Informal do Usuário\n(com erros, ideias soltas e armadilhas)"]
    Disc["2. Discovery na RAM (20 ms)\n(árvore git, símbolos, ARCHITECTURE.md)"]

    Prompt --> AI["3. INFERÊNCIA PROATIVA & SANEAMENTO DA IA"]
    Disc --> AI

    subgraph AI ["Trabalho Pesado da IA (Pre-baking)"]
        AI --> A1["Correção Semântica e Gramatical"]
        AI --> A2["Filtro Anti-Sobre-engenharia (AGENTS.md -> KISS)"]
        AI --> A3["Filtro Arquitetural (ARCHITECTURE.md -> Erro Explícito)"]
        AI --> A4["Seleção Otimista das Recomendações Ótimas"]
        AI --> A5["Redação da Issue-Contrato Completa"]
    end

    A5 --> Gate{"4. LOOP DE APROVAÇÃO HUMANA"}

    Gate -- "Concorda com as Recomendações (1 Clique)" --> Commit["5. HASH RAIZ ÚNICO (contractDigest)\n& Execução de Código e Provas"]
    Gate -- "Muda Opção (ex: Opção B)" --> Patch["IA Aplica Patch Cirúrgico na Issue"]
    Patch --> Commit
```

### 2.1. O que a IA Resolve Antecipadamente
* **Tolerância a Ruído:** Entende textos com erros ortográficos, concordância quebrada ou abreviações.
* **Preenchimento de Lacunas:** Deduz a intenção de negócio real sem interromper o fluxo por detalhes óbvios.
* **Anti-Sobre-engenharia (`AGENTS.md`):** Converte pedidos de *factories*, *event-emitters* e injeção de dependência em código plano, direto e sem abstrações desnecessárias (Protocolo Karpathy).
* **Conformidade com `ARCHITECTURE.md`:** Veta capturas silenciosas de erro (`ARCH-FAILURE-EXPLICIT`) e proíbe relógios ocultos como `Date.now()` (`ARCH-DETERMINISTIC-TIME`).
* **Geração Otimista com Decisões Pré-Marcadas:** Para cada escolha de negócio em aberto, a IA **já adota a recomendação mais segura e já monta a Issue completa assumindo essa escolha**, destacando os seletores para o humano.

### 2.2. A Unificação: Duas Faces da Mesma Moeda
* **Face Humana (`contract.md`):** Visualizada e editada diretamente na IDE (títulos, escopo, requisitos em bullets, checkboxes de aceitação).
* **Face Máquina (`contract.json`):** O mesmo documento em JSON canônico (RFC 8785) com tipagem estrita, invariantes e IDs de falha.
* O **Hash Raiz Único** (`contractDigest = SHA-256(JSON)`) é gerado no momento do aceite humano.

---

## 3. O que Será APAGADO / ZERADO (Inventário de Limpeza)

Para isolar o laboratório, eliminamos quase **1.000 linhas de código legado (~25% do harness)**:

### 3.1. Schemas JSON Deletados Fisicamente
1. ❌ `governance/schemas/normalized-demand.v2.schema.json` (47 linhas)
2. ❌ `governance/schemas/clarified-demand.v2.schema.json` (93 linhas)
3. ❌ `governance/schemas/clarified-demand-body.v2.schema.json` (15 linhas)

### 3.2. Código Deletado em `scripts/lib/preflight_core.mjs` (~270 linhas)
1. ❌ Função `normalizeDemand()` antiga com geração de array `units: [{ id: 'UNIT-0001', range: { startByte, endByte } }]`.
2. ❌ Lógica de `extractUnits()` e cálculo de byte-ranges em loops de texto.
3. ❌ Lógica de `extractReferences()` pontual por regex (absorvida 100% pelo Discovery na RAM).
4. ❌ Identidade de execução `executionId()` atrelada ao hash do prompt cru.

### 3.3. Código Deletado em `scripts/finalize_preflight.mjs` (~350 linhas)
1. ❌ Funções `unitIdsInEnvelope()` e `requireIndexes()`.
2. ❌ Função `hasVerbatimUnitEvidence()` (policiamento de cópia literal de palavras).
3. ❌ Tabela de `inputCoverage` (`unitId -> disposition -> requirementIds`).
4. ❌ Bloqueios de `normalized_demand_digest_mismatch`.

### 3.4. Simplificações em `scripts/ide_gateway.sh` (~100 linhas)
1. ❌ Eliminar a obrigação de reenviar a mesma string de demanda textual em cada subcomando.
2. ❌ Substituir subcomandos fragmentados por um fluxo coeso: `./aegis "<prompt>"` $\to$ `./aegis approve`.

### 3.5. O Diretório de Produto (`src/`) Fica 100% Zerado
* Toda e qualquer implementação de regras de negócio anteriores (`ledger.ts`, `isolation.ts`, `fees.ts`, `health.ts`, `orderBus.ts` e provas antigas) **foi totalmente removida**.
* O diretório `src/` contém exclusivamente o ponto de partida inicial vazio:
  ```typescript
  // src/index.ts
  export {};
  ```
* O ambiente fica limpo para testar novas demandas do zero.

---

## 4. O que Será PRESERVADO e MANTIDO INTACTO (A Infraestrutura do Aegis)

Nenhuma garantia de correção matemática ou segurança estática é tocada:

| Componente Preservado | Localização | Papel no Sistema |
| :--- | :--- | :--- |
| **Portões Estáticos (Static Gate)** | `scripts/substrates/static_gate.sh`, `npm run aegis:*` | Banimento de floats (BigInt puro), Zero-GC em hot-paths, ESLint e TypeScript estrito. |
| **Ponto de Entrada Canônico** | `src/index.ts` | Ponto de exportação nominal inicial vazio sob padrão ESM estrito (`.js`). |
| **Auditoria Red Team (7 Classes)** | `scripts/formal_promotion_authorization.sh` | Validador adversarial de atomicidade, tempo, limites e continuidade. |
| **Recibos Criptográficos de Commit** | `.git/aegis/precommit_receipt.json` e hooks do Git | Garantia de que nenhum commit entra no repositório sem prova formal prévia. |
| **Constituição e Políticas** | `AGENTS.md`, `governance/policies/` | Leis do projeto (`ARCH-FAILURE-EXPLICIT`, `ARCH-DETERMINISTIC-TIME`). |
| **Motor de Discovery da Camada 0** | `scripts/lib/preflight_core.mjs` (`discoverRepository`) | Varredura em memória da árvore Git (`git ls-tree`), que agora se torna a fonte exclusiva de fatos. |

---

## 5. Roteiro de Implementação nesta Branch (Passo a Passo)

A execução nesta branch seguirá a seguinte sequência controlada:

1. **Passo 1: Criação do Schema Único da Issue-Contrato:**
   * Criar `governance/schemas/issue-contract.v1.schema.json` unificando requisitos, escopo, invariantes e provas.
2. **Passo 2: Poda dos Schemas Legados:**
   * Excluir os 3 schemas obsoletos de demanda e cobertura.
3. **Passo 3: Refatoração do Motor de Pré-Cozimento (Preflight Core):**
   * Integrar o Discovery na RAM para gerar diretamente a Issue-Contrato com seletores pré-marcados.
4. **Passo 4: Adaptação do Gateway CLI (`./aegis`):**
   * Simplificar a interface de linha de comando para suportar `./aegis "<ideia>"` e `./aegis approve`.
5. **Passo 5: Teste de Validação Ponta a Ponta com Nova Demanda:**
   * Rodar um teste real do zero em `src/`, confirmando que a Issue gera o hash único, implementa o código, passa nas provas físicas e comita com `postcommit=PROVEN`.

# Target Project Architecture (`ARCHITECTURE.md`)

Diretrizes exclusivas do projeto alvo e Constituição Operacional do **Aegis Harness**.

---

## 🏛️ Os 5 Princípios Universais do Aegis Harness

> *"O foco central deve ser transformar o Aegis de um sistema que avalia código em um sistema que exige provas de correção das transições de estado sob composição, tempo e falha."*

### 1. Contrato → Invariantes → Provas
Toda demanda é convertida explicitamente em:
* Entidades e estado canônico;
* Pré-condições e pós-condições estritas;
* Invariantes globais de conservação e validade;
* Unidades e semântica pura sem contaminação de domínios anteriores;
* Comportamentos estritamente proibidos;
* Critérios de observabilidade pública.
**Regra de Ouro:** Nada deve ser implementado sem rastreabilidade bidirecional para o contrato.

### 2. Estado Projetado Antes da Mutação
A validação de lotes e operações sequenciais opera obrigatoriamente sobre a transição:
$$\text{Estado Atual } (S_0) \longrightarrow \text{Estado Projetado } (S_1 \dots S_n) \longrightarrow \text{Validar Invariantes} \longrightarrow \text{Promover Atomicamente } (S_{\text{commit}})$$
* **Proibido Netting Falso:** A solvência e capacidade não podem ser avaliadas apenas pelo somatório final de deltas ($\sum \Delta$). Cada operação deve ser admitida sequencialmente contra o estado projetado do instante anterior.
* Impede overspending, duplo consumo, dependências circulares e financiamentos retroativos ilegais.

### 3. Validators Independentes da Implementação
O código que constrói a transição de estado não pode ser o único validador de sua correção.
* Os oráculos e validadores de invariantes globais operam de forma isolada do algoritmo de mutação.
* Validam conservação total ($\sum \text{Saldos} + \text{Treasury} \equiv \text{Constante}$), limites de capacidade ($0 \le \text{tokens} \le \text{capacidade}$) e congruência de estado ($resultado \equiv \text{estado observável}$).

### 4. Adversarial Obrigatório na Composição (Red Team)
Todo componente que passa individualmente é submetido a testes adversariais sistemáticos de composição:
* **Aliasing:** $A \to A$ (transferência para si mesmo sem corromper balanços nem travar o lote).
* **Financiamento Circular:** $A \to B$ sem saldo, seguido por $B \to A$ (rejeição estrita da primeira operação).
* **Ordem & Duplicação:** IDs vazios, IDs duplicados, inversão de eventos.
* **Skew Temporal:** Relógio regressando sem gerar capacidade artificial e mantendo a soberania de tempo do motor.
* **Rollback Total:** Aborto limpo ($S_{\text{abort}} \equiv S_0$) com conversão estrita de ordens admitidas para `aborted`.

### 5. Governance Baseado em Evidência (Proof-First Promotion)
O Gate de Promoção não avalia estilo nem aprova código com base em premissas estruturais. A aprovação exige a cadeia de custódia ininterrupta:
$$\text{Requisito} \longrightarrow \text{Contrato IR} \longrightarrow \text{Implementação} \longrightarrow \text{Validator} \longrightarrow \text{Prova Adversarial (Red Team)}$$
Se qualquer elo for violado: **`REJECT_PROMOTION`**.

---

## ⚙️ Diretrizes de Engenharia e Código TypeScript (KISS)

1. **Stack & Módulos**: Pure Vanilla TypeScript com **NodeNext ESM** (`import { fn } from './file.js'`). Zero dependências externas de infraestrutura.
2. **Tipagem Estrita & Zero `any`**: Proibido `any`, `as any`, `@ts-ignore` ou asserções não nulas (`x!`). Tipos em minúsculo (`bigint`, `number`, `string`, `boolean`).
3. **Aritmética Exata**: `bigint` para grandezas financeiras, contadores e tempo de alta precisão. Proibido `Math.min/max/floor/ceil` em `bigint` (usar condicionais explícitas).
4. **Alocação Zero no Caminho Crítico**: Proibido `new Map()`, `new Set()`, `.slice()` ou spreads em loops dentro de métodos de processamento.
5. **Re-exportação Nominal**: Toda entidade, tipo e função utilitária pública em `src/` deve ser re-exportada nominalmente em `src/index.ts`.

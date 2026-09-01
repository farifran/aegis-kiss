# Target Project Architecture (`ARCHITECTURE.md`)

Diretrizes exclusivas do projeto alvo e Constituição Operacional do **Aegis Harness**.

---

## 🏛️ Os 6 Pilares Universais do Aegis Harness

> *"O salto definitivo do Aegis acontece quando ele deixa de validar se o código está correto e passa a exigir provas de que o sistema inteiro não pode ficar incorreto sob composição, tempo, falha e observação."*

### 1. Contrato Antes do Código
Transformar qualquer demanda em um contrato formal explícito antes de qualquer mutação:
* Entidades e estado canônico;
* Pré-condições e pós-condições estritas;
* Invariantes globais de conservação e validade;
* Unidades e semântica pura sem contaminação de domínios anteriores;
* Comportamentos estritamente proibidos;
* Critérios de observabilidade pública.
**Regra de Ouro:** Nada deve ser implementado sem rastreabilidade bidirecional para o contrato.

### 2. Estado Projetado para Provar Composição
A validação de lotes e operações sequenciais opera obrigatoriamente sobre a transição:
$$\text{Estado Inicial } (S_0) \longrightarrow \text{Estado Projetado } (S_1 \dots S_n) \longrightarrow \text{Estado Final } (S_{commit})$$
* **Proibido Netting Falso:** A solvência e capacidade não podem ser avaliadas apenas pelo somatório final de deltas ($\sum \Delta$). Cada operação deve ser admitida sequencialmente contra o estado projetado do instante anterior.
* Impede overspending, duplo consumo, dependências circulares e financiamentos retroativos ilegais.

### 3. Validators Baseados em Propriedades (Property-Based Oracles)
Em vez de testar exemplos pontuais ("funciona neste caso?"), os oráculos provam a preservação de propriedades universais:
* **Identidade em Abort:** $\text{rollback}(S) \equiv S_{\text{before}}$ (zero efeitos colaterais residuais).
* **Limites Canônicos:** $\text{capacity} \in [0, \text{max}]$, $\text{balance} \ge 0$.
* **Congruência Observável:** $\text{result} \equiv \text{observable\_state}$ (o resultado nunca afirma um estado que não existe no motor).
* **Determinismo Puro:** $\text{f}(S, \text{input}, \text{nowMs}) \equiv \text{f}(S, \text{input}, \text{nowMs})$.

### 4. Red Team Obrigatório na Composição
Todo componente que passa individualmente é submetido a testes adversariais de interação:
* **Aliasing:** $A \to A$ (transferência para si mesmo sem corromper balanços nem travar o lote).
* **Financiamento Circular:** $A \to B$ sem saldo, seguido por $B \to A$ (rejeição estrita da primeira operação).
* **Ordem & Duplicação:** IDs vazios, IDs duplicados, inversão de eventos.
* **Skew Temporal:** Relógio regressando sem gerar capacidade artificial.

### 5. Tempo, Efeitos e Observabilidade de Primeira Classe
* **Proibido `Date.now()` Oculto:** O cursor temporal é dependência explícita e obrigatória (`nowMs: bigint`).
* **Zero Políticas Mortas:** Proibido expor políticas nominais não implementadas (`logical_clock` sem código, locks sem mutação).
* **Digest Canônico de Execução:** O hash ou identificador da execução deve vincular a identidade completa de todas as ordens, decisões, estado inicial e estado final.

### 6. Governança Baseada em Provas (Proof-First Promotion)
O Gate de Promoção não avalia estilo nem aprova código com base em premissas estruturais. A aprovação exige a cadeia de custódia ininterrupta:
$$\text{Requisito} \longrightarrow \text{Contrato IR} \longrightarrow \text{Implementação} \longrightarrow \text{Validador de Propriedade} \longrightarrow \text{Prova Adversarial (Red Team)}$$
Se qualquer elo for violado: **`REJECT_PROMOTION`**.

---

## ⚙️ Diretrizes de Engenharia e Código TypeScript (KISS)

1. **Stack & Módulos**: Pure Vanilla TypeScript com **NodeNext ESM** (`import { fn } from './file.js'`). Zero dependências externas de infraestrutura.
2. **Tipagem Estrita & Zero `any`**: Proibido `any`, `as any`, `@ts-ignore` ou asserções não nulas (`x!`). Tipos em minúsculo (`bigint`, `number`, `string`, `boolean`).
3. **Aritmética Exata**: `bigint` para grandezas financeiras, contadores e tempo de alta precisão. Proibido `Math.min/max/floor/ceil` em `bigint` (usar condicionais explícitas).
4. **Re-exportação Nominal**: Toda entidade, tipo e função utilitária pública em `src/` deve ser re-exportada nominalmente em `src/index.ts`.

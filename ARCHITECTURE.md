# Target Project Architecture (`ARCHITECTURE.md`)

Diretrizes exclusivas do projeto alvo e Constituição Operacional do **Aegis Harness**.

---

## 🏛️ As Obrigações Constitucionais do Aegis Harness

> *"O objetivo do Aegis deve ser garantir que toda entrada seja explicada, toda transição seja determinística, todo commit seja verificado após ocorrer e toda afirmação de correção seja comprovada por uma autoridade independente."*

---

### 1. Determinismo Verificável & Soberania Temporal
* **Ordem Canônica**: Todo cálculo de digest, hash ou representação de estado deve ordenar canonicamente as estruturas (`Object.keys().sort()`), eliminando qualquer dependência implícita de motores JavaScript.
* **Tempo Explícito**: Proibido `Date.now()` oculto no interior de componentes. O tempo de execução pertence ao motor e é passado explicitamente como `nowMs: bigint`. Relógios regressivos são rejeitados com política formal.
* **Isolamento de Estado**: Proibidas variáveis globais ou estado estático oculto.

### 2. Validação Pós-Commit Obrigatória
A verificação opera obrigatoriamente sobre as 4 etapas de custódia:
$$\text{Requisito} \longleftrightarrow \text{Estado Projetado } (S_{\text{proj}}) \longleftrightarrow \text{Estado Real Pós-Commit } (S_{\text{actual}}) \longleftrightarrow \text{Resultado Observável } (BatchResult)$$
* Não basta provar que a projeção era válida; o validador reaudita o estado real após o commit para confirmar conservação estrita e ausência de efeitos colaterais. Se houver divergência: **rollback atômico total**.

### 3. Cobertura Total da Entrada (Mapeamento Bijetivo)
* Todo elemento da sequência de entrada possui destino observável explícito: `committed`, `rejected_invalid`, `blocked_capacity`, `blocked_insolvent` ou `aborted`.
* Nenhum slot nulo, indefinido ou malformado pode desaparecer silenciosamente ($\text{decisions.length} \equiv \text{orders.length}$).

### 4. Prova Independente (Separação de Autoridades)
* O algoritmo de aplicação de regras não é a autoridade que atesta a sua própria correção. Validadores independentes recomputam propriedades críticas de conservação, limites e invariantes.
* O Gate de Promoção só libera transições acompanhadas de provas adversariais que cobrem aliasing ($A \to A$), ciclos intra-lote, saturação de capacidade, recuo de relógio e rollback.

---

## ⚙️ Diretrizes de Engenharia e Código TypeScript (KISS)

1. **Stack & Módulos**: Pure Vanilla TypeScript com **NodeNext ESM** (`import { fn } from './file.js'`). Zero dependências externas de infraestrutura.
2. **Tipagem Estrita & Zero `any`**: Proibido `any`, `as any`, `@ts-ignore` ou asserções não nulas (`x!`). Tipos em minúsculo (`bigint`, `number`, `string`, `boolean`).
3. **Aritmética Exata**: `bigint` para grandezas financeiras, contadores e tempo de alta precisão. Proibido `Math.min/max/floor/ceil` em `bigint` (usar condicionais explícitas).
4. **Alocação Zero no Caminho Crítico**: Proibido `new Map()`, `new Set()`, `.slice()` ou spreads em loops dentro de métodos de processamento.
5. **Re-exportação Nominal**: Toda entidade, tipo e função utilitária pública em `src/` deve ser re-exportada nominalmente em `src/index.ts`.

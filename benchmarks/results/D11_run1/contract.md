# Issue / Contrato: Extensão cirúrgica de reverseSettlement e guarda GUARD_DISPUTE_HOLD_ACTIVE no motor de liquidação

> **Status:** Selado & Governado
> **Modo:** PRODUCT
> **Determinismo efetivo:** NOT_APPLICABLE
> **Certificado de Fechamento:** CERTIFIED_CLOSED (inventário pendente: 0, dependências abertas: 0, campos não resolvidos: 0, transições abertas: 0, lacunas ativas: 0)
> **IMPLEMENTATION_AUTHORIZED:** `false`
> **Digest do Contrato:** `91f8757888734c12cfabbf1d7b48e6e5b74f68e0545fafa392c3453c329eedd6`
> **Rascunho aprovado:** `591986c0e83d000a4468146038eb95ddefebca28ccec8e92276ac89cf9761fbb`
> **Confirmação humana:** CONTRACT_REVIEWED_AND_APPROVED via DIRECT_COMMAND
> **Custódia (Preflight / Request / src):** `fa186229cc35` / `50033239935f` / `bb300ce11b71`

## 1. Demanda interpretada
A demanda estende cirurgicamente src/ledger/settlement_engine.ts e src/risk/velocity_guard.ts para (1) adicionar a operação reverseSettlement sobre SettlementLedgerState, preservando as constantes existentes no código-fonte (MAX_PENDING_SETTLEMENTS = 250, DAILY_SETTLEMENT_LIMIT_CENTS = 5000000 e MAX_BATCH_REJECTIONS = 5) e mantendo src/ledger/fee_calculator.ts inalterado; (2) inserir a guarda GUARD_DISPUTE_HOLD_ACTIVE em processSettlementBatch exatamente após GUARD_ACCOUNT_FROZEN e antes de GUARD_DAILY_LIMIT_EXCEEDED; e (3) submeter à decisão humana (Q-0001) o efeito de reverseSettlement sobre o acumulador diário dailySettledCents.

> A intenção integral permanece preservada no JSON canônico e vinculada pelo digest do preflight; esta visão humana evita repeti-la.

## 2. Escopo
**Incluído:**
- Suporte à operação reverseSettlement sobre SettlementLedgerState em src/ledger/settlement_engine.ts e src/risk/velocity_guard.ts
- Inserção da guarda GUARD_DISPUTE_HOLD_ACTIVE após GUARD_ACCOUNT_FROZEN e antes de GUARD_DAILY_LIMIT_EXCEEDED em processSettlementBatch
- Preservação dos limites MAX_PENDING_SETTLEMENTS (250), DAILY_SETTLEMENT_LIMIT_CENTS (5000000) e MAX_BATCH_REJECTIONS (5)
- Deliberação humana sobre o efeito de reverseSettlement em dailySettledCents

**Fora do escopo:**
- Qualquer modificação em src/ledger/fee_calculator.ts
- Alteração no exportador CSV ou em módulos fora de settlement_engine.ts e velocity_guard.ts

**Caminhos observados — não autorizam implementação:**
- `src/index.ts`
- `src/ledger/fee_calculator.ts`
- `src/ledger/settlement_engine.ts`
- `src/legacy/deprecated_comments_trap.ts`
- `src/reporting/audit_csv_exporter.ts`
- `src/risk/velocity_guard.ts`

**Referências de caminho classificadas:**
- **PATH-0001** — `src/ledger/settlement_engine.ts` — **IMPLEMENTATION_CONSTRAINT:** Módulo alvo que define MAX_PENDING_SETTLEMENTS = 250, DAILY_SETTLEMENT_LIMIT_CENTS = 5000000, SettlementLedgerState e processSettlementBatch.
- **PATH-0002** — `src/risk/velocity_guard.ts` — **IMPLEMENTATION_CONSTRAINT:** Módulo alvo que define MAX_BATCH_REJECTIONS = 5, GuardCode, ACTIVE_GUARD_PRECEDENCE e evaluateSettlementGuards.
- **PATH-0003** — `src/ledger/fee_calculator.ts` — **IMPLEMENTATION_CONSTRAINT:** Módulo de cálculo de tarifas que a demanda exige manter estritamente inalterado.

> Uma superfície pública define onde algo é exposto; não obriga toda a implementação a residir nesse arquivo. Sugestões e evidências não são normativas.

## 3. Governança e correções antecipadas
- **Contextos detectados:** product-demand, product-path, typescript-form, stateful-operation, public-interface
- **Evidência neutra:** 3 fragmento(s), 3 fato(s) literal(is).
- **Regras aplicáveis já conformes:** ARCH-PRODUCT-BOUNDARY, ARCH-STRICT-EXPLICIT-MODULES, ARCH-FAILURE-EXPLICIT, ARCH-PUBLIC-INTERFACE, ARCH-CONTRACT-CONSISTENCY, ARCH-STATE-TRANSITION-TOTALITY, ARCH-MINIMAL-SUFFICIENT-CLOSURE.
- Nenhuma correção constitucional necessária.

## 4. Revisão de complexidade
- **NO_EXCESS:** A especificação adota a menor solução suficiente sem abstrações especulativas.

### Rastreabilidade da intenção
- **CLAIM-0001 — OBLIGATION/NORMATIVE:** “Estender cirurgicamente o motor em src/ledger/settlement_engine.ts e a validação em src/risk/velocity_guard.ts para suportar a operação reverseSettlement sobre SettlementLedgerState” → REQ-0001, REQ-0002.
- **CLAIM-0002 — OBLIGATION/NORMATIVE:** “Na operação processSettlementBatch, inserir a nova guarda GUARD_DISPUTE_HOLD_ACTIVE imediatamente após GUARD_ACCOUNT_FROZEN e antes de GUARD_DAILY_LIMIT_EXCEEDED.” → REQ-0003.
- **CLAIM-0003 — AMBIGUITY/DECISION:** “Ao executar reverseSettlement de um valor já liquidado no mesmo dia, o impacto sobre o acumulador diário dailySettledCents ainda precisa ser definido.” → Q-0001.

## 5. Requisitos e casos falsificáveis

### REQ-0001
A operação reverseSettlement(state, amountCents) em src/ledger/settlement_engine.ts deve rejeitar quando accountFrozen === true (GUARD_ACCOUNT_FROZEN), disputeHoldActive === true (GUARD_DISPUTE_HOLD_ACTIVE) ou amountCents > settledBalanceCents (INSUFFICIENT_SETTLED_BALANCE), sem mutar o estado; quando aceita, deve debitar amountCents de settledBalanceCents e preservar dailySettledCents inalterado.
*Base: USER_INTENT:FRAG-0001, USER_INTENT:FRAG-0003, WORKSPACE_EVIDENCE:src/ledger/settlement_engine.ts:L19-L28, USER_DECISION:Q-0001*

- **AC-0001-01 — HAPPY_PATH**
  - Dado: SettlementLedgerState com accountFrozen = false, disputeHoldActive = false, settledBalanceCents = 100000 e dailySettledCents = 100000
  - Quando: reverseSettlement é chamado com amountCents = 40000
  - Então: Retorna status REVERSED com settledBalanceCents = 60000 e dailySettledCents = 100000 (preservado inalterado sob o teto DAILY_SETTLEMENT_LIMIT_CENTS = 5000000)
  - Resultado observável: RETURN_VALUE
- **AC-0001-02 — FAILURE**
  - Dado: SettlementLedgerState com accountFrozen = true ou settledBalanceCents = 10000
  - Quando: reverseSettlement é chamado com amountCents = 40000
  - Então: Rejeita explicitamente sem alterar settledBalanceCents, dailySettledCents ou pendingQueue
  - Resultado observável: REJECTION

### REQ-0002
Os limites constantes MAX_PENDING_SETTLEMENTS = 250, DAILY_SETTLEMENT_LIMIT_CENTS = 5000000 e MAX_BATCH_REJECTIONS = 5 definidos em src/ledger/settlement_engine.ts e src/risk/velocity_guard.ts devem permanecer inalterados, assim como o módulo src/ledger/fee_calculator.ts.
*Base: USER_INTENT:FRAG-0001, WORKSPACE_EVIDENCE:src/ledger/settlement_engine.ts:L9-L10, WORKSPACE_EVIDENCE:src/risk/velocity_guard.ts:L6-L6*

- **AC-0002-01 — HAPPY_PATH**
  - Dado: O motor de liquidação carregado a partir de src/ledger/settlement_engine.ts e src/risk/velocity_guard.ts
  - Quando: As constantes exportadas MAX_PENDING_SETTLEMENTS, DAILY_SETTLEMENT_LIMIT_CENTS e MAX_BATCH_REJECTIONS são inspecionadas
  - Então: Seus valores permanecem exatamente 250, 5000000 e 5, e src/ledger/fee_calculator.ts permanece intacto
  - Resultado observável: RETURN_VALUE
- **AC-0002-02 — BOUNDARY**
  - Dado: SettlementLedgerState com pendingCount = 250 (MAX_PENDING_SETTLEMENTS)
  - Quando: enqueueSettlement é invocado para um 251º item
  - Então: Rejeita com status QUEUE_FULL_REJECTED preservando pendingCount = 250
  - Resultado observável: REJECTION

### REQ-0003
Em processSettlementBatch e evaluateSettlementGuards, a guarda GUARD_DISPUTE_HOLD_ACTIVE deve ser avaliada imediatamente após GUARD_ACCOUNT_FROZEN e antes de GUARD_DAILY_LIMIT_EXCEEDED, rejeitando o lote com status GUARD_DISPUTE_HOLD_ACTIVE e incrementando consecutiveBatchRejections até saturar em MAX_BATCH_REJECTIONS = 5 quando disputeHoldActive === true e accountFrozen === false.
*Base: USER_INTENT:FRAG-0002, WORKSPACE_EVIDENCE:src/risk/velocity_guard.ts:L6-L56, WORKSPACE_EVIDENCE:src/ledger/settlement_engine.ts:L104-L162*

- **AC-0003-01 — HAPPY_PATH**
  - Dado: SettlementLedgerState com pendingCount = 1, accountFrozen = false, disputeHoldActive = false e lote dentro de DAILY_SETTLEMENT_LIMIT_CENTS (5000000)
  - Quando: processSettlementBatch é invocado
  - Então: Liquida o lote com status BATCH_SETTLED, zera pendingCount e reseta consecutiveBatchRejections para 0
  - Resultado observável: STATE_CHANGE
- **AC-0003-02 — FAILURE**
  - Dado: SettlementLedgerState com pendingCount = 1, accountFrozen = false, disputeHoldActive = true e proposedBatchAmountCents acima de DAILY_SETTLEMENT_LIMIT_CENTS (5000000)
  - Quando: processSettlementBatch é invocado
  - Então: Rejeita com status GUARD_DISPUTE_HOLD_ACTIVE (precedendo GUARD_DAILY_LIMIT_EXCEEDED) e incrementa consecutiveBatchRejections saturando em 5
  - Resultado observável: REJECTION

### Regras de limite e extrapolação
- Nenhum valor público de representação finita identificado.

### Revisão de determinismo
- **NOT_APPLICABLE:** A demanda não promete determinismo adicional além do contrato público.
- **Cobertura CLAIM-0001/NO_DIMENSION_APPLICABLE:** nenhuma dimensão aplicável. Afirmação funcional sem fonte adicional de indeterminismo.
- **Cobertura CLAIM-0002/NO_DIMENSION_APPLICABLE:** nenhuma dimensão aplicável. Afirmação funcional sem fonte adicional de indeterminismo.
- **Cobertura CLAIM-0003/NO_DIMENSION_APPLICABLE:** nenhuma dimensão aplicável. Afirmação funcional sem fonte adicional de indeterminismo.

## 6. Inventário Semântico Auditável (State Model & Totalidade de Transição)

### 6.1 Entidades de Estado e Ciclo de Vida dos Campos

#### Entidade: `SettlementLedgerState`
- **Descrição:** Estado contábil e de risco por conta em src/ledger/settlement_engine.ts.
- **Topologia:** Instância estática única (Singleton)
- **Política de Admissão:** `N/A`
- **Política de Capacidade:** Máx 1 entradas (overflow: `STATIC_SINGLETON` [Base: WORKSPACE_EVIDENCE:src/ledger/settlement_engine.ts:L19-L28])

| Campo | Tipo | Limites (Bounds) | Inicialização | Reset | Mutações | Leitores |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `accountFrozen` | BOOLEAN | N/A | EXPLICIT_VALUE: `false`<br>*Inicializado como false em createInitialLedgerState (src/ledger/settlement_engine.ts:L43).* | Proibido (preservado) | Nenhuma (imutável pós-init) | `processSettlementBatch`, `reverseSettlement`, `inspectLedgerSnapshot` |
| `disputeHoldActive` | BOOLEAN | N/A | EXPLICIT_VALUE: `false`<br>*Inicializado como false em createInitialLedgerState (src/ledger/settlement_engine.ts:L44).* | Proibido (preservado) | Nenhuma (imutável pós-init) | `processSettlementBatch`, `reverseSettlement`, `inspectLedgerSnapshot` |
| `pendingCount` | INTEGER (Contador) | [0, 250] (REJECT; WORKSPACE_EVIDENCE:src/ledger/settlement_engine.ts:L9-L9) | EXPLICIT_VALUE: `0`<br>*Inicializado como 0 em createInitialLedgerState (src/ledger/settlement_engine.ts:L46).* | `0` (gatilho: `processSettlementBatch conclui com status BATCH_SETTLED`) | `processSettlementBatch`: SET_VALUE `0` se `pendingCount > 0 && accountFrozen === false && disputeHoldActive === false && dailySettledCents < 5000000` | `processSettlementBatch`, `reverseSettlement`, `inspectLedgerSnapshot` |
| `settledBalanceCents` | INTEGER (Contador) | [0, 500000000] (REJECT; WORKSPACE_EVIDENCE:src/ledger/settlement_engine.ts:L25-L25) | EXPLICIT_VALUE: `0`<br>*Inicializado como 0 em createInitialLedgerState (src/ledger/settlement_engine.ts:L47).* | Proibido (preservado) | `processSettlementBatch`: INCREMENT `settledBalanceCents` se `pendingCount > 0 && accountFrozen === false && disputeHoldActive === false && dailySettledCents < 5000000`<br>`reverseSettlement`: DECREMENT `amountCents` se `accountFrozen === false && disputeHoldActive === false && amountCents <= settledBalanceCents` | `processSettlementBatch`, `reverseSettlement`, `inspectLedgerSnapshot` |
| `dailySettledCents` | INTEGER (Contador) | [0, 5000000] (SATURATE; WORKSPACE_EVIDENCE:src/ledger/settlement_engine.ts:L10-L10) | EXPLICIT_VALUE: `0`<br>*Inicializado como 0 em createInitialLedgerState (src/ledger/settlement_engine.ts:L48).* | Proibido (preservado) | `processSettlementBatch`: INCREMENT `dailySettledCents` se `pendingCount > 0 && accountFrozen === false && disputeHoldActive === false && dailySettledCents < 5000000` | `processSettlementBatch`, `reverseSettlement`, `inspectLedgerSnapshot` |
| `consecutiveBatchRejections` | INTEGER (Contador) | [0, 5] (SATURATE; WORKSPACE_EVIDENCE:src/risk/velocity_guard.ts:L6-L6) | EXPLICIT_VALUE: `0`<br>*Inicializado como 0 em createInitialLedgerState (src/ledger/settlement_engine.ts:L49).* | `0` (gatilho: `processSettlementBatch conclui com status BATCH_SETTLED`) | `processSettlementBatch`: SET_VALUE `0` se `pendingCount > 0 && accountFrozen === false && disputeHoldActive === false && dailySettledCents < 5000000` | `processSettlementBatch`, `reverseSettlement`, `inspectLedgerSnapshot` |

### 6.2 Operações, Precedência Linear de Guardas e Efeitos de Transição

#### Operação: `processSettlementBatch`
- **Descrição:** Liquida itens pendentes respeitando a precedência estrita [GUARD_ACCOUNT_FROZEN, GUARD_DISPUTE_HOLD_ACTIVE, GUARD_DAILY_LIMIT_EXCEEDED].
- **Precedência Linear Estrita de Guardas (Curto-Circuito):** 1. `GUARD_ACCOUNT_FROZEN` → 2. `GUARD_DISPUTE_HOLD_ACTIVE` → 3. `GUARD_DAILY_LIMIT_EXCEEDED`

| Ramo (branchId) | Condição de Guarda | Desfecho | Status / Erro | Efeitos de Transição de Estado | Preservação Default |
| :--- | :--- | :--- | :--- | :--- | :---: |
| `GUARD_ACCOUNT_FROZEN` | `accountFrozen === true` | `REJECTION` | `GUARD_ACCOUNT_FROZEN` | Nenhum efeito colateral | Sim |
| `GUARD_DISPUTE_HOLD_ACTIVE` | `disputeHoldActive === true` | `REJECTION` | `GUARD_DISPUTE_HOLD_ACTIVE` | Nenhum efeito colateral | Sim |
| `GUARD_DAILY_LIMIT_EXCEEDED` | `dailySettledCents >= 5000000` | `REJECTION` | `GUARD_DAILY_LIMIT_EXCEEDED` | Nenhum efeito colateral | Sim |
| `SETTLE_BATCH` | `pendingCount > 0 && accountFrozen === false && disputeHoldActive === false && dailySettledCents < 5000000` | `STATE_CHANGE` | `BATCH_SETTLED` | `SettlementLedgerState.pendingCount` := SET `0`<br>`SettlementLedgerState.settledBalanceCents` := INCREMENT `settledBalanceCents`<br>`SettlementLedgerState.dailySettledCents` := INCREMENT `dailySettledCents`<br>`SettlementLedgerState.consecutiveBatchRejections` := SET `0`<br>`SettlementLedgerState.accountFrozen` := PRESERVE<br>`SettlementLedgerState.disputeHoldActive` := PRESERVE | Não |

#### Operação: `reverseSettlement`
- **Descrição:** Estorna um valor liquidado de settledBalanceCents respeitando as guardas de congelamento, disputa e saldo disponível.
- **Precedência Linear Estrita de Guardas (Curto-Circuito):** 1. `GUARD_ACCOUNT_FROZEN` → 2. `GUARD_DISPUTE_HOLD_ACTIVE` → 3. `INSUFFICIENT_SETTLED_BALANCE`

##### Contrato Público de Entrada (Public Input Contract):

| Parâmetro | Tipo | Domínio | Limites (Bounds) | Nulabilidade | Produtor | Tratamento Inválido (onInvalid) |
| :--- | :--- | :--- | :--- | :---: | :--- | :--- |
| `amountCents` | `INTEGER` | `positive_integer_cents` | [1, 5000000] (REJECT) | `NOT_NULL` | `CALLER` | REJECTION (`INVALID_REVERSE_AMOUNT`) |

| Ramo (branchId) | Condição de Guarda | Desfecho | Status / Erro | Efeitos de Transição de Estado | Preservação Default |
| :--- | :--- | :--- | :--- | :--- | :---: |
| `GUARD_ACCOUNT_FROZEN` | `accountFrozen === true` | `REJECTION` | `GUARD_ACCOUNT_FROZEN` | Nenhum efeito colateral | Sim |
| `GUARD_DISPUTE_HOLD_ACTIVE` | `disputeHoldActive === true` | `REJECTION` | `GUARD_DISPUTE_HOLD_ACTIVE` | Nenhum efeito colateral | Sim |
| `INSUFFICIENT_SETTLED_BALANCE` | `amountCents > settledBalanceCents` | `REJECTION` | `INSUFFICIENT_SETTLED_BALANCE` | Nenhum efeito colateral | Sim |
| `APPLY_REVERSE` | `accountFrozen === false && disputeHoldActive === false && amountCents <= settledBalanceCents` | `STATE_CHANGE` | `REVERSED` | `SettlementLedgerState.settledBalanceCents` := DECREMENT `amountCents`<br>`SettlementLedgerState.dailySettledCents` := PRESERVE `dailySettledCents`<br>`SettlementLedgerState.accountFrozen` := PRESERVE<br>`SettlementLedgerState.disputeHoldActive` := PRESERVE<br>`SettlementLedgerState.pendingCount` := PRESERVE<br>`SettlementLedgerState.consecutiveBatchRejections` := PRESERVE | Não |

### 6.3 Observáveis Públicos

#### Observável: `inspectLedgerSnapshot`
- **Representação:** `RECORD`
- **Derivado de:** `SettlementLedgerState.accountFrozen`, `SettlementLedgerState.disputeHoldActive`, `SettlementLedgerState.pendingCount`, `SettlementLedgerState.settledBalanceCents`, `SettlementLedgerState.dailySettledCents`, `SettlementLedgerState.consecutiveBatchRejections`
- **Comportamento quando Vazio:** `NULL_RECORD`

## 7. Invariantes
- **INV-0001:** A fila pendingQueue e o contador pendingCount nunca excedem MAX_PENDING_SETTLEMENTS = 250, e consecutiveBatchRejections permanece sempre no intervalo [0, 5] (MAX_BATCH_REJECTIONS = 5).
  - Falsificado se: Qualquer operação resulta em pendingCount > 250, consecutiveBatchRejections < 0 ou consecutiveBatchRejections > 5.
- **INV-0002:** Quando múltiplas condições de guarda falham simultaneamente em processSettlementBatch, a precedência [GUARD_ACCOUNT_FROZEN, GUARD_DISPUTE_HOLD_ACTIVE, GUARD_DAILY_LIMIT_EXCEEDED] determina unicamente o código retornado.
  - Falsificado se: Um estado com accountFrozen = true e disputeHoldActive = true retorna GUARD_DISPUTE_HOLD_ACTIVE, ou um estado com disputeHoldActive = true e excesso de limite diário retorna GUARD_DAILY_LIMIT_EXCEEDED.

## 8. Riscos e vulnerabilidades
- **Sem riscos adicionais (NONE):** Nenhum risco material adicional identificado.
- Nenhum risco material identificado.

## 9. Parecer adversarial
- **NO_ADDITIONAL_FINDINGS:** Revisão semântica residual sem achados adicionais.

## 10. Decisões humanas seladas
Nenhuma ambiguidade material detectada.

### Decisões humanas incorporadas por recompilação
- **Q-0001: Ao executar reverseSettlement de um valor liquidado no mesmo dia, como o acumulador diário dailySettledCents (limitado por DAILY_SETTLEMENT_LIMIT_CENTS = 5000000) deve se comportar?** → (Recommended) Preservar dailySettledCents inalterado (teto diário bruto de 5.000.000 centavos). Evita reciclagem de limite diário via estornos e mantém a transição de estado mínima (CONST-KISS).
  - Efeito incorporado: A operação reverseSettlement(state, amountCents) em src/ledger/settlement_engine.ts deve rejeitar quando accountFrozen === true (GUARD_ACCOUNT_FROZEN), disputeHoldActive === true (GUARD_DISPUTE_HOLD_ACTIVE) ou amountCents > settledBalanceCents (INSUFFICIENT_SETTLED_BALANCE), sem mutar o estado; quando aceita, deve debitar amountCents de settledBalanceCents e preservar dailySettledCents inalterado.
  - Evidência: CONTRACT_REVIEWED_AND_APPROVED via INTERACTIVE_WIZARD; rascunho `bc970e6647ffbf52d939ad0b62fa57bf5d7c3d19bd7bf5705036aedb4aef7eaf`.


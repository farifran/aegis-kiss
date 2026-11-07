# Issue / Contrato: Saque em Conta Corrente com Precedência Linear de Guardas

> **Status:** Selado & Governado
> **Modo:** PRODUCT
> **Determinismo efetivo:** NOT_APPLICABLE
> **Certificado de Fechamento:** CERTIFIED_CLOSED (inventário pendente: 0, dependências abertas: 0, campos não resolvidos: 0, transições abertas: 0, lacunas ativas: 0)
> **IMPLEMENTATION_AUTHORIZED:** `false`
> **Digest do Contrato:** `ad79dd970874fddc86044f2ffe83cb10a5a5c4401fd8981d312fb772eb5fdc71`
> **Rascunho aprovado:** `2b2fa47d22e2647000faf3e8e9466d5fc1129a6551489944516f92b874ea5f56`
> **Confirmação humana:** CONTRACT_REVIEWED_AND_APPROVED via DIRECT_COMMAND
> **Custódia (Preflight / Request / src):** `1b33eb718bc1` / `df166ddd03e8` / `f43c49182271`

## 1. Demanda interpretada
Especificar operação de saque em conta corrente com precedência linear estrita de guardas (CONTA_INATIVA > SALDO_INSUFICIENTE > LIMITE_DIARIO_EXCEDIDO), garantindo que erros concorrentes produzam resultado observável determinístico e curto-circuito sem mutação.

> A intenção integral permanece preservada no JSON canônico e vinculada pelo digest do preflight; esta visão humana evita repeti-la.

## 2. Escopo
**Incluído:**
- Validação ordenada de bloqueio de conta, saldo suficiente e limite diário.
- Precedência estrita de erros: CONTA_INATIVA, SALDO_INSUFICIENTE e LIMITE_DIARIO_EXCEDIDO.
- Dedutibilidade do saldo e limite diário remanescente exclusivamente no sucesso de todas as guardas.

**Fora do escopo:**
- Integração bancária externa, compensação via PIX ou TED.
- Cálculo de tarifas ou juros de cheque especial.
- Persistência em banco relacional externo ou tolerância a falhas distribuída.

**Caminhos observados — não autorizam implementação:**
- Nenhum caminho pré-existente observado no workspace (repositório greenfield).

**Referências de caminho classificadas:**
- Nenhuma referência de caminho normativa ou sugerida.

> Uma superfície pública define onde algo é exposto; não obriga toda a implementação a residir nesse arquivo. Sugestões e evidências não são normativas.

## 3. Governança e correções antecipadas
- **Contextos detectados:** product-demand, stateful-operation, public-interface
- **Evidência neutra:** 3 fragmento(s), 0 fato(s) literal(is).
- **Regras aplicáveis já conformes:** ARCH-PRODUCT-BOUNDARY, ARCH-FAILURE-EXPLICIT, ARCH-PUBLIC-INTERFACE, ARCH-CONTRACT-CONSISTENCY, ARCH-STATE-TRANSITION-TOTALITY, ARCH-MINIMAL-SUFFICIENT-CLOSURE.
- Nenhuma correção constitucional necessária.

## 4. Revisão de complexidade
- **NO_EXCESS:** A especificação modela estritamente os campos e guardas demandados pelo saque bancário.

### Rastreabilidade da intenção
- **CLAIM-0001 — OBLIGATION/NORMATIVE:** “Processar um saque em conta corrente.” → REQ-0001.
- **CLAIM-0002 — OBLIGATION/NORMATIVE:** “A operação deve rejeitar com CONTA_INATIVA se a conta estiver bloqueada; rejeitar com SALDO_INSUFICIENTE se o saldo for menor que o valor solicitado; e rejeitar com LIMITE_DIARIO_EXCEDIDO se o saque ultrapassar o limite diário remanescente.” → REQ-0001.
- **CLAIM-0003 — OBLIGATION/NORMATIVE:** “Se todas as guardas passarem, deduzir o valor do saldo.” → REQ-0001.

## 5. Requisitos e casos falsificáveis

### REQ-0001
O sistema deve processar o saque em conta corrente avaliando as guardas na ordem linear estrita: rejeitar com CONTA_INATIVA se a conta estiver bloqueada; rejeitar com SALDO_INSUFICIENTE se o saldo for menor que o valor solicitado; e rejeitar com LIMITE_DIARIO_EXCEDIDO se o saque ultrapassar o limite diário remanescente. Se todas as guardas passarem, deduzir o valor do saldo e do limite diário.
*Base: USER_INTENT:Processar um saque em conta corrente., USER_INTENT:A operação deve rejeitar com CONTA_INATIVA se a conta estiver bloqueada; rejeitar com SALDO_INSUFICIENTE se o saldo for menor que o valor solicitado; e rejeitar com LIMITE_DIARIO_EXCEDIDO se o saque ultrapassar o limite diário remanescente., USER_INTENT:Se todas as guardas passarem, deduzir o valor do saldo.*

- **AC-0001-01 — HAPPY_PATH**
  - Dado: Uma conta ativa com saldo de R$ 500,00 e limite diário de R$ 1000,00 solicita saque de R$ 200,00.
  - Quando: O saque for processado.
  - Então: A operação é autorizada com sucesso, deduzindo R$ 200,00 do saldo (restando R$ 300,00) e do limite diário (restando R$ 800,00).
  - Resultado observável: RETURN_VALUE
- **AC-0001-02 — FAILURE**
  - Dado: Uma conta bloqueada (estaBloqueada = true) solicita saque de R$ 100,00.
  - Quando: O saque for processado.
  - Então: A operação é rejeitada com erro CONTA_INATIVA na primeira guarda, sem alterar saldo ou limite.
  - Resultado observável: REJECTION
- **AC-0001-03 — FAILURE**
  - Dado: Uma conta ativa com saldo de R$ 100,00 e limite diário de R$ 1000,00 solicita saque de R$ 200,00.
  - Quando: O saque for processado.
  - Então: A operação é rejeitada com erro SALDO_INSUFICIENTE na segunda guarda, preservando o saldo.
  - Resultado observável: REJECTION
- **AC-0001-04 — FAILURE**
  - Dado: Uma conta ativa com saldo de R$ 1000,00 e limite diário remanescente de R$ 300,00 solicita saque de R$ 500,00.
  - Quando: O saque for processado.
  - Então: A operação é rejeitada com erro LIMITE_DIARIO_EXCEDIDO na terceira guarda, preservando o saldo.
  - Resultado observável: REJECTION
- **AC-0001-05 — BOUNDARY**
  - Dado: Uma conta bloqueada (estaBloqueada = true), com saldo insuficiente (R$ 50,00) e limite excedido (R$ 10,00), solicita saque de R$ 200,00.
  - Quando: O saque for processado sob múltiplas falhas concomitantes.
  - Então: A operação é rejeitada estritamente com CONTA_INATIVA por precedência da primeira guarda, sem avaliar saldo ou limite.
  - Resultado observável: REJECTION

### Regras de limite e extrapolação
- Nenhum valor público de representação finita identificado.

### Revisão de determinismo
- **NOT_APPLICABLE:** A demanda não promete determinismo.
- **Cobertura CLAIM-0001/NO_DIMENSION_APPLICABLE:** nenhuma dimensão aplicável. Operação de saque processada de forma sequencial síncrona em memória.
- **Cobertura CLAIM-0002/NO_DIMENSION_APPLICABLE:** nenhuma dimensão aplicável. A ordem linear de guardas elimina qualquer divergência observável entre erros concorrentes.
- **Cobertura CLAIM-0003/NO_DIMENSION_APPLICABLE:** nenhuma dimensão aplicável. Mutação aritmética de saldo é determinística.

## 6. Inventário Semântico Auditável (State Model & Totalidade de Transição)

### 6.1 Entidades de Estado e Ciclo de Vida dos Campos

#### Entidade: `ContaCorrente`
- **Descrição:** Sem descrição
- **Topologia:** Coleção dinâmica (instâncias múltiplas)
- **Política de Admissão:** `ON_FIRST_REQUEST`
- **Política de Capacidade:** Sem limite contratual (overflow: `NO_CONTRACT_LIMIT` — Mapeamento em memória indexado por número de conta corrente sem restrição contratual pré-fixada)
- **Política de Contêiner:** Partição: `numeroConta`, Retenção: `UNBOUNDED_CONTAINER` — Contas correntes ativas mantidas em memória

| Campo | Tipo | Limites (Bounds) | Inicialização | Reset | Mutações | Leitores |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `saldo` | INTEGER | [0, +∞] (REJECT; ARCHITECTURE_POLICY:ARCH-STATE-TRANSITION-TOTALITY) | EXPLICIT_VALUE: `0`<br>*Conta corrente inicia provisionada com saldo zero.* | Proibido (preservado) | `processarSaque`: DECREMENT se `TODAS_AS_GUARDAS_VALIDAS` | `processarSaque`, `estadoConta` |
| `limiteDiarioRemanescente` | INTEGER | [0, +∞] (REJECT; ARCHITECTURE_POLICY:ARCH-STATE-TRANSITION-TOTALITY) | EXPLICIT_VALUE: `0`<br>*Limite diário inicial provisionado.* | `0` (gatilho: `VIRADA_DO_DIA`) | `processarSaque`: DECREMENT se `TODAS_AS_GUARDAS_VALIDAS` | `processarSaque`, `estadoConta` |
| `estaBloqueada` | BOOLEAN | N/A | EXPLICIT_VALUE: `false`<br>*Conta corrente inicia desbloqueada por padrão.* | Proibido (preservado) | Nenhuma (imutável pós-init) | `processarSaque`, `estadoConta` |

### 6.2 Operações, Precedência Linear de Guardas e Efeitos de Transição

#### Operação: `processarSaque`
- **Descrição:** Sem descrição
- **Precedência Linear Estrita de Guardas (Curto-Circuito):** 1. `GUARD_CONTA_INATIVA` → 2. `GUARD_SALDO_INSUFICIENTE` → 3. `GUARD_LIMITE_DIARIO_EXCEDIDO`

##### Contrato Público de Entrada (Public Input Contract):

| Parâmetro | Tipo | Domínio | Limites (Bounds) | Nulabilidade | Produtor | Tratamento Inválido (onInvalid) |
| :--- | :--- | :--- | :--- | :---: | :--- | :--- |
| `valorSaque` | `INTEGER` | `POSITIVE_INTEGER` | [1, +∞] (REJECT) | `NOT_NULL` | `CALLER` | REJECTION (`VALOR_INVALIDO`) |

| Ramo (branchId) | Condição de Guarda | Desfecho | Status / Erro | Efeitos de Transição de Estado | Preservação Default |
| :--- | :--- | :--- | :--- | :--- | :---: |
| `GUARD_CONTA_INATIVA` | `ContaCorrente.estaBloqueada == true` | `REJECTION` | `CONTA_INATIVA` | Nenhum efeito colateral | Sim |
| `GUARD_SALDO_INSUFICIENTE` | `ContaCorrente.estaBloqueada == false && ContaCorrente.saldo < valorSaque` | `REJECTION` | `SALDO_INSUFICIENTE` | Nenhum efeito colateral | Sim |
| `GUARD_LIMITE_DIARIO_EXCEDIDO` | `ContaCorrente.estaBloqueada == false && ContaCorrente.saldo >= valorSaque && valorSaque > ContaCorrente.limiteDiarioRemanescente` | `REJECTION` | `LIMITE_DIARIO_EXCEDIDO` | Nenhum efeito colateral | Sim |
| `SAQUE_EFETUADO` | `ContaCorrente.estaBloqueada == false && ContaCorrente.saldo >= valorSaque && valorSaque <= ContaCorrente.limiteDiarioRemanescente` | `RETURN_VALUE` | `SUCESSO` | `ContaCorrente.saldo` := DECREMENT `valorSaque`<br>`ContaCorrente.limiteDiarioRemanescente` := DECREMENT `valorSaque`<br>`ContaCorrente.estaBloqueada` := PRESERVE | Não |

### 6.3 Observáveis Públicos

#### Observável: `estadoConta`
- **Representação:** `RECORD`
- **Derivado de:** `ContaCorrente.saldo`, `ContaCorrente.limiteDiarioRemanescente`, `ContaCorrente.estaBloqueada`
- **Comportamento quando Vazio:** `CONTA_INEXISTENTE`

## 7. Invariantes
- **INV-0001:** A precedência de avaliação de guardas é estrita e determinística: CONTA_INATIVA precede SALDO_INSUFICIENTE, que precede LIMITE_DIARIO_EXCEDIDO; nenhuma dedução de saldo ocorre sob falha de guarda.
  - Falsificado se: Uma conta bloqueada emite SALDO_INSUFICIENTE em vez de CONTA_INATIVA, ou uma conta com saldo insuficiente emite LIMITE_DIARIO_EXCEDIDO, ou ocorre mutação de saldo em operação rejeitada.

## 8. Riscos e vulnerabilidades
- **Sem riscos adicionais (NONE):** A ordem linear de guardas elimina condições de corrida lógica e garante determinismo estrito sob falhas concorrentes.
- Nenhum risco material identificado.

## 9. Parecer adversarial
- **NO_ADDITIONAL_FINDINGS:** O caso limite com falhas triplas simultâneas (conta bloqueada + saldo insuficiente + limite diário excedido) garante que a implementação seja refutada caso avalie o saldo antes do status de bloqueio.

## 10. Decisões humanas seladas
Nenhuma ambiguidade material detectada.


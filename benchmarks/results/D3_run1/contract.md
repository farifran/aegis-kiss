# Issue / Contrato: Controle de Tentativas de Login

> **Status:** Selado & Governado
> **Modo:** PRODUCT
> **Determinismo efetivo:** NOT_APPLICABLE
> **Certificado de Fechamento:** CERTIFIED_CLOSED (inventário pendente: 0, dependências abertas: 0, campos não resolvidos: 0, transições abertas: 0, lacunas ativas: 0)
> **IMPLEMENTATION_AUTHORIZED:** `false`
> **Digest do Contrato:** `8bc994d2d8c1830e3b1b2a9e53f28934c14f3ffa34334a53dae27324f137dea4`
> **Rascunho aprovado:** `c57aaf825cb54846726bb20deb0042028d5946928afb2dd52198c60ea3321b48`
> **Confirmação humana:** CONTRACT_REVIEWED_AND_APPROVED via DIRECT_COMMAND
> **Custódia (Preflight / Request / src):** `0f78fc596eb4` / `4d871188009c` / `f43c49182271`

## 1. Demanda interpretada
Especificar máquina de estados finita para controle de tentativas consecutivas de login por usuário, delimitando o ciclo de vida, saturação no limite de 3 falhas, bloqueio da conta e gatilho de reset por login bem-sucedido.

> A intenção integral permanece preservada no JSON canônico e vinculada pelo digest do preflight; esta visão humana evita repeti-la.

## 2. Escopo
**Incluído:**
- Controle do contador de falhas consecutivas de login por usuário.
- Transição de estado para BLOQUEADA ao atingir 3 falhas consecutivas.
- Recusa de novas tentativas quando a conta estiver bloqueada.
- Reset do contador de falhas para 0 após login bem-sucedido.

**Fora do escopo:**
- Validação de senhas ou hash criptográfico de credenciais.
- Mecanismos de desbloqueio administrativo ou por e-mail.
- Persistência em banco de dados externo ou rede.

**Caminhos observados — não autorizam implementação:**
- Nenhum caminho pré-existente observado no workspace (repositório greenfield).

**Referências de caminho classificadas:**
- Nenhuma referência de caminho normativa ou sugerida.

> Uma superfície pública define onde algo é exposto; não obriga toda a implementação a residir nesse arquivo. Sugestões e evidências não são normativas.

## 3. Governança e correções antecipadas
- **Contextos detectados:** product-demand, stateful-operation, bounded-observability, public-interface
- **Evidência neutra:** 5 fragmento(s), 3 fato(s) literal(is).
- **Regras aplicáveis já conformes:** ARCH-PRODUCT-BOUNDARY, ARCH-FAILURE-EXPLICIT, ARCH-OBSERVABILITY-COUNTERS, ARCH-PUBLIC-INTERFACE, ARCH-CONTRACT-CONSISTENCY, ARCH-STATE-TRANSITION-TOTALITY, ARCH-MINIMAL-SUFFICIENT-CLOSURE.
- Nenhuma correção constitucional necessária.

## 4. Revisão de complexidade
- **NO_EXCESS:** A máquina de estados modela unicamente os campos, transições e operações estritamente demandados.

### Rastreabilidade da intenção
- **CLAIM-0001 — OBLIGATION/NORMATIVE:** “Criar um controle de tentativas de login por usuário.” → REQ-0001.
- **CLAIM-0002 — OBLIGATION/NORMATIVE:** “O contador inicia em 0 e admite no máximo 3 falhas consecutivas.” → REQ-0001.
- **CLAIM-0003 — OBLIGATION/NORMATIVE:** “Cada falha incrementa o contador.” → REQ-0001.
- **CLAIM-0004 — OBLIGATION/NORMATIVE:** “Ao atingir 3 falhas, a conta transita para BLOQUEADA e recusa novas tentativas.” → REQ-0001.
- **CLAIM-0005 — OBLIGATION/NORMATIVE:** “Um login bem-sucedido zera as tentativas.” → REQ-0001.

## 5. Requisitos e casos falsificáveis

### REQ-0001
O sistema deve controlar as tentativas de login por usuário: o contador inicia em 0, cada falha incrementa o contador até o máximo de 3 tentativas consecutivas; ao atingir 3 falhas, a conta transita para BLOQUEADA e recusa novas tentativas; e um login bem-sucedido zera as tentativas.
*Base: USER_INTENT:Criar um controle de tentativas de login por usuário., USER_INTENT:O contador inicia em 0 e admite no máximo 3 falhas consecutivas., USER_INTENT:Cada falha incrementa o contador., USER_INTENT:Ao atingir 3 falhas, a conta transita para BLOQUEADA e recusa novas tentativas., USER_INTENT:Um login bem-sucedido zera as tentativas.*

- **AC-0001-01 — HAPPY_PATH**
  - Dado: Um usuário com 0 tentativas de falha realiza um login com credenciais corretas.
  - Quando: A operação de login bem-sucedido for processada.
  - Então: O login é autorizado com sucesso e o contador permanece em 0.
  - Resultado observável: RETURN_VALUE
- **AC-0001-02 — BOUNDARY**
  - Dado: Um usuário com 0 tentativas registra uma falha de login.
  - Quando: A falha de login for registrada.
  - Então: O contador de falhas é incrementado para 1 e a conta permanece desbloqueada.
  - Resultado observável: STATE_CHANGE
- **AC-0001-03 — BOUNDARY**
  - Dado: Um usuário com 2 falhas consecutivas registra a 3ª falha de login.
  - Quando: A falha de login for registrada.
  - Então: O contador atinge o limite de 3 falhas e o estado da conta transita para BLOQUEADA.
  - Resultado observável: STATE_CHANGE
- **AC-0001-04 — FAILURE**
  - Dado: Um usuário com a conta em estado BLOQUEADA tenta realizar login.
  - Quando: A tentativa de login for processada.
  - Então: A operação é recusada com erro ACCOUNT_BLOCKED sem alterar o contador.
  - Resultado observável: REJECTION
- **AC-0001-05 — HAPPY_PATH**
  - Dado: Um usuário com 2 falhas consecutivas realiza um login bem-sucedido.
  - Quando: A operação de login bem-sucedido for processada.
  - Então: O contador de tentativas de falha é resetado para 0 e a conta permanece desbloqueada.
  - Resultado observável: RETURN_VALUE

### Regras de limite e extrapolação
- Nenhum valor público de representação finita identificado.

### Revisão de determinismo
- **NOT_APPLICABLE:** A demanda não promete determinismo.
- **Cobertura CLAIM-0001/NO_DIMENSION_APPLICABLE:** nenhuma dimensão aplicável. Controle de login funcional não introduz fontes concorrentes não controladas.
- **Cobertura CLAIM-0002/NO_DIMENSION_APPLICABLE:** nenhuma dimensão aplicável. Limites numéricos determinísticos fixados no modelo de estado.
- **Cobertura CLAIM-0003/NO_DIMENSION_APPLICABLE:** nenhuma dimensão aplicável. Operação de incremento sequencial determinística.
- **Cobertura CLAIM-0004/NO_DIMENSION_APPLICABLE:** nenhuma dimensão aplicável. Transição para estado terminal bloqueado sem ambiguidade.
- **Cobertura CLAIM-0005/NO_DIMENSION_APPLICABLE:** nenhuma dimensão aplicável. Gatilho de reset imediato por evento de sucesso.

## 6. Inventário Semântico Auditável (State Model & Totalidade de Transição)

### 6.1 Entidades de Estado e Ciclo de Vida dos Campos

#### Entidade: `UserLoginState`
- **Descrição:** Sem descrição
- **Topologia:** Coleção dinâmica (instâncias múltiplas)
- **Política de Admissão:** `ON_FIRST_REQUEST`
- **Política de Capacidade:** Sem limite contratual (overflow: `NO_CONTRACT_LIMIT` — Mapeamento em memória indexado por chave de usuário sem restrição contratual pré-fixada)
- **Política de Contêiner:** Partição: `userId`, Retenção: `UNBOUNDED_CONTAINER` — Controle de usuários ativos sem expiração automática contratada

| Campo | Tipo | Limites (Bounds) | Inicialização | Reset | Mutações | Leitores |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `failedAttempts` | INTEGER (Contador) | [0, 3] (SATURATE; USER_INTENT:O contador inicia em 0 e admite no máximo 3 falhas consecutivas.) | EXPLICIT_VALUE: `0`<br>*O contador inicia em 0 conforme explicitado na demanda.* | `0` (gatilho: `recordLoginSuccess`) | `recordLoginFailure`: INCREMENT se `UserLoginState.isBlocked == false && UserLoginState.failedAttempts < 2`<br>`recordLoginFailure`: INCREMENT se `UserLoginState.isBlocked == false && UserLoginState.failedAttempts >= 2` | `recordLoginFailure`, `recordLoginSuccess`, `accountStatus` |
| `isBlocked` | BOOLEAN | N/A | EXPLICIT_VALUE: `false`<br>*A conta inicia desbloqueada.* | Proibido (preservado) | `recordLoginFailure`: SET_VALUE `true` se `UserLoginState.isBlocked == false && UserLoginState.failedAttempts >= 2` | `recordLoginFailure`, `recordLoginSuccess`, `accountStatus` |

### 6.2 Operações, Precedência Linear de Guardas e Efeitos de Transição

#### Operação: `recordLoginFailure`
- **Descrição:** Sem descrição
- **Precedência Linear Estrita de Guardas (Curto-Circuito):** 1. `GUARD_ALREADY_BLOCKED`

| Ramo (branchId) | Condição de Guarda | Desfecho | Status / Erro | Efeitos de Transição de Estado | Preservação Default |
| :--- | :--- | :--- | :--- | :--- | :---: |
| `GUARD_ALREADY_BLOCKED` | `UserLoginState.isBlocked == true` | `REJECTION` | `ACCOUNT_BLOCKED` | Nenhum efeito colateral | Sim |
| `INCREMENT_FAILURE` | `UserLoginState.isBlocked == false && UserLoginState.failedAttempts < 2` | `STATE_CHANGE` | `FAILURE_RECORDED` | `UserLoginState.failedAttempts` := INCREMENT `1`<br>`UserLoginState.isBlocked` := PRESERVE | Não |
| `TRANSITION_TO_BLOCKED` | `UserLoginState.isBlocked == false && UserLoginState.failedAttempts >= 2` | `STATE_CHANGE` | `BLOCKED` | `UserLoginState.failedAttempts` := INCREMENT `1`<br>`UserLoginState.isBlocked` := SET `true` | Não |

#### Operação: `recordLoginSuccess`
- **Descrição:** Sem descrição
- **Precedência Linear Estrita de Guardas (Curto-Circuito):** 1. `GUARD_ALREADY_BLOCKED`

| Ramo (branchId) | Condição de Guarda | Desfecho | Status / Erro | Efeitos de Transição de Estado | Preservação Default |
| :--- | :--- | :--- | :--- | :--- | :---: |
| `GUARD_ALREADY_BLOCKED` | `UserLoginState.isBlocked == true` | `REJECTION` | `ACCOUNT_BLOCKED` | Nenhum efeito colateral | Sim |
| `SUCCESS_RESET` | `UserLoginState.isBlocked == false` | `RETURN_VALUE` | `LOGIN_ALLOWED` | `UserLoginState.failedAttempts` := SET `0`<br>`UserLoginState.isBlocked` := PRESERVE | Não |

### 6.3 Observáveis Públicos

#### Observável: `accountStatus`
- **Representação:** `RECORD`
- **Derivado de:** `UserLoginState.failedAttempts`, `UserLoginState.isBlocked`
- **Comportamento quando Vazio:** `UNINITIALIZED_ZERO_FAILURES`

## 7. Invariantes
- **INV-0001:** O contador de falhas consecutivas de um usuário é um número inteiro no intervalo de 0 a 3, e uma conta em estado BLOQUEADA nunca admite novas tentativas de login.
  - Falsificado se: O contador assume valor negativo, ultrapassa 3, ou uma conta bloqueada permite tentativa de login.

## 8. Riscos e vulnerabilidades
- **Sem riscos adicionais (NONE):** Máquina de estados finita determinística com ciclo de vida e transições delimitados.
- Nenhum risco material identificado.

## 9. Parecer adversarial
- **NO_ADDITIONAL_FINDINGS:** Os casos cobrem todas as transições: início em zero, falha incremental, saturação em 3 com bloqueio, curto-circuito de rejeição em estado bloqueado e reset por sucesso.

## 10. Decisões humanas seladas
Nenhuma ambiguidade material detectada.


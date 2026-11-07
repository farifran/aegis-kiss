# Issue / Contrato: Limitador de Requisições por Janela Deslizante

> **Status:** Selado & Governado
> **Modo:** PRODUCT
> **Determinismo efetivo:** NOT_APPLICABLE
> **Certificado de Fechamento:** CERTIFIED_CLOSED (inventário pendente: 0, dependências abertas: 0, campos não resolvidos: 0, transições abertas: 0, lacunas ativas: 0)
> **IMPLEMENTATION_AUTHORIZED:** `false`
> **Digest do Contrato:** `e47152ab90c6d2087f635e459fd045641849bffd04b50105c04cb78f21741ffc`
> **Rascunho aprovado:** `d5e67ca6d04e49c660c30138a9b59914ae180cc9267c22afb38d86cacef80e25`
> **Confirmação humana:** CONTRACT_REVIEWED_AND_APPROVED via DIRECT_COMMAND
> **Custódia (Preflight / Request / src):** `fe93bb57cc83` / `d74db403359e` / `f43c49182271`

## 1. Demanda interpretada
Especificar limitador de requisições por API key utilizando janela deslizante de 60 segundos com capacidade máxima de 10 requisições, resposta HTTP 429 para excedentes e expiração automática por TTL.

> A intenção integral permanece preservada no JSON canônico e vinculada pelo digest do preflight; esta visão humana evita repeti-la.

## 2. Escopo
**Incluído:**
- Controle de taxa de requisições por chave de API.
- Janela deslizante de 60 segundos com capacidade de até 10 requisições.
- Rejeição com código HTTP 429 para requisições acima do limite.
- Descarte e expiração de eventos com mais de 60 segundos.

**Fora do escopo:**
- Autenticação criptográfica de chaves de API.
- Persistência externa distribuída (Redis/banco de dados).
- Configuração dinâmica de cotas por perfil de usuário.

**Caminhos observados — não autorizam implementação:**
- Nenhum caminho pré-existente observado no workspace (repositório greenfield).

**Referências de caminho classificadas:**
- Nenhuma referência de caminho normativa ou sugerida.

> Uma superfície pública define onde algo é exposto; não obriga toda a implementação a residir nesse arquivo. Sugestões e evidências não são normativas.

## 3. Governança e correções antecipadas
- **Contextos detectados:** product-demand, stateful-operation, time-dependent, bounded-observability, public-interface
- **Evidência neutra:** 3 fragmento(s), 3 fato(s) literal(is).
- **Regras aplicáveis já conformes:** ARCH-PRODUCT-BOUNDARY, ARCH-FAILURE-EXPLICIT, ARCH-DETERMINISTIC-TIME, ARCH-OBSERVABILITY-COUNTERS, ARCH-PUBLIC-INTERFACE, ARCH-CONTRACT-CONSISTENCY, ARCH-STATE-TRANSITION-TOTALITY, ARCH-TEMPORAL-INVARIANCE, ARCH-MINIMAL-SUFFICIENT-CLOSURE.
- Nenhuma correção constitucional necessária.

## 4. Revisão de complexidade
- **NO_EXCESS:** A especificação adota janela deslizante em memória enxuta e suficiente para o requisito.

### Rastreabilidade da intenção
- **CLAIM-0001 — OBLIGATION/NORMATIVE:** “Limitador de requisições por API key que permita no máximo 10 requisições por minuto utilizando janela deslizante (sliding window).” → REQ-0001.
- **CLAIM-0002 — OBLIGATION/NORMATIVE:** “Requisições excedentes devem responder com código 429.” → REQ-0001.
- **CLAIM-0003 — OBLIGATION/NORMATIVE:** “Eventos com mais de 60 segundos devem expirar e ser descartados do cômputo.” → REQ-0001.

## 5. Requisitos e casos falsificáveis

### REQ-0001
O sistema deve limitar requisições por API key permitindo no máximo 10 requisições por minuto utilizando janela deslizante de 60 segundos, respondendo com código 429 para requisições excedentes e expirando eventos com mais de 60 segundos.
*Base: USER_INTENT:Limitador de requisições por API key que permita no máximo 10 requisições por minuto utilizando janela deslizante (sliding window)., USER_INTENT:Requisições excedentes devem responder com código 429., USER_INTENT:Eventos com mais de 60 segundos devem expirar e ser descartados do cômputo.*

- **AC-0001-01 — HAPPY_PATH**
  - Dado: Uma API key sem requisições prévias realiza a 1ª requisição no instante t=0s.
  - Quando: A validação do limitador de requisições for executada.
  - Então: A requisição é permitida com status 200 e o contador na janela atual passa para 1.
  - Resultado observável: RETURN_VALUE
- **AC-0001-02 — BOUNDARY**
  - Dado: Uma API key com 9 requisições já registradas nos últimos 60 segundos realiza a 10ª requisição.
  - Quando: A validação do limitador de requisições for executada.
  - Então: A requisição é permitida com status 200 e o contador na janela atinge o limite máximo de 10.
  - Resultado observável: RETURN_VALUE
- **AC-0001-03 — FAILURE**
  - Dado: Uma API key que já atingiu o limite de 10 requisições na janela ativa de 60 segundos realiza uma 11ª requisição.
  - Quando: A validação do limitador de requisições for executada.
  - Então: A requisição é bloqueada respondendo com código 429 (Too Many Requests).
  - Resultado observável: REJECTION
- **AC-0001-04 — BOUNDARY**
  - Dado: Uma API key com 10 requisições na janela onde os eventos mais antigos completam 61 segundos de idade.
  - Quando: A janela deslizante for avaliada após a expiração dos eventos de mais de 60s.
  - Então: Os eventos expirados são descartados do cômputo da janela e nova requisição é permitida com status 200.
  - Resultado observável: RETURN_VALUE

### Regras de limite e extrapolação
- Nenhum valor público de representação finita identificado.

### Revisão de determinismo
- **NOT_APPLICABLE:** A demanda não promete determinismo.
- **Cobertura CLAIM-0001/NO_DIMENSION_APPLICABLE:** nenhuma dimensão aplicável. O limitador em janela deslizante é determinístico em função do tempo fornecido.
- **Cobertura CLAIM-0002/NO_DIMENSION_APPLICABLE:** nenhuma dimensão aplicável. Código 429 é retornado de forma determinística quando a cota é atingida.
- **Cobertura CLAIM-0003/NO_DIMENSION_APPLICABLE:** nenhuma dimensão aplicável. A expiração por TTL de 60 segundos é estritamente mensurável sem ambiguidade temporal.

## 6. Inventário Semântico Auditável (State Model & Totalidade de Transição)

### 6.1 Entidades de Estado e Ciclo de Vida dos Campos

#### Entidade: `ApiKeyRateLimitState`
- **Descrição:** Sem descrição
- **Topologia:** Coleção dinâmica (instâncias múltiplas)
- **Política de Admissão:** `ON_FIRST_REQUEST`
- **Política de Capacidade:** Máx 10 entradas (overflow: `SLIDING_WINDOW_EVICTION` [Base: USER_INTENT:FACT-0001])
- **Política de Contêiner:** Partição: `apiKey`, Retenção: `SLIDING_WINDOW_EVICTION` (60)

| Campo | Tipo | Limites (Bounds) | Inicialização | Reset | Mutações | Leitores |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `activeRequestCount` | INTEGER (Contador) [SECONDS] | [0, 10] (REJECT; USER_INTENT:FACT-0001) | EXPLICIT_VALUE: `0`<br>*Janela inicializa sem requisições registradas.* | `0` (gatilho: `WINDOW_ELAPSED_NO_TRAFFIC`) | `evaluateRateLimit`: INCREMENT se `activeRequestCount < 10`<br>`evaluateRateLimit`: DECREMENT se `hasExpiredEvents` | `evaluateRateLimit`, `rateLimitStatus` |
| `windowTtlSeconds` | INTEGER [SECONDS] | [60, 60] (PRESERVE; USER_INTENT:FACT-0003) | EXPLICIT_VALUE: `60`<br>*Duração fixa da janela deslizante de 60 segundos.* | Proibido (preservado) | Nenhuma (imutável pós-init) | `evaluateRateLimit`, `rateLimitStatus` |

### 6.2 Operações, Precedência Linear de Guardas e Efeitos de Transição

#### Operação: `evaluateRateLimit`
- **Descrição:** Sem descrição
- **Precedência Linear Estrita de Guardas (Curto-Circuito):** 1. `GUARD_RATE_LIMIT_EXCEEDED`

| Ramo (branchId) | Condição de Guarda | Desfecho | Status / Erro | Efeitos de Transição de Estado | Preservação Default |
| :--- | :--- | :--- | :--- | :--- | :---: |
| `GUARD_RATE_LIMIT_EXCEEDED` | `ApiKeyRateLimitState.activeRequestCount >= 10` | `REJECTION` | `HTTP_429_TOO_MANY_REQUESTS` | Nenhum efeito colateral | Sim |
| `ALLOW_REQUEST` | `ApiKeyRateLimitState.activeRequestCount < 10` | `RETURN_VALUE` | `HTTP_200_OK` | `ApiKeyRateLimitState.activeRequestCount` := INCREMENT `1`<br>`ApiKeyRateLimitState.windowTtlSeconds` := PRESERVE | Não |

### 6.3 Observáveis Públicos

#### Observável: `rateLimitStatus`
- **Representação:** `RECORD`
- **Derivado de:** `ApiKeyRateLimitState.activeRequestCount`, `ApiKeyRateLimitState.windowTtlSeconds`
- **Comportamento quando Vazio:** `INITIAL_ZERO_REQUESTS`

## 7. Invariantes
- **INV-0001:** O número de requisições ativas admitidas para uma mesma API key dentro de qualquer intervalo deslizante de 60 segundos nunca excede 10, e qualquer requisição que exceda esse teto responde com código 429.
  - Falsificado se: Mais de 10 requisições são autorizadas em uma janela de 60 segundos, ou uma requisição excedente não responde com código 429.

## 8. Riscos e vulnerabilidades
- **Sem riscos adicionais (NONE):** Janela deslizante com limites e expiração explícitos, eliminando risco de vazamento de memória ou contagem infinita.
- Nenhum risco material identificado.

## 9. Parecer adversarial
- **NO_ADDITIONAL_FINDINGS:** Os casos cobrem a primeira requisição, a 10ª requisição no limite exato da janela, o bloqueio com 429 na 11ª requisição e a recuperação após 61 segundos com descarte de eventos expirados.

## 10. Decisões humanas seladas
Nenhuma ambiguidade material detectada.


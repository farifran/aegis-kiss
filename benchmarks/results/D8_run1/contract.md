# Issue / Contrato: Finalização de Pedido com Webhook de Faturamento e Rollback por Compensação

> **Status:** Selado & Governado
> **Modo:** PRODUCT
> **Determinismo efetivo:** NOT_APPLICABLE
> **Certificado de Fechamento:** CERTIFIED_CLOSED (inventário pendente: 0, dependências abertas: 0, campos não resolvidos: 0, transições abertas: 0, lacunas ativas: 0)
> **IMPLEMENTATION_AUTHORIZED:** `false`
> **Digest do Contrato:** `c7a752b7176e1778c3ee71b8a8da93c2cacb630cc0c9f4288fb4bd50dc587423`
> **Rascunho aprovado:** `1d74a1cc230db3af627a992f675dcc83c1d045b728b876b9cd164c637b8d8579`
> **Confirmação humana:** CONTRACT_REVIEWED_AND_APPROVED via DIRECT_COMMAND
> **Custódia (Preflight / Request / src):** `3694195bf065` / `c60018a5bd9d` / `f43c49182271`

## 1. Demanda interpretada
Especificar finalização de pedido de e-commerce com reserva transacional de estoque local e despacho assíncrono de webhook de faturamento para gateway de pagamento externo, garantindo reversão mecânica do débito de estoque (rollback por compensação) caso o webhook falhe ou expire.

> A intenção integral permanece preservada no JSON canônico e vinculada pelo digest do preflight; esta visão humana evita repeti-la.

## 2. Escopo
**Incluído:**
- Débito transacional de estoque local no banco de dados para produtos do pedido.
- Despacho de evento de faturamento para gateway de pagamento externo via webhook.
- Reversão mecânica automática (rollback por compensação) do débito de estoque em caso de falha ou timeout do webhook.
- Guarda determinística de estoque insuficiente impedindo despacho de webhook.

**Fora do escopo:**
- Implementação interna do protocolo HTTP ou drivers de banco de dados.
- Cálculo de frete, impostos e cupons promocionais.
- Roteamento de gateways redundantes ou reexecução automática externa (retries).

**Caminhos observados — não autorizam implementação:**
- Nenhum caminho pré-existente observado no workspace (repositório greenfield).

**Referências de caminho classificadas:**
- Nenhuma referência de caminho normativa ou sugerida.

> Uma superfície pública define onde algo é exposto; não obriga toda a implementação a residir nesse arquivo. Sugestões e evidências não são normativas.

## 3. Governança e correções antecipadas
- **Contextos detectados:** product-demand, stateful-operation, external-effect, public-interface
- **Evidência neutra:** 2 fragmento(s), 0 fato(s) literal(is).
- **Regras aplicáveis já conformes:** ARCH-PRODUCT-BOUNDARY, ARCH-FAILURE-EXPLICIT, ARCH-PUBLIC-INTERFACE, ARCH-CONTRACT-CONSISTENCY, ARCH-STATE-TRANSITION-TOTALITY, ARCH-MINIMAL-SUFFICIENT-CLOSURE.
- Nenhuma correção constitucional necessária.

## 4. Revisão de complexidade
- **NO_EXCESS:** A especificação modela estritamente a compensação transacional e o efeito externo do webhook conforme demandado, sem padrões de arquitetura especulativos.

### Rastreabilidade da intenção
- **CLAIM-0001 — OBLIGATION/NORMATIVE:** “Finalizar pedido de e-commerce: debitar estoque no banco local e despachar evento de faturamento para gateway de pagamento externo via webhook.” → REQ-0001.
- **CLAIM-0002 — OBLIGATION/NORMATIVE:** “Se a confirmação do webhook falhar ou expirar, a operação deve reverter a reserva de estoque localmente.” → REQ-0001.

## 5. Requisitos e casos falsificáveis

### REQ-0001
O sistema deve finalizar o pedido de e-commerce debitando a quantidade solicitada do estoque local em banco e despachando o evento de faturamento via webhook para o gateway externo. Se a confirmação do webhook falhar ou expirar, a operação deve reverter a reserva de estoque localmente via compensação, restaurando o saldo do estoque ao estado anterior.
*Base: USER_INTENT:Finalizar pedido de e-commerce: debitar estoque no banco local e despachar evento de faturamento para gateway de pagamento externo via webhook., USER_INTENT:Se a confirmação do webhook falhar ou expirar, a operação deve reverter a reserva de estoque localmente.*

- **AC-0001-01 — HAPPY_PATH**
  - Dado: Um produto com 10 unidades em estoque local solicita finalização de pedido de 2 unidades.
  - Quando: A operação de finalização de pedido for executada e o webhook responder com confirmação de sucesso.
  - Então: O estoque local é debitado em 2 unidades (restando 8 unidades) e o pedido é finalizado com status de sucesso.
  - Resultado observável: RETURN_VALUE
- **AC-0001-02 — FAILURE**
  - Dado: Um produto com 1 unidade em estoque solicita pedido de 5 unidades.
  - Quando: A operação de finalização de pedido for invocada.
  - Então: A operação é rejeitada com erro ESTOQUE_INSUFICIENTE na guarda prévia, preservando o estoque em 1 unidade e sem acionar webhook.
  - Resultado observável: REJECTION
- **AC-0001-03 — FAILURE**
  - Dado: Um produto com 10 unidades em estoque realiza pedido de 3 unidades, mas a confirmação do webhook falha com erro 500 do gateway.
  - Quando: A falha do webhook for detectada durante a finalização do pedido.
  - Então: A operação é rejeitada com FALHA_WEBHOOK_ESTOQUE_COMPENSADO e executa compensação transacional, restaurando o estoque para as 10 unidades originais.
  - Resultado observável: REJECTION
- **AC-0001-04 — BOUNDARY**
  - Dado: Um produto com 10 unidades em estoque realiza pedido de 4 unidades e a chamada ao webhook sofre timeout sem resposta.
  - Quando: O tempo limite de confirmação expirar.
  - Então: A expiração do webhook ativa o rollback por compensação, estornando as 4 unidades reservadas e preservando o estoque integralmente em 10 unidades.
  - Resultado observável: REJECTION

### Regras de limite e extrapolação
- Nenhum valor público de representação finita identificado.

### Revisão de determinismo
- **NOT_APPLICABLE:** A demanda não promete determinismo.
- **Cobertura CLAIM-0001/NO_DIMENSION_APPLICABLE:** nenhuma dimensão aplicável. A finalização do pedido e débito de estoque seguem fluxo sequencial síncrono.
- **Cobertura CLAIM-0002/NO_DIMENSION_APPLICABLE:** nenhuma dimensão aplicável. A reversão por compensação é acionada deterministamente sob falha ou timeout do webhook.

## 6. Inventário Semântico Auditável (State Model & Totalidade de Transição)

### 6.1 Entidades de Estado e Ciclo de Vida dos Campos

#### Entidade: `EstoqueProduto`
- **Descrição:** Controle transacional de estoque local em banco de dados para produtos do e-commerce.
- **Topologia:** Coleção dinâmica (instâncias múltiplas)
- **Política de Admissão:** `ON_FIRST_REQUEST`
- **Política de Capacidade:** Sem limite contratual (overflow: `NO_CONTRACT_LIMIT` — Produtos cadastrados dinamicamente no catálogo conforme demanda.)
- **Política de Contêiner:** Partição: `produtoId`, Retenção: `UNBOUNDED_CONTAINER` — Estoque de produtos persiste durante o ciclo de vida do catálogo.

| Campo | Tipo | Limites (Bounds) | Inicialização | Reset | Mutações | Leitores |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `quantidadeDisponivel` | INTEGER (Contador) | [0, +∞] (REJECT; USER_INTENT:debitar estoque no banco local) | EXPLICIT_VALUE: `0`<br>*Estoque inicializado em zero até carga ou reabastecimento.* | Proibido (preservado) | `finalizarPedido`: DECREMENT `quantidadeItem` se `EstoqueProduto.quantidadeDisponivel >= quantidadeItem` | `finalizarPedido`, `estadoEstoque` |

### 6.2 Operações, Precedência Linear de Guardas e Efeitos de Transição

#### Operação: `finalizarPedido`
- **Descrição:** Sem descrição
- **Precedência Linear Estrita de Guardas (Curto-Circuito):** 1. `GUARD_ESTOQUE_INSUFICIENTE`

##### Contrato Público de Entrada (Public Input Contract):

| Parâmetro | Tipo | Domínio | Limites (Bounds) | Nulabilidade | Produtor | Tratamento Inválido (onInvalid) |
| :--- | :--- | :--- | :--- | :---: | :--- | :--- |
| `pedidoId` | `STRING` | `Identificador único do pedido de e-commerce.` | N/A | `NOT_NULL` | `N/A` | N/A |
| `quantidadeItem` | `INTEGER` | `Quantidade de itens solicitada para débito de estoque.` | N/A | `NOT_NULL` | `N/A` | N/A |
| `webhookFalhouOuExpirou` | `BOOLEAN` | `Indicador de falha na entrega, rejeição ou timeout de confirmação do webhook de faturamento.` | N/A | `NOT_NULL` | `N/A` | N/A |

| Ramo (branchId) | Condição de Guarda | Desfecho | Status / Erro | Efeitos de Transição de Estado | Preservação Default |
| :--- | :--- | :--- | :--- | :--- | :---: |
| `GUARD_ESTOQUE_INSUFICIENTE` | `EstoqueProduto.quantidadeDisponivel < quantidadeItem` | `REJECTION` | `ESTOQUE_INSUFICIENTE` | Nenhum efeito colateral | Sim |
| `BRANCH_SUCESSO_CONFIRMADO` | `EstoqueProduto.quantidadeDisponivel >= quantidadeItem && webhookFalhouOuExpirou == false` | `RETURN_VALUE` | `PEDIDO_FINALIZADO_FATURAMENTO_CONFIRMADO` | `EstoqueProduto.quantidadeDisponivel` := DECREMENT `quantidadeItem` | Não |
| `BRANCH_FALHA_WEBHOOK_COMPENSACAO` | `EstoqueProduto.quantidadeDisponivel >= quantidadeItem && webhookFalhouOuExpirou == true` | `REJECTION` | `FALHA_WEBHOOK_ESTOQUE_COMPENSADO` | `EstoqueProduto.quantidadeDisponivel` := PRESERVE | Sim |

### 6.3 Observáveis Públicos

#### Observável: `estadoEstoque`
- **Representação:** `RECORD`
- **Derivado de:** `EstoqueProduto.quantidadeDisponivel`
- **Comportamento quando Vazio:** `ESTOQUE_NAO_ENCONTRADO`

### 6.4 Grafo de Efeitos Externos e Reversão Mecânica (External Effect & Rollback Graph)

| Operação / Ramo | Ação Externa | Alvo / Superfície | Preserva mtime | Confirmação Física (Check) | Desfecho Sucesso (onSuccess) | Desfecho Falha (onFailure) | Estratégia de Rollback |
| :--- | :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| `finalizarPedido (BRANCH_SUCESSO_CONFIRMADO)` | `APPEND_LOG` | `webhook/payment_gateway` | Não | `HTTP 200/204 recebido do gateway de pagamento dentro da janela de confirmação` | `Faturamento confirmado com sucesso pelo gateway de pagamento` | `Acionar compensação transacional e estorno de estoque local` | `COMPENSATING_ACTION<br>Compensação: `Reverter reserva de estoque localmente incrementando a quantidade anteriormente debitada.`` |
| `finalizarPedido (BRANCH_FALHA_WEBHOOK_COMPENSACAO)` | `APPEND_LOG` | `webhook/payment_gateway` | Não | `Falha de conexão, erro HTTP 5xx ou timeout de resposta do gateway` | `Falha reportada e compensação registrada` | `Log de compensação emitido` | `COMPENSATING_ACTION<br>Compensação: `Reverter reserva de estoque localmente incrementando a quantidade anteriormente debitada.`` |

## 7. Invariantes
- **INV-0001:** O estoque local só permanece debitado se a confirmação do webhook de faturamento obtiver sucesso explícito; qualquer falha ou timeout de webhook obriga a compensação integral do estoque reservado.
  - Falsificado se: O estoque local permanece debitado após falha ou expiração do webhook, ou o webhook é disparado para pedido com saldo insuficiente.

## 8. Riscos e vulnerabilidades
- **Sem riscos adicionais (NONE):** O risco de inconsistência entre débito local e falha remota é mitigado pela estratégia formal de rollback por compensação.
- Nenhum risco material identificado.

## 9. Parecer adversarial
- **NO_ADDITIONAL_FINDINGS:** Os casos cobrem estoque insuficiente, sucesso de ponta a ponta com confirmação de pagamento, falha de conexão HTTP 500 do gateway e expiração de timeout do webhook com compensação estrita.

## 10. Decisões humanas seladas
Nenhuma ambiguidade material detectada.


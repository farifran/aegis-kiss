# Issue / Contrato: Programa de Fidelidade e Cashback

> **Status:** Selado & Governado
> **Modo:** PRODUCT
> **Determinismo efetivo:** NOT_APPLICABLE
> **Certificado de Fechamento:** CERTIFIED_CLOSED (inventário pendente: 0, dependências abertas: 0, campos não resolvidos: 0, transições abertas: 0, lacunas ativas: 0)
> **IMPLEMENTATION_AUTHORIZED:** `false`
> **Digest do Contrato:** `6c08f852f8bd5571b42b082abc91a0ad6e4da67453bbcc551e47b431d6719eee`
> **Rascunho aprovado:** `b061566ff8b62768d30cbab2ecca678d6b76136f291296053bff983fcc390782`
> **Confirmação humana:** CONTRACT_REVIEWED_AND_APPROVED via DIRECT_COMMAND
> **Custódia (Preflight / Request / src):** `aa8fca0fa76e` / `5d2a6092156b` / `f43c49182271`

## 1. Demanda interpretada
Especificar o acúmulo de pontos de fidelidade a cada R$ 10,00 gastos, deliberando sobre a política de valores residuais fracionários.

> A intenção integral permanece preservada no JSON canônico e vinculada pelo digest do preflight; esta visão humana evita repeti-la.

## 2. Escopo
**Incluído:**
- Cálculo e atualização do saldo de pontos a partir do valor da compra.
- Tratamento de compras proporcionais a R$ 10,00.

**Fora do escopo:**
- Resgate de pontos e integração com meios de pagamento.

**Caminhos observados — não autorizam implementação:**
- Nenhum caminho pré-existente observado no workspace (repositório greenfield).

**Referências de caminho classificadas:**
- Nenhuma referência de caminho normativa ou sugerida.

> Uma superfície pública define onde algo é exposto; não obriga toda a implementação a residir nesse arquivo. Sugestões e evidências não são normativas.

## 3. Governança e correções antecipadas
- **Contextos detectados:** product-demand
- **Evidência neutra:** 2 fragmento(s), 3 fato(s) literal(is).
- **Regras aplicáveis já conformes:** ARCH-PRODUCT-BOUNDARY, ARCH-CONTRACT-CONSISTENCY, ARCH-MINIMAL-SUFFICIENT-CLOSURE.
- Nenhuma correção constitucional necessária.

## 4. Revisão de complexidade
- **NO_EXCESS:** A especificação não adiciona camadas ou subsistemas além da operação de acúmulo.

### Rastreabilidade da intenção
- **CLAIM-0001 — OBLIGATION/NORMATIVE:** “Programa de fidelidade: a cada R$ 10,00 em compras, o cliente acumula 1 ponto de cashback.” → REQ-0001.
- **CLAIM-0002 — AMBIGUITY/DECISION:** “a cada R$ 10,00 em compras, o cliente acumula 1 ponto de cashback.” → Q-0001.
- **CLAIM-0003 — OBLIGATION/NORMATIVE:** “O sistema deve receber o valor total da compra e atualizar o saldo de pontos.” → REQ-0001.

## 5. Requisitos e casos falsificáveis

### REQ-0001
O sistema deve receber o valor da compra e atualizar o saldo de pontos concedendo 1 ponto a cada R$ 10,00, descartando qualquer fração residual.
*Base: USER_INTENT:Programa de fidelidade: a cada R$ 10,00 em compras, o cliente acumula 1 ponto de cashback., USER_INTENT:O sistema deve receber o valor total da compra e atualizar o saldo de pontos., USER_DECISION:Q-0001*

- **AC-0001-01 — HAPPY_PATH**
  - Dado: Um cliente realiza compra de R$ 30,00.
  - Quando: O saldo de pontos for atualizado.
  - Então: O saldo de pontos deve ser incrementado em 3 pontos.
  - Resultado observável: RETURN_VALUE
- **AC-0001-02 — BOUNDARY**
  - Dado: Um cliente realiza compra de R$ 9,99.
  - Quando: O saldo de pontos for atualizado.
  - Então: Nenhum ponto é concedido e o valor residual é descartado.
  - Resultado observável: RETURN_VALUE
- **AC-0001-03 — FAILURE**
  - Dado: Uma solicitação com valor de compra negativo de R$ -10,00.
  - Quando: A atualização for solicitada.
  - Então: A operação deve falhar com erro de valor inválido.
  - Resultado observável: REJECTION

### Regras de limite e extrapolação
- Nenhum valor público de representação finita identificado.

### Revisão de determinismo
- **NOT_APPLICABLE:** A demanda não promete determinismo.
- **Cobertura CLAIM-0001/NO_DIMENSION_APPLICABLE:** nenhuma dimensão aplicável. O acúmulo funcional direto não introduz fontes de concorrência ou deriva.
- **Cobertura CLAIM-0002/NO_DIMENSION_APPLICABLE:** nenhuma dimensão aplicável. A ambiguidade de valores residuais é resolvida pela decisão humana pendente.
- **Cobertura CLAIM-0003/NO_DIMENSION_APPLICABLE:** nenhuma dimensão aplicável. A operação de recepção de valor não ativa dimensões de determinismo.

## 6. Invariantes
- **INV-0001:** O saldo de pontos acumulados é um número inteiro não negativo.
  - Falsificado se: O saldo de pontos torna-se negativo ou fracionário.

## 7. Riscos e vulnerabilidades
- **Sem riscos adicionais (NONE):** A única incerteza material reside no tratamento de valores fracionários, exposta para deliberação humana.
- Nenhum risco material identificado.

## 8. Parecer adversarial
- **CHALLENGES_INTEGRATED:** A principal objeção à opção recomendada é o descarte de centavos pagos pelo consumidor.
- **ADV-0001 — TECHNICAL_RISK/REQUIREMENT:** O descarte de centavos pode causar fricção em consumidores com compras fracionadas frequentes.
  - Resposta incorporada: O sistema deve receber o valor da compra e atualizar o saldo de pontos concedendo 1 ponto a cada R$ 10,00, descartando qualquer fração residual.
  - Afeta: REQ-0001.
  - Base: MODEL_ANALYSIS:analysis

## 9. Decisões humanas seladas
Nenhuma ambiguidade material detectada.

### Decisões humanas incorporadas por recompilação
- **Q-0001: Como tratar frações de valor de compra inferiores a R$ 10,00 (ex: compra de R$ 15,00)?** → Descartar frações residuais (Truncamento simples por compra). Menor complexidade estrutural suficiente (KISS). Não exige manter persistência de centavos residuais acumulados.
  - Efeito incorporado: O sistema deve receber o valor da compra e atualizar o saldo de pontos concedendo 1 ponto a cada R$ 10,00, descartando qualquer fração residual.
  - Evidência: CONTRACT_REVIEWED_AND_APPROVED via INTERACTIVE_WIZARD; rascunho `a8531639500ac1c1e90c1ce371331186f687406d6d4818ac5f49f2e0ff59f0fc`.


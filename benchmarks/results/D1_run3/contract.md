# Issue / Contrato: Cálculo de Desconto de Produto

> **Status:** Selado & Governado
> **Modo:** PRODUCT
> **Determinismo efetivo:** SEMANTICALLY_CLOSED
> **Certificado de Fechamento:** CERTIFIED_CLOSED (inventário pendente: 0, dependências abertas: 0, campos não resolvidos: 0, transições abertas: 0, lacunas ativas: 0)
> **IMPLEMENTATION_AUTHORIZED:** `false`
> **Digest do Contrato:** `f9c598727ed63bf9bfd6a5b478233c2199babc4db1081286b425c4604badb10e`
> **Rascunho aprovado:** `62fdd130090a898b33eda04b15d5785fd23fb50064038db6693b4cb975b61e78`
> **Confirmação humana:** CONTRACT_REVIEWED_AND_APPROVED via DIRECT_COMMAND
> **Custódia (Preflight / Request / src):** `bc25d0cf0dd5` / `a1065ed8554c` / `f43c49182271`

## 1. Demanda interpretada
Especificar o cálculo de desconto para produtos a partir de preço base e porcentagem (0 a 100), com rejeição determinística de entradas inválidas.

> A intenção integral permanece preservada no JSON canônico e vinculada pelo digest do preflight; esta visão humana evita repeti-la.

## 2. Escopo
**Incluído:**
- Cálculo proporcional do desconto para entradas válidas.
- Rejeição determinística de preços negativos e porcentagens fora de 0 a 100.

**Fora do escopo:**
- Armazenamento de dados ou interface com usuário.

**Caminhos observados — não autorizam implementação:**
- Nenhum caminho pré-existente observado no workspace (repositório greenfield).

**Referências de caminho classificadas:**
- Nenhuma referência de caminho normativa ou sugerida.

> Uma superfície pública define onde algo é exposto; não obriga toda a implementação a residir nesse arquivo. Sugestões e evidências não são normativas.

## 3. Governança e correções antecipadas
- **Contextos detectados:** product-demand
- **Evidência neutra:** 2 fragmento(s), 2 fato(s) literal(is).
- **Regras aplicáveis já conformes:** ARCH-PRODUCT-BOUNDARY, ARCH-CONTRACT-CONSISTENCY, ARCH-MINIMAL-SUFFICIENT-CLOSURE.
- Nenhuma correção constitucional necessária.

## 4. Revisão de complexidade
- **NO_EXCESS:** A especificação adota a menor solução suficiente sem abstrações especulativas ou sobre-engenharia.

### Rastreabilidade da intenção
- **CLAIM-0001 — OBLIGATION/NORMATIVE:** “Calcular o desconto de um produto dado o preço base e a porcentagem de desconto (0 a 100).” → REQ-0001.
- **CLAIM-0002 — OBLIGATION/NORMATIVE:** “Preços negativos ou porcentagens fora do intervalo devem ser rejeitados com erro determinístico.” → REQ-0001.

## 5. Requisitos e casos falsificáveis

### REQ-0001
O sistema deve calcular o desconto proporcional multiplicando o preço base pela porcentagem dividida por 100, rejeitando deterministamente preços negativos ou porcentagens fora de 0 a 100.
*Base: USER_INTENT:Calcular o desconto de um produto dado o preço base e a porcentagem de desconto (0 a 100)., USER_INTENT:Preços negativos ou porcentagens fora do intervalo devem ser rejeitados com erro determinístico.*

- **AC-0001-01 — HAPPY_PATH**
  - Dado: Preço base de 100.0 e porcentagem de desconto de 15.0.
  - Quando: O cálculo do desconto for executado.
  - Então: O valor retornado deve ser exatamente 15.0.
  - Resultado observável: RETURN_VALUE
- **AC-0001-02 — BOUNDARY**
  - Dado: Preço base de 200.0 e porcentagem de desconto de 0.0.
  - Quando: O cálculo do desconto for executado.
  - Então: O valor retornado deve ser exatamente 0.0.
  - Resultado observável: RETURN_VALUE
- **AC-0001-03 — BOUNDARY**
  - Dado: Preço base de 50.0 e porcentagem de desconto de 100.0.
  - Quando: O cálculo do desconto for executado.
  - Então: O valor retornado deve ser exatamente 50.0.
  - Resultado observável: RETURN_VALUE
- **AC-0001-04 — FAILURE**
  - Dado: Preço base negativo de -10.0 e porcentagem de 20.0.
  - Quando: O cálculo do desconto for solicitado.
  - Então: A execução deve falhar com erro determinístico indicando preço negativo.
  - Resultado observável: REJECTION
- **AC-0001-05 — FAILURE**
  - Dado: Preço base de 100.0 e porcentagem negativa de -5.0.
  - Quando: O cálculo do desconto for solicitado.
  - Então: A execução deve falhar com erro determinístico indicando porcentagem menor que zero.
  - Resultado observável: REJECTION
- **AC-0001-06 — FAILURE**
  - Dado: Preço base de 100.0 e porcentagem excessiva de 105.0.
  - Quando: O cálculo do desconto for solicitado.
  - Então: A execução deve falhar com erro determinístico indicando porcentagem maior que 100.
  - Resultado observável: REJECTION

### Regras de limite e extrapolação
- Nenhum valor público de representação finita identificado.

### Revisão de determinismo
- **SEMANTICALLY_CLOSED:** A demanda promete expressamente erro determinístico para entradas inválidas.
- **Cobertura CLAIM-0001/NO_DIMENSION_APPLICABLE:** nenhuma dimensão aplicável. O cálculo proporcional puro não apresenta fontes concorrentes de não determinismo.
- **Cobertura CLAIM-0002/DIMENSIONS_DECLARED:** DETERMINISTIC_REJECTION/REQ-0001. A promessa explícita de erro determinístico é formalizada na dimensão de rejeição.
- **DETERMINISTIC_REJECTION/REQ-0001/SPECIFIED:** A demanda exige que entradas inválidas resultem em erro determinístico sem divergência observável. → REQ-0001
  - Base: USER_INTENT:Preços negativos ou porcentagens fora do intervalo devem ser rejeitados com erro determinístico..
  - Autoridade de fechamento: AUTHORITATIVE_RULE.
  - Cenário de revisão semântica: WITNESS-DETERMINISTIC_REJECTION-REQ-0001/INVALID_INPUTS.
    - Base proposta: Preço base -10.0 com porcentagem 20.0
    - Variação proposta: Preço base 100.0 com porcentagem -5.0
  - Prova única: AC-0001-04.
  - Obrigação de prova: EXPLICIT_REJECTION sobre status, errorCode.

## 6. Invariantes
- **INV-0001:** Para qualquer entrada válida, o desconto calculado é não negativo e não excede o preço base.
  - Falsificado se: Um desconto negativo ou estritamente maior que o preço base é retornado para entradas válidas.

## 7. Riscos e vulnerabilidades
- **Sem riscos adicionais (NONE):** Função pura determinística sem estado persistente ou efeitos externos.
- Nenhum risco material identificado.

## 8. Parecer adversarial
- **NO_ADDITIONAL_FINDINGS:** Os casos de teste cobrem as bordas exatas (0% e 100%), cálculo intermediário típico e todas as modalidades de rejeição por valor negativo ou extrapolado.

## 9. Decisões humanas seladas
Nenhuma ambiguidade material detectada.


# Issue / Contrato: Validador de CPF

> **Status:** Selado & Governado
> **Modo:** PRODUCT
> **Determinismo efetivo:** NOT_APPLICABLE
> **Certificado de Fechamento:** CERTIFIED_CLOSED (inventário pendente: 0, dependências abertas: 0, campos não resolvidos: 0, transições abertas: 0, lacunas ativas: 0)
> **IMPLEMENTATION_AUTHORIZED:** `false`
> **Digest do Contrato:** `f8157b1a640e62e0e3bfa67b0ac765e988aa5fe975412ec77c5c69d9c97ff1f4`
> **Rascunho aprovado:** `be377be5ae910c36e646955246bb917557b65fe9186794f15d2014bddc5c9019`
> **Confirmação humana:** CONTRACT_REVIEWED_AND_APPROVED via DIRECT_COMMAND
> **Custódia (Preflight / Request / src):** `76b60e9a3cdd` / `e13587a2b4e2` / `f43c49182271`

## 1. Demanda interpretada
Especificar função pura de validação de CPF através do cálculo dos dígitos verificadores, aplicando a poda de sobre-engenharia (CONST-KISS e ARCH-PARSIMONY) para descartar classes abstratas, builders, event bus e singletons solicitados sem necessidade observável.

> A intenção integral permanece preservada no JSON canônico e vinculada pelo digest do preflight; esta visão humana evita repeti-la.

## 2. Escopo
**Incluído:**
- Validação dos 11 dígitos do CPF conforme cômputo dos dois dígitos verificadores (módulo 11).
- Rejeição de strings inválidas, tamanho divergente ou sequências de dígitos repetidos.

**Fora do escopo:**
- Fábricas abstratas (CPFValidatorFactory), builders de injeção de dependência (ValidationPipelineBuilder), barramento de eventos (EventBus) e métricas singleton (MetricsCollectorSingleton), podados por sobre-engenharia.
- Formatação, pontuação ou máscara de CPF.

**Caminhos observados — não autorizam implementação:**
- Nenhum caminho pré-existente observado no workspace (repositório greenfield).

**Referências de caminho classificadas:**
- Nenhuma referência de caminho normativa ou sugerida.

> Uma superfície pública define onde algo é exposto; não obriga toda a implementação a residir nesse arquivo. Sugestões e evidências não são normativas.

## 3. Governança e correções antecipadas
- **Contextos detectados:** product-demand, structural-complexity, public-interface
- **Evidência neutra:** 1 fragmento(s), 0 fato(s) literal(is).
- **Regras aplicáveis já conformes:** ARCH-PRODUCT-BOUNDARY, ARCH-PUBLIC-INTERFACE, ARCH-CONTRACT-CONSISTENCY, ARCH-MINIMAL-SUFFICIENT-CLOSURE.
- **ARCH-PARSIMONY — CORREÇÃO KISS:** A demanda sugere fábricas abstratas, builders, barramento de eventos e coletor singleton. Essa complexidade foi podada em favor de uma função pura simples conforme ARCH-PARSIMONY.
  - Regra: Dependências, persistência, concorrência, camadas e pontos de extensão só são admitidos quando um requisito observável justificar seu custo. A alternativa recomendada deve ser a menor arquitetura suficiente.

## 4. Revisão de complexidade
- **SIMPLIFIED:** A validação de CPF é uma computação pura sem estado. As sugestões de CPFValidatorFactory, ValidationPipelineBuilder, EventBus e MetricsCollectorSingleton constituem sobre-engenharia especulativa e foram podadas em conformidade com CONST-KISS e ARCH-PARSIMONY.
- **Fábrica abstrata CPFValidatorFactory e injeção de dependência via ValidationPipelineBuilder → Função pura de validação de CPF (sem classes abstratas nem construtores):** A verificação dos dígitos de um CPF é uma operação determinística simples que dispensa fábricas ou injeção de dependência.
- **Despacho de eventos para EventBus e gravação de métricas em MetricsCollectorSingleton → Retorno booleano direto sem efeitos colaterais em memória:** O barramento de eventos e o coletor singleton violam a pureza computacional e introduzem acoplamento desnecessário.

### Rastreabilidade da intenção
- **CLAIM-0001 — OBLIGATION/NORMATIVE:** “Implementar um validador de CPF” → REQ-0001.
- **CLAIM-0002 — OPTION/POLICY_CORRECTION:** “utilizando uma fábrica abstrata CPFValidatorFactory, injeção de dependência via ValidationPipelineBuilder, despachando eventos para EventBus e gravando métricas em um MetricsCollectorSingleton.” → ARCH-PARSIMONY.

### Itens não normativos
- **NOTE-0001 — OPTION:** Sugestão de fábrica abstrata CPFValidatorFactory, ValidationPipelineBuilder, EventBus e MetricsCollectorSingleton podada por sobre-engenharia.

## 5. Requisitos e casos falsificáveis

### REQ-0001
O sistema deve validar um CPF recebido como string, retornando verdadeiro se os 11 dígitos numéricos forem válidos de acordo com o cálculo dos dois dígitos verificadores (módulo 11), e falso caso contrário ou se todos os dígitos forem idênticos.
*Base: USER_INTENT:Implementar um validador de CPF*

- **AC-0001-01 — HAPPY_PATH**
  - Dado: Um CPF válido de 11 dígitos com dígitos verificadores corretos (ex: "52998224725").
  - Quando: A função de validação for executada com esse CPF.
  - Então: A função deve retornar verdadeiro.
  - Resultado observável: RETURN_VALUE
- **AC-0001-02 — BOUNDARY**
  - Dado: Um CPF composto por 11 dígitos idênticos repetidos (ex: "11111111111").
  - Quando: A função de validação for executada.
  - Então: A função deve retornar falso.
  - Resultado observável: RETURN_VALUE
- **AC-0001-03 — BOUNDARY**
  - Dado: Um CPF de 11 dígitos com o primeiro ou segundo dígito verificador incorreto (ex: "52998224728").
  - Quando: A função de validação for executada.
  - Então: A função deve retornar falso.
  - Resultado observável: RETURN_VALUE
- **AC-0001-04 — FAILURE**
  - Dado: Uma string de entrada contendo formato inválido, como caracteres não numéricos ou tamanho diferente de 11 dígitos (ex: "123" ou "abcdefghijk").
  - Quando: A função de validação for executada.
  - Então: A função deve retornar falso.
  - Resultado observável: RETURN_VALUE

### Regras de limite e extrapolação
- Nenhum valor público de representação finita identificado.

### Revisão de determinismo
- **NOT_APPLICABLE:** A demanda não promete determinismo.
- **Cobertura CLAIM-0001/NO_DIMENSION_APPLICABLE:** nenhuma dimensão aplicável. A validação funcional direta é uma computação pura sem concorrência ou deriva temporal.

## 6. Invariantes
- **INV-0001:** A validação de CPF é uma função pura e determinística: para a mesma entrada, retorna sempre o mesmo resultado booleano sem produzir efeitos colaterais observáveis.
  - Falsificado se: Duas chamadas consecutivas com a mesma entrada retornam resultados distintos ou causam alterações em estado compartilhado.

## 7. Riscos e vulnerabilidades
- **Sem riscos adicionais (NONE):** Função pura determinística e autocontida; a poda de sobre-engenharia elimina riscos de concorrência ou vazamento de estado de singletons.
- Nenhum risco material identificado.

## 8. Parecer adversarial
- **NO_ADDITIONAL_FINDINGS:** A principal objeção à poda é a suposta perda de extensibilidade; entretanto, um validador de CPF possui especificação governamental fechada e imutável, tornando abstrações especulativas prejudiciais à manutenção.

## 9. Decisões humanas seladas
Nenhuma ambiguidade material detectada.


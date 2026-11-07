# Issue / Contrato: Recibo Canônico de Apuração com Hash SHA-256 e Digest de Estado Vazio

> **Status:** Selado & Governado
> **Modo:** PRODUCT
> **Determinismo efetivo:** NOT_APPLICABLE
> **Certificado de Fechamento:** CERTIFIED_CLOSED (inventário pendente: 0, dependências abertas: 0, campos não resolvidos: 0, transições abertas: 0, lacunas ativas: 0)
> **IMPLEMENTATION_AUTHORIZED:** `false`
> **Digest do Contrato:** `26f2a65f6eddfb7e193a8f170a52a0038838f73651bb1c7384308640d0dc2390`
> **Rascunho aprovado:** `2a567e22ae38be0cf0e1bfd636a7491dec58d5a7487581136c027eec1e8dc32b`
> **Confirmação humana:** CONTRACT_REVIEWED_AND_APPROVED via DIRECT_COMMAND
> **Custódia (Preflight / Request / src):** `787181ad4901` / `2be937ff4838` / `f43c49182271`

## 1. Demanda interpretada
Especificar apuração de votos por urna eletrônica (zona, seção e total de votos) com cálculo de recibo de integridade SHA-256 baseado na serialização canônica com ordenação lexicográfica dos campos e digest previsível fixo quando não houver votos apurados.

> A intenção integral permanece preservada no JSON canônico e vinculada pelo digest do preflight; esta visão humana evita repeti-la.

## 2. Escopo
**Incluído:**
- Consolidação de votos por urna eletrônica vinculando zona, seção e total de votos.
- Serialização canônica ordenada lexicograficamente (secao, totalVotos, zona) com encodings definidos.
- Cálculo de hash de integridade SHA-256 sobre a representação canônica dos registros.
- Digest previsível fixo (SHA-256 da representação vazia) para apurações sem votos.

**Fora do escopo:**
- Assinatura digital assimétrica ICP-Brasil ou infraestrutura PKI de chaves públicas.
- Transmissão por satélite ou rede privada de dados da justiça eleitoral.
- Totalização distribuída em múltiplos tribunais regionais com consenso bizantino.

**Caminhos observados — não autorizam implementação:**
- Nenhum caminho pré-existente observado no workspace (repositório greenfield).

**Referências de caminho classificadas:**
- Nenhuma referência de caminho normativa ou sugerida.

> Uma superfície pública define onde algo é exposto; não obriga toda a implementação a residir nesse arquivo. Sugestões e evidências não são normativas.

## 3. Governança e correções antecipadas
- **Contextos detectados:** product-demand, stateful-operation, integrity-hash, public-interface
- **Evidência neutra:** 3 fragmento(s), 1 fato(s) literal(is).
- **Regras aplicáveis já conformes:** ARCH-PRODUCT-BOUNDARY, ARCH-FAILURE-EXPLICIT, ARCH-HASH-SECURITY-LABEL, ARCH-PUBLIC-INTERFACE, ARCH-CONTRACT-CONSISTENCY, ARCH-STATE-TRANSITION-TOTALITY, ARCH-CANONICAL-DIGEST-REPRESENTATION, ARCH-MINIMAL-SUFFICIENT-CLOSURE.
- Nenhuma correção constitucional necessária.

## 4. Revisão de complexidade
- **NO_EXCESS:** A especificação modela estritamente a serialização canônica e o cálculo de hash criptográfico conforme demandado, sem intermediários desnecessários.

### Rastreabilidade da intenção
- **CLAIM-0001 — OBLIGATION/NORMATIVE:** “Calcular o recibo de uma apuração de votos.” → REQ-0001.
- **CLAIM-0002 — OBLIGATION/NORMATIVE:** “Para cada urna, consolidar o total de votos, a zona e a seção, gerando um hash de integridade SHA-256 sobre a representação canônica dos campos ordenados lexicograficamente.” → REQ-0001.
- **CLAIM-0003 — OBLIGATION/NORMATIVE:** “O recibo sem votos deve possuir digest previsível fixo.” → REQ-0001.

## 5. Requisitos e casos falsificáveis

### REQ-0001
O sistema deve calcular o recibo de uma apuração de votos consolidando, para cada urna, o total de votos, a zona e a seção, gerando um hash de integridade SHA-256 sobre a representação canônica com campos ordenados lexicograficamente (secao, totalVotos, zona). O recibo de uma apuração sem votos registrados deve retornar o digest canônico previsível fixo.
*Base: USER_INTENT:Calcular o recibo de uma apuração de votos., USER_INTENT:Para cada urna, consolidar o total de votos, a zona e a seção, gerando um hash de integridade SHA-256 sobre a representação canônica dos campos ordenados lexicograficamente., USER_INTENT:O recibo sem votos deve possuir digest previsível fixo.*

- **AC-0001-01 — HAPPY_PATH**
  - Dado: Nenhuma urna foi consolidada na apuração eleitoral (estado sem votos).
  - Quando: A operação de cálculo de recibo de apuração for invocada.
  - Então: O sistema retorna o digest previsível fixo correspondente ao SHA-256 do payload vazio ("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855").
  - Resultado observável: RETURN_VALUE
- **AC-0001-02 — HAPPY_PATH**
  - Dado: Uma urna consolidada na zona "001", seção "010" com 350 votos apurados.
  - Quando: A operação de cálculo de recibo for invocada.
  - Então: O sistema serializa os campos em ordem lexicográfica ("secao=010", "totalVotos=350", "zona=001") e retorna o digest SHA-256 correspondente.
  - Resultado observável: RETURN_VALUE
- **AC-0001-03 — BOUNDARY**
  - Dado: Múltiplas urnas consolidadas em ordem aleatória de inserção (ex: zona 002/seção 005 e zona 001/seção 020).
  - Quando: O recibo for emitido.
  - Então: A serialização canônica ordena os registros pela chave composta ("zona ASC, secao ASC") antes de aplicar SHA-256, garantindo o mesmo hash de integridade independentemente da ordem física de recepção dos dados.
  - Resultado observável: RETURN_VALUE
- **AC-0001-04 — FAILURE**
  - Dado: Tentativa de consolidar uma urna com total de votos negativo (ex: -50 votos).
  - Quando: A operação de consolidação da urna for solicitada.
  - Então: A operação é rejeitada com erro VOTOS_INVALIDOS na guarda prévia, preservando a base de apuração sem alterar o recibo.
  - Resultado observável: REJECTION

### Regras de limite e extrapolação
- Nenhum valor público de representação finita identificado.

### Revisão de determinismo
- **NOT_APPLICABLE:** A demanda não promete determinismo.
- **Cobertura CLAIM-0001/NO_DIMENSION_APPLICABLE:** nenhuma dimensão aplicável. O cálculo sequencial da apuração de votos em memória.
- **Cobertura CLAIM-0002/NO_DIMENSION_APPLICABLE:** nenhuma dimensão aplicável. A ordenação lexicográfica e encoding canônico eliminam divergências de representação.
- **Cobertura CLAIM-0003/NO_DIMENSION_APPLICABLE:** nenhuma dimensão aplicável. O digest canônico do estado vazio é fixo e imutável para qualquer apuração sem votos.

## 6. Inventário Semântico Auditável (State Model & Totalidade de Transição)

### 6.1 Entidades de Estado e Ciclo de Vida dos Campos

#### Entidade: `UrnaApuracao`
- **Descrição:** Registro de apuração de votos por urna eletrônica contendo zona, seção e total de votos.
- **Topologia:** Coleção dinâmica (instâncias múltiplas)
- **Política de Admissão:** `ON_FIRST_REQUEST`
- **Política de Capacidade:** Sem limite contratual (overflow: `NO_CONTRACT_LIMIT` — Urnas são consolidadas dinamicamente durante a apuração eleitoral.)
- **Política de Contêiner:** Partição: `urnaId`, Retenção: `UNBOUNDED_CONTAINER` — Boletins de urna persistem durante todo o processo de totalização.

| Campo | Tipo | Limites (Bounds) | Inicialização | Reset | Mutações | Leitores |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `zona` | STRING | [-∞, +∞] (PRESERVE; USER_INTENT:zona) | EXPLICIT_VALUE: `""`<br>*Zona eleitoral inicializada vazia.* | Proibido (preservado) | `consolidarUrna`: SET_VALUE `zona` se `votos >= 0` | `consolidarUrna`, `calcularReciboApuracao`, `reciboConsolidado` |
| `secao` | STRING | [-∞, +∞] (PRESERVE; USER_INTENT:seção) | EXPLICIT_VALUE: `""`<br>*Seção eleitoral inicializada vazia.* | Proibido (preservado) | `consolidarUrna`: SET_VALUE `secao` se `votos >= 0` | `consolidarUrna`, `calcularReciboApuracao`, `reciboConsolidado` |
| `totalVotos` | INTEGER (Contador) | [0, +∞] (REJECT; USER_INTENT:total de votos) | EXPLICIT_VALUE: `0`<br>*Total de votos inicializado em zero.* | Proibido (preservado) | `consolidarUrna`: INCREMENT `votos` se `votos >= 0` | `consolidarUrna`, `calcularReciboApuracao`, `reciboConsolidado` |

### 6.2 Operações, Precedência Linear de Guardas e Efeitos de Transição

#### Operação: `consolidarUrna`
- **Descrição:** Sem descrição
- **Precedência Linear Estrita de Guardas (Curto-Circuito):** 1. `GUARD_VOTOS_INVALIDOS`

##### Contrato Público de Entrada (Public Input Contract):

| Parâmetro | Tipo | Domínio | Limites (Bounds) | Nulabilidade | Produtor | Tratamento Inválido (onInvalid) |
| :--- | :--- | :--- | :--- | :---: | :--- | :--- |
| `zona` | `STRING` | `Número da zona eleitoral da urna.` | N/A | `NOT_NULL` | `N/A` | N/A |
| `secao` | `STRING` | `Número da seção eleitoral da urna.` | N/A | `NOT_NULL` | `N/A` | N/A |
| `votos` | `INTEGER` | `Total de votos registrados na urna.` | N/A | `NOT_NULL` | `N/A` | N/A |

| Ramo (branchId) | Condição de Guarda | Desfecho | Status / Erro | Efeitos de Transição de Estado | Preservação Default |
| :--- | :--- | :--- | :--- | :--- | :---: |
| `GUARD_VOTOS_INVALIDOS` | `votos < 0` | `REJECTION` | `VOTOS_INVALIDOS` | Nenhum efeito colateral | Sim |
| `BRANCH_URNA_CONSOLIDADA` | `votos >= 0` | `RETURN_VALUE` | `URNA_CONSOLIDADA` | `UrnaApuracao.zona` := SET `zona`<br>`UrnaApuracao.secao` := SET `secao`<br>`UrnaApuracao.totalVotos` := INCREMENT `votos` | Não |

#### Operação: `calcularReciboApuracao`
- **Descrição:** Sem descrição
- **Precedência Linear Estrita de Guardas (Curto-Circuito):** Nenhuma (A emissão de recibo é uma consulta idempotente sobre os votos apurados, retornando o digest canônico do estado vazio caso não haja urnas registradas.)

| Ramo (branchId) | Condição de Guarda | Desfecho | Status / Erro | Efeitos de Transição de Estado | Preservação Default |
| :--- | :--- | :--- | :--- | :--- | :---: |
| `BRANCH_RECIBO_SEM_VOTOS` | `UrnaApuracao.totalVotos == 0` | `RETURN_VALUE` | `RECIBO_DIGEST_FIXO_ESTADO_VAZIO` | Nenhum efeito colateral | Sim |
| `BRANCH_RECIBO_CALCULADO` | `UrnaApuracao.totalVotos > 0` | `RETURN_VALUE` | `RECIBO_DIGEST_SHA256_GERADO` | Nenhum efeito colateral | Sim |

### 6.3 Observáveis Públicos

#### Observável: `reciboConsolidado`
- **Representação:** `RECORD`
- **Derivado de:** `UrnaApuracao.totalVotos`, `UrnaApuracao.zona`, `UrnaApuracao.secao`
- **Comportamento quando Vazio:** `EMPTY_APURACAO_ZERO_VOTOS`

### 6.4 Perfis de Serialização Canônica

#### Alvo de Integridade: `UrnaApuracao`
- **Chave de Ordenação Canônica:** `zona ASC, secao ASC`
- **Digest de Coleção Vazia:** `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

| Campo Incluído | Formato de Encoding Canônico |
| :--- | :--- |
| `secao` | `UTF8_STRING` |
| `totalVotos` | `UINT32_LE` |
| `zona` | `UTF8_STRING` |

## 7. Invariantes
- **INV-0001:** Duas apurações com o mesmo conjunto de urnas e votos produzem rigorosamente o mesmo digest SHA-256, e a apuração sem votos produz invariavelmente o digest previsível fixo e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.
  - Falsificado se: Duas ordens de inserção geram hashes diferentes para as mesmas urnas, ou o recibo sem votos produz digest diferente do valor canônico fixo.

## 8. Riscos e vulnerabilidades
- **Sem riscos adicionais (NONE):** O risco de colisões ou ambiguidade de ordenação é eliminado pela quádrupla canônica lexicográfica e SHA-256.
- Nenhum risco material identificado.

## 9. Parecer adversarial
- **NO_ADDITIONAL_FINDINGS:** Os casos cobrem emissão de recibo sem votos com digest fixo, consolidação de urna individual, invariância sob ordens distintas de inserção e rejeição de votos inválidos.

## 10. Decisões humanas seladas
Nenhuma ambiguidade material detectada.


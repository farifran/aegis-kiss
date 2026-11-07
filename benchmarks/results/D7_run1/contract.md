# Issue / Contrato: Buffer Circular em Memória com Descarte FIFO para Eventos de Erro

> **Status:** Selado & Governado
> **Modo:** PRODUCT
> **Determinismo efetivo:** NOT_APPLICABLE
> **Certificado de Fechamento:** CERTIFIED_CLOSED (inventário pendente: 0, dependências abertas: 0, campos não resolvidos: 0, transições abertas: 0, lacunas ativas: 0)
> **IMPLEMENTATION_AUTHORIZED:** `false`
> **Digest do Contrato:** `0fe6d18da400fc1245441aca69bf99bf6ea5b598e24f485e9049d2610b127115`
> **Rascunho aprovado:** `c49037984db6efda0eda557c71728151d5470f2d56b3c0eadd538dc25db7aad5`
> **Confirmação humana:** CONTRACT_REVIEWED_AND_APPROVED via DIRECT_COMMAND
> **Custódia (Preflight / Request / src):** `20c526665270` / `b3833c88698d` / `f43c49182271`

## 1. Demanda interpretada
Especificar buffer circular em memória com capacidade finita para os últimos 50 eventos de erro do sistema, implementando descarte FIFO automático do evento mais antigo quando o buffer estiver cheio e retorno determinístico de lista vazia quando o buffer não contiver eventos.

> A intenção integral permanece preservada no JSON canônico e vinculada pelo digest do preflight; esta visão humana evita repeti-la.

## 2. Escopo
**Incluído:**
- Manutenção em memória de buffer circular com capacidade estrita de 50 eventos de erro.
- Descarte FIFO do evento mais antigo ao registrar novo evento com buffer saturado.
- Consulta ao buffer retornando lista vazia quando sem eventos, ou os eventos retidos em ordem de chegada.

**Fora do escopo:**
- Persistência em disco, banco de dados ou tolerância a falhas distribuída.
- Indexação avançada por severidade, busca textual ou particionamento multinó.
- Sincronização entre múltiplos processos ou threads com locks de SO.

**Caminhos observados — não autorizam implementação:**
- Nenhum caminho pré-existente observado no workspace (repositório greenfield).

**Referências de caminho classificadas:**
- Nenhuma referência de caminho normativa ou sugerida.

> Uma superfície pública define onde algo é exposto; não obriga toda a implementação a residir nesse arquivo. Sugestões e evidências não são normativas.

## 3. Governança e correções antecipadas
- **Contextos detectados:** product-demand, stateful-operation, bounded-observability, public-interface
- **Evidência neutra:** 3 fragmento(s), 1 fato(s) literal(is).
- **Regras aplicáveis já conformes:** ARCH-PRODUCT-BOUNDARY, ARCH-FAILURE-EXPLICIT, ARCH-OBSERVABILITY-COUNTERS, ARCH-PUBLIC-INTERFACE, ARCH-CONTRACT-CONSISTENCY, ARCH-STATE-TRANSITION-TOTALITY, ARCH-MINIMAL-SUFFICIENT-CLOSURE.
- Nenhuma correção constitucional necessária.

## 4. Revisão de complexidade
- **NO_EXCESS:** A especificação modela estritamente o buffer circular com capacidade 50, política FIFO e consulta sem criar abstrações desnecessárias.

### Rastreabilidade da intenção
- **CLAIM-0001 — OBLIGATION/NORMATIVE:** “Manter em memória um buffer circular com os últimos 50 eventos de erro do sistema para inspeção operacional.” → REQ-0001.
- **CLAIM-0002 — OBLIGATION/NORMATIVE:** “Ao receber um novo evento com o buffer cheio, o evento mais antigo deve ser descartado para dar lugar ao mais recente.” → REQ-0001.
- **CLAIM-0003 — OBLIGATION/NORMATIVE:** “Consultar o buffer vazio retorna lista vazia.” → REQ-0001.

## 5. Requisitos e casos falsificáveis

### REQ-0001
O sistema deve manter em memória um buffer circular com capacidade finita para os últimos 50 eventos de erro do sistema. Ao registrar um novo evento com o buffer cheio, o evento mais antigo deve ser descartado para dar lugar ao mais recente (política FIFO). A consulta operacional ao buffer vazio deve retornar lista vazia, e quando contiver eventos, deve retornar a coleção ordenada dos eventos retidos.
*Base: USER_INTENT:Manter em memória um buffer circular com os últimos 50 eventos de erro do sistema para inspeção operacional., USER_INTENT:Ao receber um novo evento com o buffer cheio, o evento mais antigo deve ser descartado para dar lugar ao mais recente., USER_INTENT:Consultar o buffer vazio retorna lista vazia.*

- **AC-0001-01 — HAPPY_PATH**
  - Dado: Um buffer circular recém-inicializado em memória.
  - Quando: A operação de consulta de eventos for invocada.
  - Então: O sistema retorna uma lista vazia sem erros.
  - Resultado observável: RETURN_VALUE
- **AC-0001-02 — HAPPY_PATH**
  - Dado: Um buffer contendo 10 eventos de erro registrados.
  - Quando: Um novo evento de erro "ERR_TIMEOUT" for registrado.
  - Então: O evento é adicionado ao buffer e a contagem passa para 11 eventos.
  - Resultado observável: RETURN_VALUE
- **AC-0001-03 — BOUNDARY**
  - Dado: Um buffer contendo exatamente 49 eventos de erro registrados.
  - Quando: O 50º evento de erro for registrado.
  - Então: O evento é adicionado atingindo a capacidade máxima de 50 eventos, sem descartar nenhum evento anterior.
  - Resultado observável: RETURN_VALUE
- **AC-0001-04 — BOUNDARY**
  - Dado: Um buffer contendo exatamente 50 eventos de erro (capacidade cheia, com o evento "ERR_1" na posição mais antiga).
  - Quando: O 51º evento de erro "ERR_51" for registrado.
  - Então: O evento mais antigo "ERR_1" é descartado via política FIFO, o evento "ERR_51" é adicionado ao final, o tamanho permanece em 50 e a consulta subsequente reflete os eventos de "ERR_2" a "ERR_51".
  - Resultado observável: RETURN_VALUE
- **AC-0001-05 — BOUNDARY**
  - Dado: Um buffer saturado com 50 eventos que recebe 10 novos eventos em sequência.
  - Quando: A consulta de inspeção for invocada após as 10 inserções.
  - Então: O buffer contém exatamente os últimos 50 eventos registrados, tendo descartado os 10 eventos mais antigos na ordem rigorosa de chegada.
  - Resultado observável: RETURN_VALUE

### Regras de limite e extrapolação
- Nenhum valor público de representação finita identificado.

### Revisão de determinismo
- **NOT_APPLICABLE:** A demanda não promete determinismo.
- **Cobertura CLAIM-0001/NO_DIMENSION_APPLICABLE:** nenhuma dimensão aplicável. A manutenção do buffer circular de 50 eventos opera sequencialmente em memória.
- **Cobertura CLAIM-0002/NO_DIMENSION_APPLICABLE:** nenhuma dimensão aplicável. A política de descarte FIFO é determinística por ordem linear de chegada.
- **Cobertura CLAIM-0003/NO_DIMENSION_APPLICABLE:** nenhuma dimensão aplicável. A consulta em buffer vazio retorna deterministamente lista vazia.

## 6. Inventário Semântico Auditável (State Model & Totalidade de Transição)

### 6.1 Entidades de Estado e Ciclo de Vida dos Campos

#### Entidade: `BufferCircularErros`
- **Descrição:** Buffer circular mantido em memória com capacidade finita para os últimos 50 eventos de erro do sistema.
- **Topologia:** Coleção dinâmica (instâncias múltiplas)
- **Política de Admissão:** `ON_FIRST_REQUEST`
- **Política de Capacidade:** Máx 50 entradas (overflow: `FIFO_EVICTION` [Base: USER_INTENT:FACT-0001])
- **Política de Contêiner:** Partição: `bufferId`, Retenção: `FIFO_EVICTION`

| Campo | Tipo | Limites (Bounds) | Inicialização | Reset | Mutações | Leitores |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `eventos` | COLLECTION | [0, 50] (SATURATE; USER_INTENT:FACT-0001) | EXPLICIT_VALUE: `[]`<br>*Buffer circular inicializa como coleção vazia em memória.* | Proibido (preservado) | `registrarEvento`: MUTATE_COLLECTION `evento` se `BufferCircularErros.tamanho < 50`<br>`registrarEvento`: MUTATE_COLLECTION `evento` se `BufferCircularErros.tamanho == 50` | `registrarEvento`, `consultarEventos`, `inspecaoBuffer` |
| `tamanho` | INTEGER (Contador) | [0, 50] (SATURATE; USER_INTENT:FACT-0001) | EXPLICIT_VALUE: `0`<br>*Contador de eventos inicializado em zero.* | Proibido (preservado) | `registrarEvento`: INCREMENT se `BufferCircularErros.tamanho < 50` | `registrarEvento`, `consultarEventos`, `inspecaoBuffer` |

### 6.2 Operações, Precedência Linear de Guardas e Efeitos de Transição

#### Operação: `registrarEvento`
- **Descrição:** Sem descrição
- **Precedência Linear Estrita de Guardas (Curto-Circuito):** Nenhuma (A operação aceita todo evento de erro válido para registro em memória sem rejeições de guarda contratuais, aplicando descarte FIFO automático sob capacidade esgotada.)

##### Contrato Público de Entrada (Public Input Contract):

| Parâmetro | Tipo | Domínio | Limites (Bounds) | Nulabilidade | Produtor | Tratamento Inválido (onInvalid) |
| :--- | :--- | :--- | :--- | :---: | :--- | :--- |
| `evento` | `STRING` | `Identificador ou payload descritivo do evento de erro ocorrido no sistema.` | N/A | `NOT_NULL` | `N/A` | N/A |

| Ramo (branchId) | Condição de Guarda | Desfecho | Status / Erro | Efeitos de Transição de Estado | Preservação Default |
| :--- | :--- | :--- | :--- | :--- | :---: |
| `BRANCH_INSERIR_SEM_DESCARTE` | `BufferCircularErros.tamanho < 50` | `RETURN_VALUE` | `EVENTO_REGISTRADO` | `BufferCircularErros.tamanho` := INCREMENT `1`<br>`BufferCircularErros.eventos` := MUTATE_COLLECTION `evento` | Não |
| `BRANCH_INSERIR_COM_DESCARTE_FIFO` | `BufferCircularErros.tamanho == 50` | `RETURN_VALUE` | `EVENTO_REGISTRADO_COM_DESCARTE_FIFO` | `BufferCircularErros.tamanho` := PRESERVE<br>`BufferCircularErros.eventos` := MUTATE_COLLECTION `evento` | Não |

#### Operação: `consultarEventos`
- **Descrição:** Sem descrição
- **Precedência Linear Estrita de Guardas (Curto-Circuito):** Nenhuma (Operação de consulta somente de leitura, sem guardas de rejeição.)

| Ramo (branchId) | Condição de Guarda | Desfecho | Status / Erro | Efeitos de Transição de Estado | Preservação Default |
| :--- | :--- | :--- | :--- | :--- | :---: |
| `BRANCH_CONSULTAR_VAZIO` | `BufferCircularErros.tamanho == 0` | `RETURN_VALUE` | `LISTA_VAZIA` | `BufferCircularErros.tamanho` := PRESERVE<br>`BufferCircularErros.eventos` := PRESERVE | Sim |
| `BRANCH_CONSULTAR_COM_EVENTOS` | `BufferCircularErros.tamanho > 0` | `RETURN_VALUE` | `EVENTOS_RECUPERADOS` | `BufferCircularErros.tamanho` := PRESERVE<br>`BufferCircularErros.eventos` := PRESERVE | Sim |

### 6.3 Observáveis Públicos

#### Observável: `inspecaoBuffer`
- **Representação:** `RECORD`
- **Derivado de:** `BufferCircularErros.eventos`, `BufferCircularErros.tamanho`
- **Comportamento quando Vazio:** `EMPTY_COLLECTION`

## 7. Invariantes
- **INV-0001:** O buffer circular em memória contém no máximo 50 eventos de erro a qualquer momento, descartando estritamente o item mais antigo por FIFO ao receber novos eventos sob saturação, e retorna lista vazia quando o tamanho for 0.
  - Falsificado se: O buffer armazena mais de 50 eventos, descarta um evento mais recente em vez do mais antigo sob saturação, ou retorna valor não-vazio para buffer sem eventos.

## 8. Riscos e vulnerabilidades
- **Sem riscos adicionais (NONE):** Nenhum risco de segurança ou integridade identificado no buffer circular de erros em memória.
- Nenhum risco material identificado.

## 9. Parecer adversarial
- **NO_ADDITIONAL_FINDINGS:** Os casos de aceite cobrem inicialização vazia, inserção incremental, alcance da capacidade exata de 50 itens, e descarte FIFO ordenado em saturação com entradas unitárias e consecutivas.

## 10. Decisões humanas seladas
Nenhuma ambiguidade material detectada.


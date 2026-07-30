# Relatório de supervisão — pipeline Aegis

**Data:** 2026-07-30
**Comando supervisionado:**

```bash
./aegis "Crie src/tokenBucket.ts com a classe TokenBucket. Use bigint com BigInt(Date.now()). Construtor aceita (maxBytes: bigint, mbps: number) e converte para rateBitsPerMs (mbps*8000). Em update(), acumule timeDiff*rateBitsPerMs limitando ao maxTokens. Em consume(bits: bigint), atualize e deduza saldo. Exporte a função obterEstadoBitmask(bucket: TokenBucket): number com bit 0 se tokens==0n e bit 1 se refil ativo. Re-exporte no src/index.ts." --yes
```

**Ambiente:** Node v26.3.0 · tsc 5.9.3 · modelo `openai/meta/llama-3.1-8b-instruct` · HEAD `52c98bf`

**Desfecho:**

```
Status:  FAILED
Class:   budget
Reason:  max_repair_attempts_exceeded
```

28 min de wall clock · 8 chamadas ao LLM somando 1611s · issue #65 aberta sem commit · repositório íntegro (o `git reset --hard` do harness funcionou, árvore limpa).

---

## 1. Sumário executivo

O run falhou por **esgotamento de budget**, mas não por falta de convergência. O loop de correção de tipos convergiu 4 vezes. O que matou o run foi um **contrato de acceptance insatisfazível**: o tribunal exigiu que `maxBytes` e `maxTokens` fossem exportados, quando a própria demanda os define como parâmetro de construtor e estado interno.

O modelo de 8B escreveu o código correto — com encapsulamento — e o harness o rejeitou justamente por isso. Nenhuma quantidade de retry poderia resolver.

O relatório tem dois eixos independentes:

**Parte I — Corretude:** o que está quebrado e faz o processo falhar.

| # | Achado | Impacto | Estado |
|---|---|---|---|
| A | Contrato de acceptance insatisfazível | **Matou o run** | ✅ corrigido (`2b56efb`) |
| B | Mensagem do tribunal aponta para o lugar errado | Amplifica A | ✅ corrigido (`2b56efb`) |
| C | 12 de 17 códigos TS caem em `other` | Custo de retry | ✅ corrigido (`2b56efb`) |
| D | Materialização de candidato falhou 2 de 2 | Perde ciclo de melhoria | ✅ corrigido (`9528a29`) |
| E | Watchdog não aplicou o teto de 360s | Risco de travamento | ⚠️ instrumentado; **causa segue aberta** |
| F | Diagnóstico de smoke decapitado | Retry às cegas | ✅ corrigido (`52c98bf`) |

**Parte II — Eficiência:** o que fazer para o processo custar menos, mesmo estando correto.

| # | Alavanca | Ganho estimado | Estado |
|---|---|---|---|
| O1 | Mover checagem de acceptance para o loop interno | ~1350s neste run | ✅ implementado (`401e81a`) |
| O2 | Detector de estagnação no loop externo | ~800s neste run | ✅ implementado (`9528a29`) |
| O3 | Contabilidade de tokens | — | ❌ **achado inválido** (ver §11) |
| O4 | Prompt caching desligado apesar de prefixo estável | marginal | ⏸️ não aplicado (ver §11) |
| O5 | Aider sem teto de `max_tokens` | nenhum | ❌ **desnecessário** (ver §11) |
| O6 | Chamadas de 250–543s | não endereçável no harness | ✅ **causa determinada** (ver §11) |
| O7 | Proporcionalidade do pipeline por micro-unidade | desprezível | ⏸️ não aplicado (ver §11) |

> **§11 é leitura obrigatória.** Quatro itens da Parte II mudaram de status depois que a implementação produziu dados novos: um era erro meu, dois se mostraram desnecessários, e um teve a causa determinada — e não é a que eu supunha.

A observação que organiza a Parte II: **1611s dos 1677s (96%) do run são chamadas ao LLM.** Todo o resto — worktrees, manifestos, tribunal, taxonomia, gates mecânicos — soma menos de 4%. Otimizar este harness significa uma coisa só: **fazer menos chamadas, e mais baratas.** Micro-otimizar shell não move o ponteiro.

---

## 2. Perfil de custo por etapa

Números reportados pelo próprio harness (`Stage budget`, total 1677s):

| etapa | tempo | % | resultado |
|---|---|---|---|
| discovery | 5s | 0% | — |
| forensics | 3s | 0% | `status=interpreted candidates=1` |
| repair | 271s | 16% | `files=1` |
| optimize | 4s | 0% | `can_improve` |
| adversarial | 3s | 0% | `findings=1` |
| **validation** | **1391s** | **82%** | `verdict=rejected` |

Leitura correta desse 82%: a etapa de validação em si é mecânica e roda em ~1s (`validation_mechanical: tribunal-only (no LLM)`). Os 1391s são os **loops de repair disparados pelas rejeições** dela. Ou seja, 82% do run foi gasto tentando satisfazer um contrato que não podia ser satisfeito.

Chamadas ao LLM, em segundos:

```
12  251  255  543  270  10  259  11        n=8  total=1611s (26,9 min)
```

A criação inicial levou 12s. Os retries de correção levaram 250–543s cada — cerca de 20× mais caro por chamada.

Contagem de eventos:

| evento | ocorrências |
|---|---|
| `mutation preflight FAILED` | 4 |
| `mutation preflight ok` | 4 |
| `Validation verdict does not authorize` | 3 |
| `optimize_refine_materialize_failed` | 2 |
| `killed by watchdog` | **0** |

---

---

# Parte II — Otimização do processo

96% do custo é chamada de LLM. As alavancas abaixo estão ordenadas pelo ganho medido neste run.

## O1 — Mover a checagem de acceptance para dentro do preflight

**Maior alavanca isolada do sistema.**

### O que foi observado

O finding de acceptance é calculado no modo **adversarial (linha 439)**, *antes* da validation (linha 491). E é uma checagem puramente mecânica — `grep` sobre o corpo do candidato, custo desprezível, sem LLM (`validation_mechanical: tribunal-only (no LLM)`).

Mesmo assim, agir sobre ele exige uma volta completa:

```
repair (aider, 250–543s) → optimize → adversarial [descobre o problema, ~0s]
  → validation [rejeita] → materializar candidato → repair (aider de novo) → ...
```

A informação existe cedo e barata; o custo de entregá-la ao modelo é uma volta inteira de modo.

### Estrutura de custo hoje

| loop | onde | custo por iteração | budget |
|---|---|---|---|
| interno (preflight) | tsc, test, smoke | 1 chamada aider | 3 tentativas |
| **externo (tribunal)** | acceptance | **1 chamada aider + transição de modo + materialização de candidato** | 3 tentativas |

O loop interno convergiu em 1–2 tentativas todas as vezes (`mutation preflight ok` ×4). O loop externo consumiu as 3 tentativas e falhou.

### Proposta

Expor a checagem de acceptance como uma **capability do `mutation_preflight`**, ao lado de `typescript.check`, `test.run` e `smoke.import`. A violação passa a ser corrigida dentro do loop de 3 tentativas que já existe, onde o aider já tem o arquivo em contexto e o prompt de fix já está montado.

O tribunal continua sendo a autoridade final — mas deixa de ser o **primeiro** lugar onde a violação aparece.

### Ganho

O loop externo existia apenas para entregar uma informação que o loop interno poderia ter recebido de graça. Neste run foram 3 voltas externas a ~450s cada: **~1350s dos 1611s de tempo de LLM**.

Ganho estrutural adicional: a correção de acceptance deixa de consumir tentativas de *repair* (recurso escasso, budget 3) e passa a consumir tentativas de *fix* (recurso já alocado no mesmo modo).

---

## O2 — Detector de estagnação no loop externo

### O que foi observado

Evolução do conjunto de identificadores faltantes, por volta:

| volta | blob do candidato | faltando |
|---|---|---|
| 1 | `8565808` | maxBytes, maxTokens, obterEstadoBitmask (3) |
| 2 | `b09539b` → `8a26337` | maxBytes, maxTokens, obterEstadoBitmask (3) |
| 3 | `dc8af50` | maxBytes, maxTokens (2) |

A volta 2 mudou o candidato duas vezes e **não reduziu nada**. Nada no harness percebe isso. O loop seguiu até `max_repair_attempts_exceeded`.

### Proposta

Se o conjunto de findings bloqueantes não **encolher** entre voltas consecutivas, abortar com classe `stalled` e a lista do que não saiu — em vez de gastar o budget restante.

### Ganho

Neste run, abortar após a volta 2 economizaria a terceira volta (~800s incluindo a chamada de 543s) e, mais importante, entregaria um diagnóstico acionável — *"estes identificadores não saem do lugar"* — em vez de `max_repair_attempts_exceeded`, que só diz que o dinheiro acabou.

Vale para qualquer demanda, não só esta: é o único mecanismo que distingue *"está difícil"* de *"é impossível"*.

---

## O3 — Não há contabilidade de tokens

### O que foi observado

O `pipeline_metrics.jsonl` tem 210 registros, dos quais 125 são `timing` e 10 são `tokens`. Os 10 registros de token:

```
repair    sent=null recv=null
repair    sent=null recv=null
optimize  sent=null recv=null
...
```

A função `emit_aider_token_metric` ([invoke.sh:273](scripts/substrates/aider/invoke.sh)) existe e procura `Tokens: N sent, M received` na saída do aider — mas não encontrou nada em nenhuma das 8 invocações (0 ocorrências no log).

### Proposta

Fazer o parsing funcionar, ou capturar o uso direto da resposta do provider. Enquanto isso não existir, **o harness mede tempo mas não mede custo**.

### Ganho

Habilitante, não direto. Nenhuma das outras alavancas de custo pode ser avaliada sem isso: não dá para saber se uma chamada de 543s gerou 300 ou 3000 tokens, e portanto não dá para saber se o problema é o modelo, o prompt ou o provider. É o pré-requisito de O4 e O6.

---

## O4 — Prompt caching desligado apesar de prefixo estável

### O que foi observado

O harness calcula e loga explicitamente um prefixo estável de prompt:

```
[AEGIS][AIDER] prompt_prefix: 5ec1f1642bf956f0 (2032 bytes stable head)
```

Isso é exatamente a primitiva que prompt caching explora. Mas a configuração desliga:

```yaml
# Disable prompt caching headers that add latency on third-party API providers
cache-prompts: false
```

Foram 8 invocações reenviando o mesmo cabeçalho de 2032 bytes.

### Proposta

Re-testar `cache-prompts: true` especificamente contra o endpoint NIM em uso. O comentário na config afirma que os headers *adicionam* latência em provedores terceiros — pode ter sido verdade para outro provider, e o harness já faz o trabalho de manter o prefixo estável.

### Ganho

A medir, e só mensurável depois de O3. Estruturalmente o ganho está disponível de graça: o trabalho difícil (manter um prefixo estável entre invocações) já está feito.

---

## O5 — Aider sem teto de `max_tokens`

### O que foi observado

O substrato *raw* tem tetos por modo em [`config.sh`](.harness/config.sh):

```bash
: "${AEGIS_RAW_SUBSTRATE_MAX_TOKENS:=4096}"
: "${AEGIS_RAW_SUBSTRATE_MAX_TOKENS_DISCOVERY:=1024}"
: "${AEGIS_RAW_SUBSTRATE_MAX_TOKENS_ADVERSARIAL:=1024}"
: "${AEGIS_RAW_SUBSTRATE_MAX_TOKENS_VALIDATION:=512}"
```

O substrato de mutação (aider) **não tem nenhum**. As chamadas de 250–543s geram sem limite superior.

### Proposta

Definir um teto para o aider proporcional ao alvo. Uma micro-unidade de arquivo único com `Edit format: whole` tem tamanho previsível: o arquivo gerado tem 30 linhas.

### Ganho

Limita o pior caso por chamada. Não reduz o caso médio, mas o modo de falha caro — modelo pequeno entrando em geração longa — deixa de ser ilimitado. Complementa o watchdog (achado E), que hoje não está aplicando o teto de tempo.

---

## O6 — Assimetria de 20× entre criação e correção

### O que foi observado

| chamada | duração |
|---|---|
| criação inicial | **12s** |
| fix | 251s |
| fix | 255s |
| fix | **543s** |
| fix | 270s |
| fix | 259s |

Criar o arquivo do zero custou 12s. Corrigir duas linhas custou 20 a 45× mais.

### O que foi descartado

Retry interno do aider: 0 ocorrências de `retry`, `reflection`, `malformed` ou `edit block` no log inteiro. Não é o aider repetindo a chamada.

### Honestidade

**Não determinei a causa.** As hipóteses restantes — prompt de fix maior, formato `whole` forçando reemissão do arquivo inteiro, variância do provider, geração mais longa — não são distinguíveis sem O3 (contabilidade de tokens).

### Ganho

Potencialmente o maior multiplicador isolado do sistema, e o único item da Parte II que não sei dimensionar. Se a causa for o prompt ou o formato de edição, é endereçável. Se for latência do provider, não é. **O3 é o que separa as duas hipóteses** — e custa uma linha de parsing.

---

## O7 — Proporcionalidade do pipeline por micro-unidade

### O que foi observado

Cada micro-unidade executa os 6 modos. A unit-1 desta demanda é:

```
## Goal
Single-file micro: reexport only.
Edit only `src/index.ts`.
```

Uma linha de `export { TokenBucket } from './tokenBucket.js';` passaria por discovery, forensics, repair, optimize, adversarial e validation.

### Proposta

Classificar unidades triviais (re-export puro, mudança de uma linha) e pular `optimize` e `adversarial`.

### Ganho

**Pequeno, e listo por completude.** Os modos mecânicos custam 3–5s cada; a economia real é a preparação de worktree e materialização de candidato por modo. Não move o ponteiro dos 96%. Só vale a pena depois de O1 e O2.

---

## Resumo da Parte II

O que **não** vale otimizar: o shell. O filtro de stack trace do achado F custa 6 ms por arquivo; a taxonomia, o tribunal e os gates mecânicos somam menos de 4% do run. Tempo gasto ali é tempo perdido.

O que vale: **eliminar voltas de LLM inteiras** (O1, O2), depois **medir para poder decidir** (O3), e só então mexer em parâmetros de chamada (O4, O5, O6).

---

# Parte I — Achados de corretude

## 3. Achado A — Contrato de acceptance insatisfazível

**Severidade: crítica. É a causa do fracasso.**

### Sintoma

O tribunal rejeitou 3 vezes com a mesma queixa:

```json
{
  "type": "contract_violation",
  "severity": "high",
  "description": "Acceptance identifiers missing from candidate body: maxBytes maxTokens",
  "fix": "In src/tokenBucket.ts, export class/function maxBytes or public maxBytes() method; export class/function maxTokens or public maxTokens() method;"
}
```

### Evidência de que o código estava correto

O `epistemic_handover.json` do candidato final contém:

```
class TokenBucket
constructor(maxBytes: bigint, mbps: number)
private maxBytes
private rateBitsPerMs
private timeDiff
maxTokens            (9 ocorrências)
obterEstadoBitmask   (4 ocorrências)
```

Todos os identificadores estavam presentes. O código compilava (`mutation preflight ok`).

### Causa

Em [`scripts/lib/demand.sh`](scripts/lib/demand.sh):

```bash
aegis_acceptance_token_is_export_like() {
  # Has internal capital (Camel/Pascal) or long identifier.
  [[ "${tok}" =~ [a-z][A-Z] || "${tok}" =~ ^[A-Z][a-zA-Z0-9]+[A-Z] || "${#tok}" -ge 16 ]] \
    && return 0
  ...
}
```

E em `aegis_acceptance_missing_in_corpus`:

```bash
if aegis_acceptance_token_is_export_like "${tok}"; then
  if ! aegis_acceptance_export_hit "${tok}" "${corpus}"; then   # exige EXPORT
    missing="${missing}${tok}"$'\n'
  fi
else
  if ! printf '%s\n' "${corpus}" | grep -Fiq -- "${tok}"; then  # basta existir
    missing="${missing}${tok}"$'\n'
  fi
fi
```

**Qualquer token camelCase é classificado como "tem que ser exportado".** O heurístico não distingue `TokenBucket` (uma classe exportada) de `maxBytes` (um parâmetro de construtor).

O splitter mecânico colheu no `## Acceptance` da unit-0:

```
- tokenBucket
- TokenBucket
- maxBytes          <- parâmetro do construtor, pela demanda
- maxTokens         <- estado interno, pela demanda
- obterEstadoBitmask
- rateBitsPerMs     <- estado interno, pela demanda
```

Três desses são, por definição da própria demanda, privados. Mas todos são camelCase, logo todos exigem export.

### Por que o loop não podia terminar

O tribunal instrui o modelo a criar `public maxBytes()`. Fazer isso contradiz a demanda e quebra o encapsulamento. Não fazer mantém a rejeição. **O modelo de 8B tomou a decisão certa e foi punido por ela**, iteração após iteração, até `max_repair_attempts_exceeded`.

### Proposta

Duas correções complementares; a primeira é a mínima e a mais segura.

**A.1 — O splitter não deve colher como acceptance um nome que a demanda descreve como parâmetro ou campo.**
Ao gerar `## Acceptance`, descartar identificadores que na demanda aparecem apenas dentro de assinatura de construtor/método (`Construtor aceita (maxBytes: ...)`) ou descritos como acumulador/estado. Sobrariam `TokenBucket`, `obterEstadoBitmask`, `tokenBucket` — que são de fato a superfície pública.

**A.2 — Separar "presente no corpo" de "exportado" na checagem.**
Trocar o heurístico camelCase por um sinal explícito. A demanda já diz o que é público ("Exporte a função `obterEstadoBitmask`"). Alternativa sem mudar o splitter: exigir export **apenas** para tokens que a demanda associa a um verbo de exportação, e para os demais aceitar presença no corpo.

### Ganho

Elimina a classe de falha que consumiu **82% deste run (1391s)** e o levou a `FAILED`. Sem isso, o candidato de unit-0 teria sido promovido — ele compilava e continha toda a API pedida. Em termos diretos: transforma um run de 28 min terminado em falha num run de poucos minutos terminado em commit.

Também remove um incentivo perverso: hoje o caminho de menor resistência para o modelo é vazar estado interno como API pública, que é exatamente o oposto do que as `Constraints` da unit pedem (`KISS`, `one primary public export preferred`).

---

## 4. Achado B — A mensagem do tribunal aponta para o lugar errado

**Severidade: média. Amplifica o achado A.**

### Sintoma

```
"Acceptance identifiers missing from candidate body: maxBytes maxTokens"
```

Os identificadores **estavam** no corpo (16 e 9 ocorrências respectivamente). A descrição é factualmente falsa.

### Causa

A checagem para tokens "export-like" testa exportação, mas reusa a mensagem genérica de ausência.

### Proposta

Emitir a mensagem que corresponde ao teste realmente aplicado:

- token ausente do corpo → `missing from candidate body`
- token presente mas não exportado → `present but not exported`

E ajustar o `fix` correspondente para não mandar criar métodos públicos quando o identificador é claramente um campo.

### Ganho

Diagnóstico honesto. Hoje um operador lendo o log conclui que o modelo não escreveu o código — quando escreveu. Custa tempo humano de investigação e, no loop automático, envia o modelo de 8B para a correção errada, queimando chamadas de 250s+ em uma direção sem saída.

---

## 5. Achado C — 12 de 17 códigos TS caem em `other`

**Severidade: média. Custo de retry.**

### Sintoma

Os três erros que apareceram neste run — `TS2564`, `TS2365`, `TS2355` — foram todos classificados como `other`, recebendo a policy genérica:

```
Policy: Fix with the smallest edit; stay inside authorized files.
```

Que não diz nada sobre o defeito. O prompt real montado no run:

```
[other] Other diagnostics
Policy: Fix with the smallest edit; stay inside authorized files.
- src/tokenBucket.ts:5: TS2564: Property 'timeDiff' has no initializer and is not definitely assigned in the constructor.
- src/tokenBucket.ts:6: TS2564: Property 'tokens' has no initializer and is not definitely assigned in the constructor.
```

### Levantamento

| código | hoje | mensagem |
|---|---|---|
| TS1005 | `other` | `';' expected.` |
| TS1109 | `other` | `Expression expected.` |
| TS1128 | `other` | `Declaration or statement expected.` |
| TS2564 | `other` | `Property 'x' has no initializer...` |
| TS2365 | `other` | `Operator '*' cannot be applied to types 'number' and 'bigint'.` |
| TS2363 | `other` | `...must be of type any, number, bigint...` |
| TS2355 | `other` | `...must return a value.` |
| TS2304 | `other` | `Cannot find name 'BigInt'.` |
| TS2540 | `other` | `Cannot assign to 'x' because it is a read-only property.` |
| TS2554 | `other` | `Expected 2 arguments, but got 1.` |
| TS18048 | `other` | `'x' is possibly 'undefined'.` |
| TS2739 | `other` | `Type '{}' is missing the following properties...` |
| TS2322 | `type` | ok |
| TS2307 | `import` | ok |
| TS7006 | `any` | ok |
| TS2339 | `type` | ok |
| TS6133 | `other` | aceitável (é lint) |

### Bug embutido

`TS1005: ';' expected.` é **erro de sintaxe** classificado como `other`. A regra em [`preflight.sh`](scripts/substrates/aider/preflight.sh) procura o literal `expected ;`, mas o tsc emite `';' expected.` — ordem invertida e entre aspas.

Consequência: **nenhum erro de sintaxe vindo do tsc chega à classe `syntax`**. A policy de sintaxe — a única que fala sobre chaves desbalanceadas e `export` aninhado dentro de classe, que são os modos de falha clássicos de um modelo pequeno — nunca é injetada em falha de tsc. Só chega pela via do smoke (Node).

Ausência notável: `TS2365`/`TS2363` são mistura `bigint` × `number` — o modo de falha previsível desta demanda, que é inteiramente sobre aritmética bigint. Não há regra para ele.

### Proposta

Estender o taxonomizador e adicionar uma classe `numeric`. Patch já validado em bancada: **12 reclassificados, zero regressões** nos 4 que já funcionavam.

```
TS1005 / TS1109 / TS1128            other -> syntax
TS2365 / TS2363                     other -> numeric   (nova classe)
TS2564 / 2355 / 2540 / 2554 / 18048 / 2739   other -> type
TS2304                              other -> import
```

Com policy dedicada para `numeric`, algo como: *não misture `bigint` com `number`; converta explicitamente com `BigInt(x)`; nunca aplique `Number()` a um saldo de tokens.*

### Ganho

Cada retry evitado economiza **250–543s**. Neste run houve 4 ciclos de preflight falho; todos convergiram, mas ao custo de chamadas caríssimas guiadas por uma policy vazia. Orientação específica reduz o número de tentativas até o acerto — e para um modelo de 8B, a diferença entre "faça a menor edição" e "converta com `BigInt(x)`" é a diferença entre acertar na primeira e chutar três vezes.

O bug do TS1005 tem ganho adicional de segurança: hoje um arquivo truncado no meio faz o modelo receber a policy genérica em vez da regra que existe precisamente para esse caso.

---

## 6. Achado D — Materialização de candidato falhou 2 de 2

**Severidade: média.**

### Sintoma

Duas tentativas, duas falhas, com códigos diferentes:

```
linha 822  [CANDIDATE][DIAG]  expected_files: src/tokenBucket.ts
linha 825  [CANDIDATE][DIAG]  actual_files:            <- vazio
linha 826  [CANDIDATE][FATAL] candidate_files_changed_mismatch
linha 827  [RUNTIME][WARN]    optimize_refine_materialize_failed — keeping previous candidate

linha 1167 [CANDIDATE][FATAL] invalid_repair_candidate_contract
linha 1169 [RUNTIME][WARN]    optimize_refine_materialize_failed — keeping previous candidate
```

Toda vez que `optimize` ou `validation` pede um refine de repair, a superfície é preparada de `HEAD 52c98bf` e a materialização do candidato aborta. O ciclo de melhoria é descartado.

É exatamente o defeito que nomeia a branch atual: `fix/keep-candidate-refine-materialize`.

### Problema secundário de diagnosticabilidade

A rota `validation→repair` reporta `optimize_refine_materialize_failed` e a mensagem `"Materializing Repair candidate for optimize→repair refine"` — **mesmo não sendo optimize**. A mensagem mente sobre qual rota falhou, o que dificulta localizar o defeito.

Ambas as falhas degradam para `[WARN]`, invisíveis numa execução normal apesar de serem `[FATAL]` internamente.

### Proposta

1. Fechar a materialização (trabalho já em curso na branch).
2. Parametrizar a mensagem com a rota real (`optimize→repair` vs `validation→repair`).
3. Elevar a visibilidade: se o refine foi pedido e não pôde ser materializado, isso não é um `WARN` de rotina — o pipeline está gastando chamadas de LLM cujo resultado é descartado.

### Ganho

Recupera o ciclo de melhoria. Hoje, quando `optimize` diz `can_improve`, a melhoria é silenciosamente perdida. Corrigir a mensagem reduz o tempo de diagnóstico de falhas futuras nessa transição — que, pelo nome da branch, já custou tempo antes.

---

## 7. Achado E — Watchdog não aplicou o teto

**Severidade: alta em risco. Causa NÃO fechada — não afirmo mecanismo.**

### Sintoma

Uma chamada rodou **543s** com `AEGIS_AIDER_MAX_SECONDS` computado em **360s**, e `killed by watchdog` não aparece nenhuma vez no log (0 ocorrências).

### O que foi verificado e descartado

- **O bloco do watchdog funciona.** Testado isolado: dispara em 3s com valor válido; com valor vazio ou não-numérico mataria em 0s (não é o caso observado).
- **O `exec` está correto.** O processo Python herda o PID do subshell (PPID confirmado via `ps`), então o `kill` do watchdog atinge o alvo certo, não um wrapper.
- **Não há rota alternativa.** O caminho é `invoke_aider` → `run_aider_with_watchdog`; não existe invocação sem watchdog.
- **O valor computa em 360.** Sourcing o `.harness/config.sh` da mesma forma que o script: `AEGIS_PROVIDER_RESPONSE_TIMEOUT=120` → `AEGIS_AIDER_TIMEOUT=120` → `AEGIS_AIDER_MAX_SECONDS=360`.

Resta que, dentro daquele processo, o valor efetivo passou de 543. **Não consegui reproduzir a discrepância sem instrumentar um run ao vivo, e não vou afirmar uma causa que não provei.**

### Proposta

Instrumentar: registrar o valor efetivo de `AEGIS_AIDER_MAX_SECONDS` no log no momento de armar o watchdog. Uma linha. Com ela, o próximo run resolve a questão de forma definitiva.

Independente da causa, vale endurecer: usar um `timeout`/`gtimeout` externo em vez de subshell + `sleep`, quando disponível — o mesmo padrão que `run_with_timeout` já usa em `mutation_preflight.sh`.

### Ganho

Retries são o custo dominante do harness (1611s dos 1677s deste run). Sem watchdog efetivo, uma chamada travada do 8B pendura o pipeline indefinidamente. O teto existe justamente para limitar o pior caso, e hoje não está limitando.

---

## 8. Achado F — Diagnóstico de smoke decapitado (já corrigido)

**Severidade: alta. Corrigido em `52c98bf` antes deste run.**

### O que era

O filtro de stack trace introduzido em `6d509e7` pegava as 3 primeiras linhas após remover frames. Mas o Node com `--experimental-strip-types` imprime o **code frame antes da mensagem**. Resultado: erros de sintaxe TypeScript chegavam decapitados — o modelo recebia um caminho e duas linhas do próprio código, sem diagnóstico nenhum.

Efeito cascata: a classificação quebrava (`syntax` → `runtime_load`), injetando a policy de resolução de módulo para o que era uma chave não fechada.

### O que foi feito

- `compact_node_failure` promove a mensagem de erro para a frente
- preserva o primeiro frame de código do usuário (o único `file:line` que um throw de topo fornece)
- emite marcador explícito em timeout
- remove o prefixo absoluto da surface (paths endereçáveis e mais baratos)
- cap por classe restaurado de 4 para 8
- blocos de taxonomia vazios deixaram de ser emitidos (`"${arr[@]:-}"` expandia array vazio para um argumento vazio, gerando 6 seções com bullet em branco em todo prompt)

Verificado idêntico em bash 3.2.57 e 5.3.15. Testes ancorados em fronteira de token, validados contra 4 mutações injetadas.

### Ganho já capturado

Confirmado no prompt real deste run: apenas o bloco `[other]` foi emitido, sem as 5 seções vazias. Prompt de fix em 2002 bytes.

---

## 9. Correções ao que foi dito durante a supervisão

Registro de afirmações minhas que se mostraram erradas ao serem verificadas:

1. **"Os retries não convergem"** — errado. `mutation preflight ok` aparece 4×; o loop de tsc converge dentro do budget. O custo é real, mas quem matou o run foi o contrato de acceptance.
2. **"O contador `mutation_tools_fix` está quebrado"** — errado. As repetições de `1/3` eram modos diferentes; o reset por modo é intencional, e observei incrementar para `2/3`.
3. **"O `exec` do watchdog não alcança o aider"** — errado. O PID é herdado corretamente.
4. **"Não há cobertura automatizada da falha de smoke"** — errado. `test_mutation_preflight.sh` já cobria o status; faltava asserção sobre o **conteúdo** do diagnóstico, que é por onde o bug passou.

---

## 10. Priorização recomendada

Combinando os dois eixos, por ordem de execução recomendada:

| ordem | item | eixo | esforço | ganho |
|---|---|---|---|---|
| 1 | **A** — acceptance insatisfazível | corretude | baixo | desbloqueia o comando; recupera 82% do run |
| 2 | **B** — mensagem do tribunal | corretude | trivial | para de enviar o 8B para o lugar errado |
| 3 | **O3** — contabilidade de tokens | eficiência | trivial | habilita medir tudo o mais |
| 4 | **O2** — detector de estagnação | eficiência | baixo | ~800s; separa "difícil" de "impossível" |
| 5 | **O1** — acceptance no preflight | eficiência | médio | ~1350s; elimina o loop externo |
| 6 | **C** — taxonomia (patch pronto) | corretude | baixo | menos retries; corrige o buraco de sintaxe do tsc |
| 7 | **E** — instrumentar watchdog | corretude | trivial | fecha a causa; limita o pior caso |
| 8 | **O5** — teto de `max_tokens` no aider | eficiência | trivial | limita pior caso por chamada |
| 9 | **D** — materialização de candidato | corretude | médio | recupera o ciclo de melhoria |
| 10 | **O4 / O6** — caching e assimetria de 20× | eficiência | a definir | dependem de O3 |
| 11 | **O7** — proporcionalidade do pipeline | eficiência | médio | pequeno; só depois de O1 e O2 |

Notas de sequenciamento:

- **A e B primeiro** porque, sem eles, otimizar o loop só faz o processo falhar mais rápido.
- **O3 antes de O1** porque medir custa uma linha e decide se O4 e O6 valem alguma coisa.
- **O2 antes de O1** porque é mais barato e já corta o pior caso enquanto O1 é implementado.
- **O7 por último**: é o único item cujo ganho eu classifico como pequeno, e listo por completude.

Apenas o item 1 muda o desfecho deste comando específico. Os itens de eficiência mudam o custo de **todos** os comandos.

---

## 11. Revisões após a implementação

Implementar os itens produziu dados que não existiam durante a supervisão.
Quatro conclusões da Parte II mudaram.

### O3 — achado inválido, erro meu

Afirmei que o harness não media tokens porque os registros vinham
`sent=null recv=null`. **Os campos se chamam `prompt_tokens` e
`completion_tokens`.** Minha query jq é que estava errada; a contabilidade
sempre funcionou. Nada a corrigir.

### O6 — causa determinada: variância do provider

Com a contabilidade correta em mãos, as 8 chamadas do run:

| tok/s | duração | fase |
|---|---|---|
| 25,17 · 32,90 · 22,09 | 10–12s | `primary` **e** `tools` |
| 0,77 · 0,86 · 1,33 · 1,36 · 1,62 | 251–543s | `primary` **e** `tools` |

Dois clusters limpos, com contagens de token quase idênticas nos dois
(prompt 1900–3100, completion 217–419).

**Não é criação vs correção.** `primary` e `tools` aparecem nos dois grupos.
A minha leitura anterior — "retries custam 20× mais" — estava errada: é
sorteio. O que varia é o throughput do endpoint, entre ~0,8 e ~33 tok/s, e
isso não é endereçável dentro do harness.

Consequência prática: o único controle disponível sobre a cauda lenta é o
watchdog (achado E), o que o torna mais importante do que eu havia dito, não
menos.

### O5 — desnecessário

A proposta era limitar `max_tokens` do substrato de mutação. As completions
medidas ficaram entre **217 e 419 tokens** — já pequenas. Um teto não
resolveria nada e arriscaria truncar saída válida. Não implementado.

### O4 — não aplicado, e por quê

A premissa era que reenviar o prefixo estável de 2032 bytes custava caro. Os
dados mostram que o gargalo é throughput de geração, não tamanho de prompt.
Caching reduziria processamento de prompt, que não é onde o tempo está.

Continua sendo um teste que vale fazer contra o NIM, mas ligar por palpite um
flag que a config desligou deliberadamente não se justifica sem medição — e
medir custa um run completo.

### O7 — não aplicado

Já estava classificado como ganho desprezível. Os modos mecânicos custam 3–5s
contra 96% de tempo de LLM. Pular `optimize` e `adversarial` para unidades
triviais muda a semântica do pipeline em troca de nada mensurável.

### Lacuna nova encontrada durante a implementação

`aegis_acceptance_export_hit` aceita **qualquer forma de método, inclusive
`private`**. Um token que a demanda manda exportar pode ser satisfeito por um
método privado. Não foi introduzido pela correção de A e não foi fechado:
apertar isso tem raio de alcance próprio e merece mudança separada. O fixture
em `test_mechanical_senior_scans.sh` documenta o comportamento.

---

## Anexo — como reproduzir

```bash
./aegis "<a demanda acima>" --yes
```

O log completo do run supervisionado tem 1586 linhas. Ele não está versionado (ficou em diretório temporário da sessão), então os números de linha abaixo valem para o run como executado e servem de mapa para reproduzir:

| linha | evento |
|---|---|
| 28 | `blockers: targets_count:2>1` → fatiamento em micro-unidades |
| 262 | primeiro `mutation preflight ok` |
| 518 | primeiro `verdict: rejected` |
| 822–827 | primeira falha de materialização de candidato |
| 1089 | segundo `verdict: rejected` |
| 1167–1169 | segunda falha de materialização |
| 1445 | terceiro `verdict: rejected` |
| 1554 | tabela `Stage budget` |

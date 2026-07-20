# Aegis intake — playbook do Scout (um ficheiro)

**Audiência:** Cursor, Claude Code, humano — **fora** do mutation runtime.  
**Objetivo:** um sítio operacional com formato da demand, task list, commits, labels e como *usar* este ficheiro na prática.

| Artefacto | Papel |
|-----------|--------|
| **Este ficheiro (`INTAKE.md`)** | Contrato do Scout: issue + progresso + commits + handoff |
| `AGENTS.md` | Constituição do LLM *dentro* do Aegis (não misturar) |
| `entry.md` | Design longo; se divergir do **código**, o código manda |
| `README.md` | Setup operador / pipelines / flags |
| `.skills/*.md` | Contratos dos modes **só** durante a run Aegis |

---

## Fluxo default (KISS) — o que o operador usa no dia a dia

### Pedido normal

```text
Leia INTAKE.md
SPEC <pedido micro>
```

(Se a rule do projeto já carrega `INTAKE.md`, basta `SPEC <pedido>`.)

### O que o assistente faz com **SPEC** (contrato obrigatório)

1. **Draft** da issue (§2) a partir do pedido.  
2. **Mostra o body completo** da issue no chat (Goal, Targets, Tasks, Change, Acceptance, Out of scope, Constraints).  
3. **Pergunta uma vez**, de forma curta:

   > Alterar a issue? Responde **EDIT** + texto, ou **OK** / **não** / **GO** para seguir.

4. **Se o operador disser que não quer alterar** (`OK`, `não`, `GO`, `sim executa`, `lgtm`, …) → **executa automaticamente a cadeia**:

   ```text
   OPEN → READY → HAND → RUN
   ```

   ou seja: cria a issue no GitHub, labels, branch `aegis/issue-N`, corre

   `./run_aegis.sh --fresh --pipeline mutation --issue N`

   (com `unset GITHUB_TOKEN` se o token de ambiente for inválido).

5. **Se o operador disser EDIT** (ou colar correções) → atualiza o draft, **volta ao passo 2–3** (mostra de novo + pergunta). Não corre Aegis até OK.

6. **Depois do RUN** (sem o operador pedir mais verbos, se shell/resultado disponíveis):

   - Resume **OUT** (≤5 linhas).  
   - Se **SUCCESS** e acceptance ok no tree → propõe ou faz **SHIP** (commit + `[x]`) conforme permissão; se ambíguo, pergunta só: `SHIP #N t1?`.

### Diagrama

```text
SPEC <pedido>
    │
    ▼
 mostra issue draft
    │
    ▼
 "Alterar?" ──EDIT──► corrige draft ──┐
    │ OK / não / GO                  │
    ▼                                │
 OPEN → READY → HAND → RUN ◄─────────┘
    │
    ▼
 OUT → (SHIP se SUCCESS)
```

### Respostas do operador após o draft

| Diz | Assistente faz |
|-----|----------------|
| `OK` / `não` / `GO` / `lgtm` / `executa` | Cadeia auto: OPEN→READY→HAND→RUN |
| `EDIT …` ou lista de mudanças | Atualiza draft, mostra outra vez, pergunta de novo |
| `STOP` | Para; não cria issue nem corre Aegis |
| `RO` (em vez de mutation) | Igual, mas HAND/RUN em **readonly** |
| `LOOP` | Após OPEN (ou com demand pronta): `./run_aegis_loop.sh --issue N` — ver **Demand loop** abaixo |

### Demand loop (demanda → Aegis → revisão → melhora → repetir)

Orquestração **fora** dos modes (Scout/operador). Não corta optimize/adversarial.

```text
seed demand
    │
    ▼
┌─ fit review (opcional auto-fix / micro) ──┐
│            ▼                               │
│   run_aegis --fresh --pipeline mutation    │
│            ▼                               │
│   review last_outcome (status/class/next)  │
│            ▼                               │
│   SUCCESS? ──yes──► STOP (SHIP)            │
│            │ no                            │
│   stop class (env/provider/bug)? ──yes──► STOP
│            │ no                            │
│   improve demand (LOOP FEEDBACK + next_step)
│            │                               │
└────────────┴──── max iters ────────────────┘
```

```bash
# Issue
./run_aegis_loop.sh --issue N --max 3

# Ficheiro / free-text
./run_aegis_loop.sh --demand-file /tmp/demand.md --max 3
./run_aegis_loop.sh --max 2 "micro demand text…"

# Sem fit check
./run_aegis_loop.sh --no-fit --issue N
```

Artefactos: `.harness/runtime/loop/demand.md`, `state.json`, `loop.jsonl`, `run_*.log`.  
Melhora = apêndice `## LOOP FEEDBACK` na demand (não edita `src/` à mão).

### Acceptance no draft (evita falha do alignment)

No SPEC, Acceptance deve ser **tokens curtos** que aparecem no código/diff, não prosa:

```markdown
## Acceptance
- converterMegabytesToKilobits
- 1024 * 8
```

Não: “is exported from src/index.ts with typed number…”.

### Pré-requisitos da cadeia auto

- `gh` autenticado (`gh auth status`); se falhar OPEN → reportar e parar.  
- `unset GITHUB_TOKEN` se token de ambiente inválido.  
- Worktree: avisar se targets dirty; não mutar `src/` à mão durante RUN.  
- Durante RUN: Scout **não** edita targets.  
- **Fit check** (recomendado antes de OK/RUN): ver secção **Fit check** abaixo.

---

## Fit check — cabe nos rails / no modelo? Como se ajusta?

Ferramenta: `scripts/fit_check_demand.sh` (+ lib `scripts/lib/fit_check.sh`).

```bash
# stdin ou ficheiro
bash scripts/fit_check_demand.sh < demand.md
bash scripts/fit_check_demand.sh --issue 4
bash scripts/fit_check_demand.sh --write-fixed /tmp/fixed.md < demand.md

# bloquear mutation se não couber
AEGIS_FIT_CHECK=1 ./run_aegis.sh --fresh --pipeline mutation --issue N
```

Stdout = JSON `aegis.fit_check.v1`. Exit `0` se `run_allowed`, senão `1`.

### Como o ajuste funciona (importante)

Há **três camadas** — não é “mágica que reescreve o mundo”:

```text
                    demand original
                          │
                          ▼
              ┌───────────────────────┐
              │ 1. AUTO-FIX (sempre)  │  reescreve markdown na memória
              │    → fixed_demand     │  NÃO abre issue sozinho
              └──────────┬────────────┘
                         │
                         ▼
              ┌───────────────────────┐
              │ 2. AVALIAR            │  rails_ok + score modelo
              │    run_allowed?       │
              └──────────┬────────────┘
                         │
           ┌─────────────┼─────────────┐
           ▼             ▼             ▼
        RUN ok      PROPOR SPLIT    BLOQUEAR
                    (needs_operator)
```

#### 1) O que o sistema **ajusta sozinho** (`auto_fixes_applied` → `fixed_demand`)

| Auto-fix | O que faz |
|-----------|-----------|
| `wrap_free_text_to_structured` | Free-text → esqueleto `## Goal/Targets/Tasks/…` |
| `tokenize_acceptance` | Linhas de Acceptance longas/prosa → tokens curtos (identificadores do Change/Goal) |
| `neutralize_package_js_prose` | Menções a `package.js` que não são target → prosa neutra |

**Limite:** isto só mexe no **texto da demand**. Não edita o GitHub Issue até o Scout fazer `gh issue edit`. Em free-text + `AEGIS_FIT_CHECK=1`, o `run_aegis` pode **usar** o `fixed_demand` na run.

#### 2) O que o sistema **só propõe** (`proposed_units`) — operador decide

| Situação | Proposta |
|----------|----------|
| `targets_count > 1` | Uma micro-unidade por path em `## Targets` |
| create + reexport no mesmo bundle | Duas unidades sequenciais (create → reexport) |
| `model_fit=poor` / score alto | Split; **não** corre mutation |

O operador (ou Scout com **OK** por micro) cria issues e corre **uma a uma**.  
**Não** há multi-RUN automático em background (de propósito — KISS + custo).

#### 3) O que **nunca** é automático

| Nunca auto | Porquê |
|------------|--------|
| Correctness do algoritmo (clamp vs `%`) | Rails não “entendem” domínio |
| Review de produto | Humano |
| Trocar o modelo | Política do operador (marco 8B = split, não upgrade) |

### Campos do JSON (leitura rápida)

| Campo | Significado |
|-------|-------------|
| `rails_ok` | Passou checks mecânicos (targets, tasks, estrutura) |
| `model_fit` | `ok` \| `marginal` \| `poor` (heurística 8B) |
| `score` | 0–10 risco (maior = pior) |
| `run_allowed` | Podes ir a OPEN/RUN? |
| `fixed_demand` | Demand após auto-fixes |
| `proposed_units` | Micros sugeridos se não couber |
| `auto_fixes_applied` | O que já foi reescrito |
| `how_adjust_works` | Eco deste contrato (para o Scout) |

### Integração no fluxo SPEC

```text
SPEC <pedido>
  → (Scout) fit_check no draft
  → mostra fixed_demand + blockers/proposed_units
  → se run_allowed: pergunta OK como hoje → OPEN→RUN
  → se !run_allowed: mostra micros; operador OK por micro (SPEC/OPEN cada um)
```

### Exemplos

```bash
# Cabe (como issue #5)
bash scripts/fit_check_demand.sh --issue 5
# → run_allowed=true

# Não cabe (como issue #4 monstro)
bash scripts/fit_check_demand.sh --issue 4
# → run_allowed=false, proposed_units=[...]
```

### Pipeline de mutation (único caminho de garantia)

Aegis **sempre** percorre o stack completo em mutation:

`discovery → forensics → repair → optimize → adversarial → validation`

Pedidos pequenos sem essas garantias → assistente no IDE, não Aegis.  
Modelo fraco (ex. 8B) é **piso de qualidade** dos modes, não motivo para saltar optimize/adversarial.

```bash
./run_aegis.sh --fresh --pipeline mutation --issue N
# ou default mutation:
./run_aegis.sh --fresh --issue N
```

### Emit micros + correr uma unidade (`--from-fit --unit`)

Quando o monstro não cabe, gera ficheiros e corre **uma** micro de cada vez (full mutation por unidade):

```bash
# 1) Split → dir com fit.json + unit-0.md, unit-1.md, …
bash scripts/fit_check_demand.sh --emit-micros /tmp/aegis-micros --issue 4

# 2) Correr só a unidade 0 (free-text demand; pipeline mutation completo)
./run_aegis.sh --fresh --from-fit /tmp/aegis-micros --unit 0

# 3) Depois da SUCCESS, unidade 1
./run_aegis.sh --fresh --from-fit /tmp/aegis-micros --unit 1
```

Cada `unit-N.md` é uma demand estruturada (1 target). O operador confirma a sequência; o harness **não** dispara N runs em paralelo.

---

## Vocabulário reservado

### Entrada

```text
Leia INTAKE.md
SPEC <pedido>
```

Pós-run / casos especiais: verbos finos abaixo.

### Verbos (default vs avançado)

| Verbo | Uso | Significa |
|-------|-----|-----------|
| **`SPEC`** | **Default** | Draft → mostra issue → pergunta alterar? → se não, **OPEN→READY→HAND→RUN** (+ OUT/SHIP se possível) |
| **`EDIT`** | Após SPEC | Só reescreve o draft; não executa |
| **`OK`** / **`GO`** | Após SPEC | Confirma draft sem mudanças → dispara cadeia auto |
| **`STOP`** | Qualquer momento | Cancela cadeia pendente |
| **`OUT`** | Pós-run | Resume outcome/diff (≤5 linhas) |
| **`SHIP`** | Pós-SUCCESS | Commit §5 + task `[x]` |
| **`NEXT`** | Multi-task | Próxima `[ ]` + HAND/RUN `--fresh` |
| **`FIX`** | Falha | Diagnóstico demand vs patch; re-SPEC/re-run ou fix jailed |
| **`POL`** | Pós-SHIP | Polish + `polish: issue#N…` |
| **`RO`** | Em vez de mutation | Readonly (sonda) |
| **`OPEN`** **`READY`** **`HAND`** **`RUN`** | **Avançado / debug** | Passos manuais; no fluxo default o **SPEC+OK** já os encadeia |

### Argumentos

| Token | Significado |
|-------|-------------|
| `#N` | Issue N |
| `tK` | Task K (ex. `t2`) |
| `@path` | Forçar target no SPEC |

### Exemplos

**Dia a dia (preferido):**

```text
Leia INTAKE.md
SPEC megabytes→kilobits em src/index.ts
```

Assistente mostra issue e pergunta. Operador:

```text
OK
```

→ issue no GitHub + Aegis corre sozinho.

**Com edição:**

```text
SPEC …
→ (vê draft)
EDIT Acceptance só: nomeDaFuncao
→ (vê draft de novo)
OK
```

**Pós-run manual:**

```text
OUT
SHIP #2 t1
```

### Regras de interpretação

1. **SPEC sem texto** → pedir o pedido numa frase; não inventar.  
2. **SPEC+OK** = autorização completa para criar issue e correr mutation (não pedir OPEN/READY/HAND/RUN à parte).  
3. Verbo desconhecido → perguntar.  
4. Sem `gh` / auth → mostrar draft, explicar bloqueio OPEN; oferecer free-text RUN só se o operador pedir.  
5. Durante RUN: **proibido** editar targets.  
6. Respostas curtas; o body da issue no SPEC pode ser o único bloco longo.

### Rule do projeto (opcional)

```text
On "Leia INTAKE.md" or SPEC/OK/EDIT/OUT/SHIP/…: follow INTAKE.md. SPEC shows issue draft, asks once to edit; if user declines, auto OPEN→READY→HAND→RUN. Scout only during RUN.
```

---

## Marco 8B (piso de qualidade — full pipeline)

O 8B é o **limite inferior** de sucesso com o **mesmo** pipeline de mutation (inclui optimize + adversarial).  
Não se corta stages para “ajudar” o modelo: melhora-se demand, rails e skills.

Problemas que **não** se resolvem com modelo maior quando o harness/demand falha:

| Problema | Fix mínimo |
|----------|------------|
| `package.json` → path fantasma `package.js` | regex com `\b`; paths só de `## Targets` |
| Issue monstro multi-ficheiro | **1 issue = 1 ficheiro / 1 intenção** |
| Acceptance em prosa | tokens que aparecem no diff |
| Reexport NodeNext + smoke | smoke cria symlink `.js`→`.ts` temporário |
| Out of scope a nomear paths | **não** listar paths em Out of scope |

**Prova de marco (Llama 3.1 8B):** micros bem formatadas no stack de exemplo (ex. issues TokenBucket). A issue monstro multi-ficheiro falha — mesma capacidade, demand errada.

## 0. O que este ficheiro gere (e o que não gere)

### 0.1 Gere aqui (kit nativo)

| Responsabilidade | Onde persiste | Dono |
|------------------|---------------|------|
| Pedido (Goal, Targets, Acceptance, …) | GitHub Issue body | Scout |
| Progresso (task list `[ ]`/`[x]`) | Mesma issue | **Scout / humano** |
| Labels de prontidão | GitHub labels | Scout / humano |
| Código “o que o software é” | git commits (§5) | Scout / humano / opt-in harness |
| Handoff + execução | CLI `./run_aegis.sh --issue N` | **Scout após SPEC+OK** (cadeia auto); operador pode RUN à mão |
| Prova curta de run | comentário issue (opt-in) + `last_outcome` local | Aegis (opt-in) / Scout |
| Branch de trabalho | git branch | Scout / humano |
| Diagnóstico pós-falha | chat + issue edit se demand má | Scout |

### 0.2 Não gere aqui (fica no Aegis / noutros sítios)

| Não é papel do Scout via `INTAKE.md` | Onde vive |
|--------------------------------------|-----------|
| Path jail, intent gates, preflight tsc/test | Runtime Aegis |
| Policy de repair / adversarial / validation | `.skills/*.md` |
| Epistemic handover, metrics jsonl, payloads | `.harness/runtime/*` (efémero) |
| Secrets / API keys | `.harness/local.env` (gitignored) |
| Store paralelo de demands | **Proibido** (sem `.harness/demands/`) |
| Memória longa do agente em ficheiro | **Proibido** — usa issue + git log |

### 0.3 Hierarquia de verdade se divergir

1. **Código em HEAD** (commits) — o que existe de facto  
2. **Issue body** (pedido) — o que se *queria*  
3. **Checkboxes** — progresso *declarado* (corrigir se mentirem face ao git)  
4. **Chat / handover** — nunca fonte de verdade entre sessões  

---

## 1. Papéis

| Papel | Quem | Faz |
|-------|------|-----|
| **Scout** | Cursor / Claude Code / humano | Issue, tasks, labels, commits, leitura de outcome, polish |
| **Executor** | Aegis CLI | Pipeline contido (`--issue N`) |
| **Judge** | Humano ± Scout *depois* da run | Aceitar done, marcar `[x]`, próxima task ou fechar issue |

**Regras de ouro**

1. Um mutador de código por fase: **Aegis** na run; **Scout** só antes (rascunho throwaway) ou **depois** do promote (polish).  
2. Demand estável durante a run — não reescrever a issue “em voo”.  
3. Task list e commits são **memória**; handover **não** é.

---

## 2. Formato da issue (Demand Record)

Body markdown com **headers fixos**. Paths **repo-relativos**, sem `..`, sem absolutos.

```markdown
## Goal
Uma frase: o comportamento que deve existir no fim desta issue.

## Targets
- src/path/one.ts
- src/path/two.ts

## Tasks
- [ ] Task 1 — uma mutação executável sozinha
- [ ] Task 2 — …

## Change
- O que muda (1–3 bullets; preferir por task se houver várias)

## Acceptance
- Critério observável 1
- Critério observável 2

## Out of scope
- O que esta issue NÃO pede

## Constraints
- TypeScript: sem any / as any / @ts-ignore
- Imports: NodeNext com extensão .js em relative imports
- Só packages no package.json; builtins = globais

## API sketch
(Opcional; create/net-new; ≤ ~15 linhas; assinaturas/types; sem corpos)

## Notes
(Opcional; humano/auditoria — não é o centro do pedido ao Aegis)
```

### 2.1 Tetos

| Campo | Limite |
|-------|--------|
| Goal | 1–2 frases, ~≤240 chars |
| Targets por task | 1–2 paths |
| Tasks abertas “prontas” | 1–3 por issue micro |
| Acceptance | 1–3 bullets por task |
| API sketch | ≤ ~15 linhas, sem implementação |

### 2.2 Task auto-contida

| Campo | Exemplo |
|-------|---------|
| Título | `Create tokenBucket module` |
| Targets | 1–2 paths |
| Done when | 1–2 bullets observáveis |
| Depends | `none` \| `task:1` \| `issue:41` |
| Change | 1–3 bullets **só desta task** |

### 2.3 Exemplo micro

```markdown
## Goal
Token bucket em src/tokenBucket.ts reexportado por src/index.ts.

## Targets
- src/tokenBucket.ts
- src/index.ts

## Tasks
- [ ] Create src/tokenBucket.ts with public consume/refill API (BigInt time)
- [ ] Reexport public API from src/index.ts

## Change
- Add tokenBucket module with consume/refill
- Reexport from index

## Acceptance
- Public API exists and is typed without any
- index reexports the public symbols

## Out of scope
- e2e tests; other src/ files; drive-by refactors

## Constraints
- no any/as any/@ts-ignore; NodeNext .js relative imports; BigInt is global
```

### 2.4 Intake: o que a IA pode / não pode

**Pode:** micro-partir tasks; paths reais; change; acceptance; depends; out of scope; API sketch mínimo.  
**Não pode:** tutoriais longos; copiar `.skills/`; implementação no body; secrets; reescrever demand *dentro* do Aegis.

---

## 3. Task list — dono e operações

### 3.1 Quem cuida

| Ação | Dono |
|------|------|
| Criar / partir / reordenar tasks | **Scout** (intake) |
| Marcar `[x]` quando acceptance ok | **Scout ou humano** (pós SUCCESS + commit) |
| Não avançar task *k* se *k−1* aberta | **Scout / operador** (disciplina) |
| Auto-marcar no promote Aegis | **Não** — o harness só *sugere* (“mark task done”) |

A task list é **progresso declarado na issue**, não prova de código. Se `[x]` e git divergirem → **git manda**; corrigir a checkbox.

### 3.2 Quando marcar done

Marcar `[x]` **só se**:

1. Run terminou **SUCCESS** (ou humano aceitou promote + acceptance à mão), **e**  
2. Há commit `aegis: issue#N task#K …` (ou auto-commit equivalente) cobrindo os paths da task, **e**  
3. Acceptance da task é observável no código/testes.

**Não** marcar `[x]` em: HALTED, FAILED, soft-accept duvidoso, WIP, “parece ok no chat”.

### 3.3 Operações `gh` (práticas)

**Ver issue**

```bash
gh issue view N
gh issue view N --json title,body,labels,state
```

**Criar** (intake)

```bash
gh issue create --title "<goal curto>" --body-file - --label "aegis,aegis:ai-assisted" <<'EOF'
## Goal
…

## Targets
- …

## Tasks
- [ ] Task 1 — …
- [ ] Task 2 — …

## Change
- …

## Acceptance
- …

## Out of scope
- …

## Constraints
- …
EOF
```

**Marcar task K como done (editar body)**  
`gh` não tem “toggle checkbox” nativo estável em todas as versões: o Scout **obtém o body, troca a linha da task, regrava**.

```bash
# 1) Body atual
gh issue view N --json body -q .body > /tmp/aegis-issue-N.md

# 2) Editar: na linha da task, trocar "- [ ]" por "- [x]"
#    (assistente ou editor; não alterar outras secções sem necessidade)

# 3) Regravar
gh issue edit N --body-file /tmp/aegis-issue-N.md
```

Convenção de linhas (fácil de grep):

```markdown
## Tasks
- [ ] Task 1 — Create src/tokenBucket.ts …
- [x] Task 2 — Reexport from index
- [ ] Task 3 — …
```

**Reabrir task** (regressão / rework): `- [x]` → `- [ ]` + nota em `## Notes` ou comentário curto.

**Comentário de progresso** (opcional, sem reescrever body):

```bash
gh issue comment N --body "$(cat <<'EOF'
### Progress
- task: 1 → done
- commit: \`abc1234\`
- next: task 2 with clean tree + \`./run_aegis.sh --fresh --issue N\`
EOF
)"
```

### 3.4 Ordem e depends

- Não sugerir run da task *k* se *k−1* ainda `[ ]` e Depends implica ordem.  
- Depends `none` → pode ser paralela em **branches diferentes**; no **mesmo** worktree, serializar.  
- Próxima task = sempre investigation **nova** (`--fresh`); não reutilizar handover.

---

## 4. Labels e branch

### 4.1 Labels

| Label | Quem põe | Significado |
|-------|----------|-------------|
| `aegis` | Scout no create | Filtrar demandas harness |
| `aegis:ai-assisted` | Scout | Draft veio de IA |
| `aegis:operator-confirmed` | Humano / Scout após OK humano | Secções obrigatórias validadas |
| `aegis:ready` | Humano / Scout | Pode correr Aegis |
| `aegis:blocked` | Humano / Scout | **Não** correr |

```bash
gh issue edit N --add-label "aegis:ready,aegis:operator-confirmed"
gh issue edit N --add-label "aegis:blocked"
gh issue edit N --remove-label "aegis:ready"
```

Só sugerir `./run_aegis.sh` se **não** houver `aegis:blocked` e (idealmente) houver `aegis:ready`.

### 4.2 Branch

```text
aegis/issue-<N>
aegis/issue-<N>-task-<K>    # opcional se quiseres PR por task
```

```bash
# Base na ponta do produto (main atualizado ou última aegis/issue-* mergeada).
# Não criar em main stale — imports de módulos ainda não no trunk falham.
git switch -c aegis/issue-42
# worktree limpo nos targets antes da run
git status
```

---

## 5. Formato de commit (memória do código)

Default do Aegis: **promote no worktree, sem commit**. Fechar memória = Scout/operador (ou `AEGIS_AUTO_COMMIT=1`).

### 5.1 Subject

```text
aegis: issue#<N> task#<K> <resumo curto>
aegis: issue#<N> <resumo curto>
polish: issue#<N> <resumo curto>
wip: issue#<N> <resumo>          # só se o humano pedir; NÃO é “done”
```

### 5.2 Body (trailers)

```text
Aegis-Promoted: true
Aegis-Verdict: accepted
Aegis-Mode: validation
Aegis-Issue: 42
Aegis-Task: 1
Aegis-Paths: src/tokenBucket.ts, src/index.ts
Aegis-Source: scout
```

| Trailer | Uso |
|---------|-----|
| `Aegis-Promoted` | `true` se promote Aegis |
| `Aegis-Verdict` | `accepted` / … |
| `Aegis-Mode` | `validation`, … |
| `Aegis-Issue` / `Aegis-Task` | números sem `#` |
| `Aegis-Paths` | paths tocados |
| `Aegis-Source` | `harness` \| `scout` \| `human` |

### 5.3 Exemplo

```bash
git add -- src/tokenBucket.ts
git commit -m "$(cat <<'EOF'
aegis: issue#42 task#1 add tokenBucket consume/refill

Aegis-Promoted: true
Aegis-Verdict: accepted
Aegis-Mode: validation
Aegis-Issue: 42
Aegis-Task: 1
Aegis-Paths: src/tokenBucket.ts
Aegis-Source: scout
EOF
)"
```

### 5.4 Ler memória

```bash
git log --oneline --grep='issue#42' -20
git log -1 --format=full
git log -5 --oneline -- src/tokenBucket.ts
```

### 5.5 Comentário OUTCOME (curto; opt-in harness `AEGIS_ISSUE_COMMENT=1`)

```markdown
### AEGIS OUTCOME
- status: SUCCESS
- verdict: accepted
- issue: 42
- task: 1
- commit: `abc1234`
- paths: src/tokenBucket.ts
- next: mark task 1 done; run task 2 with --fresh
```

```bash
export AEGIS_AUTO_COMMIT=1      # opt-in
export AEGIS_ISSUE_COMMENT=1    # opt-in; precisa issue number no env da run
```

---

## 6. Handoff Aegis e ciclo de vida

### 6.1 Comandos

```bash
./run_aegis.sh --fresh --pipeline mutation --issue N
./run_aegis.sh --fresh --pipeline readonly --issue N
./run_aegis.sh --resume
```

Provider: OpenAI-compatible via env / `.harness/local.env` (sem MLX local no projeto).

**Produto atual:** `--issue N` → `gh issue view` → body inteiro.  
**Proposto:** `--task K`. Até existir, preferir **issues micro** ou uma task clara por run.

### 6.2 Ciclo de vida de uma issue

```text
[draft Scout] → create issue + labels ai-assisted
      → humano confirma → operator-confirmed + ready
      → branch aegis/issue-N ; worktree limpo
      → Aegis mutation --issue N   (Scout NÃO edita targets)
      → SUCCESS?
           sim → commit §5 → checkbox [x] → próxima task ou fechar issue
           não → diagnosticar demand vs patch → edit issue ou re-run / fix jailed
      → polish opcional (commit polish:) 
      → issue closed quando Goal global cumprido
```

### 6.3 Durante a run

- Não editar targets no IDE.  
- Não reescrever issue.  
- Não marcar `[x]` “por antecipação”.

### 6.4 Depois da run

1. `last_outcome.json` + `pipeline_metrics.jsonl` + `git diff`  
2. SUCCESS → commit §5 se preciso → **task list `[x]`** (§3)  
3. FAILED → demand vs patch; sem commit de sucesso falso  
4. Próxima task → `--fresh`, HEAD estável  

### 6.5 Quando *não* usar Aegis

Cosmético trivial → IDE. Design aberto → só chat. Épico → partir issues/tasks primeiro.

---

## 7. Utilização prática

### 7.1 Default (2 mensagens)

```text
Leia INTAKE.md
SPEC <pedido>
```

```text
OK
```

→ issue criada + Aegis mutation + OUT (+ SHIP se possível).

### 7.2 Com edição

```text
SPEC <pedido>
→ draft
EDIT <mudanças>
→ draft novo
OK
```

### 7.3 Anti-padrões

- Pedir OPEN/READY/HAND/RUN à mão no fluxo normal (o **OK** já encadeia)  
- Mutar `src/` durante RUN  
- Acceptance em prosa longa (quebra alignment)  
- Plano só no chat sem issue  
- Store `demands/`

---

## 8. Checklist rápido

**Fluxo SPEC (default)**

- [ ] `SPEC <pedido>` → draft mostrado  
- [ ] Operador: EDIT ou OK  
- [ ] Se OK: OPEN→READY→HAND→RUN automático  
- [ ] Acceptance com tokens curtos  
- [ ] Scout **não** edita targets durante RUN  

**Depois**

- [ ] OUT  
- [ ] SHIP se SUCCESS (`aegis: issue#N…` + `[x]`)  
- [ ] Sem `package.js` / paths fantasmas se Constraints mencionarem package.json 

---

## 9. Mapa de secções

| § | Conteúdo |
|---|----------|
| **Fluxo default** | **SPEC → mostra issue → OK? → auto OPEN…RUN** |
| **Vocabulário** | Verbos (default vs avançado) |
| 0 | O que este ficheiro gere / não gere |
| 1 | Papéis |
| 2 | Formato da issue |
| 3 | Task list — dono + `gh` |
| 4 | Labels e branch |
| 5 | Commits como memória |
| 6 | Handoff Aegis e ciclo de vida |
| 7 | Utilização prática |
| 8 | Checklist |
| 9 | Este índice |

---

*Fim de `INTAKE.md` — único playbook operacional do Scout para Aegis + IDE.*

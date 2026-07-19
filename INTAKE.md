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

## 0. O que este ficheiro gere (e o que não gere)

### 0.1 Gere aqui (kit nativo)

| Responsabilidade | Onde persiste | Dono |
|------------------|---------------|------|
| Pedido (Goal, Targets, Acceptance, …) | GitHub Issue body | Scout |
| Progresso (task list `[ ]`/`[x]`) | Mesma issue | **Scout / humano** |
| Labels de prontidão | GitHub labels | Scout / humano |
| Código “o que o software é” | git commits (§5) | Scout / humano / opt-in harness |
| Handoff para executar | CLI `./run_aegis.sh --issue N` | Operador (± Scout imprime o comando) |
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

## 7. Utilização prática com o assistente

### 7.1 Como “ligar” este ficheiro

No início da sessão (ou na rule do projeto), o humano (ou a rule fixa) diz:

> Segue `INTAKE.md` neste repositório. És o Scout: issues, task list, commits e handoff Aegis — não o executor do harness.

**Cursor:** rule/project doc apontando a `INTAKE.md`.  
**Claude Code:** CLAUDE.md / instrução de sessão: “Read and follow INTAKE.md”.  
**Não** coloques o texto inteiro no `AGENTS.md` (esse é para o LLM *dentro* do Aegis).

### 7.2 Frases úteis do operador → resposta esperada do Scout

| Operador diz | Scout faz |
|--------------|-----------|
| “Quero X no código” | Explora → draft issue §2 → pede confirmação → `gh issue create` |
| “Prepara o Aegis para a #42” | `gh issue view 42` → valida schema/labels → imprime comando run + `git status` |
| “A run da #42 passou” | Lê outcome/diff → commit §5 se preciso → marca task `[x]` → propõe próxima |
| “A run falhou” | Diagnóstico demand vs patch → edita issue **ou** re-run; não dual-write |
| “Continua a issue #42” | `git log --grep=issue#42` + `gh issue view` → próxima `[ ]` → handoff `--fresh` |
| “Só explora, não mutes” | Readonly Aegis ou só leitura no IDE; sem promote |
| “Fecha a #42” | Verifica Goal + todos `[x]` + commits → `gh issue close 42` se ok |

### 7.3 Sessão tipo (fim a fim)

```text
1. Humano: "Preciso de converter bits→bytes em src/"
2. Scout: lê INTAKE + src → draft issue
3. Humano: "ok, cria"
4. Scout: gh issue create → #42 ; labels ; branch aegis/issue-42
5. Scout: imprime
     ./run_aegis.sh --fresh --pipeline mutation --issue 42
6. Humano (outro terminal): corre Aegis  [Scout espera]
7. Humano: "acabou, vê o outcome"
8. Scout: last_outcome + diff → commit aegis: issue#42 … → [x] task
9. Scout: se há task 2, propõe nova run --fresh; senão close issue
```

### 7.4 O que o assistente deve abrir em cada fase

| Fase | Ler |
|------|-----|
| Intake | `INTAKE.md` §2–3, código relevante (read-only) |
| Pré-run | issue via `gh`, `git status`, labels |
| Pós-run | `last_outcome.json`, metrics, `git diff`, §5 commits, §3 tasks |
| Nova sessão | `INTAKE.md` (se rule não carregar), `git log --grep=issue#N`, `gh issue view N` |

### 7.5 Anti-padrões (assistente)

- Mutar `src/` enquanto Aegis corre no mesmo branch  
- Marcar todas as tasks `[x]` de uma vez “para limpar”  
- Commit monólito no fim de 5 tasks  
- Guardar plano só no chat e não na issue  
- Criar `DEMANDS.md` / `.harness/demands/`  
- Misturar cloud keys no body da issue  
- Tratar soft-accept como done sem olhar acceptance  

---

## 8. Checklist rápido

**Antes**

- [ ] Goal / Targets / Tasks / Acceptance / Out of scope  
- [ ] Issue `#N` no GitHub  
- [ ] Labels: sem `blocked`; idealmente `ready` + `operator-confirmed`  
- [ ] Branch `aegis/issue-N` ; `git status` limpo nos targets  

**Handoff**

- [ ] `./run_aegis.sh --fresh --pipeline mutation --issue N`  
- [ ] Scout **não** edita targets durante a run  

**Depois**

- [ ] Outcome + métricas + diff  
- [ ] Commit `aegis: issue#N task#K …` (+ trailers) se sem auto-commit  
- [ ] Checkbox da task → `[x]` (§3)  
- [ ] Comentário curto opcional  
- [ ] Próxima task com `--fresh` ou `gh issue close`  

---

## 9. Mapa de secções (para o assistente)

| § | Conteúdo |
|---|----------|
| 0 | O que este ficheiro gere / não gere |
| 1 | Papéis |
| 2 | Formato da issue |
| 3 | **Task list — dono + `gh`** |
| 4 | Labels e branch |
| 5 | Commits como memória |
| 6 | Handoff Aegis e ciclo de vida |
| 7 | **Utilização prática com o assistente** |
| 8 | Checklist |
| 9 | Este índice |

---

*Fim de `INTAKE.md` — único playbook operacional do Scout para Aegis + IDE.*

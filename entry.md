# entry.md — Demand Protocol via GitHub Issues (proposta)

**Status:** proposta completa; **mínimo KISS parcialmente implementado**  
**Mapa canónico do repo atual:** `summary.md` · **Setup operador:** `README.md` · **Constituição:** `AGENTS.md`  
**Âmbito:** padronizar como o Aegis obtém, valida e consome a *investigation demand*  
**Persistência da demanda:** GitHub Issue (remoto) — sem store local de demands  
**Data da discussão:** 2026-07 (sessão de desenho Aegis KISS)

### Já no produto (KISS slice)

| Capacidade | Onde |
|---|---|
| `--issue N` → `gh issue view` (title+body real) | `scripts/lib/demand.sh` + `runtime_aegis.sh` |
| Soft normalize de headers `## Goal` / `## Targets` / … | `aegis_normalize_demand_text` |
| Path safety (sem `..`, sem absolutos) | `aegis_demand_assert_paths_safe` |
| `filesystem.read` determinístico (paths do operador + attention) | `augment_evidence_profile_from_anchors` em `execute_mode.sh` |
| Tokens da demand → `search_symbol` + Layer 0 content resonance | `aegis_demand_tokens` / dense + `;;` multi `-F` + `git grep -l` |
| `required_evidence` só âncoras mecânicas (named ∪ seed) | `merge_operator_required_evidence` em `artifact_protocol.sh` |
| Discovery mecânico content-aware (missing / hits / no hits) | `aegis_discovery_probe_path` + `aegis_build_mechanical_discovery_json` |
| Forensics mecânico; LLM se multi-seed sem vencedor de probe | `aegis_forensics_needs_llm` + probes + search só no ramo LLM |
| Uma história mecânica: prompt (linhas) + capability (JSON) + handover | `aegis_materialize_demand_anchors_json` |
| Structured goal/targets/done_when | mesmo helper |
| Forensics handoff = só ALVO/reason (sem duplicar TOKENS) | `aegis_format_forensics_handoff_section` |
| Repair: MUTATION BRIEF (exports + probe + one-change) | `aegis_format_mutation_brief_section` |
| Repair com ALVO omite search_symbol | `aegis_handover_has_repair_alvo` + execute_mode |
| Scrub “operator named” falso no discovery | enrich discovery |
| Repair intent gates (tokens + over-export) + fix retry | `assert_mutation_intent_gates` / `assemble_intent_fix_prompt` |
| Profiles lean: forensics sem git.status; optimize/adversarial sem demand_anchors | config evidence profiles |

### Ainda proposta (não implementado)

Wizard de intake, labels GitHub, 1-task-1-pipeline batch, schema fatal completo, `--task K`.

Este documento regista o acordo conceptual.  
Se conflitar com código, o **código atual manda**.  
Se conflitar com `AGENTS.md`, a constituição manda.

---

## 1. Problema

### 1.1 O que já funciona

- O harness é **efetivo a conter o LLM** (capabilities, evidence, scope gate, preflight, promotion, outcome).
- Gates de mutação (lint, tsc delta, smoke, scope) e higiene de tipos/modules melhoram a execução.
- Epistemic handover é atenção incompleta da investigation atual — **não** memória de verdade.

### 1.2 O buraco

- A qualidade das runs longas falha muitas vezes na **demanda do operador** (spec densa, multi-eixo, free-text).
- Modelos fracos (ex. 8B) degradam com prompts monstro; o harness detecta (preflight) mas não corrige a *spec*.
- O operador também precisa de **disciplina e consciência** do modelo de execução (custo, isolamento, limites).

### 1.3 Comportamento atual da instrução (baseline a substituir)

| Entrada | `AEGIS_INVESTIGATION_INPUT` |
|---|---|
| `./run_aegis.sh "texto livre..."` | String do CLI (path-scrub + soft normalize se headers) |
| `./run_aegis.sh --issue N` | **Body real** via `gh issue view` (title+body) |
| env / default | Conforme config; materializado no runtime |

- O **mesmo** input alimenta **todos** os modes de **uma** run.
- Não há schema Goal/Tasks/Acceptance, nem 1-task-1-pipeline, nem wizard de intake.
- Persistência da demanda: fraca (shell history / string no handover).

---

## 2. Objetivos da proposta

1. **Padronizar a demanda** como artefacto estável e auditável (GitHub Issue).
2. **Forçar micro-demandas** coerentes e completas (polícia do operador).
3. **Clareza para modelos fracos** via texto canónico estruturado e curto.
4. **Completude para o harness** (targets, acceptance, out of scope, constraints).
5. **Isolamento de execução:** cada micro-operação = investigation própria = pipeline completo.
6. **KISS:** reutilizar recursos nativos (GitHub Issue, `gh`, git, OUTCOME) — **sem** pasta `.harness/demands/` nem DB nova.
7. Separar **intake** (humano ± IA barata) de **execução Aegis** (LLM contido).

---

## 3. Princípios (alinhados a AGENTS.md)

| Princípio | Consequência |
|---|---|
| Runtime authority | Só o runtime/orchestrator materializa o input; modes não inventam demanda |
| Evidence discipline | Sem LLM a reescrever a demanda *dentro* do repair; intake IA = proposta, humano confirma |
| KISS | Schema markdown fixo; validação mecânica; zero store paralelo de ficheiros de demand |
| Ephemeral cognition | Handover/payloads/metrics não são memória entre tasks |
| Git = memória do **código** | Tree/HEAD (e commits) entre tasks; issue = memória do **pedido/progresso** |

---

## 4. Modelo mental

```text
┌─────────────────────────────────────────┐
│  1. INTAKE (wizard ± IA Fable/Grok)     │  humano + opcional IA barata
│     pergunta / preenche / valida tetos  │
└─────────────────┬───────────────────────┘
                  ▼
┌─────────────────────────────────────────┐
│  2. PERSISTÊNCIA                        │  GitHub Issue (Goal + Tasks)
└─────────────────┬───────────────────────┘
                  ▼
┌─────────────────────────────────────────┐
│  3. CONSENTIMENTO DE EXECUÇÃO           │  micro (default) vs batch (opt-in)
│     operador ciente de custo/limitação  │
└─────────────────┬───────────────────────┘
                  ▼
┌─────────────────────────────────────────┐
│  4. AEGIS RUN                           │  1 task = 1 pipeline isolado
│     (batch só se opt-in frontier)       │
└─────────────────────────────────────────┘
```

| Sistema | Papel | Modelo |
|---|---|---|
| **Assistente de demanda** | Escrever/validar issue | Grok/Fable/humano — **fora** do mutation runtime |
| **Aegis** | Executar investigation contida | 8B/frontier **dentro** de gates |

**Não misturar:** o LLM do repair não gera nem “melhora” a issue a meio da run.

---

## 5. Persistência: GitHub Issue

### 5.1 Onde vive

- Issues ficam no **GitHub remoto** (API / UI / `gh`), não como ficheiros no tree do projeto.
- Identidade estável: número da issue (`#42`) + índice da task + (proposto) hash do texto da task.

### 5.2 O que a issue é / não é

| É | Não é |
|---|---|
| Store do **pedido** e do **progresso** (tasks) | Store do código |
| Roadmap humano da feature | Handover epistémico |
| Fonte para materializar investigation input | Transcript do Aider / metrics |

### 5.3 Por que não ficheiros locais de demand

- Operador pediu **não criar store novo** no repo.
- Issue já é recurso nativo de equipas GitHub.
- Escape hatch offline: ver §12 (stdin / freeform opt-in com o **mesmo schema**), sem pasta `demands/`.

---

## 6. Schema da issue (Demand Record)

Markdown com **headers fixos** (parse mecânico).

```markdown
## Goal
Uma frase: o comportamento a existir no fim desta issue (visão agregada).
(Sem lista de features. Sem “e também” longos.)

## Targets
- src/path/one.ts
- src/path/two.ts
# Preferência: targets por task; lista global opcional/redundante

## Tasks
- [ ] Task 1 — título curto e executável sozinho
- [ ] Task 2 — …
- [ ] Task 3 — …

## Change
# Global opcional; preferir change por task (ver §6.1)

## Acceptance
# Global opcional; preferir done-when por task

## Out of scope
- O que esta issue NÃO pede

## Constraints
- TypeScript: sem any / as any / @ts-ignore
- Imports: NodeNext com extensão .js em relative imports
- Só packages no package.json; builtins = globais
# Defaults do repo — curtos e estáveis (não reinventar por issue)

## API sketch
# Opcional; só create/net-new; ≤ ~15 linhas; só assinaturas/types; sem corpos de lógica

## Notes
# Opcional; NÃO entra no prompt do Aegis (só humano / auditoria / output bruto da IA de intake)
```

### 6.1 Task auto-contida (obrigatório para execução)

Cada task deve poder ser investigation isolada. Campos lógicos (no body, por convenção):

| Campo | Exemplo |
|---|---|
| Título | `Create tokenBucket module` |
| Targets | 1–2 paths |
| Done when / acceptance | 1–2 bullets observáveis |
| Depends | `none` \| `task:1` \| `issue:41` |
| Change | 1–3 bullets do que muda **só nesta task** |

**Task list na issue = micro-operações**, não checklist cosmética de uma única run monstro.

### 6.2 Tetos duros (validação mecânica no intake / no run)

| Regra | Limite sugerido | Token fatal (proposto) |
|---|---|---|
| Goal | 1–2 frases, ≤ ~240 chars | `demand_goal_invalid` |
| Targets por task | 1–2 paths repo-relativos | `demand_targets_invalid` |
| Tasks abertas relevantes | 1–3 por issue “pronta a correr” em micro; mais = mais runs | `demand_requires_split` se uma task for gorda |
| Acceptance / done-when | 1–3 bullets por task | `demand_acceptance_invalid` |
| Paths | regex segura, sem `..` | reject |
| API sketch | ≤ ~15 linhas, sem implementação | truncate/reject |

### 6.3 Labels GitHub (recurso nativo)

| Label | Uso |
|---|---|
| `aegis` | Filtrar demandas do harness |
| `aegis:ready` | Operador marca pronta para run |
| `aegis:ai-assisted` | Draft veio de IA de intake |
| `aegis:operator-confirmed` | Humano confirmou secções obrigatórias |
| `aegis:blocked` | Não correr |

### 6.4 O que a IA de intake pode acrescentar

**Sim (estruturado, curto):**

- Micro-partir tasks, targets, change, acceptance, depends-on, out of scope  
- API sketch mínimo em create  
- Extrair paths do rascunho free-text  

**Não:**

- Tutoriais / “dicas longas para o 8B”  
- Duplicar skill/repair  
- Implementação completa no body  
- Reescrever demanda *dentro* do Aegis runtime  

**Higiene genérica (any, imports, etc.)** = defaults de **Constraints** + gates do harness — não manual por issue.

### 6.5 Exemplo bom (micro)

```markdown
## Goal
Token bucket em src/tokenBucket.ts reexportado por src/index.ts.

## Tasks
- [ ] Create src/tokenBucket.ts with public consume/refill API (BigInt time)
- [ ] Reexport public API from src/index.ts

## Out of scope
- e2e tests; other src/ files; drive-by refactors

## Constraints
- no any/as any/@ts-ignore; NodeNext .js relative imports; BigInt is global
```

(Com detail por task no body ou em subtarefas GitHub, conforme convenção de implementação.)

---

## 7. Execução: 1 task = 1 pipeline isolado

### 7.1 Regra default

```text
Issue #42
  Task 1 → run Aegis completa (--fresh) → git/código
  Task 2 → run Aegis completa (--fresh) → parte do tree já com task 1
  Task 3 → …
```

- Cada task = **uma investigation** = discovery→…→validation (ou pipeline escolhido).
- **Handover limpo** entre tasks (`--fresh` implícito ou explícito).
- Memória entre tasks = **código no git/worktree**, não handover da task anterior.

### 7.2 Ordem e dependências

- Tasks são **sequenciais em git** quando Depends-on exige.
- Não avançar task *k* se *k−1* não está done (checkbox / OUTCOME SUCCESS / commit).
- Ordem típica: net-new → consumidores/reexport.

### 7.3 Batch (modelos grandes) — opt-in

| Modo | Quem | Comportamento |
|---|---|---|
| `micro` (default) | Todos; forçar se `aegis:ai-assisted` e ≥2 tasks | 1 task → 1 pipeline |
| `batch` | Frontier; confirmação explícita | Várias tasks abertas → **uma** investigation canónica coalescida |

**Custo:** micro gasta mais tokens de orquestração; pode gastar menos em retries vs 8B monstro.  
**Pergunta de responsabilidade** no *run* (não só no create): operador ciente de N pipelines vs scope creep.

### 7.4 Pipeline enxuto (opcional futuro, frontier)

Não afrouxar scope/preflight/promote.  
Eventual skip de stages redundantes se Targets+Change já fecham a task (`mutation-direct`) — **fora do MVP**.

---

## 8. Canónico injetado no Aegis

Materializado **uma vez** no início da run (orchestrator), não re-lido mode a mode via API GitHub.

```text
AEGIS_DEMAND issue:42 task:2 sha:<hash-curto-do-texto-da-task>
ISSUE_CONTEXT: <Goal global em 1 frase — opcional>
GOAL: <objetivo da task 2>
TARGETS: src/index.ts
CHANGE:
- ...
ACCEPTANCE:
- ...
OUT_OF_SCOPE:
- ...
CONSTRAINTS:
- no any; NodeNext .js relative imports; no invented packages
```

- `sha` ancora reexecução: se o operador editar a task, sha muda → fresh / mismatch honesto.
- **Omitir** Notes e lista de outras tasks no prompt.
- API sketch só se relevante à task.

Este string substitui o free-text de hoje como `AEGIS_INVESTIGATION_INPUT` (ou convive durante migração).

---

## 9. Como os modes usam a info

Não há canal especial por mode para a issue.

1. Orchestrator: `gh issue view` → parse task → canónico → `AEGIS_INVESTIGATION_INPUT`.
2. Modes consomem **como hoje**: investigation + capabilities + handover **dessa** investigation.

| Mode | Efeito prático |
|---|---|
| discovery | Atenção / required_evidence alinhados aos targets da task |
| forensics | repair_candidates ⊆ targets da task |
| repair / optimize | Mutação na jail da task |
| adversarial / validation | Julgam candidate **desta** run; acceptance da task como intenção humana |

**Entre tasks da mesma issue — reaproveita:** body da issue, constraints, labels, **código no git**, identidade issue/task.  
**Não reaproveita:** handover, payloads, evidence cache, roadmap inteiro no prompt.

---

## 10. Camadas de memória / suporte do “que foi feito”

A doutrina “git = única memória persistente” refere-se a **não inventar DB de memória do agente para o código**.  
Suporte completo do trabalho usa o **kit nativo**:

| Camada | Recurso | Responde |
|---|---|---|
| Pedido | GitHub Issue body | O que se queria |
| Progresso | Task list `[ ]`/`[x]`, labels | O que falta / feito |
| Código | Working tree + **commits** | O que o software é |
| Prova de run | OUTCOME local → **comentário na issue** (proposto) | O que o harness concluiu |
| Review (opcional) | PR ligado à issue | Validação humana/CI |
| Efêmero | handover, metrics, payloads | Só a investigation atual |

### 10.1 Git / commits hoje no Aegis

- Worktree de mutação, `git diff`/`status` como evidence, `git apply` na promotion.
- **Não** há commit automático pós-sucesso.
- `git log` entra de forma fraca (ex. churn em layer0_facts).

### 10.2 Integração de commit (proposta, níveis)

| Nível | Ação | MVP? |
|---|---|---|
| 0 | apply no worktree; commit manual | Hoje |
| 1 | OUTCOME sugere `git commit` com `issue:N task:K` | Sim |
| 2 | Opt-in `AEGIS_AUTO_COMMIT=1` após validation accepted | Desejável multi-task |
| 3 | `git.log` filtrado como evidence | Só se necessário |
| 4 | LLM narra history de commits para planear | **Não** |

**Entre tasks:** HEAD/código estável (commit ou apply+disciplina) é a memória correta; handover da task 1 na task 2 é anti-padrão.

### 10.3 Comentário OUTCOME na issue (proposto)

One-liner / bloco curto, não dump de logs:

```text
AEGIS OUTCOME issue:42 task:2/3 status=FAILED reason=mutation_preflight_failed
demand_sha=… commit=n/a
next: fix task 2 only; do not start task 3
```

Opt-in: `AEGIS_ISSUE_COMMENT=1`.

---

## 11. Intake (wizard) e IA opcional

### 11.1 Duas fases (separar)

1. **`demand` / intake** — só criar/atualizar issue + labels  
2. **`run --issue N --task K`** — só executar  

### 11.2 Perguntas do wizard (cada secção da issue)

1. Goal (1 frase)  
2. Targets / tasks (1–3 micros)  
3. Done-when por task  
4. Out of scope  
5. Constraints (defaults + confirma)  
6. Preview canónico  
7. Criar issue (`gh issue create`)  

Pergunta de **responsabilidade** no **run**:

```text
Cada TASK é uma execução ISOLADA do pipeline Aegis.
Micro (default): mais fiável, mais runs/tokens de orquestração.
Batch (opt-in): menos orquestração, mais risco de scope creep.
Escolhe: [1] micro  [2] batch  [3] cancelar
```

### 11.3 “Preencher com IA” (Fable / Grok)

- Input: rascunho free-text do operador.  
- Output: **só** body no schema (ou JSON→body).  
- Wizard: aceitar/editar/descartar **por secção**.  
- Labels: `aegis:ai-assisted` até `aegis:operator-confirmed`.  
- Tokens baratos vs repair falhado de 8B; ROI alto.  
- IA **não** executa o pipeline nem grava issue final sem confirmação humana.

---

## 12. CLI proposto (futuro)

| Comando / flag | Comportamento |
|---|---|
| Intake wizard | Cria/atualiza issue |
| `--issue N --task K` | Fetch body, materializa canónico da task K, pipeline |
| `--issue N --tasks 1-3` ou `--batch-open-tasks` | Batch opt-in |
| `--fresh` | Já existe; implícito por task no default micro |
| Free-text CLI | Recusar **ou** redirecionar ao intake / `gh issue create` |
| `AEGIS_ALLOW_FREEFORM=1` | Escape hatch testes/demo com **mesmo schema** (ex. stdin), sem store de ficheiros |
| `AEGIS_AUTO_COMMIT=1` | Commit após accepted (opt-in) |
| `AEGIS_ISSUE_COMMENT=1` | Comentar OUTCOME na issue |

Tokens de outcome propostos: `demand_incomplete`, `demand_goal_invalid`, `demand_targets_invalid`, `demand_requires_split`, `demand_acceptance_invalid`, `fresh_resume_conflict` (já existe para fresh+resume).

---

## 13. Hoje vs proposta (resumo)

| Dimensão | Hoje | Proposta |
|---|---|---|
| Fonte da verdade | CLI string / `issue #N` vazio | Body da issue + task |
| Granularidade | 1 prompt = 1 run | 1 task = 1 run (default) |
| Polícia operador | Quase nenhuma no input | Wizard + tetos + labels ready |
| IA intake | Não | Opcional, barata, confirmada |
| Handover entre passos | Uma investigation | Fresh por task; git entre tasks |
| Persistência demanda | Fraca | GitHub Issue |
| Ficheiros novos no repo | — | Nenhum store de demands |

**Não muda:** modes, capabilities, scope gate, preflight, promote, constituição AGENTS.md.

---

## 14. Non-goals (explícitos)

- Auto-split semântico da demanda pelo LLM de repair  
- Store local `.harness/demands/`  
- LLM do harness a reescrever issues  
- Batch default silencioso  
- Dicas longas por issue para o 8B  
- Persistência de handover/metrics no git  
- Memória narrativa via `git log` como segundo cérebro do agente  
- Obrigar PR em todo MVP  

---

## 15. Roadmap de implementação sugerido

### Fase A — Contrato e leitura (MVP)

1. Documentar template mental / Issue Form opcional em `.github/` (se a equipa aceitar *um* ficheiro standard GitHub; senão só convenção no README).  
2. Parser/validator do schema (headers + tetos).  
3. `--issue N` com `gh issue view` real + body → canónico (sem task = issue inteira se tiver 1 task implícita).  
4. `--task K` + sha; `--fresh` por task.  
5. Fatals `demand_*` + classify no `run_outcome`.  

### Fase B — Intake

6. Wizard CLI de perguntas.  
7. Hook “expandir com IA” (interface externa; não acoplar provider do Aegis mutation).  
8. Labels ready / ai-assisted / operator-confirmed.  

### Fase C — Memória e progresso

9. OUTCOME sugere commit; opt-in auto-commit com mensagem `issue:N task:K`.  
10. Opt-in comentário OUTCOME na issue; progresso de checkboxes (manual ou `gh`).  

### Fase D — Frontier

11. Batch opt-in de tasks abertas + pergunta de responsabilidade.  

Cada fase deve manter testes shell de contrato (parser, tetos, isolamento de canónico por task).

---

## 16. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Dependência de `gh`/rede | Escape freeform schema; fail claro se offline |
| Issue monstro com 10 tasks | Tetos + UI de custo (N runs); micro-issues se preciso |
| IA de intake inventa API errada | Confirmação humana; API sketch com teto |
| Task 2 sem task 1 | Depends-on + recusar run se predecessor aberto |
| Poluição da issue com logs | Só OUTCOME curto |
| Commit automático indesejado | Opt-in; default só apply + sugestão |
| Conflito com free-text demos | `AEGIS_ALLOW_FREEFORM` |

---

## 17. Decisões abertas (para fechar na implementação)

1. Issue Forms em `.github/` vs convenção pura no body?  
2. Tasks detalhadas: sub-secções no mesmo body vs GitHub task-list items com descrição?  
3. Auto-commit default em CI vs nunca default em dev local?  
4. Batch: concatenação literal das tasks no canónico — ordem e limites exactos?  
5. Free-text CLI: sempre recusar vs criar issue automaticamente com `gh issue create`?  
6. Hash da task: algoritmo e o que entra no hash (só título vs bloco completo)?  

---

## 18. Frase de fecho

**Um formato de persistência (GitHub Issue: Goal + tasks micro), intake que disciplina o operador (± IA barata só a estruturar), execução default 1 task = 1 pipeline isolado, código entre tasks via git, prova via OUTCOME/comentário — o harness continua a conter o LLM; a issue passa a conter e policiar a demanda.**

---

## 19. Referências no repo (contexto actual)

- `AGENTS.md` — constituição  
- `run_aegis.sh` — orchestrator, `--issue`, `--fresh`, report/outcome  
- `runtime_aegis.sh` — investigation input, handover, promotion  
- `scripts/lib/run_outcome.sh` — classify / OUTCOME  
- `scripts/runtime/promote_validated_candidate.sh` — `git apply` (sem commit automático)  
- `scripts/capabilities/git/*` — status/diff evidence  
- `scripts/substrates/aider_substrate.sh` — mutation, scope, preflight fix taxonomy  
- `.skills/repair.md` — type/module hygiene  

*Fim de entry.md — proposta para implementação futura.*

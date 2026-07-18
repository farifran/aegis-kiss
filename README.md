# Aegis Harness

Bounded, deterministic AI execution runtime. The runtime owns orchestration and evidence; modes only reason from exposed capability payloads and emit protocol-framed JSON. Git is the only persistent memory.

Constitution: `AGENTS.md`. Living repository map: **`summary.md`**. Epistemic doctrine: `.harness/00_architecture_core.md`. Operator notes / demand map: `entry.md`.

---

## Prerequisites

- `bash`, `git`, `jq`, `curl`, `python3`
- Node / npm (verify + tests)
- `ast-grep` (via npm / static gate)
- `aider` (mutation modes)
- OpenAI-compatible endpoint (`OPENAI_API_BASE`, `OPENAI_API_KEY`)

---

## Quick start

```bash
export OPENAI_API_BASE="https://integrate.api.nvidia.com/v1"
export OPENAI_API_KEY="..."

# Prefer a clean worktree on mutation targets (or promotion may refuse dirty files)
git status

# Full pipelines
./run_aegis.sh --fresh --pipeline mutation "funções de conversão, como bytes para Megabits"
./run_aegis.sh --fresh --pipeline readonly "inspect demand anchors"

# Single mode
bash runtime_aegis.sh discovery "inspect runtime handover boundary"
bash runtime_aegis.sh forensics --issue 123
```

Optional secrets: `.harness/local.env` (loaded when `AEGIS_LOAD_LOCAL_ENV=1`; never into capability children). Local MLX: `.harness/local.env.mlx` + `scripts/start_mlx_server.sh` (do not mix with cloud env in the same shell).

After a run:

```bash
jq -c 'select(.kind=="intent")' .harness/runtime/pipeline_metrics.jsonl
cat .harness/runtime/last_outcome.json | jq .
```

---

## Architecture (short)

| Layer | Responsibility |
|---|---|
| `AGENTS.md` | Constitution; loaded as preamble on raw/Aider prompts |
| `run_aegis.sh` | Operator pipeline + outcome + metrics file |
| `runtime_aegis.sh` | Lifecycle, surfaces, handover, repair-feedback re-entry |
| `scripts/execute_mode.sh` | Envelope, evidence, substrate, validate/enrich |
| `scripts/lib/demand.sh` | Demand, tokens, anchors, mechanical discovery/forensics, briefs |
| `scripts/substrates/aider/*` | Mutation: targets, prompt, invoke, intent preflight |
| `scripts/capabilities/*` | Evidence handlers |
| `.harness/config.sh` | Modes, handlers, evidence profiles |
| `.skills/*.md` | Mode contracts (discovery = docs only; repair = always injected into Aider) |

**Pipelines**

| Pipeline | Modes |
|---|---|
| `mutation` (default) | discovery → forensics → repair → optimize → adversarial → validation |
| `readonly` | discovery → forensics |

**Mode engines (product path)**

| Mode | Who produces the body |
|---|---|
| **discovery** | Runtime mechanical only (**no LLM**) |
| **forensics** | Mechanical by default; LLM if multi-seed probes **tie** or `AEGIS_FORENSICS_LLM=1` |
| **repair / optimize** | Aider (bounded mutation) |
| **adversarial / validation** | Raw LLM + runtime tribunal gates |

---

## Product behavior (current)

**Demand.** `--issue N` loads the real GitHub issue via `gh`. Free-text or optional `## Goal` / `## Targets` / … headers. Operator-named paths are path-safety checked.

**Tokens & search.** Dense tokens bind multi-token fixed-string search (`;;`, never ERE) and Layer 0 content resonance (`git grep`). `search_symbol` uses pathspecs (anchors / `src`) and is **omitted** on mechanical forensics and on repair when a forensics ALVO exists.

**Discovery.** Always mechanical: path missing / token hits / no hits. Fail → fatal (no LLM fallthrough).

**Forensics.** Mechanical `{id, reason}`; multi-seed ranked by content probes; LLM only on true ambiguity. Search only on LLM residual path.

**Repair.** Prompt stack (no policy echo): `AGENTS.md` → **skill** (policy) → DEMAND ANCHORS / FEEDBACK / ALVO / BRIEF (data) → investigation → **jail** (path list) → whole-format rules if needed → thin close cue. Rails: Aider **auto-lint** (file eslint/prettier/static + **project tsc delta** on the edited file) → post-diff scope → preflight tsc/test/smoke → **intent gates**. Soft intent may soft-accept with `intent_violations` → validation `demand_mismatch` re-entry. Metrics: `kind:"intent"` in `pipeline_metrics.jsonl`.

**Flags (common)**

| Flag | Meaning |
|---|---|
| `AEGIS_FORENSICS_LLM=auto\|0\|1` | Forensics LLM residual (default auto) |
| `AEGIS_MUTATION_INTENT_PREFLIGHT=soft\|hard\|off` | Intent gate policy (default soft) |
| `AEGIS_MUTATION_MAX_NEW_EXPORTS` | Over-delivery cap (default 1) |
| `AEGIS_PROMOTION_RESET_DIRTY=true` | Allow promote when target worktree is dirty (eval / ops) |

**Operational memory:** capability payloads · epistemic handover · git only.

Full map and tables: **`summary.md`**. Field ownership: **`.skills/field_ownership.md`**.

---

## Tests

```bash
npm run aegis:test:fast   # core contracts (fast loop)
npm run aegis:test        # full shell suite
npm run aegis:sanity      # tsc + eslint + static enforce
```

```bash
bash scripts/substrates/test/test_demand_tokens.sh   # tokens, mechanical modes, intent, metrics
bash scripts/substrates/test/test_readonly_modes.sh
```

---

## Principles

- **Runtime sovereignty** — orchestration stays outside the model
- **Capability authority** — modes do not self-authorize
- **Evidence discipline** — no invented repository state
- **KISS** — mechanical defaults where the contract is deterministic
- **Protocol artifacts** — framed JSON, mechanically validated

---

## License

See `LICENSE.md`.

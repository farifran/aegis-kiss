# Aegis Harness

Bounded, deterministic AI execution runtime. The runtime owns orchestration and evidence; modes only reason from exposed capability payloads and emit protocol-framed JSON. Git is the only persistent memory.

Constitution: `AGENTS.md` (loaded as LLM/Aider preamble). Mode contracts: `.skills/<mode>.md`.

**Usar o Aegis num alvo:** [`GUIA.md`](GUIA.md) (humano) · [`AEGIS.md`](AEGIS.md) (assistente de código).

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

# --- Using Aegis on a target (see AEGIS.md) ---
# Where the target stands: record, pending gate, dirty worktree
./aegis context

# One issue = one task = one target; ends at a commit gate that is yours
./aegis go --goal "converter Gigabits em Terabits em src/index.ts" \
           --target src/index.ts --accept converterGigabitsEmTerabits

# --- Building/testing the harness itself ---
# Prefer a clean worktree on mutation targets (or promotion may refuse dirty files)
git status

# Full mutation (always: repair → optimize → adversarial → validation)
./run_aegis.sh --fresh --pipeline mutation "funções de conversão, como bytes para Megabits"
./run_aegis.sh --fresh --pipeline mutation --issue N
./run_aegis.sh --fresh --pipeline readonly "inspect demand anchors"

# Demand loop: demand → fit → run → review → improve demand → repeat
./run_aegis_loop.sh --issue N --max 3
./run_aegis_loop.sh --demand-file demand.md --max 3

# Single mode
bash runtime_aegis.sh discovery "inspect runtime handover boundary"
bash runtime_aegis.sh forensics --issue 123
```

Optional secrets: `.harness/local.env` (loaded when `AEGIS_LOAD_LOCAL_ENV=1`; never into capability children).

After a run:

```bash
jq -c 'select(.kind=="intent")' .harness/runtime/pipeline_metrics.jsonl

# Context cost: per-mode budget + evidence reuse, prompt prefix stability,
# provider-reported tokens, and one pipeline-wide roll-up
jq -c 'select(.kind=="cache" or .kind=="tokens")' .harness/runtime/pipeline_metrics.jsonl
jq -c 'select(.kind=="pipeline_budget")' .harness/runtime/pipeline_metrics.jsonl
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
| **repair** | Aider (bounded mutation) |
| **optimize** | Mechanical greps first (any/stubs → 1 improve); else LLM advise or clean passthrough |
| **adversarial** | Mechanical tools dirty + diff greps (stubs/any); else LLM falsify; tribunal enrich |
| **validation** | **Mechanical tribunal** by default (`AEGIS_VALIDATION_LLM=0`); LLM opt-in |

---

## Product behavior (current)

**Demand.** `--issue N` loads the real GitHub issue via `gh`. Optional `--task K` scopes to checklist item K while keeping issue-level Goal/Targets/Constraints as context (other tasks omitted). Free-text or `## Goal` / `## Targets` / … headers. Operator-named paths are path-safety checked.

**Tokens & search.** Dense tokens bind multi-token fixed-string search (`;;`, never ERE) and Layer 0 content resonance (`git grep`). `search_symbol` uses pathspecs (anchors / `src`) and is **omitted** on mechanical forensics and on repair when a forensics ALVO exists.

**Discovery.** Always mechanical: path missing / token hits / no hits. Fail → fatal (no LLM fallthrough).

**Forensics.** Mechanical `{id, reason}`; multi-seed ranked by content probes; LLM only on true ambiguity. Search only on LLM residual path.

**Repair.** Prompt stack (no policy echo): `AGENTS.md` → **skill** (policy) → DEMAND ANCHORS / FEEDBACK / ALVO / BRIEF (data) → investigation → **jail** (path list) → whole-format rules if needed → thin close cue. Rails: Aider **auto-lint** (file eslint/prettier/static + **project tsc delta**) → post-diff scope → preflight tsc/test/smoke → **intent gates** with dedicated Aider fix budget (default 3) before soft-accept + `intent_violations` / validation tribunal codes (`demand_tokens`, `over_export`, …). Metrics: `kind:"intent"` / `kind:"alignment"` / `kind:"validation"` in `pipeline_metrics.jsonl`.

**Flags (common)**

| Flag | Meaning |
|---|---|
| `AEGIS_FORENSICS_LLM=auto\|0\|1` | Forensics LLM residual (default auto) |
| `AEGIS_MUTATION_INTENT_PREFLIGHT=soft\|hard\|off` | Intent gate policy (default soft: fix first, soft-accept only after intent budget) |
| `AEGIS_MUTATION_INTENT_FIX_ATTEMPTS` | Aider demand-correction retries (default **3**, separate from tools) |
| `AEGIS_MUTATION_PREFLIGHT_FIX_ATTEMPTS` | tsc/test/smoke fix retries (default 2) |
| `AEGIS_MUTATION_MAX_NEW_EXPORTS` | Over-delivery cap (default 1) |
| `AEGIS_OPTIMIZE_REPAIR_DIFF_MAX_BYTES` | Cap on REPAIR RESULT diff in optimize prompt (default 12000) |
| `AEGIS_OPTIMIZE_FILE_BODY_MAX_BYTES` | Cap per post-repair file body in optimize prompt (default 8000) |
| `AEGIS_OPTIMIZE_FILE_BODY_MAX_FILES` | Max files materialized for optimize bodies (default 4) |
| `OPENAI_MODEL_OPTIMIZE` | Model for optimize raw (default = readonly cognition) |
| `AEGIS_MAX_OPTIMIZE_REPAIR_ATTEMPTS` | Max optimize→repair refine loops (default **1**); 2nd optimize is mechanical no-LLM passthrough |
| `AEGIS_OPTIMIZE_REPAIR_LOOP=true\|false` | Enable can_improve → repair re-entry (default true) |
| `AEGIS_OPTIMIZE_TRIVIAL_SKIP=true\|false` | Skip optimize LLM when repair is small/clean (default true) |
| `AEGIS_ADVERSARIAL_LLM=auto\|0\|1` | Residual adversarial LLM when tools/greps clean (`auto`: only if large diff; default **auto**) |
| `AEGIS_ADVERSARIAL_LLM_MAX_LINES` | auto threshold: lines above this force LLM residual (default 48) |
| `AEGIS_ADVERSARIAL_LLM_MAX_FILES` | auto threshold: files above this force LLM residual (default 1) |
| `AEGIS_OPTIMIZE_TRIVIAL_MAX_LINES` | Diff line cap for trivial skip (default 24) |
| `AEGIS_VALIDATION_LLM=0\|1` | Validation LLM residual (default **0**: mechanical tribunal only) |
| `AEGIS_OPTIMIZE_TRIVIAL_MAX_FILES` | File count cap for trivial skip (default 1) |
| `AEGIS_CANDIDATE_TOOLS_STAMP_DIR` | Where repair stamps tsc/test/eslint for adversarial reuse (removed when the run finishes) |
| `AEGIS_RUNTIME_REMOVE_CANDIDATE_TOOLS_STAMP` | Drop stamp after pipeline/standalone finish (default **true**) |
| `AEGIS_ALIGNMENT_GATE=true\|false` | Validation minimal demand-alignment proof on final candidate (default true) |
| `AEGIS_PROMOTION_RESET_DIRTY=true` | Allow promote when target worktree is dirty (eval / ops) |

**Context budget (single authority)**

`AEGIS_MAX_CONTEXT_BYTES` (default 32768) is the only context policy number.
The rendered-prompt backstop (`AEGIS_EVIDENCE_MAX_TOTAL_BYTES`) and the
handover read ceiling (`AEGIS_EPISTEMIC_HANDOVER_READ_MAX_BYTES`) are derived
from it. `AEGIS_EPISTEMIC_HANDOVER_MAX_BYTES` is deliberately independent — it
is a structural validity gate, not a context ceiling, and must stay generous
because the handover embeds the candidate diff.

**Why fixed, and why 32 KB.** The ceiling is not model-derived on purpose.
Aegis executes *one issue = one task = one target*, so the bound comes from
the task, not from the model's window. A demand whose evidence does not fit in
32 KB is a demand that should be split — which makes `budget_exceeded` a
scoping signal, not a request to raise the number. Two caveats worth knowing:

- The budgeter measures capability payload JSON. Formatted sections (candidate
  diff, tools summary, anchors, investigation input) are assembled inside the
  substrate *after* pruning, so the rendered prompt is larger than
  `context_bytes` — compare it against `rendered_bytes` in the same metric.
- The ceiling is advisory. The protected set (handover, demand anchors, content
  seeds) can exceed it alone; the run proceeds and reports
  `budget_exceeded: true`.

| Flag | Meaning |
|---|---|
| `AEGIS_MAX_CONTEXT_BYTES` | Context budget; everything else derives from it |
| `AEGIS_EVIDENCE_CACHE_MAX_AGE_DAYS` | Evidence cache entry expiry (default 7) |
| `AEGIS_EVIDENCE_CACHE_ENABLED` | Disable cross-run evidence reuse |
| `AEGIS_PROVIDER_EXTRA_HEADER` | One extra request header, for gateways that resolve upstream by header |

**Metrics:** `kind:"cache"` (per mode: budget, reuse, prefix hash) ·
`kind:"tokens"` (provider-reported usage) · `kind:"pipeline_budget"` (run
roll-up) in `pipeline_metrics.jsonl`.

**Operational memory:** capability payloads · epistemic handover · git only.
The evidence cache is memoization keyed on demand + target + repository
state, not memory: a hit can only return what recomputing would produce.

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

## Acknowledgments & Credits

Two projects shaped how Aegis handles context. The credits below describe
what was actually taken, and what was not.

**[Headroom](https://github.com/headroomlabs-ai/headroom)** — context
compression for AI agents. Aegis adapts two of its ideas:

- **Frozen zone / live zone.** Everything above the `LIVE ZONE` marker in the
  assembled prompt is byte-identical for a given mode and configuration, so a
  provider-side prefix cache has something stable to reuse. Mode-dependent
  content (the pocket map) was moved below the marker. Reported as
  `kind:"cache"` with `substrate:"raw"`.
- **Reversible pruning (CCR).** Budget pruning preserves the full payload
  beside the truncated one and records `recoverable_from`. Dropping bytes
  from the prompt no longer destroys gathered evidence. Aegis has no
  tool-calling loop, so recovery is runtime/operator-side — the model cannot
  request the payload back mid-turn as it can with Headroom's `headroom_retrieve`.

Not adapted: SmartCrusher / CodeCompressor / Kompress. Aegis's context is
dominated by the epistemic handover — a nested document carrying a candidate
diff — not the repetitive record shapes those compressors target, so the
headline reduction figures do not transfer.

**[LMCache](https://github.com/LMCache/LMCache)** — KV-cache layer for LLM
serving. Only its *reuse discipline* transfers, not its mechanisms: KV-cache
lives inside the inference engine, and Aegis is a client. What Aegis owns is
payload-level reuse — the evidence cache is keyed on capability, demand,
target and (for tree-derived capabilities only) repository state, which makes
entries safe to keep across runs. Budget pruning cuts from the tail of the
prompt rather than by payload size, so the prefix survives.

Neither project is a dependency; nothing is vendored. We thank both for the
work these ideas came from.

---

## License

See `LICENSE.md`.

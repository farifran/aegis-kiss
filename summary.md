# Aegis Harness — Repository Map

**Canonical product map** of the tree as it exists today. Not constitutional.

**Precedence when docs conflict:**

1. `AGENTS.md`
2. `.harness/config.sh`
3. Runtime-generated manifests / capability contracts
4. Mode contracts under `.skills/`
5. Transient artifacts under `.harness/runtime/`
6. Everything else (including this file)

**Related docs (not maps):**

| File | Role |
|---|---|
| `AGENTS.md` | Cognition constitution (5 Karpathy-inspired rules); injected as preamble on LLM/Aider paths |
| `ARCHITECTURE.md` | Target application architecture directives & PonyTail engineering patterns |
| `README.md` | English operator setup, quick start, test entrypoints, 3-tier governance architecture |
| `README.pt-BR.md` | Portuguese operator setup, quick start, test entrypoints, 3-tier governance architecture |
| `INTAKE.md` | Scout/IDE demand playbook (outside mutation runtime) |
| `entry.md` | Demand protocol design notes (ADR; code wins on conflict) |

Field ownership lives in mode skills (`.skills/*.md`) and runtime enrich — there is no separate ownership doc.

---

## One sentence

Aegis is a **runtime-sovereign shell harness**: modes get only capability evidence the runtime materializes; discovery/forensics default to **mechanical** bodies; build mutates under jail + intent rails; git is the only durable memory.

---

## Execution graph

```text
./aegis (CLI Intake/Fit/Batch)  ──►  run_aegis.sh  ──►  runtime_aegis.sh  ──►  execute_mode.sh
            │                               │                  │                      │
            │                               │                  │              capability handlers
            │                               │                  │                      │
            ├── micro-unit plan (.harness/micros_auto)        ├── mechanical (discovery always; forensics if clear)
            ├── keep-progress batch                           ├── raw_llm.sh      (forensics residual, optimize advise, adversarial, validation)
            └── human commit gate (git commit -e -F)          └── aider_substrate (build only)
                                                                            │
                                                                       framed JSON artifact
                                                                            │
                                                               └── outcome (human + metrics + last_outcome.json)
                                                                          handover promote / cleanup
```

| Entrypoint | Owns |
|---|---|
| `./aegis` | Top-level Operator CLI: demand intake, topological `fit_check` micro-unit split, batch keep-progress execution, direct `./aegis <N>` resume, `./aegis squash <N>` feature consolidation, TTY human commit gate |
| `run_aegis.sh` | Low-level driver: pipelines (`mutation` / `readonly`), timing report, run-level outcome, preflight dirty-target check, `pipeline_metrics.jsonl` |
| `runtime_aegis.sh` | Lifecycle, surface, handover reset/promote, per-mode invoke, build-feedback re-entry, signal termination expunge |
| `scripts/execute_mode.sh` | Protocol VM: envelope, evidence, substrate, validate/enrich; loads full `AGENTS.md` as preamble |
| `.harness/config.sh` | Modes, handlers, evidence profiles, budgets, provider defaults |

---

## Execution Paradigms & Model Hierarchy

### 1. Execution Paradigms (2 Modes)
- **Direct CLI Execution (Human Operator)**: Direct invocation via `./aegis "<demand>"`, `./aegis <N>`, or `./aegis squash <N>`. Interactive TTY prompts for human approval; triggers interactive setup (`./aegis setup`) if API keys are missing.
- **AI Assistant Handover (Antigravity, Claude Code, Codex, OpenCode, Cursor, Windsurf, Aider, Devin)**: Automatic environment sensing via `aegis_is_agentic_execution` (`ANTIGRAVITY_AGENT`, `CLAUDE_CODE`, `CODEX_AGENT`, `OPENCODE_AGENT`, `CURSOR_AGENT`, `WINDSURF_AGENT`, `--agent` / `--agentic` flags, or non-TTY subshells). Operates in non-blocking, silent handover mode returning structured JSON results.

### 2. Model Selection Hierarchy
- **Global Fallback**: `AEGIS_MODEL_DEFAULT` (e.g. `meta/llama-3.1-8b-instruct` or `ollama/llama3.1:8b`). Applies to all pipeline stages unless specialized per-mode overrides are specified.
- **Per-Stage Specialized Overrides**:
  - `AEGIS_SUPERVISOR_MODEL`: Demand expansion & issue creation in intake (`scripts/lib/briefing.sh`).
  - `AEGIS_AIDER_MODEL` / `AEGIS_MUTATION_MODEL`: Code mutation in Aider (`build`).
  - `AEGIS_MODEL_DISCOVERY`: Discovery stage.
  - `AEGIS_MODEL_FORENSICS`: Forensics stage.
  - `AEGIS_MODEL_ADVERSARIAL`: Devil's Advocate red-teaming & invariant falsification stage.
  - `AEGIS_MODEL_VALIDATION`: Tribunal static validation stage.
  - `AEGIS_MODEL_OPTIMIZE`: System design refactoring stage.
- **Inference Providers**: Supports local inference (Ollama, vLLM, LM Studio via `OPENAI_API_BASE="http://localhost:11434/v1"`) and cloud endpoints (NVIDIA Integrate, OpenAI, Anthropic, Gemini, DeepSeek).

## Modes

| Mode | Engine | Role |
|---|---|---|
| `discovery` | **runtime mechanical only** (no LLM) | Gaps over anchors/probes → `observations` / `rationale` / `required_evidence` |
| `forensics` | mechanical default; raw LLM if multi-seed **probe tie** / force | `build_candidates[{id,reason}]` |
| `build` | aider | Bounded mutation from candidates + MUTATION BRIEF |
| `optimize` | **raw** (advise only) | Systems & Runtime Physics Refactoring (closed-form $O(1)$ math, zero hot-path GC allocations, reference confinement); **can_improve** → re-enter **mutation** once; else passthrough → adversarial |
| `adversarial` | raw LLM | **Devil's Advocate (Advogado do Diabo)**: Invariant falsification (non-negativity guards, temporal monotonicity / NTP drift, boundary crashes) with **Strict Anti-Overengineering KISS Filter** (no generic factories/frameworks; 1-line surgical fixes only) |
| `validation` | **mechanical tribunal** (default; LLM only if `AEGIS_VALIDATION_LLM=1`) | Verdict; `build_feedback` with stable codes (`demand_tokens` / `over_export` / …) |

**Skills (`.skills/<mode>.md`):**

| Skill | Loaded into model? |
|---|---|
| *(discovery)* | **No skill file** — runtime mechanical only (`demand.sh`) |
| `forensics.md` | **Yes** only on LLM residual path |
| `mutation.md` | **Yes** — Aider mutation |
| `optimize.md` | **Yes** — raw LLM advise-only (Systems & Runtime Physics; closed-form $O(1)$ math & zero GC; strict KISS) |
| `adversarial.md` | **Yes** — raw substrate (Devil's Advocate & Invariant Falsifier with `AEGIS_ADVERSARIAL_DEPTH` tiers and strict KISS rule; unless tools-dirty mechanical) |
| `validation.md` | **Contract only** by default; LLM only if `AEGIS_VALIDATION_LLM=1` |

### Orthogonal Skill Architecture (Zero Redundancy)

| Contract | Owner / Role | Invariant Responsibility |
|---|---|---|
| `ARCHITECTURE.md` | **Target Domain Law** | NodeNext ESM, `BigInt`, zero `any`, `readonly` immutability, pure getters (Single Source of Truth), and non-negativity guards. |
| `.skills/mutation.md` | **Coder Surgery Protocol** | 5 Core Directives: target confinement, complete logic (no stubs), clean comments (no narration/dead code), entrypoint integrity, exact SEARCH/REPLACE. |
| `.skills/optimize.md` | **Systems & Runtime Physics** | Closed-form $O(1)$ math, zero hot-path GC allocations, boundary reference confinement, strict KISS ($\le 5$ lines). |
| `.skills/adversarial.md` | **Devil's Advocate** | Invariant falsification (non-negativity, NTP clock drift, boundary crashes) under strict 1-line surgical KISS rule. |
| `.skills/validation.md` | **Mechanical Tribunal** | P2 Behavioral Oracle (`node --experimental-strip-types`) + Promotion Gate to Git. |

---

## Capability surface (live)

Handlers under `scripts/capabilities/`, registered only in `.harness/config.sh`.

| Capability | Handler |
|---|---|
| `filesystem.list_tree` | `filesystem/list_tree.sh` |
| `filesystem.read` | `filesystem/read_file.sh` |
| `filesystem.search_symbol` | `filesystem/search_symbol.sh` (`git grep` + pathspecs) |
| `git.status` | `git/git_status.sh` |
| `git.diff` | `git/git_diff.sh` |
| `runtime.layer0_facts` | `runtime/layer0_facts.sh` |
| `runtime.attention_seed` | `runtime/attention_seed.sh` |
| `runtime.demand_anchors` | `runtime/demand_anchors.sh` |
| `typescript.check` | `typescript_check.sh` |
| `eslint.check` | `eslint_check.sh` |
| `test.run` | `test_runner.sh` |

Shared emit: `scripts/capabilities/_emit.sh`. Manifest: `generate_manifest.sh`.

**Removed (do not reintroduce without a product decision):**  
`extract_*` graph extractors, `structural/builder.sh`, composed deep topology profiles.

---

## Evidence profiles (product path)

Config lists a base set; execute_mode **re-ranks** and may **omit** search when not needed.

| Mode | Base evidence (config) | Runtime notes |
|---|---|---|
| discovery | `demand_anchors`, `list_tree`, handover, `layer0_facts`, `attention_seed` | Always mechanical body |
| forensics | `demand_anchors`, handover, `search_symbol` | **Search omitted** if mechanical; + `filesystem.read` anchors |
| build | `demand_anchors`, handover, `search_symbol`, git, tsc, eslint, test | **Search omitted** if forensics ALVO present; + read anchors |
| optimize | handover only (+ BUILD RESULT + post-build file bodies) | Advise-only; System Design & Architecture; trivial-skip / max 1 improve / metrics `kind:optimize` |
| adversarial | handover, tsc, eslint, test | Falsifies workflow/async race conditions & commit record contract alignment under `AEGIS_ADVERSARIAL_DEPTH`; **Reuses** build tool stamp when candidate hash matches; else re-runs |
| validation | handover only | **Mechanical tribunal** + **alignment gate** (tokens↔export names, paths, exports, done_when); stable `tribunal:*` basis; no LLM by default |

**Authorization:** operator-named paths, `required_evidence`, Layer 0 / attention seed — not import graphs.

Cacheable: `list_tree`, `layer0_facts`, `attention_seed`, `demand_anchors`.

---

## Demand → mechanical cognition (core)

| Concern | Implementation |
|---|---|
| Issue body | `--issue N` via `gh` (`demand.sh`) |
| Tokens / dense / multi-F search | `aegis_demand_tokens`, `aegis_demand_dense_tokens`, `;;` sep |
| Anchors | `aegis_materialize_demand_anchors_json` (seed: handover > attention_seed > layer0) |
| Discovery body | `aegis_build_mechanical_discovery_json` + `aegis_discovery_probe_path` |
| Forensics body | `aegis_build_mechanical_forensics_json`; multi-seed via `aegis_forensics_discriminate_seeds` |
| Forensics LLM? | `aegis_forensics_needs_llm` (`AEGIS_FORENSICS_LLM=auto\|0\|1`) |
| Search scope | `aegis_search_symbol_pathspecs` + `git grep` |
| Build prompt extras | ALVO / BRIEF (data) / FEEDBACK; skill owns policy (no recency echo) |
| Build intent | tokens in `+` lines, max new exports; soft retry → optional soft-accept stamp |
| Intent metrics | `kind:"intent"` in `pipeline_metrics.jsonl` (`pass`/`fail`/`soft_accept`/`fix_attempt`); P2: separate `INTENT_FIX_ATTEMPTS` (default 3), soft-accept only after ≥1 intent fix |
| demand_tokens / over_export (etc.) | soft-accept → `intent_violations` → validation reject (`tribunal:demand_tokens`…) + local re-build |
| **Behavioral oracle (P2)** | Supervisor Briefing carries executable `## Behavior` (desc / exports / prelude[] / assert). `fit_check.sh` carries it into each unit demand; `aegis_mechanical_behavior_gate` (demand.sh) parses, scopes each item to the unit owning its **first-listed export**, imports the union of referenced exports, and executes with `node --experimental-strip-types` → `behavior_failure` findings (severity high, `supported_by_evidence: true`) → validation `rejected` + `build_feedback`. Asserts anchor time to the exported `windowStart` (never absolute numbers / real-clock sleeps) |
| Supervisor reliability | `aegis_briefing_generate`: `AEGIS_BRIEFING_MAX_TOKENS` (default 2048), `AEGIS_BRIEFING_MAX_ATTEMPTS` (default 2), quality-gate retry on degenerate algebra / duplicated declarations (observed deepseek decode glitches); provenance `AEGIS_BRIEFING_SOURCE=user\|supervisor`; bounded correction loop `AEGIS_BRIEFING_CORRECT_MAX` (default 1) when adversarial findings contradict the Goal |
| KV-Cache Topology | Byte-0 shared prefix (`AGENTS.md` + `src/ARCHITECTURE.md` + skill contract + capability manifest — **not** the Pocket Map, which sits below the `LIVE ZONE` marker); `kind:"cache"` metric in `pipeline_metrics.jsonl` reports `system_bytes` + `prefix_bytes` + `frozen_prefix_bytes` |
| Skeletal AST Pruning | Optional `AEGIS_READ_SKELETAL=1` via `ast-grep` (Tree-sitter) in `read_file.sh`; `kind:"skeletal_prune"` metric |
| Multi-Language AST Rules | Language-tagged AST rules in `.harness/enforcement/rules/` (TS, Python, Rust, Go) |

Primary code: `scripts/lib/demand.sh`, `scripts/lib/evidence.sh`, `scripts/lib/language_detector.sh`, `scripts/capabilities/filesystem/read_file.sh`, `scripts/substrates/aider/preflight.sh`, `scripts/lib/artifact_protocol.sh`.

---

## Library split

| File | Role |
|---|---|
| `scripts/lib/common.sh` | Logging, path helpers, `measure` (+ timing metrics) |
| `scripts/lib/language_detector.sh` | Mechanical language detection & adaptive TTY fallback |
| `scripts/lib/artifact_protocol.sh` | Validate / enrich; forensics gates; validation `build_feedback` |
| `scripts/lib/evidence.sh` | Materialize / select payloads; late `search_symbol` for forensics LLM |
| `scripts/lib/epistemic_handover.sh` | Handover read/write |
| `scripts/lib/run_outcome.sh` | Human outcome, metrics JSONL, `last_outcome.json` |
| `scripts/lib/demand.sh` | Demand materialization, tokens, anchors, mechanical discovery/forensics, briefs, **mechanical behavior gate** (`aegis_mechanical_behavior_gate`) + validation substrate (reject/accepted via behavior) |

Promotion: `scripts/runtime/apply_candidate_diff.sh`, `promote_validated_candidate.sh`.  
Mutation rails: `mutation_preflight.sh`, `mutation_scope_gate.sh`, `aider_lint_gate.sh` (per-edit: prettier/eslint/static + **project tsc delta** on the edited file so Aider’s auto-lint loop sees real TS errors; baseline debt ignored), `static_gate.sh`.  
Aider: `scripts/substrates/aider/{targets,prompt,invoke,preflight}.sh`.

---

## Operational memory (exactly three surfaces)

1. **Capability payloads** — evidence for the current mode (ephemeral)
2. **`.harness/runtime/epistemic_handover.json`** — incomplete attention, not truth
3. **git** — only durable memory

Also produced (not memory): `pipeline_metrics.jsonl` (timing + **intent**), `last_outcome.json` (gitignored), fatal marker.

---

## Isolation and secrets

- Capability / cognition children run under **`env -i`** via `run_with_isolated_base_env`.
- `local.env` loads only when **`AEGIS_LOAD_LOCAL_ENV=1`** (entrypoints).
- Aider whitelist includes `AEGIS_METRICS_FILE` and intent policy knobs so build metrics actually land in jsonl.

---

## Tree (product-relevant)

```text
.
├── aegis                     # Top-level Operator CLI (Intake, Fit Check, Batch, Gate)
├── run_aegis.sh              # Low-level pipeline driver
├── runtime_aegis.sh          # Sovereign runtime orchestrator
├── run_aegis_loop.sh         # Continuous task loop runner
├── ARCHITECTURE.md           # Target application architecture directives (PonyTail)
├── AGENTS.md                 # Cognition constitution loaded into model/Aider preambles
├── README.md                 # English documentation & 3-tier governance guide
├── README.pt-BR.md           # Portuguese documentation & 3-tier governance guide
├── summary.md                # Canonical repository map
├── package.json              # aegis:sanity / aegis:test:fast / aegis:test
├── .skills/                  # Mode contracts (.skills/*.md)
├── .harness/
│   ├── config.sh             # Engine registries, budgets & evidence profiles
│   ├── enforcement/          # Static AST grep enforcement rules (.harness/enforcement/rules/*.yml)
│   ├── local.env             # Local environment variables & secrets (gitignored)
│   ├── contracts/            # JSON contracts (handover, manifest, outcome)
│   ├── micros*/              # Transient multi-unit plans (auto-cleaned on SUCCESS)
│   └── runtime/              # Epistemic handover, metrics, execution surfaces
├── scripts/
│   ├── execute_mode.sh       # Protocol VM
│   ├── fit_check_demand.sh   # Demand fit checking & mechanical micro splitter
│   ├── audit_epistemic_pipeline.sh # Epistemic audit scanner
│   ├── lib/                  # common, demand, evidence, artifact_protocol, record, run_outcome...
│   ├── capabilities/         # Capability handlers (filesystem, git, typescript, eslint, test)
│   ├── runtime/              # apply_candidate_diff, promote_validated_candidate
│   └── substrates/           # aider_substrate.sh, raw_llm.sh, static_gate.sh, preflight, test/
└── src/                      # Target mutation playground (governed by ARCHITECTURE.md)
```

`src/` is the **mutation playground**, not the harness runtime.

---

## Tests

| Command | Scope |
|---|---|
| `npm run aegis:test:fast` | Contracts without full LLM matrix |
| `npm run aegis:test` | Full shell suite |
| `npm run aegis:sanity` | tsc + eslint + static enforce |
| `npm run aegis:test:language-detector` | Mechanical language detector sentinel census & adaptive TTY test |
| `npm run aegis:test:skeletal-ast` | Skeletal AST Scope Pruning via Tree-sitter (`ast-grep`) test |

Notable: `test_demand_tokens.sh` (tokens, mechanical discovery/forensics, intent, metrics shape), `test_model_boundary_idempotency_cache.sh` (Byte-0 cache stability).

---

## Status notes

- **Deep topology cut complete** — Layer 0 + attention; no structural builder.
- **Discovery is runtime-only** — no `AEGIS_DISCOVERY_LLM`; mechanical fail is fatal.
- **Forensics** — mechanical + probe discrimination; search only on LLM residual.
- **Build** — skill always injected; intent gates + metrics; optional `demand_mismatch` re-entry.
- **Context ceiling is fixed at 32 KB by decision, not omission.** The bound
  comes from the task (one issue = one task = one target), not from the model
  window, so it is deliberately not model-derived. `budget_exceeded: true`
  reads as *this demand is too large for one execution* — split the demand
  rather than raise the number.
- Prefer hardening and KISS reduction over new architectural surfaces.
- **P2 behavioral oracle live** — supervisor-expanded Briefing now carries
  executable `## Behavior`; wrong-but-API-correct candidates are rejected by the
  mechanical gate (closed issue #183 hole). Benchmark arm D (vague demand +
  Aegis): **0/12 → 12/12** (`verify_rate_limiter.ts`).

---

## Open verification — prompt prefix reuse (client side now proven; provider side still open)

The context work (tail-first budget pruning, frozen zone / live zone split,
`kind:"cache"` prefix hashes) rests on two separate premises, which were
previously conflated:

1. **The client emits a long, byte-stable prefix.** Now measured and true.
2. **The provider reuses it.** Still unobserved.

### Premise 1 — measured

Two `forensics` runs of the same demand, captured at the wire (mock-curl shim
from `test_model_boundary_idempotency_cache.sh`, so no network) and tokenised
with `o200k_base`:

| Fact | Before | After |
|---|---|---|
| Whole raw prompt | 2052 tok | 2435 tok |
| **Byte-0 identical prefix across both runs** | **998 tok (49%)** | **1718 tok (71%)** |
| Provider minimum before a prefix cache engages | 1024 tok | 1024 tok |
| Verdict | **26 tok short — could never cache** | clears with margin |

The "before" column is not a tuning miss, it is a design fault that the old
metric could not see. Three causes, all now fixed:

- **Per-execution identity stamped into every payload envelope.** `execution_id`
  and `generated_at` from `aegis_emit_capability_success` were the sole cause of
  the first 23 divergence points between the two runs. `render_bounded_payload_section`
  now projects them out of the *rendered* prompt; the on-disk payload keeps them
  for the audit trail.
- **`src/ARCHITECTURE.md` never reached the model.** The lookup in
  `assemble_system_prompt` was relative, and it runs after
  `prepare_isolated_substrate_workspace` has `cd`'d into a temp workspace, so it
  silently never matched. Candidates are absolute now. This is a correctness fix
  first and a prefix fix second — architecture directives were simply absent.
- **`emit_raw_prefix_metric` measured the wrong segment.** It hashed only the
  user message, reporting 306 tok against a real frozen prefix of 998 — a 3.3x
  understatement, and the reason the shortfall went unnoticed. It now reports
  `system_bytes`, `prefix_bytes` and their sum.

Residual: the remaining 29% starts at the epistemic handover payload, whose
`artifact_snapshot.generated_at` is nested inside a JSON string in file content.
It is left alone deliberately — scrubbing volatile-looking text out of evidence
bodies would let the renderer alter what the model reads as fact, which the
evidence discipline in `AGENTS.md` forbids. Reordering the handover to the tail
would extend the prefix, but the payload order is the budgeter's priority order,
and demoting the handover would make it the first thing dropped under budget
pressure.

### Premise 2 — still open

`cached_prompt_tokens` is `null` on every run (NVIDIA
`integrate.api.nvidia.com`). `emit_provider_usage_metric`
(`scripts/substrates/raw/provider.sh`) already reads
`usage.prompt_tokens_details.cached_tokens` / `usage.cached_tokens` — nothing to
build, only a provider that fills them.

Note that Anthropic caching is **explicit**: it requires `cache_control`
breakpoints. `assemble_provider_request` automatically detects Anthropic
models / gateways (or `AEGIS_PROVIDER_CACHE_CONTROL=1`) and formats the system
prompt with `{"cache_control": {"type": "ephemeral"}}`, backed by a Pareto
fallback in `provider.sh` that strips it if the endpoint rejects structured
content parts. OpenAI and DeepSeek cache automatically on plain text.

**What to run when a reporting key is available.** Replaying captured payloads
is preferable to re-running the pipeline: it isolates the variable and costs
cents. Critically, any probe needs a **positive control** — a bare `cached == 0`
does not distinguish "the design does not cache" from "the measurement cannot
observe cache":

```bash
AEGIS_CAPTURE_OUT=/tmp/caps bash scripts/substrates/test/probes/capture_prompt_payloads.sh
OPENAI_API_KEY=sk-... python3 scripts/substrates/test/probes/prefix_cache_probe.py /tmp/caps --provider openai
```

`prefix_cache_probe.py` fires three arms: **A** the payload as shipped, **B**
the same payload with volatile stamps neutralised, **C** a long, obviously
cacheable control. If C does not register a hit, the harness or the account is
the problem and A/B prove nothing.

Ceiling if it does fire: 71% of input tokens at a 50% cached-input discount is
~35% of input cost (~53% at 75%). Output is never cached and costs several times
input, so the saving on a full bill is smaller than either number. The former
"50% to 98%" claim in the READMEs had no evidence behind it and has been
replaced with the measured figures.

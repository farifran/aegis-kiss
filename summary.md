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
| `backup.md` | Forensic audit, evolution logs, and comparative table of the historical baseline |

Field ownership lives in mode skills (`.skills/*.md`) and runtime enrich — there is no separate ownership doc.

---

## One sentence

Aegis is a **runtime-sovereign shell harness**: modes get only capability evidence the runtime materializes; discovery/forensics default to **mechanical** bodies; supervisor briefings compile and execute before coding; build mutates under jail + intent rails; git is the only durable memory.

---

## Execution graph

```text
./aegis (CLI Intake/Fit/Batch)  ──►  run_aegis.sh  ──►  runtime_aegis.sh  ──►  execute_mode.sh
            │                               │                  │                      │
            │                               │                  │              capability handlers
            │                               │                  │                      │
            ├── supervisor briefing (.skills/briefing.md)      ├── mechanical (discovery always; forensics if clear)
            ├── micro-unit plan (.harness/micros_auto)        ├── raw_llm.sh      (forensics residual, optimize advise, adversarial, validation)
            ├── keep-progress batch                           └── aider_substrate (build only)
            └── human commit gate (git commit -e -F)                        │
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
  - `AEGIS_SUPERVISOR_MODEL`: Demand expansion & structured JSON schema generation in intake (`.skills/briefing.md`, `scripts/lib/briefing.sh`).
  - `AEGIS_AIDER_MODEL` / `AEGIS_MUTATION_MODEL`: Code mutation in Aider (`build`).
  - `AEGIS_MODEL_DISCOVERY`: Discovery stage.
  - `AEGIS_MODEL_FORENSICS`: Forensics stage.
  - `AEGIS_MODEL_ADVERSARIAL`: Devil's Advocate red-teaming & invariant falsification stage.
  - `AEGIS_MODEL_VALIDATION`: Tribunal static validation stage.
  - `AEGIS_MODEL_OPTIMIZE`: System design refactoring stage.
- **Inference Providers**: Supports local inference (Ollama, vLLM, LM Studio via `OPENAI_API_BASE="http://localhost:11434/v1"`) and cloud endpoints (NVIDIA Integrate, OpenAI, Anthropic, Gemini, DeepSeek).

---

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
| `briefing.md` | **Yes** — supervisor model JSON schema generation & category decision tree |
| `forensics.md` | **Yes** only on LLM residual path |
| `mutation.md` | **Yes** — Aider mutation |
| `optimize.md` | **Yes** — raw LLM advise-only (Systems & Runtime Physics; closed-form $O(1)$ math & zero GC; strict KISS) |
| `adversarial.md` | **Yes** — raw substrate (Devil's Advocate & Invariant Falsifier with `AEGIS_ADVERSARIAL_DEPTH` tiers and strict KISS rule; unless tools-dirty mechanical) |
| `validation.md` | **Contract only** by default; LLM only if `AEGIS_VALIDATION_LLM=1` |

### Orthogonal Skill Architecture (Zero Redundancy)

| Contract | Owner / Role | Invariant Responsibility |
|---|---|---|
| `ARCHITECTURE.md` | **Target Domain Law** | NodeNext ESM, `BigInt`, zero `any`, `readonly` immutability, pure getters (Single Source of Truth), and non-negativity guards. |
| `.skills/briefing.md` | **Supervisor Briefing** | Category Decision Tree (Cat A: Library 2 targets; Cat B: Frontend 3 targets; Cat C: Multi-entity 3-5 targets) + Schema Closure + Invariant Protection. |
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
`extract_*` graph extractors, `structural/builder.sh`, composed deep topology profiles, multi-language sentinels.

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
| **Pre-Intake Discovery & Forensics** | `aegis_intake_discover_context` (`demand.sh`): Canonical factual workspace snapshot before briefing expansion (16 KB target file budget, full exports extraction `type|interface|enum|class|function|const`, auto-included barrel entrypoint, universal `*.ts` pocket map). Verified via `aegis:test:intake-discovery`. |
| **Supervisor Briefing (In-Memory & Sovereign Compiler)** | `aegis_briefing_expand_json` & `aegis_briefing_typecheck_json` (`briefing.sh`): 100% in-memory curl streaming (zero `/tmp/` I/O). Injeção do `AGENTS.md` no Byte 0. Strict JSON envelope validation + sovereign `tsc --noEmit` compiler gate with sanitized diagnostic feedback injected directly into self-healing retry loop (3072 max_tokens). Verified 100% green on Levels 1-10 & Extreme 20-50. |
| **Unified Governance & Architecture Decisions (CLI & IDE)** | Dual-surface interactive governance: **CLI TTY** presents rendered markdown specification with clean `[y/N/e]` prompt; **IDE Mode** presents full syntax-highlighted specification alongside interactive engineering decision modals (`ask_question`). Zero local draft pollution (100% RAM conception, direct GitHub Issues integration & git trailers). |
| **Behavioral oracle (P2)** | Supervisor Briefing carries executable `## Behavior` (desc / exports / prelude[] / assert). `fit_check.sh` carries it into each unit demand; `aegis_mechanical_behavior_gate` (demand.sh) scopes each item, unions referenced exports, and executes with `node --experimental-strip-types` → `behavior_failure` findings → validation `rejected` + `build_feedback`. |
| KV-Cache Topology | Byte-0 shared prefix (`AGENTS.md` + `src/ARCHITECTURE.md` + skill contract + capability manifest); `kind:"cache"` metric in `pipeline_metrics.jsonl` reports `system_bytes` + `prefix_bytes` + `frozen_prefix_bytes` (71% byte-stable prefix measured). |
| Skeletal AST Pruning | Optional `AEGIS_READ_SKELETAL=1` via `ast-grep` (Tree-sitter) in `read_file.sh`; `kind:"skeletal_prune"` metric |
| AST Security & Quality Gate | AST rules in `.harness/enforcement/rules/` (`static_gate.sh`) enforcing zero eval, no non-null assertions, strict privacy, and secret containment. |

---

## Library split

| File | Role |
|---|---|
| `scripts/lib/common.sh` | Logging, path helpers, `measure` (+ timing metrics) |
| `scripts/lib/artifact_protocol.sh` | Validate / enrich; forensics gates; validation `build_feedback` |
| `scripts/lib/evidence.sh` | Materialize / select payloads; late `search_symbol` for forensics LLM |
| `scripts/lib/epistemic_handover.sh` | Handover read/write |
| `scripts/lib/run_outcome.sh` | Human outcome, metrics JSONL, `last_outcome.json` |
| `scripts/lib/briefing.sh` | Supervisor briefing generation, sanitize, `tsc` typecheck gate & Node.js runtime behavior execution gate |
| `scripts/lib/fit_check.sh` | Demand fit checking, topological unit slicing & module-export pairing |
| `scripts/lib/demand.sh` | Demand materialization, tokens, anchors, mechanical discovery/forensics & pre-intake context discovery |
| `scripts/lib/mutation_helpers.sh` | Mutation & Aider prompt helpers, barrel reexports, AST code snippets & alignment gates |
| `scripts/lib/mechanical_scans.sh` | Mechanical tribunal scans (Optimize O(1), Adversarial diff scans, tools stamping & behavior gate) |

Promotion: `scripts/runtime/apply_candidate_diff.sh`, `promote_validated_candidate.sh`.  
Mutation rails: `mutation_preflight.sh`, `mutation_scope_gate.sh`, `aider_lint_gate.sh` (per-edit: prettier/eslint/static + **project tsc delta** on edited file), `static_gate.sh`.  
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
- Aider whitelist includes `AEGIS_METRICS_FILE` and intent policy knobs so build metrics land in jsonl.

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
├── package.json              # aegis:sanity / aegis:test:fast / aegis:test / aegis:test:briefing-loop
├── .skills/                  # Mode contracts (.skills/*.md) including briefing.md
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
│   ├── lib/                  # common, demand, evidence, artifact_protocol, briefing, fit_check, record, run_outcome...
│   ├── capabilities/         # Capability handlers (filesystem, git, typescript, eslint, test)
│   ├── runtime/              # apply_candidate_diff, promote_validated_candidate
│   └── substrates/           # aider_substrate.sh, raw_llm.sh, static_gate.sh, preflight, test/
│       └── test/             # 39 regression suites & briefing improvement loop
└── src/                      # Target mutation playground (governed by ARCHITECTURE.md)
```

`src/` is the **mutation playground**, not the harness runtime.

---

## Tests

| Command | Scope |
|---|---|
| `npm run aegis:test:fast` | Fast regression suite covering all core contracts without full LLM matrix |
| `npm run aegis:test` | Full shell test matrix (39 test suites) |
| `npm run aegis:sanity` | tsc + eslint + static enforce |
| `npm run aegis:test:briefing-loop` | Automated supervisor briefing benchmark loop (Lots A, B, C with 30 prose demands) |
| `npm run aegis:benchmark:intake-briefing` | End-to-end multi-level benchmark loop (Passos 1 & 2) across 14 complexity tiers (Levels 1-10 & Extreme Levels 20-50: Stack VM, Bloom Filter, 2D KD-Tree, Lock-Free SPSC Ring Buffer) with 100% pass rate. |
| `npm run aegis:test:skeletal-ast` | Skeletal AST Scope Pruning via Tree-sitter (`ast-grep`) test |

Notable: `test_intake_briefing_loop.sh` (100% pass on 14/14 multi-level tiers), `test_briefing_loop.sh` (prose demands in, `tsc` compilation + Node runtime behavior execution gate), `test_model_boundary_idempotency_cache.sh` (Byte-0 cache stability).

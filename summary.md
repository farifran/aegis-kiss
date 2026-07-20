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
| `AGENTS.md` | Cognition constitution (4 rules); injected as preamble on LLM/Aider paths |
| `.harness/00_architecture_core.md` | Epistemic doctrine (modes as cognition layers) |
| `README.md` | Operator setup, quick start, flags, test entrypoints |
| `INTAKE.md` | Scout/operator playbook (issue → SPEC → run) |
| `entry.md` | Demand protocol notes + operator map (evolving) |

Field ownership (model vs runtime body fields) lives in mode skills + `execute_mode.sh` / `demand.sh` — there is no separate `field_ownership.md`.

---

## One sentence

Aegis is a **runtime-sovereign shell harness**: modes get only capability evidence the runtime materializes; discovery/forensics/optimize/adversarial/validation default to **mechanical** bodies where the contract is deterministic; repair mutates under jail + intent rails; git is the only durable memory.

---

## Execution graph

```text
run_aegis_loop.sh  ──►  fit_check  ──►  run_aegis.sh  ──►  runtime_aegis.sh  ──►  execute_mode.sh
       │                     │               │                    │                      │
       │                     │               │                    │              capability handlers
       │                     │               │                    │                      │
       │                     │               │                    │              capability_payloads/
       │                     │               │                    │                      │
       │                     │               │                    ├── mechanical (discovery always;
       │                     │               │                    │   forensics / optimize /
       │                     │               │                    │   adversarial / validation defaults)
       │                     │               │                    ├── raw_llm.sh      (residuals)
       │                     │               │                    └── aider_substrate (repair only)
       │                     │               │                                │
       │                     │               │                           framed JSON artifact
       │                     │               │                                │
       │                     │               └── outcome + metrics + last_outcome.json
       │                     │                        handover promote / cleanup
       │                     │
       │                     └── scripts/fit_check_demand.sh + lib/fit_check.sh
       │
       └── .harness/runtime/loop/  (state, insights, per-iter artifacts)
```

| Entrypoint | Owns |
|---|---|
| `run_aegis_loop.sh` | Demand loop: fit → full mutation → review → improve demand → repeat; writes loop insights |
| `run_aegis.sh` | Operator CLI, pipelines (`mutation` / `readonly`), optional fit gate, `--from-fit` / `--unit`, timing, run-level outcome, `pipeline_metrics.jsonl` |
| `runtime_aegis.sh` | Lifecycle, surface, handover reset/promote, per-mode invoke, repair-feedback re-entry |
| `scripts/execute_mode.sh` | Protocol VM: envelope, evidence, substrate, validate/enrich; loads full `AGENTS.md` as preamble |
| `scripts/fit_check_demand.sh` | Demand fit CLI (rails + weak-model budget); `--emit-micros` for unit splits |
| `.harness/config.sh` | Modes, handlers, evidence profiles, budgets, provider defaults |

**Pipelines**

| Pipeline | Modes |
|---|---|
| `mutation` (default, only guarantee path) | discovery → forensics → repair → optimize → adversarial → validation |
| `readonly` | discovery → forensics |

`mutation_lite` is **removed** (fatal if requested). Full mutation is the only product guarantee path.

---

## Modes

| Mode | Engine | Role |
|---|---|---|
| `discovery` | **runtime mechanical only** (no LLM) | Gaps over anchors/probes → `observations` / `rationale` / `required_evidence` |
| `forensics` | mechanical default; raw LLM if multi-seed **probe tie** / force | `repair_candidates[{id,reason}]` |
| `repair` | aider | Bounded mutation from candidates + MUTATION BRIEF |
| `optimize` | **mechanical first** (senior greps / refine cap / trivial-skip); raw residual if still needed | Advise only: `can_improve` → re-enter **repair** once; else passthrough → adversarial |
| `adversarial` | **mechanical first** (tools dirty, diff greps, verified clean); raw residual if large clean diff | Falsify candidate assumptions |
| `validation` | **mechanical tribunal** (default; LLM only if `AEGIS_VALIDATION_LLM=1`) | Verdict; alignment/acceptance gates; `repair_feedback` with stable codes (`demand_tokens` / `over_export` / …) |

**Skills (`.skills/<mode>.md`):**

| Skill | Loaded into model? |
|---|---|
| *(discovery)* | **No skill file** — runtime mechanical only (`demand.sh`) |
| `forensics.md` | **Yes** only on LLM residual path |
| `repair.md` | **Yes** — Aider mutation |
| `optimize.md` | **Yes** only on LLM residual (JSON plan; no edits) |
| `adversarial.md` | **Yes** only on LLM residual |
| `validation.md` | **Contract only** by default; LLM only if `AEGIS_VALIDATION_LLM=1` |
| `bootstrap/issue_refiner.md` | Scout/bootstrap helper — **not** a pipeline mode |

---

## Fit check and micro units

| Concern | Implementation |
|---|---|
| Fit CLI | `scripts/fit_check_demand.sh` (`aegis.fit_check.v1` JSON) |
| Fit lib | `scripts/lib/fit_check.sh` (no LLM; rails + model-budget heuristics) |
| Emit micros | `--emit-micros DIR` → `fit.json` + `unit-N.md` |
| Run one micro | `./run_aegis.sh --fresh --from-fit DIR --unit N` |
| Pre-pipeline gate | `AEGIS_FIT_CHECK=1` on `run_aegis.sh` (or loop default fit) |
| Demand loop | `./run_aegis_loop.sh --issue N \| --demand-file path \| free-text` |

Loop always uses full `--pipeline mutation`. Artifacts: `.harness/runtime/loop/` (`demand.md`, `state.json`, `loop.jsonl`, `insights.jsonl`, `insights.md`, per-iter logs).

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
`extract_*` graph extractors, `structural/builder.sh`, composed deep topology profiles, `mutation_lite` pipeline.

---

## Evidence profiles (product path)

Config lists a base set; execute_mode **re-ranks** and may **omit** search when not needed.

| Mode | Base evidence (config) | Runtime notes |
|---|---|---|
| discovery | `demand_anchors`, `list_tree`, handover, `layer0_facts`, `attention_seed` | Always mechanical body |
| forensics | `demand_anchors`, handover, `search_symbol` | **Search omitted** if mechanical; + `filesystem.read` anchors |
| repair | `demand_anchors`, handover, `search_symbol`, git, tsc, eslint, test | **Search omitted** if forensics ALVO present; + read anchors |
| optimize | handover only (+ REPAIR RESULT + post-repair file bodies) | Mechanical greps / clean / refine-cap first; advise-only residual; max 1 improve; metrics `kind:optimize` |
| adversarial | handover, tsc, eslint, test | **Reuses** repair tool stamp when candidate hash matches; mechanical findings if tools/diff dirty; residual LLM when clean+large |
| validation | handover only | **Mechanical tribunal** + **alignment/acceptance** gates; stable `tribunal:*` basis; no LLM by default |

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
| Optimize mechanical | `aegis_mechanical_optimize_scan` / passthrough / `can_improve` emit |
| Adversarial mechanical | tools gate + `aegis_mechanical_adversarial_diff_scan` + verified-clean |
| Acceptance check | `aegis_acceptance_*` (export-like tokens in candidate corpus) |
| Search scope | `aegis_search_symbol_pathspecs` + `git grep` |
| Repair prompt extras | ALVO / BRIEF (data) / FEEDBACK; skill owns policy (no recency echo) |
| Repair intent | tokens in `+` lines, max new exports; soft retry → optional soft-accept stamp |
| Intent metrics | `kind:"intent"` in `pipeline_metrics.jsonl` (`pass`/`fail`/`soft_accept`/`fix_attempt`); P2: separate `INTENT_FIX_ATTEMPTS` (default 3), soft-accept only after ≥1 intent fix |
| demand_tokens / over_export (etc.) | soft-accept → `intent_violations` → validation reject (`tribunal:demand_tokens`…) + local re-repair |

Primary code: `scripts/lib/demand.sh`, `scripts/lib/evidence.sh`, `scripts/lib/fit_check.sh`, `scripts/substrates/aider/preflight.sh`, `scripts/lib/artifact_protocol.sh`.

---

## Library split

| File | Role |
|---|---|
| `scripts/lib/common.sh` | Logging, path helpers, `measure` (+ timing metrics) |
| `scripts/lib/artifact_protocol.sh` | Validate / enrich; forensics gates; validation `repair_feedback` |
| `scripts/lib/evidence.sh` | Materialize / select payloads; late `search_symbol` for forensics LLM |
| `scripts/lib/epistemic_handover.sh` | Handover read/write |
| `scripts/lib/run_outcome.sh` | Human outcome, metrics JSONL, `last_outcome.json` |
| `scripts/lib/demand.sh` | Demand materialization, tokens, anchors, mechanical discovery/forensics/optimize/adversarial/validation, briefs, senior scans |
| `scripts/lib/fit_check.sh` | Demand fit rails, auto-fix, micro-unit proposals (no LLM) |

Promotion: `scripts/runtime/apply_candidate_diff.sh`, `promote_validated_candidate.sh`.  
Mutation rails: `mutation_preflight.sh`, `mutation_scope_gate.sh`, `aider_lint_gate.sh` (per-edit: prettier/eslint/static + **project tsc delta** on the edited file so Aider’s auto-lint loop sees real TS errors; baseline debt ignored), `static_gate.sh`.  
Aider: `scripts/substrates/aider/{targets,prompt,invoke,preflight}.sh`.

---

## Operational memory (exactly three surfaces)

1. **Capability payloads** — evidence for the current mode (ephemeral)
2. **`.harness/runtime/epistemic_handover.json`** — incomplete attention, not truth
3. **git** — only durable memory

Also produced (not memory):

| Artifact | Role |
|---|---|
| `pipeline_metrics.jsonl` | `timing`, `intent`, `optimize`, `validation`, `alignment`, `adversarial`, `outcome`, … |
| `last_outcome.json` | Run summary (gitignored) |
| `.harness/runtime/loop/*` | Demand-loop state + harness-learning insights |
| fatal marker | `last_fatal` on hard failure |

---

## Isolation and secrets

- Capability / cognition children run under **`env -i`** via `run_with_isolated_base_env`.
- `local.env` loads only when **`AEGIS_LOAD_LOCAL_ENV=1`** (entrypoints).
- Aider whitelist includes `AEGIS_METRICS_FILE` and intent policy knobs so repair metrics actually land in jsonl.

---

## Tree (product-relevant)

```text
.
├── AGENTS.md                 # constitution → preamble
├── README.md                 # operator entry
├── INTAKE.md                 # scout playbook
├── summary.md                # this map
├── entry.md                  # demand notes + map
├── run_aegis.sh              # pipeline driver
├── run_aegis_loop.sh         # demand → fit → mutation → improve
├── runtime_aegis.sh
├── package.json              # aegis:test / aegis:test:fast
├── .skills/                  # mode contracts (+ bootstrap/)
├── .harness/
│   ├── config.sh
│   ├── 00_architecture_core.md
│   └── runtime/              # handover, metrics, loop/, payloads, surfaces
└── scripts/
    ├── execute_mode.sh
    ├── fit_check_demand.sh
    ├── lib/                  # demand, fit_check, evidence, artifact_protocol, …
    ├── capabilities/
    ├── runtime/              # promote / apply
    └── substrates/
        ├── raw_llm.sh / raw/
        ├── aider_substrate.sh / aider/
        ├── prompts/
        └── test/
```

`src/` is the **mutation playground**, not the harness runtime.

---

## Tests

| Command | Scope |
|---|---|
| `npm run aegis:test:fast` | Contracts without full LLM matrix |
| `npm run aegis:test` | Full shell suite |
| `npm run aegis:sanity` | tsc + eslint + static enforce |

Notable suites:

| Suite | Covers |
|---|---|
| `test_demand_tokens.sh` | tokens, mechanical discovery/forensics, intent, metrics shape |
| `test_fit_check.sh` | demand fit rails + micros |
| `test_mechanical_senior_scans.sh` | optimize/adversarial greps |
| `test_aegis_demand_loop.sh` | loop orchestration + insights |
| `test_preflight_fix_prompt.sh` | weak-model tools-fix prompts |

---

## Status notes

- **Deep topology cut complete** — Layer 0 + attention; no structural builder.
- **Discovery is runtime-only** — no `AEGIS_DISCOVERY_LLM`; mechanical fail is fatal.
- **Forensics** — mechanical + probe discrimination; search only on LLM residual.
- **Optimize / adversarial** — mechanical senior paths first; residual LLM only when needed.
- **Validation** — mechanical tribunal + alignment/acceptance; LLM opt-in only.
- **Repair** — skill always injected; intent gates + metrics; optional `demand_mismatch` re-entry.
- **Fit + micros** — pre-run rails check; `--from-fit` / `--unit` for split work units.
- **Demand loop** — operator/Scout orchestration outside mode cognition; full mutation only.
- **`mutation_lite` removed** — do not reintroduce without a product decision.
- Prefer hardening and KISS reduction over new architectural surfaces.

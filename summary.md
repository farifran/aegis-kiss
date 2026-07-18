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
| `README.md` | Operator setup, quick start, test entrypoints |
| `entry.md` | Demand protocol notes + operator map (evolving) |
| `.skills/field_ownership.md` | Model vs runtime field ownership |

---

## One sentence

Aegis is a **runtime-sovereign shell harness**: modes get only capability evidence the runtime materializes; discovery/forensics default to **mechanical** bodies; repair mutates under jail + intent rails; git is the only durable memory.

---

## Execution graph

```text
run_aegis.sh  ──►  runtime_aegis.sh  ──►  execute_mode.sh
       │                  │                      │
       │                  │              capability handlers
       │                  │                      │
       │                  │              capability_payloads/
       │                  │                      │
       │                  ├── mechanical (discovery always; forensics if clear)
       │                  ├── raw_llm.sh      (forensics residual, adversarial, validation)
       │                  └── aider_substrate (repair / optimize)
       │                              │
       │                         framed JSON artifact
       │                              │
       └── outcome (human + metrics + last_outcome.json)
                  handover promote / cleanup
```

| Entrypoint | Owns |
|---|---|
| `run_aegis.sh` | Operator CLI, pipelines (`mutation` / `readonly`), timing report, run-level outcome, `pipeline_metrics.jsonl` |
| `runtime_aegis.sh` | Lifecycle, surface, handover reset/promote, per-mode invoke, repair-feedback re-entry |
| `scripts/execute_mode.sh` | Protocol VM: envelope, evidence, substrate, validate/enrich; loads full `AGENTS.md` as preamble |
| `.harness/config.sh` | Modes, handlers, evidence profiles, budgets, provider defaults |

---

## Modes

| Mode | Engine | Role |
|---|---|---|
| `discovery` | **runtime mechanical only** (no LLM) | Gaps over anchors/probes → `observations` / `rationale` / `required_evidence` |
| `forensics` | mechanical default; raw LLM if multi-seed **probe tie** / force | `repair_candidates[{id,reason}]` |
| `repair` | aider | Bounded mutation from candidates + MUTATION BRIEF |
| `optimize` | aider | Refine candidate on disposable surface (short-circuit if small) |
| `adversarial` | raw LLM | Falsify candidate assumptions |
| `validation` | raw LLM + tribunal gates | Verdict; `repair_feedback` / `demand_mismatch` on reject |

**Skills (`.skills/<mode>.md`):**

| Skill | Loaded into model? |
|---|---|
| *(discovery)* | **No skill file** — runtime mechanical only (`demand.sh`) |
| `forensics.md` | **Yes** only on LLM residual path |
| `repair.md` / `optimize.md` | **Yes** — always injected by Aider (`cat` skill file) |
| `adversarial.md` / `validation.md` | **Yes** — raw substrate |

Field ownership: `.skills/field_ownership.md`.

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
| repair | `demand_anchors`, handover, `search_symbol`, git, tsc, eslint, test | **Search omitted** if forensics ALVO present; + read anchors |
| optimize | handover, git.status, tsc, eslint | Lean |
| adversarial | handover, tsc, eslint, test | No demand search |
| validation | handover only | Tribunal; may reject on `intent_violations` |

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
| Repair prompt extras | ALVO / BRIEF (data) / FEEDBACK; skill owns policy (no recency echo) |
| Repair intent | tokens in `+` lines, max new exports; soft retry → optional soft-accept stamp |
| Intent metrics | `kind:"intent"` in `pipeline_metrics.jsonl` (`pass`/`fail`/`soft_accept`/`fix_attempt`) |
| demand_mismatch | soft-accept → `intent_violations` on artifact → validation reject + local re-repair |

Primary code: `scripts/lib/demand.sh`, `scripts/lib/evidence.sh`, `scripts/substrates/aider/preflight.sh`, `scripts/lib/artifact_protocol.sh`.

---

## Library split

| File | Role |
|---|---|
| `scripts/lib/common.sh` | Logging, path helpers, `measure` (+ timing metrics) |
| `scripts/lib/artifact_protocol.sh` | Validate / enrich; forensics gates; validation `repair_feedback` |
| `scripts/lib/evidence.sh` | Materialize / select payloads; late `search_symbol` for forensics LLM |
| `scripts/lib/epistemic_handover.sh` | Handover read/write |
| `scripts/lib/run_outcome.sh` | Human outcome, metrics JSONL, `last_outcome.json` |
| `scripts/lib/demand.sh` | Demand materialization, tokens, anchors, mechanical discovery/forensics, briefs |

Promotion: `scripts/runtime/apply_candidate_diff.sh`, `promote_validated_candidate.sh`.  
Mutation rails: `mutation_preflight.sh`, `mutation_scope_gate.sh`, `aider_lint_gate.sh`, `static_gate.sh`.  
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
- Aider whitelist includes `AEGIS_METRICS_FILE` and intent policy knobs so repair metrics actually land in jsonl.

---

## Tree (product-relevant)

```text
.
├── AGENTS.md                 # constitution → preamble
├── README.md                 # operator entry
├── summary.md                # this map
├── entry.md                  # demand notes + map
├── run_aegis.sh
├── runtime_aegis.sh
├── package.json              # aegis:test / aegis:test:fast
├── .skills/                  # mode contracts (repair injected into Aider)
├── .harness/
│   ├── config.sh
│   ├── 00_architecture_core.md
│   └── runtime/              # handover, metrics, payloads, surfaces
└── scripts/
    ├── execute_mode.sh
    ├── lib/                  # demand, evidence, artifact_protocol, …
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

Notable: `test_demand_tokens.sh` (tokens, mechanical discovery/forensics, intent, metrics shape).

---

## Status notes

- **Deep topology cut complete** — Layer 0 + attention; no structural builder.
- **Discovery is runtime-only** — no `AEGIS_DISCOVERY_LLM`; mechanical fail is fatal.
- **Forensics** — mechanical + probe discrimination; search only on LLM residual.
- **Repair** — skill always injected; intent gates + metrics; optional `demand_mismatch` re-entry.
- Prefer hardening and KISS reduction over new architectural surfaces.

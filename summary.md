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
| `AGENTS.md` | Cognition constitution (4 rules) |
| `.harness/00_architecture_core.md` | Epistemic doctrine (modes as cognition layers) |
| `README.md` | Operator setup, quick start, test entrypoints |
| `entry.md` | **Proposal only** — demand protocol via GitHub Issues (not implemented) |
| `.skills/field_ownership.md` | Model vs runtime field ownership |

---

## One sentence

Aegis is a **runtime-sovereign shell harness**: modes get only capability evidence the runtime materializes; they emit framed JSON artifacts; git is the only durable memory; deep graph extractors / `structural.builder` are **gone**.

---

## Execution graph

```text
run_aegis.sh  ──►  runtime_aegis.sh  ──►  execute_mode.sh
       │                  │                      │
       │                  │              capability handlers
       │                  │                      │
       │                  │              capability_payloads/
       │                  │                      │
       │                  ├── raw_llm.sh      (readonly modes)
       │                  └── aider_substrate (repair / optimize)
       │                              │
       │                         JSON artifact
       │                              │
       └── outcome (human + metrics + last_outcome.json)
                  handover promote / cleanup
```

| Entrypoint | Owns |
|---|---|
| `run_aegis.sh` | Operator CLI, pipelines (`mutation` / `readonly`), timing report, run-level outcome |
| `runtime_aegis.sh` | Lifecycle, surface, handover reset/promote, per-mode invoke |
| `scripts/execute_mode.sh` | Protocol VM: envelope, evidence, substrate, validate/enrich artifact |
| `.harness/config.sh` | Modes, handlers, evidence profiles, budgets, provider defaults |

---

## Modes

| Mode | Engine | Role |
|---|---|---|
| `discovery` | raw LLM | Observe investigation state; Layer 0 priors |
| `forensics` | raw LLM | Interpret evidence → repair candidates |
| `repair` | aider | Bounded mutation from candidates |
| `optimize` | aider | Refine candidate on disposable surface |
| `adversarial` | raw LLM | Falsify candidate assumptions |
| `validation` | raw LLM | Tribunal verdict on findings + handover |

Contracts: `.skills/<mode>.md`. Field ownership: `.skills/field_ownership.md`.

---

## Capability surface (live)

Handlers under `scripts/capabilities/`, registered only in `.harness/config.sh`.

| Capability | Handler |
|---|---|
| `filesystem.list_tree` | `filesystem/list_tree.sh` |
| `filesystem.read` | `filesystem/read_file.sh` |
| `filesystem.search_symbol` | `filesystem/search_symbol.sh` |
| `git.status` | `git/git_status.sh` |
| `git.diff` | `git/git_diff.sh` |
| `runtime.layer0_facts` | `runtime/layer0_facts.sh` |
| `runtime.attention_seed` | `runtime/attention_seed.sh` |
| `typescript.check` | `typescript_check.sh` |
| `eslint.check` | `eslint_check.sh` |
| `test.run` | `test_runner.sh` |

Shared emit: `scripts/capabilities/_emit.sh`. Manifest: `generate_manifest.sh`.

**Removed (do not reintroduce without a product decision):**  
`extract_*` graph extractors, `structural/builder.sh`, composed deep topology profiles.

---

## Evidence profiles (product path)

Discovery is **Layer 0 only**:

| Mode | Evidence (config names) |
|---|---|
| discovery | `list_tree`, handover read, `layer0_facts`, `attention_seed` |
| forensics | `search_symbol`, `git.status`, handover |
| adversarial | `search_symbol`, handover, tsc, eslint, test |
| validation | handover only (tribunal) |
| repair | search, handover, git, tsc, eslint, test |
| optimize | handover, git.status, tsc, eslint |

**Authorization after cut:** operator-named paths, `required_evidence`, and Layer 0 attention — not import/reference graphs.

Cacheable (stable) capabilities: `list_tree`, `layer0_facts`, `attention_seed`.

---

## Library split

| File | Role |
|---|---|
| `scripts/lib/common.sh` | Logging, path helpers (`AEGIS_SOURCE_PATH_RE`), isolation (`run_with_isolated_base_env`), `measure` |
| `scripts/lib/artifact_protocol.sh` | Validate / enrich artifacts; shared jq enrich lib + per-mode bodies |
| `scripts/lib/evidence.sh` | Evidence materialization / selection |
| `scripts/lib/epistemic_handover.sh` | Handover read/write helpers |
| `scripts/lib/run_outcome.sh` | Human `AEGIS OUTCOME`, metrics JSONL, `last_outcome.json` |

Promotion: `scripts/runtime/apply_candidate_diff.sh`, `promote_validated_candidate.sh`.

Mutation rails: `mutation_preflight.sh`, `mutation_scope_gate.sh`, `aider_lint_gate.sh`, `static_gate.sh`.  
Prompt templates: `scripts/substrates/prompts/`.

---

## Operational memory (exactly three surfaces)

1. **Capability payloads** — evidence for the current mode (ephemeral)
2. **`.harness/runtime/epistemic_handover.json`** — incomplete attention, not truth
3. **git** — only durable memory

Also produced (not memory): `pipeline_metrics.jsonl`, `last_outcome.json` (gitignored), fatal marker.

---

## Isolation and secrets

- Capability children run under **`env -i`** via `run_with_isolated_base_env`.
- `local.env` loads only when **`AEGIS_LOAD_LOCAL_ENV=1`** (entrypoints), never into capability children.
- Observation layer never needs provider credentials; cognition substrates do.

---

## Tree (product-relevant)

```text
.
├── AGENTS.md
├── README.md                 # operator entry
├── summary.md                # this map
├── entry.md                  # proposal only
├── run_aegis.sh
├── runtime_aegis.sh
├── package.json              # aegis:test / aegis:test:fast
├── .skills/                  # mode contracts + field_ownership
├── .harness/
│   ├── config.sh             # topology SoT
│   ├── 00_architecture_core.md
│   └── runtime/              # ephemeral (handover, payloads, surfaces)
└── scripts/
    ├── execute_mode.sh
    ├── lib/
    ├── capabilities/         # handlers above only
    ├── runtime/              # promote / apply
    └── substrates/
        ├── raw_llm.sh
        ├── aider_substrate.sh
        ├── prompts/
        └── test/             # contract suite
```

`src/` is the **mutation playground**, not the harness runtime.

---

## Tests

| Command | Scope |
|---|---|
| `npm run aegis:test:fast` | Contracts that stay green without full LLM matrix (capabilities, runtime, secrets, authority, static gate, outcome, scope, constitutional) |
| `npm run aegis:test` | Full shell suite chained in `package.json` |
| `npm run aegis:sanity` | tsc + eslint + static enforce |

Individual harnesses live under `scripts/substrates/test/`.

---

## Status notes

- **Deep topology cut complete:** product discovery path is Layer 0 + fine only. Residual `structural_builder` reads were removed from handover, attention_seed, enrich, and mutation fallbacks.
- **Docs role:** this file is the living map; README stays operator-facing; `entry.md` is future demand protocol, not current behavior.
- Prefer hardening and KISS reduction over new architectural surfaces.

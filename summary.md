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
| `historyCommit.md` | Complete forensic audit, evolutionary logs, historical matrix, and canonical invariants |

Field ownership lives in mode skills (`.skills/*.md`) and runtime enrich — there is no separate ownership doc.

---

## One sentence

Aegis is a **runtime-sovereign shell harness**: modes get only capability evidence the runtime materializes; discovery/forensics default to **mechanical** bodies; supervisor briefings compile and execute in-memory with active architecture alignment before coding; build mutates under jail + intent rails; auto-squash consolidates micro-units upon completion; git is the only durable memory.

---

## Execution graph

```text
./aegis (CLI Intake/Fit/Batch)  ──►  run_aegis.sh  ──►  runtime_aegis.sh  ──►  execute_mode.sh
            │                               │                  │                      │
            │                               │                  │              capability handlers
            │                               │                  │                      │
            ├── supervisor briefing (.skills/briefing.md)      ├── mechanical (discovery always; forensics if clear)
            ├── 5-Pillar Setup Wizard (./aegis setup)          ├── raw_llm.sh      (forensics residual, optimize advise, adversarial, validation)
            ├── micro-unit plan (.harness/micros_auto)        └── aider_substrate (build only)
            ├── zero-token recommended bypass                               │
            ├── keep-progress batch + auto-squash                      framed JSON artifact
            └── human commit gate (git commit -e -F)                        │
                                                                       └── outcome (human + metrics + last_outcome.json)
                                                                                  handover promote / cleanup
```

| Entrypoint | Owns |
|---|---|
| `./aegis` | Top-level Operator CLI: demand intake, topological `fit_check` micro-unit split, batch keep-progress execution, direct `./aegis <N>` resume, unconditional auto-squash feature consolidation, 5-Pillar Setup Wizard, TTY human commit gate |
| `run_aegis.sh` | Low-level driver: pipelines (`mutation` / `readonly`), timing report, run-level outcome, preflight dirty-target check, `pipeline_metrics.jsonl` |
| `runtime_aegis.sh` | Lifecycle, surface, handover reset/promote, per-mode invoke, build-feedback re-entry, signal termination expunge |
| `scripts/execute_mode.sh` | Protocol VM: envelope, evidence, substrate, validate/enrich; loads full `AGENTS.md` as preamble |
| `.harness/config.sh` | Modes, handlers, evidence profiles, budgets, provider defaults |

---

## Execution Paradigms & Model Hierarchy

### 1. Execution Paradigms (2 Modes)
- **Direct CLI Execution (Human Operator)**: Direct invocation via `./aegis "<demand>"`, `./aegis <N>`, or `./aegis setup`. Interactive TTY prompts for human approval; triggers interactive setup (`./aegis setup`) if API keys are missing.
- **AI Assistant Handover (Antigravity, Claude Code, Codex, OpenCode, Cursor, Windsurf, Aider, Devin)**: Automatic environment sensing via `aegis_is_agentic_execution` (`ANTIGRAVITY_AGENT`, `CLAUDE_CODE`, `CODEX_AGENT`, `OPENCODE_AGENT`, `CURSOR_AGENT`, `WINDSURF_AGENT`, `--agent` / `--agentic` flags, or non-TTY subshells). Operates in non-blocking, silent handover mode returning structured JSON results (`PENDING_USER_QUESTIONS`, `PENDING_SETUP_CONFIG`, `PENDING_ASSISTANT`).

### 2. Model Selection Hierarchy & 5-Pillar Setup
- **5 Ecosystem Pillars (`./aegis setup`)**:
  1. *Native IDE Assistants & CLI Agents* (Antigravity, Claude Code, Cursor, Windsurf, OpenCode)
  2. *Proprietary / Frontier Cloud Models* (OpenAI GPT-4o/o3-mini, Anthropic Claude 3.7, Google Gemini 2.5, xAI Grok-2)
  3. *Open-Weights Fast Hosted APIs* (NVIDIA Integrate GLM-5.2/Llama-3.3, DeepSeek Direct, Moonshot Kimi, Groq)
  4. *Local & Offline Sovereign Engines* (Ollama, vLLM, SGLang, LM Studio)
  5. *Custom Hybrid Mode* (Independent decoupling: Supervisor on IDE/API + Coder on API/Local with smart key reuse)
- **Global Fallback**: `AEGIS_MODEL_DEFAULT` (e.g. `z-ai/glm-5.2` or `gemini-2.5-flash`). Applies to all pipeline stages unless specialized per-mode overrides are specified.
- **Per-Stage Specialized Overrides**:
  - `AEGIS_SUPERVISOR_MODEL`: Demand expansion & structured JSON schema generation in intake (`.skills/briefing.md`, `scripts/lib/briefing.sh`).
  - `AEGIS_AIDER_MODEL` / `AEGIS_MUTATION_MODEL`: Code mutation in Aider (`build`).
  - `AEGIS_MODEL_DISCOVERY`: Discovery stage.
  - `AEGIS_MODEL_FORENSICS`: Forensics stage.
  - `AEGIS_MODEL_ADVERSARIAL`: Devil's Advocate red-teaming & invariant falsification stage.
  - `AEGIS_MODEL_VALIDATION`: Tribunal static validation stage.
  - `AEGIS_MODEL_OPTIMIZE`: System design refactoring stage.

---

## Modes

| Mode | Engine | Role |
|---|---|---|
| `discovery` | **runtime mechanical only** (no LLM) | Gaps over anchors/probes → `observations` / `rationale` / `required_evidence` |
| `forensics` | mechanical default; raw LLM if multi-seed **probe tie** / force | `build_candidates[{id,reason}]` |
| `build` | aider / mechanical shortcut | Bounded mutation from candidates + MUTATION BRIEF. Zero tokens on resolved function appends & barrel re-exports |
| `optimize` | **mechanical clean** ($O(1)$ AST scan); raw LLM advise only if complex | Systems & Runtime Physics Refactoring (closed-form $O(1)$ math, zero hot-path GC allocations, reference confinement) |
| `adversarial` | **mechanical verified** (Node.js runtime assert runner + `tsc` + `eslint`); raw LLM on dirty/complex | **Devil's Advocate (Advogado do Diabo)**: Invariant falsification (non-negativity guards, temporal monotonicity, boundary crashes) with **Strict Anti-Overengineering KISS Filter** |
| `validation` | **mechanical tribunal** (default; LLM only if `AEGIS_VALIDATION_LLM=1`) | Verdict; `build_feedback` with stable codes; Git promotion |

**Skills (`.skills/<mode>.md`):**

| Skill | Loaded into model? |
|---|---|
| *(discovery)* | **No skill file** — runtime mechanical only (`demand.sh`) |
| `briefing.md` | **Yes** — supervisor model JSON schema generation & category decision tree |
| `forensics.md` | **Yes** only on LLM residual path |
| `mutation.md` | **Yes** — Aider mutation |
| `optimize.md` | **Yes** — raw LLM advise-only (Systems & Runtime Physics; closed-form $O(1)$ math & zero GC; strict KISS) |
| `adversarial.md` | **Yes** — raw substrate (Devil's Advocate & Invariant Falsifier with `AEGIS_ADVERSARIAL_DEPTH` tiers and strict KISS rule) |
| `validation.md` | **Contract only** by default; LLM only if `AEGIS_VALIDATION_LLM=1` |

### Orthogonal Skill Architecture (Zero Redundancy)

| Contract | Owner / Role | Invariant Responsibility |
|---|---|---|
| `ARCHITECTURE.md` | **Target Domain Law** | NodeNext ESM, `BigInt`, zero `any`, `readonly` immutability, pure getters (Single Source of Truth), and non-negativity guards. |
| `.skills/briefing.md` | **Supervisor Briefing** | Category Decision Tree + Mandatory Questions Gate + In-Memory `tsc` Typecheck + Zero-Token Recommended Bypass. |
| `.skills/mutation.md` | **Coder Surgery Protocol** | 5 Core Directives: target confinement, complete logic (no stubs), clean comments (no dead code), entrypoint integrity, exact SEARCH/REPLACE. |
| `.skills/optimize.md` | **Systems & Runtime Physics** | Closed-form $O(1)$ math, zero hot-path GC allocations, boundary reference confinement, strict KISS. |
| `.skills/adversarial.md` | **Devil's Advocate** | Invariant falsification (non-negativity, NTP clock drift, boundary crashes) with real Node.js behavior assertions. |
| `.skills/validation.md` | **Mechanical Tribunal** | P2 Behavioral Oracle (`node --experimental-strip-types`) + Promotion Gate to Git + Auto-Squash. |

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

---

## Evidence profiles (product path)

Config lists a base set; execute_mode **re-ranks** and may **omit** search when not needed.

| Mode | Base evidence (config) | Runtime notes |
|---|---|---|
| discovery | `demand_anchors`, `list_tree`, handover, `layer0_facts`, `attention_seed` | Always mechanical body |
| forensics | `demand_anchors`, handover, `search_symbol` | **Search omitted** if mechanical; + `filesystem.read` anchors |
| build | `demand_anchors`, handover, `search_symbol`, git, tsc, eslint, test | **Search omitted** if forensics ALVO present; + read anchors |
| optimize | `demand_anchors`, handover | Read-only; diff-in-handover |
| adversarial | `demand_anchors`, handover, `search_symbol`, git, tsc, eslint, test | Read-only; runs real Node.js runtime asserts |
| validation | `demand_anchors`, handover | Read-only; tribunal checks against acceptance criteria |

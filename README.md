Language: [English](README.md) | [Português (Brasil)](README.pt-BR.md)

# Aegis Harness

Runtime-sovereign execution for AI-assisted software engineering.

Aegis turns a coding demand into a bounded, inspectable, multi-mode pipeline. The runtime decides what evidence is exposed, which engine runs each phase, what files may change, and whether the candidate patch is ready for promotion. Models reason only over the payload they receive; Git is the only durable project memory.

It is a shell-first harness, not an IDE plugin or a general-purpose autonomous agent. Aider is used as the mutation engine, while the surrounding lifecycle, evidence profiles, gates, and outcome reporting belong entirely to Aegis.

---

## Why Aegis

AI coding tools produce code quickly, but production engineering requires strict operational answers:

- **Evidence Boundary:** What was the model allowed to see?
- **Mutation Isolation:** Which files was it authorized to modify?
- **Intent Alignment:** Did the patch satisfy the original demand and acceptance criteria without extra scope creep?
- **Deterministic Gates:** Did static checks, TypeScript compilation, linters, tests, and semantic red-teaming pass?
- **Human Sovereignty:** Can an operator inspect and approve the exact patch before it becomes project history?

Aegis enforces these boundaries deterministically at runtime and records every decision as protocol artifacts and Git history.

---

## Three-Tier Governance Architecture

Aegis maintains a strict separation between model cognition, mechanical AST enforcement, and application domain code rules:

1. **[`AGENTS.md`](AGENTS.md) — Model Cognition Contract:** Governs the model's mind (how to reason from evidence, be direct, eliminate conversational fluff, avoid hallucinating unexposed facts, and follow KISS).
2. **`.harness/enforcement/rules/` — Mechanical AST Gate:** Governs automated machine enforcement (`ast-grep` rules). The machine deterministically blocks bad code (e.g. `any` usage, `eval`, unhandled promises, literal throws) via `npm run aegis:sanity` before human review.
3. **[`src/ARCHITECTURE.md`](src/ARCHITECTURE.md) — Target Application Conventions:** The exclusive and authoritative location for application code style, file naming conventions (`kebab-case`), TypeScript ESM NodeNext import rules, `BigInt` scaling formulas, strict encapsulation, and PonyTail engineering patterns for source code in `src/`.

---

## Cognitive Principles & Karpathy Discipline

Aegis operates under a constitutional contract defined in [`AGENTS.md`](AGENTS.md), inspired by Andrej Karpathy's pragmatic coding principles:

1. **RUNTIME AUTHORITY:** Interpret only the authority explicitly delegated by the runtime. Do not assume permissions, repository knowledge, intent, or state beyond provided capabilities and evidence.
2. **EVIDENCE DISCIPLINE (Think Before Coding):** Reason strictly from runtime-exposed evidence. Validate assumptions explicitly; never invent facts, fill gaps with speculation, or guess missing context.
3. **KISS & SURGICAL MUTATION (Simplicity First):** Prefer explicit, local, deterministic implementations. Avoid speculative abstractions, hidden behavior, unnecessary indirection, or premature generalization. Make minimal, surgical edits.
4. **DIRECT PROTOCOL EMISSION:** Emit framed, concise, technical artifacts without conversational preambles, fluff, or filler prose.
5. **ERROR & TYPE DISCIPLINE:** Ensure strict type correctness, respect language invariants, handle edge cases explicitly, and avoid unrequested side effects or extra public exports.

### Why Karpathy's Rules Work Best under Aegis Runtime Sovereignty

Traditional AI coding tools mix project maps, build commands, and coding styles into a single, massive prompt file (e.g. `.cursorrules` or `CLAUDE.md`) and rely on the model to self-regulate. Aegis takes a different approach:

- **Runtime Sovereignty vs. Prompt Rules:** Aegis does not rely on prompt text to prevent out-of-bounds edits. Physical guards (path containment, environment isolation `env -i`, capability manifests, and mode VM routing) are enforced in Shell. [`AGENTS.md`](AGENTS.md) is strictly focused on the model's internal reasoning discipline.
- **KV-Cache Prefix Efficiency:** Because [`AGENTS.md`](AGENTS.md) is ultra-concise (~150 tokens) and invariant across all modes, it sits in the frozen prompt zone, maximizing LLM API prompt-prefix caching and reducing token costs by ~40-60%.
- **Zero Prompt Bloat:** Project topology lives in [`summary.md`](summary.md) for human operators; mode contracts live in `.skills/`; runtime rules live in `.harness/config.sh`. The model prompt receives only what is strictly required for the current execution step.

---

## Execution Graph & Modes

The standard mutation pipeline executes in bounded phases:

```text
demand
  │
  ├──► intake / fit check      (Supervisor expand 8B + micro-unit planner)
  ├──► discovery               (Mechanical only: gaps & required evidence)
  ├──► forensics               (Mechanical default: target selection)
  ├──► repair                  (Bounded Aider mutation under path jail)
  ├──► optimize                (Raw LLM advice: max 1 refinement loop)
  ├──► adversarial             (Raw LLM red-team semantic check)
  ├──► validation              (Mechanical tribunal: token/export alignment)
  └──► promotion / commit gate (Human commit gate or pending approval)
```

### Pipeline Modes Overview

| Mode | Purpose | Engine | Skill Contract |
|---|---|---|---|
| `discovery` | Identify code gaps, probes, and required evidence | **Mechanical runtime only** (no LLM) | Mechanical `demand.sh` |
| `forensics` | Select smallest set of mutation target files | Mechanical default; LLM on tie/ambiguity | `.skills/forensics.md` |
| `repair` | Produce a bounded candidate patch | Aider mutation substrate | `.skills/repair.md` |
| `optimize` | Suggest single proven improvement or pass | Raw LLM (advice only; no edits) | `.skills/optimize.md` |
| `adversarial` | Challenge semantic assumptions & edge cases | Raw LLM (red-team analysis) | `.skills/adversarial.md` |
| `validation` | Decide if patch satisfies demand & gates | Mechanical tribunal (LLM opt-in) | `.skills/validation.md` |

---

## Live Capability Surface

Capability handlers live in `scripts/capabilities/` and are registered in `.harness/config.sh`:

| Capability | Handler | Purpose |
|---|---|---|
| `filesystem.list_tree` | `filesystem/list_tree.sh` | Directory structure inspectability |
| `filesystem.read` | `filesystem/read_file.sh` | Authorized file content reading |
| `filesystem.search_symbol` | `filesystem/search_symbol.sh` | Scoped symbol search (`git grep`) |
| `git.status` | `git/git_status.sh` | Working tree status |
| `git.diff` | `git/git_diff.sh` | Unstaged / staged diff inspection |
| `runtime.layer0_facts` | `runtime/layer0_facts.sh` | Core runtime facts |
| `runtime.attention_seed` | `runtime/attention_seed.sh` | Focus area seeding |
| `runtime.demand_anchors` | `runtime/demand_anchors.sh` | Anchor path materialization |
| `typescript.check` | `typescript_check.sh` | Project TypeScript compiler check |
| `eslint.check` | `eslint_check.sh` | Project ESLint static code quality check |
| `test.run` | `test_runner.sh` | Automated test suite verification |

---

## Quick Start

### Prerequisites

- **Core System:** Bash, Git, `jq`, `curl`, Python 3
- **Node.js Environment:** Node.js (v18+) and `npm`
- **Mutation Engine (for repairs):** [Aider](https://aider.chat/) installed and available in `$PATH`
- **LLM Endpoint:** OpenAI-compatible API endpoint (e.g. OpenAI, vLLM, Ollama, etc.)
- **GitHub Workflows (optional):** GitHub CLI (`gh`) for `--issue` intake workflows

### Installation

Clone the repository and install npm dependencies:

```bash
git clone https://github.com/farifran/aegis-kiss.git
cd "aegis kiss"
npm install
```

### Environment Configuration

Create `.harness/local.env` (gitignored) to configure model endpoints and API keys:

```bash
# Required: OpenAI-compatible API credentials
OPENAI_API_BASE="https://your-openai-compatible-endpoint/v1"
OPENAI_API_KEY="your-api-key"
OPENAI_MODEL_READONLY_COGNITION="your-model-name"

# Optional: Dedicated model for Aider mutation phase
# AEGIS_AIDER_MODEL="your-mutation-model"
```

The CLI entrypoints load `.harness/local.env` automatically.

---

## Operator CLI Reference (`./aegis`)

`./aegis` is the primary entry point for operators.

### 1. Read-Only Context Inspection (`context`)

Inspect target state, branch details, worktree cleanliness, and managed commit log history offline without calling an LLM:

```bash
./aegis context --target src
```

### 2. Task Execution (`go`)

Run the complete pipeline from demand intake to mutation, validation, and the human commit gate:

```bash
# Execute a goal with explicit target and acceptance token
./aegis go \
  --goal "Create the requested utility in src/index.ts" \
  --target src/index.ts \
  --accept requestedUtility

# Execute or resume a GitHub issue (automatically split into micro-units if structured)
./aegis go --issue 123

# Force re-running a specific task index within an issue (reopens task K [x] -> [ ])
./aegis go --issue 123 --force-task 2

# Bypass strict intake expand if needed
./aegis go "fix typo in src/index.ts" --relaxed
```

---

## ⚡ KV-Cache Topology & Token Economy

Aegis implements a **Byte-0 Shared Prefix Architecture** across both its Aider mutation substrate and Raw LLM cognition substrate. By placing static invariants (`AGENTS.md` + `src/ARCHITECTURE.md` + `Pocket Map`) starting at byte 0 of every prompt, Aegis achieves massive prompt caching efficiency across pipeline modes and re-entries:

| Stage / Phase | Mode | Substrate / Engine | Prompt Payload Structure | KV-Cache State | Estimated Cache Hit |
|---|---|---|---|---|---|
| **1. Investigation** | `discovery` | Raw / Shell | 100% Mechanical in Shell | N/A (0 tokens) | 🟢 **N/A (0 tokens)** |
| **2. Investigation** | `forensics` | Raw / Shell | 100% Mechanical in Shell | N/A (0 tokens) | 🟢 **N/A (0 tokens)** |
| **3. Mutation 1** | `repair` *(1st run)* | Aider CLI | Frozen Header + Demand + Forensics Anchors | **Establishes Aider Cache** | 🆕 **0%** (Writes Aider's stable header) |
| **4. Review 1** | `optimize` *(1st run)* | Raw LLM | Frozen Header + Candidate Diff $C_1$ | **Establishes Review Cache** | 🟡 **~60% Hit** (Byte 0 shared prefix) |
| **5. Review 1** | `adversarial` *(1st run)* | Raw LLM | Frozen Header + Candidate Diff $C_1$ (Same as step 4) | ⚡ **FULL REVIEW HIT!** | ⚡ **95% - 100% Cache Hit** (Reads header + Diff $C_1$ at ~0 cost) |
| **6. Re-entry** | `repair` *(2nd run)* | Aider CLI | Frozen Header (Same as step 3) + *[Optimize Feedback in Live Zone]* | ⚡ **FULL AIDER HIT!** | ⚡ **~100% Header Cache Hit** (Reads ~3,500 header tokens at 0 cost) |
| **7. Review 2** | `optimize` *(2nd run)* | Raw LLM | Frozen Header + Refined Diff $C_2$ | **Updates Diff Cache** | 🟡 **~60% Hit** (Byte 0 shared prefix) |
| **8. Review 2** | `adversarial` *(2nd run)* | Raw LLM | Frozen Header + Refined Diff $C_2$ (Same as step 7) | ⚡ **FULL REVIEW HIT!** | ⚡ **95% - 100% Cache Hit** (Reads header + Diff $C_2$ at ~0 cost) |
| **9. Validation** | `validation` | Raw / Shell | Mechanical Tribunal (`npm run aegis:sanity`) | N/A (0 tokens by default) | 🟢 **N/A (0 tokens)** |

### Core Efficiency Drivers:
- **0-Token Mechanical Modes:** `discovery`, `forensics`, and `validation` run deterministically in shell by default.
- **Intra-Mode Re-entries:** Re-entering `repair` with compiler or reviewer feedback preserves 100% of Aider's frozen header in cache.
- **Inter-Mode Review Pairs:** `adversarial` achieves ~100% cache hit on top of `optimize` because both evaluate the exact same candidate diff $C_n$ under the same byte-0 prefix.

---

## Observability & Metrics

After execution, Aegis materializes structured outcome reports under `.harness/runtime/`:

```bash
# 1. View final pipeline outcome report
cat .harness/runtime/last_outcome.json | jq .

# 2. Inspect intent, alignment, and validation tribunal decisions
jq -c 'select(.kind == "intent" or .kind == "alignment" or .kind == "validation")' \
  .harness/runtime/pipeline_metrics.jsonl

# 3. Analyze token usage, prompt caching efficiency, and context budgets
jq -c 'select(.kind == "cache" or .kind == "tokens" or .kind == "pipeline_budget")' \
  .harness/runtime/pipeline_metrics.jsonl
```

---

## Development & Testing

Run project verification commands to validate harness contracts:

```bash
npm run aegis:sanity
npm run aegis:test:fast
npm run aegis:test
npm run aegis:full
```

---

## Repository Map

```text
.
├── aegis                     # Primary Operator CLI: intake, fit check, batch, commit gate
├── run_aegis.sh              # Low-level pipeline driver
├── runtime_aegis.sh          # Sovereign runtime orchestrator & re-entry lifecycle
├── run_aegis_loop.sh         # Bounded demand loop runner
├── AGENTS.md                 # Constitution loaded into LLM/Aider preambles
├── README.md                 # English documentation
├── README.pt-BR.md           # Portuguese documentation
├── summary.md                # Detailed repository map & architecture reference
├── package.json              # Test scripts and project dependencies
├── .skills/                  # Mode contracts (forensics, repair, optimize, adversarial, validation)
├── .harness/
│   ├── config.sh             # Engine registries, budgets, providers, evidence profiles
│   ├── enforcement/          # Static rules and path guards
│   └── runtime/              # Epistemic handover, metrics, last outcome
├── scripts/
│   ├── execute_mode.sh       # Protocol VM executor
│   ├── fit_check_demand.sh   # Demand fit checking & mechanical micro splitter
│   ├── capabilities/         # Capability handlers (filesystem, git, typescript, eslint, test)
│   ├── lib/                  # Core libraries (demand, evidence, artifact_protocol, run_outcome)
│   ├── runtime/              # Candidate diff application and promotion
│   └── substrates/           # Raw LLM, Aider substrate, gates, and tests
├── src/                      # Mutation playground for target TypeScript code
└── tasks/                    # Structured demand task examples
```

---

## Related Work and Credits

- **Andrej Karpathy:** Aegis adapts Karpathy's pragmatic software engineering principles ("Think Before Coding", "Simplicity First", "Direct Output", and "Strict Error Checking") directly into its constitutional cognition contract ([`AGENTS.md`](AGENTS.md)).
- **[PonyTail](https://github.com/dietrichgebert/ponytail) (by Dietrich Gebert):** Inspires the clean, native-first, pure-function, strict encapsulation, and atomic module conventions for target application code documented in [`src/ARCHITECTURE.md`](src/ARCHITECTURE.md).
- **[Aider](https://aider.chat/):** Used as the bounded mutation substrate for code edits.
- **[Headroom](https://github.com/headroomlabs-ai/headroom):** Inspires the frozen/live prompt zone architecture and context budget pruning discipline.
- **[LMCache](https://github.com/LMCache/LMCache):** Inspires payload-level caching concepts.

These projects are not vendor dependencies in Aegis and no code is vendored from them.

---

## License

See [`LICENSE.md`](LICENSE.md).

Language: [English](README.md) | [Português (Brasil)](README.pt-BR.md)

# Aegis Harness 🛡️

> **Sovereign & Deterministic Containment Harness for AI-Assisted Software Engineering**

![AST Enforced](https://img.shields.io/badge/AST--Enforced-ast--grep-blue)
![KV-Cache](https://img.shields.io/badge/KV--Cache-Byte--0%20prefix%20stable-yellowgreen)
![Zero Regressions](https://img.shields.io/badge/Quality-Zero%20Regressions-brightgreen)
![KISS Architecture](https://img.shields.io/badge/Architecture-KISS%20Shell-orange)

**Aegis** transforms code demands into a **bounded, inspectable, 6-stage autonomous pipeline** (`discovery` ➔ `forensics` ➔ `build` ➔ `optimize` ➔ `adversarial` ➔ `validation`). Unlike generic IDE extensions, Aegis is a **deterministic governance engine** that mechanically blocks bad code via AST, elevates LLM code reviews from local syntax to **System Design & State Lifecycle Red-Teaming**, holds a measured **71% of each raw-substrate prompt byte-identical from Byte 0** so a provider prefix cache can reuse it, and guarantees **only 100% tested, architecturally aligned patches reach Git**.

---

## ⚡ 30-Second Quickstart

```bash
# 1. Clone & Install
git clone https://github.com/farifran/aegis-kiss.git && cd "aegis kiss" && npm install

# 2. Configure Credentials (.harness/local.env)
echo 'OPENAI_API_KEY="sk-..."' > .harness/local.env
echo 'OPENAI_MODEL_READONLY_COGNITION="gemini-3.6-flash"' >> .harness/local.env

# 3. Execute a Demand
./aegis "Create utility in src/index.ts" --target src/index.ts --accept myFunction
```

---

## 📦 Dependencies

`npm install` covers only the TypeScript toolchain (`typescript`, `eslint`,
`@ast-grep/cli`, … — see `package.json`). The runtime also requires the
following on your `PATH`:

| Dependency | Required? | Used for |
|---|---|---|
| **bash** (≥ 4) | ✅ | Harness runtime (`set -Eeuo pipefail`) |
| **git** | ✅ | Only durable memory; diff/status & commit gate |
| **curl** | ✅ | Provider HTTP requests (`raw` substrate) |
| **jq** | ✅ | JSON evidence, handover, metrics, prompts |
| **node** + **npm** | ✅ | `tsc`, `eslint`, `ast-grep` toolchain |
| **Aider CLI** (`aider`) | ✅ *(mutation)* | `build` substrate — `AEGIS_AIDER_BIN` (default `.venv/bin/aider`, auto-detected from `PATH`) |
| **python3** | ⚪ optional | Mechanical TS sanitizer + cache probe scripts |
| **gh** (GitHub CLI) | ⚪ optional | Only `--issue N` demand intake |
| Ollama / vLLM / LM Studio | ⚪ optional | Local inference provider |

Install **Aider** for the mutation pipeline (install it into the repo venv so
`AEGIS_AIDER_BIN`'s default `.venv/bin/aider` resolves, or leave it on your
`PATH`):

```bash
python3 -m venv .venv && .venv/bin/pip install aider-chat
```

Aider is only needed for `build`; read-only modes (`discovery` / `forensics` /
`validation`) run without it.

---

## 🌐 Multi-Client Integration & Inference Modes

Aegis supports **two primary execution modes** across any development environment:

### 1. 💻 Direct CLI Execution (Human Operator)
- **Interactive TTY Experience**: Prompts for confirmation and opens interactive setup (`./aegis setup`) if API keys are missing.
- **Local LLMs & Cloud APIs**: Connects to local inference servers (Ollama, vLLM, LM Studio) or cloud endpoints (NVIDIA Integrate, OpenAI, Anthropic, Gemini, DeepSeek).
- **Flexible Model Selection**:
  - **Single Global Model**: Set `AEGIS_MODEL_DEFAULT="meta/llama-3.1-8b-instruct"` (or `ollama/llama3.1:8b`) to use one model for all pipeline stages.
  - **Per-Task / Per-Mode Models**: Override specific pipeline stages with dedicated models:
    - `AEGIS_SUPERVISOR_MODEL`: Intake demand expansion & issue generation (e.g. `deepseek-ai/deepseek-v4-flash-0731`; defaults to the brief model)
    - `AEGIS_AIDER_MODEL` / `AEGIS_MUTATION_MODEL`: Code mutation in Aider (`build`)
    - `AEGIS_MODEL_ADVERSARIAL`: Red-teaming & falsification (`adversarial`)
    - `AEGIS_MODEL_VALIDATION`: Tribunal static alignment (`validation`)
  - **Supervisor reliability knobs**: `AEGIS_BRIEFING_MAX_TOKENS` (default `2048`),
    `AEGIS_BRIEFING_MAX_ATTEMPTS` (default `2`), `AEGIS_BRIEFING_TIMEOUT_SEC`
    (default `90`). A quality gate retries Briefings that are structurally valid
    but degenerate (self-cancelling algebra, duplicated declarations).

### 2. 🤖 AI Assistant Handover (Antigravity, Claude Code, Codex, OpenCode, Cursor, Windsurf)
- **Automatic Agentic Sensing**: Aegis automatically detects AI assistant environments via `aegis_is_agentic_execution` (`ANTIGRAVITY_AGENT`, `CLAUDE_CODE`, `CODEX_AGENT`, `OPENCODE_AGENT`, `CURSOR_AGENT`, `WINDSURF_AGENT`, `--agent` / `--agentic` flags, or non-TTY subshells).
- **Non-Blocking & Silent Execution**: Disables interactive TTY prompts, emitting clean structured JSON (`pending_assistant.json`) and returning execution control directly to the AI assistant with 0 external token overhead.

| Client / Environment | Execution Mode | Workflow / Command |
|---|---|---|
| 💻 **Direct Aegis CLI** | Human Operator (Interactive) | `./aegis "your demand" --target src/...` or `./aegis <N>` |
| 🛸 **Antigravity IDE / Codex** | Agentic Pair-Programmer (Non-blocking) | Background execution via `run_command` or terminal subshell |
| 🤖 **Claude Code / OpenCode / Cursor** | Agentic Assistant (Silent Handover) | `./aegis "your demand"` inside assistant prompt |

---

## 🏛️ Architectural Synthesis: Aegis's 6 Pillars

Aegis unifies 6 major open-source software engineering projects into a single deterministic harness:

| Pillar | Role in Aegis | Measurable Practical Benefit |
|---|---|---|
| 🧠 **Karpathy** | Cognition Constitution at Byte 0 ([`AGENTS.md`](AGENTS.md)). | Mechanical intent tribunal rejects hallucinated diffs. |
| 😈 **Devil's Advocate** | Adversarial Invariant Falsifier ([`.skills/adversarial.md`](.skills/adversarial.md)). | Interrogates sign invariants (`bits <= 0n`), NTP clock drift, and boundary crashes with **Strict Anti-Overengineering KISS Filter** (1-line surgical fixes). |
| 📐 **PonyTail** | Directives in [`ARCHITECTURE.md`](ARCHITECTURE.md) + AST rules. | Enforces NodeNext ESM, `readonly`, `BigInt`, zero `any`. |
| ✂️ **Headroom** | Epistemic 32KB Context Budgeting with anchor protection. | Prunes irrelevant files without deleting bug root causes. |
| ⚡ **LMCache** | Prompt held byte-identical from Byte 0 (`AGENTS.md` + `ARCHITECTURE.md` + skill contract + capability manifest). | **71% of the prompt measured byte-stable** across repeat runs — clears the 1,024-token minimum a prefix cache needs. |
| 🛡️ **Semgrep** | SAST static security scanner in `static_gate.sh`. | Mechanically blocks Git promotion of OWASP / injection flaws. |

---

## 🧪 Behavioral Oracle: Mechanical Validation of Semantics (P2)

Intake expands a demand through the **supervisor** model into a structured
Briefing that carries an executable **`## Behavior`** section — regression
asserts the coder must satisfy:

```text
- window slides at the boundary and resets count
   exports: RateLimiter
   prelude: const r = new RateLimiter(1, 1000)
   prelude: r.allow(0n)
   assert: r.allow(1000n) === true && r.windowStart === 1000n
```

`fit_check.sh` carries `## Behavior` into each micro-unit demand; the mechanical
**behavior gate** (`aegis_mechanical_behavior_gate` in `demand.sh`) parses the
items, scopes each assert to the unit that owns its **first-listed export**
(imports are the union of all exports an item references), and executes them
with `node --experimental-strip-types`. A failing assert emits a
`behavior_failure` finding (high severity, `supported_by_evidence: true`) that
`validation` turns into a hard `rejected` verdict with `build_feedback` — so a
candidate that implements the API but violates the intended semantics **cannot**
be promoted. This closes the "validated but semantically wrong" hole.

Assertions anchor time to the exported `windowStart` getter (never absolute
numbers or real-clock sleeps), keeping the oracle deterministic. Verified on the
RateLimiter benchmark: a wrong-but-API-correct candidate that the old pipeline
accepted (issue #183) is now rejected with findings in every relevant unit.

**Benchmark (arm D, vague demand + Aegis).** With the supervisor brief + the
behavioral oracle the 12-check oracle (`verify_rate_limiter.ts`) goes from
**0/12 (bare 8B)** to **12/12**, matching the structured-demand arms.

---

## ⚡ KV-Cache Topology & Token Economy

Aegis orders every prompt so the invariant part comes first: constitution,
architecture directives, skill contract and capability manifest at Byte 0,
then a `LIVE ZONE` marker, then everything that changes per execution.
A provider-side prefix cache can only reuse bytes up to the first one that
differs, so that ordering is the whole mechanism.

**What is measured.** Two `forensics` runs of the same demand, captured at the
wire and tokenised with `o200k_base`:

| | tokens |
|---|---|
| Whole raw-substrate prompt | 2,435 |
| **Byte-0 identical prefix across both runs** | **1,718 (71%)** |
| — system message (constitution + architecture + skill) | 1,059 |
| — user message up to first divergence | 659 |
| Provider minimum before any prefix cache engages | 1,024 |

The prefix clears the threshold with room to spare. The residual 29% is the
epistemic handover, which carries its own timestamp and legitimately changes
every cycle.

**What is not measured.** *Whether the provider actually reuses it.* No
cache-reporting endpoint has been exercised yet — the current NVIDIA endpoint
returns `null` for `cached_tokens`, so `cached_prompt_tokens` in
`pipeline_metrics.jsonl` has never been anything but null. Until that run
happens, the honest ceiling is arithmetic, not a benchmark:

| If the cache fires | Saving on **input** cost |
|---|---|
| Provider bills cached input at 50% off | ~35% |
| Provider bills cached input at 75% off | ~53% |

Output tokens are never cached and are billed several times the input rate, so
the saving on a full bill is materially smaller than either figure. Any claim
above this range is not supported by evidence in this repository.

| Mode | Substrate / Engine | Prompt Payload Structure | Prefix status |
|---|---|---|---|
| **`discovery`** | Mechanical Shell | 100% mechanical in shell | 🟢 **N/A (0 tokens)** |
| **`forensics`** | Mechanical Shell (LLM residual only) | Frozen head + evidence | 📏 **71% byte-stable (measured)** |
| **`build`** | Aider CLI | Frozen head + demand + evidence | ❓ **Unmeasured** *(Aider owns its own prompt assembly)* |
| **`optimize`** | Raw LLM | Frozen head + candidate diff $C_1$ | ❓ **Unmeasured** *(same assembler as `forensics`)* |
| **`adversarial`** | Raw LLM | Frozen head + diff $C_1$ *(depth `low\|medium\|paranoid`)* | ❓ **Unmeasured** *(larger skill contract ⇒ larger frozen head)* |
| **`validation`** | Mechanical Shell | Mechanical tribunal (`npm run aegis:sanity`) | 🟢 **N/A (0 tokens)** |

---

## 🚦 Quality Gate & Quick Commands

```bash
# 1. Execute a new demand (Intake + Fit + Pipeline)
./aegis "Create TokenBucket in src/tokenBucket.ts"

# 2. Resume an existing issue
./aegis 207

# 3. Squash micro-task commits into 1 clean feature commit for PR
./aegis squash 207

# 4. Offline context inspection (0 tokens)
./aegis context --target src

# 5. Run static tribunal (AST grep + ESLint + TS)
npm run aegis:sanity

# 6. Execute harness test suite
npm run aegis:test:fast
```

---

## 📜 License & Credits

See [`LICENSE.md`](LICENSE.md). Inspired by Andrej Karpathy, Dietrich Gebert (PonyTail), Aider, Headroom, LMCache, Semgrep, and Tree-sitter.

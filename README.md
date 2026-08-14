Language: [English](README.md) | [Português (Brasil)](README.pt-BR.md)

# Aegis Harness 🛡️

> **Sovereign & Deterministic Containment Harness for AI-Assisted Software Engineering**

![AST Enforced](https://img.shields.io/badge/AST--Enforced-ast--grep-blue)
![KV-Cache](https://img.shields.io/badge/KV--Cache-Byte--0-green)
![Zero Regressions](https://img.shields.io/badge/Quality-Zero%20Regressions-brightgreen)
![KISS Architecture](https://img.shields.io/badge/Architecture-KISS%20Shell-orange)

**Aegis** transforms code demands into a **bounded, inspectable, 6-stage autonomous pipeline** (`discovery` ➔ `forensics` ➔ `repair` ➔ `optimize` ➔ `adversarial` ➔ `validation`). Unlike generic IDE extensions, Aegis is a **deterministic governance engine** that mechanically blocks bad code via AST, elevates LLM code reviews from local syntax to **System Design & State Lifecycle Red-Teaming**, optimizes token expenditure up to 98% via Byte-0 KV-Cache, and guarantees **only 100% tested, architecturally aligned patches reach Git**.

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

## 🌐 Multi-Client Integration & Inference Modes

Aegis supports **two primary execution modes** across any development environment:

### 1. 💻 Direct CLI Execution (Human Operator)
- **Interactive TTY Experience**: Prompts for confirmation and opens interactive setup (`./aegis setup`) if API keys are missing.
- **Local LLMs & Cloud APIs**: Connects to local inference servers (Ollama, vLLM, LM Studio) or cloud endpoints (NVIDIA Integrate, OpenAI, Anthropic, Gemini, DeepSeek).
- **Flexible Model Selection**:
  - **Single Global Model**: Set `AEGIS_MODEL_DEFAULT="meta/llama-3.1-8b-instruct"` (or `ollama/llama3.1:8b`) to use one model for all pipeline stages.
  - **Per-Task / Per-Mode Models**: Override specific pipeline stages with dedicated models:
    - `AEGIS_SUPERVISOR_MODEL`: Intake demand expansion & issue generation
    - `AEGIS_AIDER_MODEL` / `AEGIS_MUTATION_MODEL`: Code mutation in Aider (`repair`)
    - `AEGIS_MODEL_ADVERSARIAL`: Red-teaming & falsification (`adversarial`)
    - `AEGIS_MODEL_VALIDATION`: Tribunal static alignment (`validation`)

### 2. 🤖 AI Assistant Handover (Copilot, Antigravity, Claude Code, OpenCode, Codex)
- **Automatic Agentic Sensing**: Aegis detects assistant environments (`ANTIGRAVITY_AGENT`, `CLAUDE_CODE`, `CODEX_AGENT`, `OPENCODE_AGENT`, or non-TTY subshells).
- **Non-Blocking & Silent Execution**: Disables TTY interactive prompts automatically, executing deterministically and returning structured JSON outcomes directly to the AI pair-programmer.

| Client / Environment | Execution Mode | Workflow / Command |
|---|---|---|
| 💻 **Direct Aegis CLI** | Human Operator (Interactive) | `./aegis "your demand" --target src/...` |
| 🛸 **Antigravity IDE / Codex** | Agentic Pair-Programmer (Non-blocking) | Background execution via `run_command` or terminal subshell |
| 🤖 **Claude Code / OpenCode** | Agentic Assistant (Silent Handover) | `./aegis "your demand"` inside assistant prompt |

---

## 🏛️ Architectural Synthesis: Aegis's 6 Pillars

Aegis unifies 6 major open-source software engineering projects into a single deterministic harness:

| Pillar | Role in Aegis | Measurable Practical Benefit |
|---|---|---|
| 🧠 **Karpathy** | Cognition Constitution at Byte 0 ([`AGENTS.md`](AGENTS.md)). | Mechanical intent tribunal rejects hallucinated diffs. |
| 📐 **PonyTail** | Directives in [`src/ARCHITECTURE.md`](src/ARCHITECTURE.md) + AST rules. | Enforces NodeNext ESM, `readonly`, `BigInt`, zero `any`. |
| ✂️ **Headroom** | Epistemic 32KB Context Budgeting with anchor protection. | Prunes irrelevant files without deleting bug root causes. |
| ⚡ **LMCache** | Static 4,356-byte header frozen starting at Byte 0. | **50% to 98% token cost savings** on LLM APIs. |
| 🛡️ **Semgrep** | SAST static security scanner in `static_gate.sh`. | Mechanically blocks Git promotion of OWASP / injection flaws. |
| 🌳 **Tree-sitter** | Skeletal scope pruning (`AEGIS_READ_SKELETAL=auto`). | **60% to 90% token pruning** on support files. |

---

## ⚡ KV-Cache Topology & Token Economy

| Mode | Substrate / Engine | Prompt Payload Structure | Estimated Cache Hit |
|---|---|---|---|
| **`discovery`** | Mechanical Shell | 100% Mechanical in Shell | 🟢 **N/A (0 tokens)** |
| **`forensics`** | Mechanical Shell | 100% Mechanical in Shell | 🟢 **N/A (0 tokens)** |
| **`repair` (1st run)** | Aider CLI | Frozen Header + Demand + Evidence | 🆕 **0%** *(Writes Aider header to server)* |
| **`optimize` (1st run)** | Raw LLM | Frozen Header + Candidate Diff $C_1$ *(System Design Refactoring)* | 🟡 **~60% Hit** *(Reuses frozen Byte 0)* |
| **`adversarial` (1st run)**| Raw LLM | Frozen Header + Diff $C_1$ *(Adaptive Depth `low|medium|paranoid` Workflow Falsification)* | ⚡ **95% - 100% Cache Hit** *(Reads header + Diff at ~0 cost)*|
| **`repair` (Re-entry)** | Aider CLI | Frozen Header + *[Live Zone Feedback]* | ⚡ **~100% Header Hit** *(Reads header at ~0 cost)* |
| **`validation`** | Mechanical Shell | Mechanical Tribunal (`npm run aegis:sanity`) | 🟢 **N/A (0 tokens)** |

---

## 🚦 Quality Gate & Quick Commands

```bash
# 1. Offline context inspection (0 tokens)
./aegis context --target src

# 2. Run static tribunal (AST grep + ESLint + TS)
npm run aegis:sanity

# 3. Execute harness test suite
npm run aegis:test:fast
```

---

## 📜 License & Credits

See [`LICENSE.md`](LICENSE.md). Inspired by Andrej Karpathy, Dietrich Gebert (PonyTail), Aider, Headroom, LMCache, Semgrep, and Tree-sitter.

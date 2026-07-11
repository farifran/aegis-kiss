README.md

Prerequisites:

- Node
- npm
- git
- jq
- ast-grep
- aider (optional)


# Aegis LLM Setting

cat >> ~/.bashrc <<'EOF'

export OPENAI_API_BASE="https://integrate.api.nvidia.com/v1"

export OPENAI_API_KEY="..."

EOF

source ~/.bashrc

echo $OPENAI_API_BASE

curl https://integrate.api.nvidia.com/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"meta/llama-3.3-70b-instruct",
    "messages":[
      {
        "role":"user",
        "content":"Reply only with OK"
      }
    ],
    "temperature":0
  }'

timeout 20 aider \
  --model openai/meta/llama-3.3-70b-instruct \
  --message "Reply ONLY with: OK" \
  --yes-always \
  --no-show-model-warnings \
  --no-stream \
  --no-pretty \
  --map-tokens 0 \
  --no-git \
  --exit

# Aegis Harness

Aegis Harness is a bounded, deterministic AI execution runtime designed to separate cognition, orchestration, evidence, operational memory, persistence, and mutation authority. The system is built around explicit authority boundaries, disposable execution environments, capability exposure, runtime-exposed evidence, and protocol-enforced artifacts.

## What Aegis Is

Aegis treats AI systems as bounded execution units rather than autonomous agents.

The core goal is to ensure that:

- the runtime governs execution,
- modes produce bounded cognition,
- capabilities define authority,
- capability payloads remain evidence rather than memory,
- epistemic handover remains incomplete epistemic attention rather than truth,
- persistence remains explicit,
- git remains the only persistent memory,
- execution is mechanically observable.

This architecture intentionally rejects hidden persistence, implicit governance, conversational execution topology, and assistant-style repository inheritance.

## Current Architecture

Aegis is organized around a small set of clearly separated responsibilities:

| Layer | Responsibility |
|---|---|
| `AGENTS.md` | Governance constitution and operating principles |
| `runtime_aegis.sh` | Runtime orchestration, execution surface lifecycle, capability lifecycle, cleanup |
| `scripts/execute_mode.sh` | Protocol virtual machine, capability environment injection, evidence payload selection |
| `scripts/substrates/raw_llm.sh` | Readonly cognition substrate for readonly cognition modes |
| `scripts/capabilities/*` | Runtime-owned capability handlers |
| `.harness/config.sh` | Operational capability registry and runtime policy |
| `.skills/*.md` | Mode contracts |

## Execution Model

Aegis operates through runtime-owned capability environments and prepares disposable execution surfaces only for modes that require mutation-oriented infrastructure.

The runtime:

1. validates runtime policy,
2. creates an isolated execution surface when required by the active mode,
3. materializes capability environments,
4. materializes the runtime-owned capability manifest,
5. executes capability handlers,
6. materializes capability payloads,
7. executes the selected mode substrate,
8. validates the resulting artifact,
9. updates epistemic handover guidance when unresolved attention must persist,
10. cleans up transient state.

Each investigation is also defined by one runtime-consumed `AEGIS_INVESTIGATION_INPUT`, regardless of whether the operator first wrote that demand as an issue or as an informal prompt.

The execution model is intentionally deterministic and protocol-oriented.

## Capability Topology

Capabilities are not generic tools. They are runtime-owned authority surfaces.

Examples include:

- `filesystem.read`
- `filesystem.list_tree`
- `filesystem.search_symbol`
- `git.status`
- `git.diff`

Capabilities are exposed through executable handler scripts under `scripts/capabilities/`, and the runtime materializes both the capability environment and the selected manifest from `.harness/config.sh` during execution.

Runtime-owned files such as `.harness/runtime/epistemic_handover.json` are exposed through `filesystem.read` using runtime-selected paths.

The canonical contract is that the runtime decides which paths are surfaced as evidence targets and the mode consumes only the payloads that were materialized.

The read capability itself should not grow specialized runtime wrappers when a runtime-selected path is sufficient.

Operational memory uses exactly three surfaces: capability payloads as runtime-owned evidence, `.harness/runtime/epistemic_handover.json` as incomplete epistemic attention, and git as persistent memory.

## Modes

Aegis currently defines the following modes:

### Readonly cognition modes
- `discovery`
- `forensics`
- `validation`
- `adversarial`

These modes are readonly and operate on explicit capability payloads.

### Mutation modes
- `repair`
- `optimize`

These modes are bounded mutation modes and may operate only on explicitly authorized surfaces.

## Core Design Principles

Aegis is built around the following principles:

- **Runtime sovereignty** â the runtime owns orchestration and lifecycle.
- **Capability-based authority** â modes consume capabilities; they do not self-authorize.
- **Capability exposure** â repository awareness comes through runtime-exposed evidence, not implicit inheritance.
- **Operational memory discipline** â only capability payloads, epistemic handover, and git exist as operational surfaces.
- **Protocol enforcement** â outputs are validated mechanically.
- **KISS** â minimize complexity, avoid framework drift, and preserve operational clarity.

## Requirements

Aegis expects a shell environment with:

- `bash`
- `git`
- `jq`
- `curl`
- `python3`

It also expects access to a compatible OpenAI-style endpoint.

## Provider Configuration

The runtime is configured through environment variables and `.harness/config.sh`.

Typical provider settings:

```bash
export OPENAI_API_KEY="..."
export OPENAI_API_BASE="https://integrate.api.nvidia.com/v1"
```

The current runtime has been validated with NVIDIAâs OpenAI-compatible endpoint and a `meta/llama-3.3-70b-instruct` family model.

### Prompt topology and KV-cache reuse

The runtime assembles prompts with a monotonic, decreasing-half-life
layout: the constitutional preamble, skill contract and stable manifest
sit at the head, while per-request volatile segments (investigation
input, execution identity, volatile manifest metadata) are pushed to the
tail. This maximises prefix stability so any prefix-caching layer on the
serving side reuses the stable head across modes and iterations. This
layout is always on and backend-agnostic — it also helps the automatic
prefix caching of hosted endpoints such as NVIDIA NIM.

An optional `cache_salt` field can be emitted on raw-substrate requests
to cryptographically partition KV-cache reuse per surface/handover
generation (`AEGIS_ENABLE_CACHE_SALT=true`; see `derive_cache_salt` in
`scripts/lib/common.sh`). This is a **vLLM-native** parameter (vLLM
>= 0.8.3 / LMCache) and is **only meaningful against a self-hosted
vLLM+LMCache backend the operator controls** (configured with prefix
caching and `enable_blending: false`). Hosted endpoints (NVIDIA NIM,
etc.) ignore it, so it is **disabled by default** to avoid dead payload.
LMCache itself is **not** part of this repository and requires a
Linux + NVIDIA/CUDA host; it cannot run against a hosted cloud endpoint
or on Apple Silicon.

## Quick Start

Run the full runtime:

```bash
bash runtime_aegis.sh discovery "inspect runtime handover boundary"
```

Use formal issue input through the same runtime entrypoint:

```bash
bash runtime_aegis.sh discovery --issue 123
```

Run a specific mode directly:

```bash
AEGIS_INVESTIGATION_INPUT="inspect runtime handover boundary" bash scripts/execute_mode.sh   ".skills/discovery.md"   "discovery"   ".harness/runtime/epistemic_handover.json"
```

Execute a capability handler directly:

```bash
bash .harness/runtime/capability_env/filesystem.read AGENTS.md
```

Run isolated capability harnesses:

```bash
bash scripts/substrates/test/test_capabilities.sh
bash scripts/substrates/test/test_runtime_contract.sh
bash scripts/substrates/test/test_constitutional_invariants.sh
```

Run the readonly runtime smoke suite:

```bash
bash scripts/substrates/test/test_readonly_modes.sh
```

Run the mutation and promotion suites:

```bash
bash scripts/substrates/test/test_aider_substrate.sh
bash scripts/substrates/test/test_validation_and_promotion.sh
bash scripts/substrates/test/test_candidate_continuity.sh
```

Run the full test suite through npm:

```bash
npm run aegis:test
```

## Repository Structure

```text
.
âââ AGENTS.md
âââ runtime_aegis.sh
âââ scripts/
â   âââ execute_mode.sh
â   âââ substrates/
â   â   âââ raw_llm.sh
â   âââ capabilities/
â       âââ filesystem/
â       âââ git/
âââ .harness/
â   âââ config.sh
â   âââ runtime/
âââ .skills/
âââ docs/
```

## Artifact Contract

Modes emit sentinel-framed JSON artifacts.

The runtime validates:

- framing integrity,
- JSON validity,
- mode identity,
- protocol compliance.

Artifacts are treated as machine-readable execution outputs, not conversational responses.

## Operational Notes

The current design intentionally avoids:

- hidden memory systems,
- autonomous orchestration layers,
- implicit persistence,
- assistant-style repository inheritance,
- premature framework expansion.

The architecture is currently optimized for:

- deterministic execution,
- explicit authority,
- runtime-exposed evidence,
- bounded cognition,
- execution-scoped evidence surfaces.

## Current Status

Aegis is now operating as a capability-exposed runtime with:

- runtime sovereignty,
- explicit capability environments,
- capability payload evidence,
- protocol-enforced execution,
- disposable execution surfaces,
- bounded readonly cognition for readonly cognition modes,
- bounded mutation surfaces for mutation modes.

The remaining work should focus on operational hardening rather than architectural expansion.

## License

See `LICENSE.md` for licensing information.

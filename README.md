# Aegis Harness

Bounded, deterministic AI execution runtime. The runtime owns orchestration and evidence; modes only reason from exposed capability payloads and emit protocol-framed JSON. Git is the only persistent memory.

Constitution: `AGENTS.md`. Living repository map: **`summary.md`**. Epistemic doctrine: `.harness/00_architecture_core.md`. Demand-protocol **proposal** (not product): `entry.md`.

---

## Prerequisites

- `bash`, `git`, `jq`, `curl`, `python3`
- Node / npm (verify + tests)
- `ast-grep` (via npm / static gate)
- `aider` (optional; mutation modes)
- OpenAI-compatible endpoint (`OPENAI_API_BASE`, `OPENAI_API_KEY`)

---

## Quick start

```bash
export OPENAI_API_BASE="https://integrate.api.nvidia.com/v1"
export OPENAI_API_KEY="..."

# Full pipeline driver (readonly or mutation)
./run_aegis.sh discovery "inspect runtime handover boundary"
./run_aegis.sh mutation "fix the failing gate in src/"

# Single mode via runtime
bash runtime_aegis.sh discovery "inspect runtime handover boundary"
bash runtime_aegis.sh discovery --issue 123
```

Provider smoke (optional):

```bash
curl "$OPENAI_API_BASE/chat/completions" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"meta/llama-3.3-70b-instruct","messages":[{"role":"user","content":"Reply only with OK"}],"temperature":0}'
```

Optional secrets for local entrypoints: `.harness/local.env` (loaded only when `AEGIS_LOAD_LOCAL_ENV=1`; never injected into capability children).

---

## Architecture (short)

| Layer | Responsibility |
|---|---|
| `AGENTS.md` | Constitutional rules for cognition |
| `run_aegis.sh` | Operator pipeline + run outcome |
| `runtime_aegis.sh` | Lifecycle, surfaces, handover promote |
| `scripts/execute_mode.sh` | Protocol VM (envelope, evidence, substrate, validate) |
| `scripts/substrates/raw_llm.sh` | Readonly cognition |
| `scripts/substrates/aider_substrate.sh` | Bounded mutation |
| `scripts/capabilities/*` | Authority handlers → evidence payloads |
| `.harness/config.sh` | Modes, handlers, evidence profiles |
| `.skills/*.md` | Mode contracts |

**Modes:** readonly — `discovery`, `forensics`, `adversarial`, `validation`. Mutation — `repair`, `optimize`.

**Discovery evidence (product path):** `list_tree` + handover + Layer 0 facts + attention seed. Graph extractors and `structural.builder` were removed; scope uses operator paths, `required_evidence`, and Layer 0 attention.

**Demand:** `--issue N` fetches the real GitHub issue body via `gh` (not a placeholder). Optional markdown headers (`## Goal`, `## Targets`, …) get a short structured head; free-text still works. Operator-named paths are path-safety checked.

**Forensics+ content seeds:** the runtime materializes `filesystem.read` for operator-named paths and attention targets (cap `AEGIS_DETERMINISTIC_READ_MAX`) so content does not depend solely on Discovery requesting it.

**Demand tokens:** free-text investigation input is tokenized once (`aegis_demand_tokens` / dense filter) to bind `filesystem.search_symbol` (multi-token fixed-string via `;;`, never ERE) and Layer 0 content resonance (`git grep -l` on dense tokens only). Generic stems like `bytes` do not flood search/hot files. Discovery `required_evidence` is clamped to operator-named paths ∪ Layer0 seed (not arbitrary on-disk invent).

**Demand anchors:** one mechanical story — `aegis_materialize_demand_anchors_json` → prompt (human lines only), capability payload (nested JSON), handover. Structured demands add `goal` / `targets_header` / `done_when`. Evidence rank: layer0 → seed → anchors → reads → search/tools. **Discovery** is mechanical and content-aware by default (path missing / token hits / no hits; no LLM unless `AEGIS_DISCOVERY_LLM=1`). **Forensics** is mechanical by default; LLM only when multi-seed probes cannot pick a winner (`AEGIS_FORENSICS_LLM=auto`) or force `=1`. Search evidence is LLM-path only. **Repair** sees FORENSICS HANDOFF + MUTATION BRIEF. **Intent gates** on the diff (demand tokens in `+` lines, max new exports) with soft retry then warn, or `AEGIS_MUTATION_INTENT_PREFLIGHT=hard`. **Adversarial/optimize** lean. **Validation** TRIBUNAL SUMMARY.

**Operational memory (only three surfaces):** capability payloads, epistemic handover, git.

Details, file map, and capability table: **`summary.md`**. Field ownership (model vs runtime): `.skills/field_ownership.md`.

### Prompt layout

Stable head (constitution, skill, stable manifest) + volatile tail (investigation, execution identity) for prefix-cache friendliness. No cache-management state inside the harness.

---

## Tests

```bash
npm run aegis:test:fast   # core contracts (fast loop)
npm run aegis:test        # full shell suite
npm run aegis:sanity      # tsc + eslint + static enforce
```

Examples of individual harnesses:

```bash
bash scripts/substrates/test/test_capabilities.sh
bash scripts/substrates/test/test_constitutional_invariants.sh
bash scripts/substrates/test/test_readonly_modes.sh
```

---

## Principles

- **Runtime sovereignty** — orchestration stays outside the model
- **Capability authority** — modes do not self-authorize
- **Evidence discipline** — no invented repository state
- **KISS** — no hidden memory, no assistant-style repo inheritance
- **Protocol artifacts** — framed JSON, mechanically validated

---

## License

See `LICENSE.md`.

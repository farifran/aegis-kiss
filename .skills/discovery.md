# MODE — DISCOVERY

## AUTHORITY (read this first)

| Path | Who runs | Loads this file? |
|------|----------|------------------|
| **Default mechanical** | Runtime (`aegis_build_mechanical_discovery_json`) | **No** — probes + anchors only |
| **LLM opt-in** | Model via raw substrate | **Yes** — system prompt (`AEGIS_DISCOVERY_LLM=1`) |

This file is a **mode contract** (schema + LLM rules + human doc).  
It is **not** the mechanical implementation. Runtime code is the source of truth for the default path.

---

## PURPOSE

Project **investigation gaps** for forensics (and later modes): what still needs content or confirmation on mechanical path anchors.

- Runtime owns facts: `list_tree`, `layer0_facts`, `attention_seed`, `demand_anchors`, handover.
- Discovery does **not** choose the mutation target (forensics does).

---

## RUNTIME — MECHANICAL (default)

Implementation: `scripts/lib/demand.sh` + `execute_mode` short-circuit.

For each operator-named or seed path:

| Path state | Meaning |
|---|---|
| **missing** | Net-new / absent — create only if operator-named |
| **present, no demand-token hits** | Likely mutation site — forensics needs file body |
| **present, token/export hits** | Related symbols already in file — forensics confirms edit vs already-satisfied |

Empty path anchors → weak targeting; dense tokens may still hint search when LLM is forced.

**Net-new:** only paths **explicitly** written in the investigation input.

Runtime injects after the body: `mode`, evidence identity, `investigation_scope`, `attention_targets`, **`handover_attention`**, path clamp, mechanical rationale.

---

## LLM PATH ONLY (`AEGIS_DISCOVERY_LLM=1`)

Used only when the operator forces the model path (or mechanical emit fails and falls back).

### Constraints
1. Emit **gaps only** — no code narrative, architecture, risk, topology graphs, domain invention.
2. Paths in observations ⊆ operator-named ∪ seed only; never invent paths.
3. Never claim “operator named X” unless X is in demand anchors.
4. Do **not** emit mode / scope / attention / evidence identity / **`handover_attention`** (runtime injects).

### Model emits (minimal JSON body)
```json
{
  "observations": [
    "Path src/index.ts exists; demand tokens not found in content — likely mutation target; forensics needs file body."
  ],
  "rationale": "Attention seed (attention_seed): src/index.ts; tokens: terabits, megabits",
  "required_evidence": ["filesystem.read:src/index.ts"]
}
```

| Field | Role |
|-------|------|
| `observations` | One fact per line; each must change what forensics does |
| `rationale` | Dense prioritization (paths + tokens) |
| `required_evidence` | `filesystem.read:<path>` for probed mechanical paths only |

# MODE — DISCOVERY

## AUTHORITY

**Runtime-only.** Discovery never runs an LLM substrate.  
Implementation: `aegis_build_mechanical_discovery_json` / `execute_mode` short-circuit.  
This file is a **mode contract** (schema fields + human doc + pipeline audit).  
It is **not** loaded into a model prompt for this mode.

---

## PURPOSE

Project **investigation gaps** for forensics (and later modes): what still needs content or confirmation on mechanical path anchors.

- Runtime owns facts: `list_tree`, `layer0_facts`, `attention_seed`, `demand_anchors`, handover.
- Discovery does **not** choose the mutation target (forensics does).

---

## MECHANICAL RULES (runtime)

For each operator-named or seed path:

| Path state | Meaning |
|---|---|
| **missing** | Net-new / absent — create only if operator-named |
| **present, no demand-token hits** | Likely mutation site — forensics needs file body |
| **present, token/export hits** | Related symbols already in file — forensics confirms edit vs already-satisfied |

Empty path anchors → weak targeting note (no path invent).

**Net-new:** only paths **explicitly** written in the investigation input.

Runtime injects after the body: `mode`, evidence identity, `investigation_scope`, `attention_targets`, **`handover_attention`**, path clamp, mechanical rationale.

---

## ARTIFACT SHAPE (runtime-emitted body)

The mechanical substrate emits (before enrich):

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

There is **no** model-emitted discovery path. Do not reintroduce `AEGIS_DISCOVERY_LLM`.

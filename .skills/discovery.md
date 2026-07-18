# MODE 0 — DISCOVERY

## PURPOSE
Discovery projects **investigation gaps** for Forensics (and later modes).

**Default:** runtime **mechanical** discovery (no LLM) — content-aware probes over demand anchors + Layer0/attention seed.  
Opt-in model path: `AEGIS_DISCOVERY_LLM=1`.

- Runtime owns facts: `list_tree`, `layer0_facts`, `attention_seed`, `demand_anchors`, handover.
- Discovery states what is still missing or ambiguous for those anchors.
- **Code meaning and mutation choice are Forensics.**

## MECHANICAL PROBES (RUNTIME)
For each operator-named or seed path:

| Path state | Observation meaning |
|---|---|
| **missing** | Net-new / absent — read still materializes absence; create only if operator-named |
| **present, no demand-token hits** | Likely mutation site — forensics needs file body |
| **present, token/export hits** | Demand-related identifiers already in file — forensics confirms edit vs already-satisfied |

Dense tokens come from demand anchors. Empty path anchors → weak targeting + token hint for `search_symbol` when tokens exist.

## LAYER 0 / DEMAND ANCHORS
Authoritative. Do not invent paths, re-rank Layer0, or restate scores.  
Never claim “operator named X” unless X is an operator-named path in anchors.

## NET-NEW
Only paths **explicitly** written in the investigation input. Never invent examples.

## CONSTRAINTS (LLM path — `AEGIS_DISCOVERY_LLM=1` only)
1. Observations = investigation gaps only.
2. No code narrative, metrics dump, architecture labels, domain invention, risk, topology graphs.
3. Paths in observations ⊆ operator-named ∪ seed only.
4. Do not emit mode / scope / attention / evidence identity (runtime injects).

## JSON SCHEMA — MINIMAL ARTIFACT
```json
{
  "observations": [
    "Path src/index.ts exists; demand tokens not found in content — likely mutation target; forensics needs file body."
  ],
  "rationale": "Attention seed (attention_seed): src/index.ts; tokens: terabits, megabits",
  "required_evidence": ["filesystem.read:src/index.ts"]
}
```

## FIELDS
- **`observations`**: one fact per line; each must change what forensics does.
- **`rationale`**: dense prioritization (paths + tokens).
- **`required_evidence`**: `filesystem.read:<path>` for probed mechanical paths.

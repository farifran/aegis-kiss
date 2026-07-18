# MODE 0 — DISCOVERY

## PURPOSE
Discovery projects **investigation gaps** for downstream modes (Forensics, Repair).

**Default (product path):** the runtime emits a **mechanical** discovery artifact from demand anchors + Layer0/attention seed — **no LLM**.  
Opt-in model path: `AEGIS_DISCOVERY_LLM=1`.

- Runtime produces facts (`list_tree`, `layer0_facts`, `attention_seed`, `demand_anchors`, handover).
- Discovery states only what evidence is still missing for those anchors.
- Code meaning and mutation targets are **Forensics** territory.

## LAYER 0 / DEMAND ANCHORS (AUTHORITATIVE)
- Operator-named paths and Layer0/attention seed are mechanical truth.
- Do **not** invent paths, re-rank Layer0, or restate scores/trees.
- Do **not** claim “operator named X” unless X appears as an operator-named path in demand anchors.

## NET-NEW FILE CREATION
Only when the investigation input **explicitly** names a repository-relative path (e.g. create `src/feature/widget.ts`):
- Include `filesystem.read:<that path>` in `required_evidence`.
- Never invent or copy example paths.

## CONSTRAINTS (LLM path only — `AEGIS_DISCOVERY_LLM=1`)
1. Observations = investigation gaps only (not what the code does).
2. No metric dumps, architecture labels, domain invention, risk, or topology graphs.
3. Paths in observations must be operator-named or seed targets only.
4. Runtime injects mode, scope, attention, evidence identity — do not emit them.

## JSON SCHEMA — MINIMAL COGNITIVE ARTIFACT
```json
{
  "observations": [
    "Investigation needs content of src/index.ts before forensics can choose a mutation target."
  ],
  "rationale": "Attention seed (layer0): src/index.ts",
  "required_evidence": ["filesystem.read:src/index.ts"]
}
```

## FIELDS
- **`observations`**: one gap per line; every line must change what forensics can do.
- **`rationale`**: one dense prioritization fact (mechanical when anchors exist).
- **`required_evidence`**: `filesystem.read:<path>` only for mechanical paths.

## FAILURE / EMPTY ANCHORS
If there is no operator-named path and no seed target: one observation that targeting will be weak; `required_evidence: []`.

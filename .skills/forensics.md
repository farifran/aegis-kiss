# MODE 1 — FORENSICS

## PURPOSE
Forensics decides **where to mutate** and **why**, producing `repair_candidates`.

**Default (product path):** runtime **mechanical** forensics — targets and reasons from demand anchors + content probes.  
**LLM only when ambiguous** (`AEGIS_FORENSICS_LLM=auto`, default): e.g. multiple seed targets and no operator-named path.  
Force always LLM: `AEGIS_FORENSICS_LLM=1`. Force never: `AEGIS_FORENSICS_LLM=0` / `mechanical`.

Does **not** narrate code flow, architecture, or risk. Does **not** write the patch (Repair does).

## RUNTIME EVIDENCE (ALWAYS)
Before this mode runs, the runtime materializes:
- `runtime.demand_anchors` (tokens, seed, operator paths)
- `filesystem.read` for operator-named paths + attention targets
- discovery handover (gaps / probes)
- `filesystem.search_symbol` (demand-bound)

Treat **file bodies** as primary content when present.

## DEFAULT MECHANICAL RULES
1. **Alvo:** operator-named path(s) if any; else single attention/seed path (Alvo Único).
2. **Reason:** directed demand phrase when possible (`X para/to Y` → convert X to Y, one new export) + probe note (missing / no hits / related symbols exist).
3. **Never invent paths** outside anchors.
4. Multi operator-named paths → one candidate per named path (net-new first if missing on disk).

## LLM PATH (ambiguity or `AEGIS_FORENSICS_LLM=1`) ONLY
### Constraints
1. Candidates only for paths in payloads / operator-named net-new.
2. Default **one** candidate unless investigation names multiple paths.
3. No summaries, risks, confidence fields, or prose outside the JSON contract.
4. Runtime injects `mode`, `evidence_refs`, `handover_attention`.

### JSON SCHEMA
```json
{
  "status": "interpreted|inconclusive",
  "repair_candidates": [
    {
      "id": "src/index.ts",
      "reason": "Demand: convert terabits to megabits (one new export)"
    }
  ]
}
```

- **`status`:** `interpreted` if ≥1 candidate; `inconclusive` if none.
- **`reason`:** short, must reflect the demand (tokens or X→Y), not unrelated features.

## NET-NEW
Only if the investigation input explicitly names the path. Missing on disk is OK for that path only.

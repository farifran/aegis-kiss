# MODE — FORENSICS

## AUTHORITY (read this first)

| Path | Who runs | Loads this file? |
|------|----------|------------------|
| **Default mechanical** | Runtime (`aegis_build_mechanical_forensics_json` + probes) | **No** |
| **LLM residual** | Model via raw substrate | **Yes** — multi-seed probe **tie**, force `AEGIS_FORENSICS_LLM=1`, or mechanical fallthrough |

This file is a **mode contract** (schema + LLM rules + human doc).  
It is **not** the mechanical implementation. Runtime code owns Alvo Único, probe scores, and gates.

---

## PURPOSE

Decide **where to mutate** and **why** → `repair_candidates[{id,reason}]`.  
Does **not** write the patch (repair does). Does **not** narrate architecture or risk.

---

## RUNTIME — MECHANICAL (default)

Implementation: `scripts/lib/demand.sh` + `execute_mode` (`AEGIS_FORENSICS_USE_LLM=0`).

### Rules
1. **Alvo:** operator-named path(s) if any; else single seed (Alvo Único).
2. **Multi-seed:** unique content-probe winner → mechanical on that path; **tie / no signal → LLM**.
3. **Reason:** directed demand (`X para/to Y`) + probe note (missing / no hits / related symbols).
4. **Never invent paths** outside anchors.
5. Multi operator-named → one candidate per named path.

### Evidence (mechanical)
- `runtime.demand_anchors`, handover read, deterministic `filesystem.read` of anchors  
- **`filesystem.search_symbol` omitted** (not used for id/reason)

### Evidence (LLM residual)
- Same plus **`filesystem.search_symbol`** (pathspecs scoped to anchors / `src`)

Flags: `AEGIS_FORENSICS_LLM=auto|0|1` (or `mechanical` / `llm`).

Runtime injects: `mode`, `evidence_refs`, **`handover_attention`**, demand-anchor gates (alvo + reason bind).

---

## LLM PATH ONLY (probe tie / force / fallthrough)

### Constraints
1. Candidates only for paths in payloads / operator-named net-new.
2. Prefer **one** candidate unless investigation names multiple paths.
3. No summaries, risks, confidence fields, or prose outside the JSON contract.
4. Do **not** emit mode / evidence_refs / **`handover_attention`** (runtime injects).
5. `reason` must reflect the demand (tokens or X→Y), never unrelated features (e.g. invent “power”).

### Model emits (minimal JSON body)
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

| Field | Role |
|-------|------|
| `status` | `interpreted` if ≥1 candidate; `inconclusive` if none |
| `repair_candidates[].id` | Repo-relative path (anchor-scoped) |
| `repair_candidates[].reason` | Short demand-aligned reason |

### Net-new
Only if the investigation input **explicitly** names the path. Missing on disk is OK for that path only.

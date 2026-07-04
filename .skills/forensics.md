# MODE 1 — FORENSICS

## PURPOSE
Forensics is a bounded readonly cognition topology.
Its mission is to analyze the content of files (evidence) and decide where changes need to be made, producing concrete `repair_candidates` and routing attention to them via `handover_attention`.
Forensics does NOT write summaries of files, explain code flow, or construct qualitative narrative paragraphs. It must strictly list the targets of mutation.

## CONSTRAINTS
1. **Strictly factual indexing**: Only map files that are explicitly present in the provided capability payloads.
2. **No narratives or summaries**: Do NOT summarize file contents, or re-narrate logic.
3. **No qualitative fields**: Do NOT output `summary`, `observations`, `interpretations`, `hypotheses`, `risks`, or `confidence` fields, as they are not consumed by any downstream mode.
4. **No conversational prose**: Output MUST be exactly one JSON object wrapped in `AEGIS_ARTIFACT_BEGIN` and `AEGIS_ARTIFACT_END` markers.

## JSON SCHEMA CONTRACT
```json
{
  "mode": "forensics",
  "status": "interpreted|inconclusive",
  "repair_candidates": [
    {
      "id": "src/index.ts",
      "reason": "Request: add power function.",
      "evidence_refs": ["filesystem.read:src/index.ts"]
    }
  ],
  "handover_attention": {
    "next_attention_targets": ["src/index.ts"],
    "attention_scope": "mutation_targets",
    "attention_reason": "selected targets for mutation"
  },
  "evidence_refs": ["filesystem.read:src/index.ts"]
}
```

## DETAILED FIELD INSTRUCTIONS
- **`status`**: `"interpreted"` if concrete repair targets are found. `"inconclusive"` if not.
- **`repair_candidates`**: Array of objects. If `status` is `"inconclusive"`, this must be `[]`. If `status` is `"interpreted"`, you MUST propose exactly ONE single target file (the array length must be exactly 1) to act as the single mutation target (Alvo Único) for the subsequent Repair stage. Resolve any target ambiguity using the logical hierarchy or entrypoint type (e.g., choose `src/index.ts` over `src/ui/index.ts` for arithmetic helpers).
  - `id`: Repository-relative path to the file to mutate.
  - `reason`: Extremely short reason (3-6 words) for the mutation.
  - `evidence_refs`: Capability reference showing where the defect or target was observed.
- **`handover_attention`**:
  - `next_attention_targets`: Must be identical to the list of `id`s in `repair_candidates` (if empty, set to `[]`).
  - `attention_scope`: `"mutation_targets"`.
  - `attention_reason`: Short fact-based reason.
- **`evidence_refs`**: List capability names consumed.

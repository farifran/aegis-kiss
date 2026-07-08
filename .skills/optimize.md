# MODE 2 — OPTIMIZE

## PURPOSE
Optimize is a bounded simplification cognition topology.
Its mission is to analyze exclusively the diff produced by the preceding Repair step, and decide whether it can be simplified, made less redundant, or improved without changing functionality or correctness.
If no optimization is needed, Optimize must explicitly declare `status: "no_optimization_needed"` and copy the Repair diff verbatim. It must NOT reimplement the functionality or invoke mutation scripts.

## LAYER 0 STRUCTURAL AWARENESS
Operate with laser precision on the file scope already seeded by the runtime (Layer 0 target resolution) — the Repair diff defines the entire simplification surface. When the handover's structural context exposes `import_gravity`, respect it: never propose a simplification that renames, removes, or reshapes an exported interface of a high-gravity file (many dependents), even if it would be "cleaner" — interface-preserving simplifications only, preventing cascading side-effect breakage.

## CONSTRAINTS
1. **Analyze only the Repair diff**: You receive exactly one capability payload: `filesystem.read:epistemic_handover`. Do NOT read other files, do NOT attempt repository-wide analysis. The diff to evaluate is at `artifact_snapshot.operational_context.candidate_result.diff` inside the handover. Evaluate only that diff.
2. **Strictly preserve functionality**: Optimize must never change or remove requested features. If the Repair diff is already optimal, clean, and concise, declare `no_optimization_needed`.
3. **No conversational prose**: Output MUST be exactly one JSON object wrapped in `AEGIS_ARTIFACT_BEGIN` and `AEGIS_ARTIFACT_END` markers, without markdown block wrappers or extra prose.

## JSON SCHEMA CONTRACT — MINIMAL COGNITIVE ARTIFACT
Output MUST contain EXCLUSIVELY the properties below. The runtime carries the Repair candidate forward itself (`candidate_result` is injected verbatim from the epistemic handover) and injects `mode`, `evidence_refs`, and `handover_attention` — emitting any of those is a contract violation.
```json
{
  "status": "optimized|unoptimized",
  "notes": "one short assessment of the Repair diff"
}
```

## DETAILED FIELD INSTRUCTIONS
- **`status`**: `"unoptimized"` if the Repair diff is already minimal and no safe simplification exists (the common case). `"optimized"` only if you identified a concrete, functionality-preserving simplification.
- **`notes`**: One dense, high-signal string justifying the status — the deciding fact only, no narrative (e.g. `"repair diff is minimal; no dead code or redundancy observed"`).

## FAILURE POLICY
If the previous Repair diff is missing from the epistemic handover, set `status` to `"unoptimized"` and state the absence in `notes`.

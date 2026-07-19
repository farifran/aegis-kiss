# MODE — VALIDATION

## PURPOSE
Validation is a **bounded verdict** mode. The **runtime tribunal** is the sole authority for `accepted` / `rejected`. It uses the adversarial handover, intent stamps, and the demand alignment gate — not free-form model judgment.

## DEFAULT PATH (mechanical — no LLM)
By default (`AEGIS_VALIDATION_LLM=0`) the runtime emits a thin placeholder artifact and **enrich** rewrites:

- `validated_candidate` ← adversarial `candidate_result` (verbatim)
- `findings` ← adversarial findings (soft quote gate)
- `verdict` / `basis` ← tribunal ladder (empty/shape → intent → alignment → blocking findings)
- `repair_feedback` on reject (violations + `authorized_scopes`)

Opt-in residual LLM: `AEGIS_VALIDATION_LLM=1` (debug / experiments only). The tribunal still overrides the model.

## INPUT (runtime-owned)
Consume only the epistemic handover:

- `candidate_result` (diff + files_changed) — preserved as `validated_candidate`
- `findings` from adversarial
- Optional `intent_violations` on the candidate (soft-accept from repair)

Do **not** re-discover the repository or invent a new diff.

## CONSTRAINTS
1. Readonly — no mutation.
2. Reject only for real blocking issues: surviving high/medium findings, demand mismatch / alignment, or empty/invalid candidate.
3. Prefer `accepted` when findings are non-blocking after gates and alignment passes.
4. Ignore baseline TS noise outside `files_changed` and adversarial hallucinations (quote gate).
5. Model (if forced) emits only the minimal JSON below; runtime injects mode / candidate / findings / attention.

## JSON SCHEMA — MINIMAL ARTIFACT (LLM path only)
```json
{
  "verdict": "accepted|rejected",
  "basis": ["one short deciding fact"]
}
```

`findings` and `validated_candidate` are **runtime-owned** (injected at enrich). Do not invent them.

## TRIBUNAL LADDER (authoritative)
1. Empty / invalid candidate shape → `rejected` (`tribunal:empty_mutation_candidate` / `invalid_candidate_diff_shape`)
2. `intent_violations` on candidate → `rejected` + stable codes (`tribunal:demand_tokens`, `tribunal:over_export`, …)
3. Alignment gate fail → same stable codes (`demand_tokens` / `over_export` / `path_scope` / `done_when`)
4. No blocking findings after soft quote gate → `accepted` (`tribunal:accepted`)
5. Else → `rejected` (`tribunal:blocking_finding`)

Stable violation `origin` values (repair feedback): `demand_tokens`, `over_export`, `path_scope`, `done_when`, `empty_diff`, plus adversarial finding types. Legacy umbrellas `demand_mismatch` / `demand_alignment` are normalized to these codes.

Alignment matches dense tokens against **+lines**, **export names**, and **camelCase/snake stems** (e.g. `terabitsToMegabits` ↔ `terabits`).

## FAILURE POLICY
If the candidate is missing or empty, emit `rejected` with basis describing the gap. Never invent a candidate diff.

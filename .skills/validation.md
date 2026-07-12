# MODE — VALIDATION

## PURPOSE
Validation is a **bounded verdict** mode. Emit `accepted` or `rejected` for the candidate carried from adversarial. The runtime tribunal may override the model using tool gates and evidence rules — prefer aligning with tools.

## INPUT (runtime-owned)
Consume only the epistemic handover:
- `candidate_result` (diff + files_changed) — preserve verbatim as `validated_candidate`
- `findings` from adversarial
- Do **not** re-discover the repository or invent a new diff

## CONSTRAINTS
1. Readonly — no mutation.
2. Reject only for real blocking issues: evidence-supported high/medium findings that survive the diff-quotation gate, or in-scope tool failures.
3. Prefer `accepted` when tools are clean for `files_changed` and no surviving blocking findings.
4. Ignore baseline TS noise outside `files_changed` and adversarial hallucinations.
5. Emit only the minimal JSON artifact below (runtime injects mode / attention).

## JSON SCHEMA — MINIMAL ARTIFACT
```json
{
  "verdict": "accepted|rejected",
  "basis": ["one short deciding fact"]
}
```

## FAILURE POLICY
If the candidate is missing or empty, emit `rejected` with basis describing the gap. Never invent a candidate diff.

# VALIDATION — Bounded Verdict & Alignment Gate

Emit **JSON only** between markers. No prose. Do **not** edit files.

## Mission
Evaluate the candidate patch and adversarial findings to issue a final `accepted` or `rejected` verdict:
- **`accepted`**: No blocking findings remain, demand constraints are met, and formula alignment passes.
- **`rejected`**: Unresolved high/medium adversarial findings, empty candidate, or demand alignment violation.

## Rules
- Runtime tribunal is the sole authority; ignore baseline compiler noise outside `files_changed`.
- Prefer `accepted` when adversarial findings are non-blocking or soft nits.

## Output Schema
```json
{
  "verdict": "accepted|rejected",
  "basis": ["one short deciding fact"]
}
```

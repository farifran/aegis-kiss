# MODE — REPAIR

## PURPOSE
Repair is a **bounded mutation** mode. Implement exactly the investigation demand on the seeded targets (forensics `repair_candidates` / Layer 0), with minimal sufficient edits.

On a **local feedback iteration** (handover from rejected validation with `repair_feedback`), fix only the listed violations inside `authorized_scopes` — no rediscovery, no scope expansion.

## TARGETS
- Primary: forensics `repair_candidates[].id` (or `repair_feedback.authorized_scopes` on feedback).
- UNION: operator-named paths in the investigation input.
- Mutate **only** files loaded into the chat. No new files unless the demand names a net-new path.

## CONSTRAINTS
1. Minimal sufficient mutation — no speculative features or refactors.
2. **One demand → one change**: if the operator asks for one conversion/behavior, add exactly one function or edit — do not ship parallel variants (`Foo` + `FooExact`, etc.) unless both are named.
3. Preserve high-gravity exports unless the demand renames them.
4. TypeScript: NodeNext imports use `.js` extension; keep existing export names. New top-level functions use `export function` (importable), not a bare unexported function, unless the demand forbids export.
5. No narration — edits only (aider whole/diff format).
6. Feedback iterations: honor `repair_feedback.violations[]` and stay inside `authorized_scopes`.

## SUCCESS
- Demand (or listed violations) satisfied on the loaded targets.
- Surface compiles under preflight (tsc/tests) when preflight is enabled.

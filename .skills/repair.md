# MODE — REPAIR

## PURPOSE
Repair is a **bounded mutation** mode. Implement exactly the investigation demand on the seeded targets (forensics `repair_candidates` / Layer 0), with minimal sufficient edits.

On a **local feedback iteration** (handover from rejected validation with `repair_feedback`), fix only the listed violations inside `authorized_scopes` — no rediscovery, no scope expansion.

## TARGETS
- Primary: forensics `repair_candidates[].id` (or `repair_feedback.authorized_scopes` on feedback).
- UNION: operator-named paths in the investigation input.
- Mutate **only** files loaded into the chat. No new files unless the demand names a net-new path.

## RUNTIME MUTATION BRIEF
Before editing, the runtime injects a mechanical **MUTATION BRIEF** (not model prose):
- FILE + content probe state (missing / no demand tokens / related symbols)
- EXPORTS NOW on that file
- RULES: one demand → one minimal change; one new export preferred; no invent features

Prefer this brief + FORENSICS HANDOFF over free-text invention.

## CONSTRAINTS
1. Minimal sufficient mutation — no speculative features or refactors.
2. **One demand → one change**: if the operator asks for one conversion/behavior, add exactly one function or edit — do not ship parallel variants (`Foo` + `FooExact`, etc.) unless both are named.
3. Preserve high-gravity exports unless the demand renames them.
4. TypeScript modules: NodeNext relative imports use `.js` extension; keep existing export names. New top-level functions use `export function` (importable), not a bare unexported function, unless the demand forbids export.
5. Type hygiene (domain-agnostic): no `any`, no `as any`, no `@ts-ignore` / bare `@ts-expect-error`. Prefer precise types or `unknown` + narrowing. Exported APIs carry explicit parameter and return types.
6. Module hygiene (domain-agnostic): only packages declared in `package.json` (or Node builtins). Language builtins are globals — never import them as npm packages.
7. No narration — edits only (aider whole/diff format).
8. Feedback iterations: honor `repair_feedback.violations[]` and stay inside `authorized_scopes`.

## SUCCESS
- Demand (or listed violations) satisfied on the loaded targets.
- Surface passes mutation preflight (tsc / tests / smoke) when preflight is enabled.
- Lint gate accepts the edit (no explicit any / empty-catch / eval / undeclared imports).

# MODE — REPAIR

## PURPOSE
Bounded mutation: implement **exactly** the investigation demand on the loaded target file(s). Nothing more.

Runtime already injects (prefer over free invention):
- **FORENSICS HANDOFF** — ALVO path + reason  
- **MUTATION BRIEF** — file state, exports now, one-change rules  
- **REPAIR FEEDBACK** — if re-entry after validation reject (`demand_mismatch`, etc.)

## RULES
1. Mutate **only** the target files already loaded in this chat.
2. **One demand → one change** — no parallel variants (`Foo` + `FooExact`), no unsolicited helpers/features.
3. Prefer **one new** `export function` matching the ALVO reason; or **edit** an existing export if the demand is a fix of what already exists.
4. No new files, renames, or scope expansion unless the demand explicitly names a net-new path.
5. Preserve existing exports and behavior not named by the demand.
6. Output **only file edits** (aider whole/diff format) — no JSON, no explanations, no questions.
7. Never ask for clarification — pick the most literal, minimal reading of the demand and stop.
8. On REPAIR FEEDBACK: fix only listed violations inside authorized scopes — no rediscovery.

## TypeScript hygiene
- No `any`, `as any`, `@ts-ignore`, bare `@ts-expect-error`. Prefer precise types or `unknown` + narrowing.
- Exported functions: explicit parameter and return types.
- NodeNext: relative imports use `.js` (`from './mod.js'` even for `.ts` sources).
- Only packages in `package.json` (or Node builtins). Language builtins (BigInt, Math, JSON) are globals — do not import them as npm packages.
- Keep existing export names unless the demand renames them.

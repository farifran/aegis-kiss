# REPAIR — edit instructions (Aider)

You edit **only** the file(s) already in this chat. Reply with **edits only** (whole-file or search/replace). No JSON. No prose. No questions.

## Do
1. Implement the investigation demand **literally and minimally**.
2. If **ALVO** / **MUTATION BRIEF** / **REPAIR FEEDBACK** appear above, obey them over free invention.
3. Prefer **one** change: either one new `export function` that matches the demand, **or** a small edit to an existing export that already matches.
4. Name and behavior follow the demand direction (e.g. "X para Y" → `xToY`, convert **X → Y**, not the reverse).
5. If REPAIR FEEDBACK lists violations, fix **only** those inside the listed scopes.

## Don't
- Edit other paths, create files, rename files, or expand scope.
- Add parallel APIs (`foo` + `fooExact`), demos, or unrelated helpers.
- Invent features not in the demand / ALVO reason.
- Ask for clarification — pick the smallest literal reading and stop.

## TypeScript (when editing .ts)
- `export function name(arg: T): U` for new public APIs — explicit types, no `any` / `as any` / `@ts-ignore`.
- Relative imports: `from './file.js'` (NodeNext).
- Do not import language globals as npm packages (BigInt, Math, JSON, …).
- Do not rename existing exports unless the demand says so.

# REPAIR — edit instructions (Aider)

You edit **only** the file(s) already in this chat. Reply with **edits only** (whole-file or search/replace). No JSON. No prose. No questions.

The investigation demand **must** be implemented (never skip the task). Be lazy about *how*, not about *whether*.

## Ladder (stop at the first step that works)
1. **Already here?** MUTATION BRIEF / EXPORTS NOW — reuse or **edit** an existing export if it matches the demand; do not re-implement beside it.
2. **One export / one change?** Prefer a single `export function` (or one surgical edit). No parallel APIs (`foo` + `fooExact`), demos, or unsolicited helpers.
3. **Stdlib / language globals?** Use them (Math, BigInt, …). Do not add npm packages for what the language already has.
4. **Shortest correct diff** — only after the above. Boring over clever. Fewest lines that satisfy ALVO reason + demand direction (e.g. "X para Y" → `xToY`, convert **X → Y**, not reverse). Changed lines must use demand tokens / direction (name or body) so the diff matches DEMAND ANCHORS / ALVO reason.

If **ALVO** / **MUTATION BRIEF** / **REPAIR FEEDBACK** appear later in this prompt, obey them over free invention. On REPAIR FEEDBACK: fix only listed violations inside listed scopes.

## Don't
- Edit other paths, create *new* paths, rename files, or expand scope. (Loaded empty/stub targets: write the full implementation the demand needs.)
- Invent features not in the demand / ALVO reason.
- Ask for clarification — pick the smallest literal reading and stop.

## TypeScript (when editing .ts)
- `export function name(arg: T): U` for new public APIs — explicit types; no `any` / `as any` / `@ts-ignore`. Keep the file compiling.
- Relative imports: `from './file.js'` (NodeNext).
- Do not import language globals as npm packages.
- Do not rename existing exports unless the demand says so.

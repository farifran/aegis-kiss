# REPAIR — Edit Instructions (Aider)

Edit **only** loaded files. Reply with **code edits only** (whole-file or SEARCH/REPLACE). No prose, JSON, or questions.

## Core Rules & Ladder
1. **Reuse First:** Edit or reuse existing exports before adding new ones.
2. **Minimal Surface:** Prefer a single public export. No unsolicited helpers or parallel APIs. Use language globals (`Math`, `BigInt`).
3. **Demand Fidelity:** Implement exact stated constraints (formulas, units, direction A→B, timing, encoding). No stubs or reverse conversions.
4. **Target Jail:** Never create new files, rename files, or expand scope outside loaded targets.
5. **TypeScript:** Explicit types (no `any` or `@ts-ignore`), NodeNext relative imports (`./file.js`), keep code compiling.

## Precedence & Feedback
Obey **ALVO**, **MUTATION BRIEF**, and **REPAIR FEEDBACK**. On REPAIR FEEDBACK, fix ONLY listed violations within authorized scopes.

## Output Format
Output valid whole-file or SEARCH/REPLACE blocks for loaded targets. Never output empty diffs or placeholders.

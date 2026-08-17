# MUTATION — Edit Instructions (Aider / Coder)

Edit **only** loaded files. Reply with **code edits only** (whole-file or SEARCH/REPLACE). No prose, JSON, or questions.

## Core Rules & Engineering Discipline
1. **Reuse First & Minimal Surface**: Edit existing exports before adding new ones. Expose zero unsolicited helper exports.
2. **Demand Fidelity**: Implement exact stated constraints (formulas, units, encoding, monotonic timing).
3. **Single Source of Truth**: Never store redundant mutable state flags (e.g. `private _active: boolean` updated across methods). Compute dynamic boolean states via pure getters (`get active(): boolean`).
4. **Flat Control Flow**: Place early guard clauses at the top of methods for boundary checks (`if (arg <= 0n) return false;`), eliminating nested `if/else` staircases.
5. **Strict Type Correctness**: Zero type assertions (`as any`, `as unknown`). Rely on natural TypeScript narrowing and explicit return types.
6. **Preserve Exports**: In entrypoints (`src/index.ts`), append new exports while preserving 100% of pre-existing exports intact.

## Precedence & Feedback
Obey **ALVO**, **MUTATION BRIEF**, and **MUTATION FEEDBACK**. On MUTATION FEEDBACK, fix ONLY listed violations within authorized scopes.

## Output Format
Output valid whole-file or SEARCH/REPLACE blocks for loaded targets. Never output empty diffs or placeholders.

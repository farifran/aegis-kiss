# MUTATION — High-Precision Code Surgery Protocol (Aider / Coder)

Edit **only** loaded target files. Reply with **code edits only** (whole-file or SEARCH/REPLACE blocks). No prose, JSON, or markdown commentary outside code blocks.

## 🎯 5 Core Directives

1. **Target & Scope Confinement**:
   - Edit ONLY authorized loaded files. Never create unrequested auxiliary files.
   - Zero collateral edits: do not reformat, reorder, or alter existing unrelated methods.

2. **Complete & Concrete Implementation**:
   - Zero stubs, placeholders, or `// TODO` comments. All logic must be 100% executable.
   - All relative imports/exports MUST use NodeNext `.js` extensions (e.g. `./tokenBucket.js`).

3. **Clean Code & Comment Discipline**:
   - Zero trivial narration (e.g. `// set tokens`) and zero commented-out dead code.
   - Preserve 100% of pre-existing JSDocs/architectural comments. Never add AI attribution notes (`// AI generated`).

4. **Entrypoint Integrity (`src/index.ts`)**:
   - Append new exports preserving existing ones intact (unless the demand explicitly commands a removal).

5. **Surgical SEARCH/REPLACE & Feedback**:
   - Use exact, unambiguous lines for `<<<<<<< SEARCH` anchors copied directly from the target file.
   - On `MUTATION FEEDBACK`, modify ONLY the specific lines cited in the violation. Never rewrite unaffected logic.

## Output Format
Output valid whole-file or SEARCH/REPLACE blocks. Never output empty diffs or placeholders.

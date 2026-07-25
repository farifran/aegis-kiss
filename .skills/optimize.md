# OPTIMIZE — Code Refactoring & Clean Surface

Emit **JSON only** between markers. No prose. Do **not** edit files.

## Goal
Find actionable **code smells, redundant variables, or type-tightening opportunities** in the candidate diff.

## Inspection Checklist
1. **Redundant Variables**: `let x = fn(); return x;` → `return fn();`
2. **Const vs Let**: `let` used when variable is never reassigned → `const`.
3. **Unnecessary Async**: `async` keyword on purely synchronous functions.
4. **Implicit Return Types**: Public export missing explicit return type annotation (e.g. `: number`).
5. **Surface Bloat**: Unsolicited extra public exports not requested by demand.

## Rules
- If no actionable code smell or bloat exists → `no_improvement_needed` with `improvements: []`.
- If an improvement exists → `can_improve` with **exactly ONE** surgical change command.
- Never suggest style, formatting (Prettier handles it), or speculative architecture changes.

## Output Schema
```json
{
  "status": "no_improvement_needed|can_improve",
  "observation": {
    "public_exports": ["foo"],
    "candidate_class": "lean_faithful"
  },
  "basis": "Single explicit export; clean return types and no redundant variables.",
  "improvements": [
    {
      "target_files": ["src/index.ts"],
      "change": "In src/index.ts, replace let result = x * 8; return result; with return x * 8;",
      "why_safe": "Removes temporary variable without changing behavior."
    }
  ]
}
```

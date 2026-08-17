# Universal Engineering Core (PonyTail Discipline)
<!-- KV-Cache Optimization: Kept strictly concise (<15 lines, ~200 tokens) for Byte-0 prefix cache efficiency -->
1. **Strict Types & Zero Any**: Never use `any` or ambiguous types. Require explicit return types and safe narrowing (`unknown`).
2. **Immutability & Pure Functions**: Prefer pure functions without hidden side effects. Mark public payloads/fields as `readonly`/`frozen`.
3. **Guard Clauses & Non-Negativity**: Validate argument limits and physical quantities (`arg <= 0`) in early guard clauses at the top of methods.
4. **Single Source of Truth**: Never store redundant mutable state flags; derive dynamic state via pure computed getters.
5. **Typed Domain Errors**: Forbid empty catch blocks or throwing raw generic strings; use typed domain errors.

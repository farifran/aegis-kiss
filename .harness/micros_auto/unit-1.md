## Goal
Single-file micro: export obterEstadoBitmask only.
Edit only `src/tokenBucket.ts`. Parent intent: Create class in tokenBucket.ts and re-export from index.ts

## Targets
- src/tokenBucket.ts

## Tasks
- [ ] Task 1 — export obterEstadoBitmask only

## Change
- Create or update ONLY `src/tokenBucket.ts`.
- Do not create or modify any other path.
- Do not re-export from index in this run.
- Export **only** top-level `obterEstadoBitmask` in this unit (export class/function/const).
- Do **not** add other top-level exports (especially not TokenBucket — later unit); no stub `export function` siblings.
- Methods on `obterEstadoBitmask` are fine; sibling public APIs are out of scope.
- Implement the demanded API for `tokenBucket` in this file alone.
- Scope note: export_slice:obterEstadoBitmask

## Briefing
2) export function obterEstadoBitmask(bucket: TokenBucket): number:
     let mask = 0
     if (bucket.tokens === 0n) { mask |= 1 }
     if (BigInt(Date.now()) - bucket.lastUpdate < 1000n) { mask |= 2 }
     return mask

## Acceptance
- obterEstadoBitmask

## Out of scope
- other source files
- network
- UI
- e2e
- multi-file stacks
- sibling modules not listed in Targets

## Constraints
- no any
- KISS
- single target micro unit only
- prefer focused public surface (class methods need not be top-level exports)
- do not delete pre-existing barrel exports unrelated to this demand
- NodeNext .js imports if this file imports siblings
- BigInt is global when high-precision time is required
- no any / as any / @ts-ignore
- NodeNext: .js extension in relative imports
- only packages in package.json; builtins are global

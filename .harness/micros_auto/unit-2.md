## Goal
Single-file micro: reexport only.
Edit only `src/index.ts`. Parent intent: Create TokenBucket class in tokenBucket.ts and re-export from index.ts

## Targets
- src/index.ts

## Tasks
- [ ] Task 1 — reexport only

## Change
- Update ONLY `src/index.ts`.
- Import and re-export from './tokenBucket.js': TokenBucket, obterEstadoBitmask (NodeNext `.js` relative import).
- Do not re-implement the algorithm in this file.
- Do not create or modify any other path.
- Do not delete or demote pre-existing barrel exports unrelated to this demand.
- Scope note: after create succeeds

## Briefing
Em src/index.ts:
   import { TokenBucket, obterEstadoBitmask } from './tokenBucket.js'
   export { TokenBucket, obterEstadoBitmask }

## Acceptance
- TokenBucket
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

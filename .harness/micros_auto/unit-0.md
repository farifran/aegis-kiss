## Goal
Single-file micro: create src/tokenBucket.ts.
Edit only `src/tokenBucket.ts`. Parent intent: Crie um novo arquivo em src/tokenBucket.ts que implemente um limitador de taxa baseado no algoritmo Token Bucket de alta precisão para controle offline-first. O bucket deve acumular tokens baseados em uma taxa de consumo

## Targets
- src/tokenBucket.ts

## Tasks
- [ ] Task 1 — create src/tokenBucket.ts

## Change
- Create or update ONLY `src/tokenBucket.ts`.
- Do not create or modify any other path.
- Do not re-export from index in this run.
- Implement the demanded API for `tokenBucket` in this file alone.
- Prefer one public named export (class or function); methods on that export are fine.
- Scope note: create module only; omit reexport

## Acceptance
- tokenBucket
- TokenBucket

## Out of scope
- other source files
- network
- UI
- e2e
- multi-file stacks

## Constraints
- no any
- KISS
- single target micro unit only
- one primary public export preferred (methods allowed)
- NodeNext .js imports if this file imports siblings
- BigInt is global when high-precision time is required

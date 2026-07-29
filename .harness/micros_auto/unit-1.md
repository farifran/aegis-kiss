## Goal
Single-file micro: reexport only.
Edit only `src/index.ts`. Parent intent: Crie um novo arquivo em que implemente um limitador de taxa baseado no algoritmo Token Bucket de alta precisão para controle offline-first. O bucket deve acumular tokens baseados em uma taxa de consumo em bits por miliss

## Targets
- src/index.ts

## Tasks
- [ ] Task 1 — reexport only

## Change
- Update ONLY `src/index.ts`.
- Import and re-export the public API already created in the sibling module (NodeNext `.js` relative import).
- Do not re-implement the algorithm in this file.
- Do not create or modify any other path.
- Scope note: after create succeeds

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

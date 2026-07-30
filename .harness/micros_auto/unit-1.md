## Goal
Single-file micro: reexport only.
Edit only `src/index.ts`. Parent intent: Crie com a classe TokenBucket. Use bigint com BigInt(Date.now()). Construtor aceita (maxBytes: bigint, mbps: number) e converte para rateBitsPerMs (mbps*8000). Em update(), acumule timeDiff*rateBitsPerMs limitando ao max

## Targets
- src/index.ts

## Tasks
- [ ] Task 1 — reexport only

## Change
- Update ONLY `src/index.ts`.
- Import and re-export the public API (e.g. `export { TokenBucket } from './tokenBucket.js';`) already created in the sibling module (NodeNext `.js` relative import).
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

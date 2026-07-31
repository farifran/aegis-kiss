## Goal
Single-file micro: create src/tokenBucket.ts.
Edit only `src/tokenBucket.ts`. Parent intent: Crie src/tokenBucket.ts com a classe TokenBucket. Use bigint com BigInt(Date.now()). Construtor aceita (maxBytes: bigint, mbps: number) e converte para rateBitsPerMs (mbps*8000). Em update(), acumule timeDiff*rateBitsPer

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
- maxBytes
- maxTokens
- obterEstadoBitmask
- rateBitsPerMs

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
- one primary public export preferred (methods allowed)
- NodeNext .js imports if this file imports siblings
- BigInt is global when high-precision time is required
- no any / as any / @ts-ignore
- NodeNext: .js extension in relative imports
- only packages in package.json; builtins are global

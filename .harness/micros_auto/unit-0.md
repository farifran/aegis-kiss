## Goal
Single-file micro: create src/tokenBucket.ts.
Edit only `src/tokenBucket.ts`. Parent intent: create src/tokenBucket.ts

## Targets
- src/tokenBucket.ts

## Tasks
- [ ] Task 1 — create src/tokenBucket.ts

## Change
- Create or update ONLY `src/tokenBucket.ts`.
- Do not create or modify any other path.
- Do not re-export from index in this run.
- ## Goal
- ## Goal
- ## Targets
- src/tokenBucket.ts
- ## Acceptance
- TokenBucket
- obterEstadoBitmask
- ## Briefing
- Scope note: create module only; omit reexport

## Briefing
- Em src/tokenBucket.ts:
  - Defina a classe exportada TokenBucket.
  - Altere todos os campos de saldo/timestamp para bigint usando BigInt(Date.now()).
  - Construtor aceita (maxBytes: bigint, mbps: number) e converte para rateBitsPerMs (mbps * 8000).
  - Em update(), acumule (timeDiff * rateBitsPerMs) limitando o saldo a maxTokens.
  - Em consume(bits: bigint): boolean, execute update() e deduza do saldo.
  - Exporte a função obterEstadoBitmask(bucket: TokenBucket): number (bit 0 se tokens==0n, bit 1 se refil recente).
- Em src/index.ts:
  - Re-exporte TokenBucket e obterEstadoBitmask de './tokenBucket.js'.

## Acceptance
- tokenBucket
- TokenBucket
- obterEstadoBitmask

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
- no any / as any / @ts-ignore
- NodeNext: .js extension in relative imports
- only packages in package.json; builtins are global

## Goal
Single-file micro: mutate src/index.ts.
Edit only `src/index.ts`. Parent intent: mutate src/index.ts

## Targets
- src/index.ts

## Tasks
- [ ] Task 1 — mutate src/index.ts

## Change
- Update ONLY `src/index.ts`.
- Import and re-export the public API (e.g. `export { TokenBucket } from './tokenBucket.js';`) already created in the sibling module (NodeNext `.js` relative import).
- Do not re-implement the algorithm in this file.
- Do not create or modify any other path.
- Scope note: single-target micro unit

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

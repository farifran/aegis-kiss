## Goal
Single-file micro: create src/eventEmitter.ts.
Edit only `src/eventEmitter.ts`. Parent intent: # Issue: Implementação do EventEmitter & Barramento PubSub com Prioridades (src/eventEmitter.ts) ## Descrição Implementar uma classe EventEmitter fortemente tipada com suporte a listeners prioritários, emissão síncrona/a

## Targets
- src/eventEmitter.ts

## Tasks
- [ ] Task 1 — create src/eventEmitter.ts

## Change
- Create or update ONLY `src/eventEmitter.ts`.
- Do not create or modify any other path.
- Do not re-export from index in this run.
- Prefer **one** new top-level export (avoid parallel public APIs; methods on one export ok).
- # Issue: Implementação do EventEmitter & Barramento PubSub com Prioridades (src/eventEmitter.ts) ## Descrição Implementar uma classe EventEmitter fortemente tipada com suporte a listeners prioritários
- Implement demand in Targets only
- Scope note: create module only; omit reexport

## Acceptance
- eventEmitter
- EventEmitter

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

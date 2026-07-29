## Goal
Single-file micro: mutate src/index.ts.
Edit only `src/index.ts`. Parent intent: # Issue: Implementação do Servidor HTTP, Parser & Roteador Middleware () ## Descrição Implementar um servidor HTTP, parser de requisições cruas, formatador de respostas e roteador com suporte a middlewares em `src/httpSe

## Targets
- src/index.ts

## Tasks
- [ ] Task 1 — mutate src/index.ts

## Change
- Create or update ONLY `src/index.ts`.
- Do not create or modify any other path.
- Do not re-export from index in this run.
- Prefer **one** new top-level export (avoid parallel public APIs; methods on one export ok).
- Implement demand in Targets only
- Scope note: single-target micro unit

## Acceptance
- index
- Index
- httpServer

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

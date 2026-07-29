## Goal
Single-file micro: create src/httpServer.ts.
Edit only `src/httpServer.ts`. Parent intent: # Issue: Implementação do Servidor HTTP, Parser & Roteador Middleware (src/httpServer.ts) ## Descrição Implementar um servidor HTTP, parser de requisições cruas, formatador de respostas e roteador com suporte a middlewar

## Targets
- src/httpServer.ts

## Tasks
- [ ] Task 1 — create src/httpServer.ts

## Change
- Create or update ONLY `src/httpServer.ts`.
- Do not create or modify any other path.
- Do not re-export from index in this run.
- Prefer **one** new top-level export (avoid parallel public APIs; methods on one export ok).
- # Issue: Implementação do Servidor HTTP, Parser & Roteador Middleware (src/httpServer.ts) ## Descrição Implementar um servidor HTTP, parser de requisições cruas, formatador de respostas e roteador com
- Implement demand in Targets only
- Scope note: create module only; omit reexport

## Acceptance
- HTTPServer
- HTTPRequest
- HTTPResponse

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

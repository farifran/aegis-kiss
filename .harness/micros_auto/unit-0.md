## Goal
Single-file micro: export TokenBucket only.
Edit only `src/tokenBucket.ts`. Parent intent: Create TokenBucket class in tokenBucket.ts and re-export from index.ts

## Targets
- src/tokenBucket.ts

## Tasks
- [ ] Task 1 — export TokenBucket only

## Change
- Create or update ONLY `src/tokenBucket.ts`.
- Do not create or modify any other path.
- Do not re-export from index in this run.
- Export **only** top-level `TokenBucket` in this unit (export class/function/const).
- Do **not** add other top-level exports (especially not obterEstadoBitmask — later unit); no stub `export function` siblings.
- Methods on `TokenBucket` are fine; sibling public APIs are out of scope.
- Implement the demanded API for `tokenBucket` in this file alone.
- Scope note: export_slice:TokenBucket

## Briefing
1) export class TokenBucket:
   Campos privados: _maxTokens: bigint, _rateBitsPerMs: bigint, _tokens: bigint, _lastUpdate: bigint
   constructor(maxBytes: bigint, mbps: number):
     this._maxTokens = maxBytes * 8n
     this._rateBitsPerMs = BigInt(Math.floor(mbps * 8000))
     this._tokens = this._maxTokens
     this._lastUpdate = BigInt(Date.now())
   update(): void:
     const now = BigInt(Date.now())
     const timeDiff = now - this._lastUpdate
     this._lastUpdate = now
     let newTokens = this._tokens + timeDiff * this._rateBitsPerMs
     if (newTokens > this._maxTokens) { newTokens = this._maxTokens }
     this._tokens = newTokens
   consume(bits: bigint): boolean:
     this.update()
     if (this._tokens >= bits) { this._tokens -= bits; return true }
     return false
   get tokens(): bigint { return this._tokens }
   get maxTokens(): bigint { return this._maxTokens }
   get lastUpdate(): bigint { return this._lastUpdate }

## Acceptance
- TokenBucket

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

## Goal
Single-file micro: export TokenBucket only.
Edit only `src/tokenBucket.ts`. Parent intent: Create TokenBucket class and bitmask helper in tokenBucket module and re-export from index

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
   Campos privados: _maxTokens: bigint, _rateBitsPerMs: number, _tokens: bigint, _lastUpdate: bigint, _refillActive: boolean
   constructor(maxBytes: bigint, mbps: number):
     this._maxTokens = maxBytes * 8n
     this._rateBitsPerMs = mbps * 8000
     this._tokens = this._maxTokens
     this._lastUpdate = BigInt(Date.now())
     this._refillActive = false
   update(): void:
     const now = BigInt(Date.now())
     const timeDiff = Number(now - this._lastUpdate)
     if (timeDiff > 0) { this._tokens += BigInt(Math.floor(timeDiff * this._rateBitsPerMs)); this._lastUpdate = now; this._refillActive = true }
     if (this._tokens > this._maxTokens) { this._tokens = this._maxTokens; this._refillActive = false }
   consume(bits: bigint): boolean:
     this.update()
     if (this._tokens >= bits) { this._tokens -= bits; return true }
     return false
   get tokens(): bigint { return this._tokens }
   get refillActive(): boolean { return this._refillActive }

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
- TypeScript types are lowercase (bigint, number, string, boolean) — never BigInt/Number/String/Boolean as types; BigInt(x) as a call is OK
- NEVER Math.min/Math.max/Math.floor/Math.ceil on bigint values — clamp with if (x > max) { x = max }; use BigInt(Date.now()) for time
- Outside a class, never read private fields (_name) — expose getters and use those in helpers
- Private fields start with underscore and are not Acceptance exports
- BigInt is global when high-precision time is required
- Prefer one top-level export per micro unit; methods on a class are fine

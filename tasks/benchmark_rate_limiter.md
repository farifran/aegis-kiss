# Benchmark Demand: SlidingWindowRateLimiter (src/rateLimiter.ts)

> Demanda de A/B para validar o Aegis com/sem harness.
> Mesmo input nos dois braços. Armadilhas embutidas (truncamento BigInt,
> alinhamento de janela, re-export) que um passe único tende a errar.

## Goal
Crie src/rateLimiter.ts e re-exporte tudo no src/index.ts.

## Targets
- src/index.ts
- src/rateLimiter.ts

## Acceptance
- RateLimiter
- estimateBackoffMs

## Briefing
Em src/rateLimiter.ts, dois exports top-level:

1) export class RateLimiter:
   Campos privados: _limit: number, _windowMs: number, _count: number, _windowStart: bigint.
   constructor(limit: number, windowMs: number):
     this._limit = limit
     this._windowMs = windowMs
     this._count = 0
     this._windowStart = BigInt(Date.now())
   _advance(nowMs: bigint): void:
     const windowMs = BigInt(this._windowMs)
     let start = this._windowStart
     while (start + windowMs <= nowMs) { start += windowMs; this._count = 0 }
     this._windowStart = start
   allow(nowMs?: bigint): boolean:
     const now = nowMs ?? BigInt(Date.now())
     this._advance(now)
     if (this._count < this._limit) { this._count += 1; return true }
     return false
   reset(): void { this._count = 0; this._windowStart = BigInt(Date.now()) }
   get remaining(): number { return this._limit - this._count }
   get windowMs(): number { return this._windowMs }
   get windowStart(): bigint { return this._windowStart }

2) export function estimateBackoffMs(limiter: RateLimiter, nowMs: bigint): bigint:
   const windowMs = BigInt(limiter.windowMs)
   const position = (nowMs - limiter.windowStart) % windowMs
   if (position < 0n) return 0n
   return windowMs - position

Em src/index.ts:
   import { RateLimiter, estimateBackoffMs } from './rateLimiter.js'
   export { RateLimiter, estimateBackoffMs }

## Out of scope
- unrelated files
- e2e tests
- drive-by refactors

## Constraints
- no any / as any / @ts-ignore
- NodeNext: .js extension in relative imports
- BigInt is global
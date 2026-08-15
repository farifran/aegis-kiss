import { readFile } from 'node:fs/promises'
import { RateLimiter, estimateBackoffMs } from '../../src/rateLimiter.ts'

let failures = 0
let checks = 0

function assert(condition: boolean, label: string): void {
  checks += 1
  if (!condition) {
    failures += 1
    console.error(`  [FAIL] ${label}`)
  } else {
    console.log(`  [PASS] ${label}`)
  }
}

function assertBigInt(value: unknown, label: string): void {
  assert(typeof value === 'bigint', label)
}

console.log('verify_rate_limiter')

const windowMs = 1000n
const limiter = new RateLimiter(2, Number(windowMs))
const ws = limiter.windowStart

assert(limiter.allow(ws) === true, 'allow #1 within window')
assert(limiter.allow(ws + 100n) === true, 'allow #2 within window')
assert(limiter.allow(ws + 200n) === false, 'allow #3 rejected (limit 2)')

assert(limiter.allow(ws + windowMs) === true, 'window rollover resets count')

assert(limiter.remaining === 1, 'remaining decremented after 2 allows + rollover reset')

const backoffLimiter = new RateLimiter(5, 1000)
const bws = backoffLimiter.windowStart

const now = bws + 100n
const expectedBackoff = 900n
const actualBackoff = estimateBackoffMs(backoffLimiter, now)
assertBigInt(actualBackoff, 'estimateBackoffMs returns bigint')
assert(actualBackoff === expectedBackoff, `backoff aligned to windowStart (got ${actualBackoff}, want ${expectedBackoff})`)

const rollover = bws + windowMs
const expectedRolloverBackoff = 1000n
const actualRolloverBackoff = estimateBackoffMs(backoffLimiter, rollover)
assert(
  actualRolloverBackoff === expectedRolloverBackoff,
  `backoff at boundary (got ${actualRolloverBackoff}, want ${expectedRolloverBackoff})`,
)

const emptyLimiter = new RateLimiter(1, 1000)
emptyLimiter.reset()
assert(emptyLimiter.remaining === 1, 'reset() restores remaining')

const indexSource = await readFile(
  new URL('../../src/index.ts', import.meta.url),
  'utf8',
).catch(() => '')
const reexportsRateLimiter = /\bRateLimiter\b/.test(indexSource)
const reexportsBackoff = /\bestimateBackoffMs\b/.test(indexSource)
const nodeNextImport = /from\s+['"]\.\/rateLimiter\.js['"]/.test(indexSource)
assert(reexportsRateLimiter, 'RateLimiter re-exported from index (source)')
assert(reexportsBackoff, 'estimateBackoffMs re-exported from index (source)')
assert(nodeNextImport, 'index uses NodeNext .js relative import')

console.log(`\n${checks} checks, ${failures} failures`)
if (failures > 0) {
  throw new Error(`rate_limiter_verification_failed: ${failures} check(s)`)
}

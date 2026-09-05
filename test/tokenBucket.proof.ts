import assert from 'node:assert/strict';
import { TokenBucket, obterEstadoBitmask } from '../src/index.js';

// ---------------------------------------------------------
// PO-TB-INVARIANT-001: 0n <= tokens <= maxTokens
// ---------------------------------------------------------
{
  const maxBytes = 100n;
  const mbps = 1;
  const bucket = new TokenBucket(maxBytes, mbps);

  // Invariant at rest after construction
  assert.ok(bucket.tokens >= 0n && bucket.tokens <= bucket.maxTokens, 'invariant violated after init');
  assert.equal(bucket.maxTokens, 800n, 'maxTokens must be maxBytes * 8n');
  assert.equal(bucket.tokens, 800n, 'bucket must start full');
  assert.equal(bucket.rateBitsPerMs, 8000n, 'rateBitsPerMs must be 8000n for 1 mbps');

  // Invariant under consumption
  const consumed = bucket.consume(300n);
  assert.equal(consumed, true);
  assert.ok(bucket.tokens >= 0n && bucket.tokens <= bucket.maxTokens, 'invariant violated after consume');

  // Invariant when consuming more than capacity
  const rejected = bucket.consume(1000n);
  assert.equal(rejected, false);
  assert.ok(bucket.tokens >= 0n && bucket.tokens <= bucket.maxTokens, 'invariant violated after rejected consume');

  // Invariant under extreme time jumps (clamping to maxTokens)
  const future = bucket.lastUpdate + 1000000n;
  bucket.update(future);
  assert.equal(bucket.tokens, bucket.maxTokens, 'tokens must not exceed maxTokens on overflow refill');
  assert.ok(bucket.tokens >= 0n && bucket.tokens <= bucket.maxTokens, 'invariant violated after overflow update');
}

// ---------------------------------------------------------
// PO-TB-BEHAVIOR-001: update and consume behavior
// ---------------------------------------------------------
{
  const maxBytes = 50n; // 400 bits
  const mbps = 0.5; // 4000 bits/ms
  const bucket = new TokenBucket(maxBytes, mbps);
  const t0 = bucket.lastUpdate;

  // Consume all tokens
  const ok1 = bucket.consume(400n, t0);
  assert.equal(ok1, true);
  assert.equal(bucket.tokens, 0n);

  // At same timestamp, consume must fail
  const ok2 = bucket.consume(10n, t0);
  assert.equal(ok2, false);
  assert.equal(bucket.tokens, 0n);

  // Advance 1ms -> should add 4000 bits, but capped at 400 bits
  bucket.update(t0 + 1n);
  assert.equal(bucket.tokens, 400n);

  // Advance with rate = 0
  const zeroBucket = new TokenBucket(10n, 0);
  const zt0 = zeroBucket.lastUpdate;
  assert.equal(zeroBucket.rateBitsPerMs, 0n);
  zeroBucket.consume(80n, zt0);
  assert.equal(zeroBucket.tokens, 0n);
  zeroBucket.update(zt0 + 1000n);
  assert.equal(zeroBucket.tokens, 0n, 'zero rate bucket must not refill');

  // Fail semantics: negative inputs
  assert.throws(() => new TokenBucket(-1n, 10), RangeError);
  assert.throws(() => new TokenBucket(10n, -1), RangeError);
  assert.throws(() => bucket.consume(-1n), RangeError);
}

// ---------------------------------------------------------
// PO-TB-BITMASK-001: obterEstadoBitmask mapping
// ---------------------------------------------------------
{
  // Case 1: tokens > 0n and rate > 0n => bit 0 is 0, bit 1 is 1 => mask = 2
  const b1 = new TokenBucket(10n, 1);
  assert.equal(obterEstadoBitmask(b1), 2, 'expected mask 2 (active refill, non-empty)');

  // Case 2: tokens == 0n and rate > 0n => bit 0 is 1, bit 1 is 1 => mask = 3
  b1.consume(80n, b1.lastUpdate);
  assert.equal(b1.tokens, 0n);
  assert.equal(obterEstadoBitmask(b1), 3, 'expected mask 3 (empty bucket, active refill)');

  // Case 3: tokens == 0n and rate == 0n => bit 0 is 1, bit 1 is 0 => mask = 1
  const b2 = new TokenBucket(10n, 0);
  b2.consume(80n, b2.lastUpdate);
  assert.equal(b2.tokens, 0n);
  assert.equal(b2.rateBitsPerMs, 0n);
  assert.equal(obterEstadoBitmask(b2), 1, 'expected mask 1 (empty bucket, refill inactive)');

  // Case 4: tokens > 0n and rate == 0n => bit 0 is 0, bit 1 is 0 => mask = 0
  const b3 = new TokenBucket(10n, 0);
  assert.equal(b3.tokens, 80n);
  assert.equal(b3.rateBitsPerMs, 0n);
  assert.equal(obterEstadoBitmask(b3), 0, 'expected mask 0 (non-empty, refill inactive)');
}

console.log('[AEGIS][PROOF][PASS] TokenBucket mathematical obligations verified.');

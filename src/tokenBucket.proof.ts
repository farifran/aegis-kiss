import assert from 'node:assert/strict';
import process from 'node:process';
import { TokenBucket, obterEstadoBitmask } from './index.js';

const origin = 1_000n;

{
  const bucket = new TokenBucket(100n, 1, origin);
  assert.equal(bucket.maxTokens, 800n);
  assert.equal(bucket.tokens, 800n);
  assert.equal(bucket.consume(300n, origin), true);
  assert.equal(bucket.tokens, 500n);
  bucket.update(origin + 1_000_000n);
  assert.equal(bucket.tokens, bucket.maxTokens);
  assert.ok(bucket.tokens >= 0n && bucket.tokens <= bucket.maxTokens);
}

{
  const bucket = new TokenBucket(10n, 0.001, origin);
  assert.equal(bucket.consume(80n, origin), true);
  assert.equal(bucket.tokens, 0n);
  assert.equal(bucket.consume(9n, origin + 1n), false);
  assert.equal(bucket.tokens, 8n, 'rejected consumption may refill but must not deduct');
  assert.throws(() => bucket.update(origin), RangeError);
  assert.equal(bucket.tokens, 8n, 'regressive time must preserve state');
  assert.throws(() => new TokenBucket(1n, 0.00001), RangeError);
  assert.throws(() => bucket.consume(-1n, origin + 1n), RangeError);
}

{
  const b1 = new TokenBucket(10n, 1, origin);
  assert.equal(obterEstadoBitmask(b1), 2);
  assert.equal(b1.consume(80n, origin), true);
  assert.equal(obterEstadoBitmask(b1), 3);

  const b2 = new TokenBucket(10n, 0, origin);
  assert.equal(b2.consume(80n, origin), true);
  assert.equal(obterEstadoBitmask(b2), 1);

  const b3 = new TokenBucket(10n, 0, origin);
  assert.equal(obterEstadoBitmask(b3), 0);
}

process.stdout.write('[AEGIS][PROOF][PASS] TokenBucket mathematical obligations verified.\n');


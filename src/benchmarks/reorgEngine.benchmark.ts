import { performance } from 'node:perf_hooks';
import { env, memoryUsage, stdout } from 'node:process';
import { ReorgEngine, type BlockHeader } from '../index.js';

const requestedSize = Reflect.get(env, 'AEGIS_BENCHMARK_SIZE');
const size = Number(requestedSize ?? 1000);
if (!Number.isInteger(size) || size <= 0) throw new RangeError('AEGIS_BENCHMARK_SIZE must be a positive integer');

const blocks: BlockHeader[] = [];
for (let height = 0; height < size; height++) {
  blocks.push({
    hash: `bench_${height}`,
    prevHash: height === 0 ? '' : `bench_${height - 1}`,
    height,
    txids: height === 0 ? ['bench_tx'] : [],
    timestampMs: BigInt(height + 1)
  });
}

let inputDigest = 0xcbf29ce484222325n;
for (const block of blocks) {
  for (const character of block.hash) {
    inputDigest ^= BigInt(character.charCodeAt(0));
    inputDigest = (inputDigest * 0x100000001b3n) & 0xFFFFFFFFFFFFFFFFn;
  }
}

const engine = new ReorgEngine(100, { maxPendingBlocks: size + 1 });
engine.subscribe('bench_sub', 'bench_tx', 'bench_user', size);
const started = performance.now();
const result = engine.processBatch(blocks, BigInt(size + 1));
const elapsedMs = performance.now() - started;
const memory = memoryUsage();

stdout.write(`${JSON.stringify({
  input_digest: inputDigest.toString(16).padStart(16, '0'),
  requested_blocks: size,
  committed_blocks: result.committedCount,
  elapsed_ms: Number(elapsedMs.toFixed(3)),
  throughput_blocks_per_second: Number((result.committedCount / Math.max(elapsedMs / 1000, 0.000001)).toFixed(2)),
  heap_used_bytes: memory.heapUsed,
  invariant_valid: engine.verifyInvariants().valid
})}\n`);


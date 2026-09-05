#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { buildPreflight, semanticRequest } from './lib/preflight_core.mjs';

const root = resolve(process.env.AEGIS_ROOT ?? fileURLToPath(new URL('..', import.meta.url)));
let target = '';
let internalEnvelope = false;
for (let index = 2; index < process.argv.length;) {
  if (process.argv[index] === '--internal-envelope') {
    internalEnvelope = true;
    index += 1;
  } else if (process.argv[index] === '--target' && typeof process.argv[index + 1] === 'string') {
    target = process.argv[index + 1];
    index += 2;
  } else {
    process.stderr.write('[AEGIS][PREFLIGHT][FATAL] invalid_arguments\n');
    process.exit(1);
  }
}

try {
  const startedAtEpochMs = Date.now();
  const started = performance.now();
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const envelope = await buildPreflight(Buffer.concat(chunks), target, root);
  const output = internalEnvelope
    ? envelope
    : semanticRequest(envelope, {
      phase: 'preflight',
      startedAtEpochMs,
      durationMs: Math.round((performance.now() - started) * 1000) / 1000,
    });
  process.stdout.write(JSON.stringify(output) + '\n');
} catch (error) {
  const code = error instanceof Error ? error.message : 'preflight_failed';
  process.stderr.write('[AEGIS][PREFLIGHT][FATAL] ' + code + '\n');
  process.exit(1);
}

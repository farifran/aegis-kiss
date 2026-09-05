#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { buildPreflight, normalizeDemand, semanticRequest } from './lib/preflight_core.mjs';

const root = resolve(process.env.AEGIS_ROOT ?? fileURLToPath(new URL('..', import.meta.url)));
let target = '';
let internalEnvelope = false;
let saveEnvelope = false;
let digestOnly = false;
let changeKind = 'PRODUCT';
for (let index = 2; index < process.argv.length;) {
  if (process.argv[index] === '--internal-envelope') {
    internalEnvelope = true;
    index += 1;
  } else if (process.argv[index] === '--save-envelope') {
    saveEnvelope = true;
    index += 1;
  } else if (process.argv[index] === '--digest-only') {
    digestOnly = true;
    index += 1;
  } else if (process.argv[index] === '--kind' && ['PRODUCT', 'HARNESS'].includes(process.argv[index + 1])) {
    changeKind = process.argv[index + 1];
    index += 2;
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
  const rawDemand = Buffer.concat(chunks);
  if (digestOnly) {
    if (internalEnvelope || saveEnvelope || target.length > 0) throw new Error('invalid_digest_only_combination');
    process.stdout.write(`${normalizeDemand(rawDemand).digest}\n`);
    process.exit(0);
  }
  const envelope = await buildPreflight(rawDemand, target, root, changeKind);
  const timing = {
    phase: 'preflight',
    startedAtEpochMs,
    durationMs: Math.round((performance.now() - started) * 1000) / 1000,
  };
  const frozenEnvelope = { ...envelope, timing };
  if (saveEnvelope) {
    const runtimeDirectory = resolve(root, '.harness/runtime');
    const envelopePath = resolve(runtimeDirectory, 'preflight_envelope.json');
    const temporaryPath = `${envelopePath}.${process.pid}.tmp`;
    await mkdir(runtimeDirectory, { recursive: true });
    const previousArtifacts = await readdir(runtimeDirectory);
    await Promise.all(previousArtifacts.map((name) => rm(resolve(runtimeDirectory, name), { force: true, recursive: true })));
    await writeFile(temporaryPath, `${JSON.stringify(frozenEnvelope)}\n`, 'utf8');
    await rename(temporaryPath, envelopePath);
  }
  const output = internalEnvelope
    ? frozenEnvelope
    : semanticRequest(frozenEnvelope, timing);
  process.stdout.write(JSON.stringify(output) + '\n');
} catch (error) {
  const code = error instanceof Error ? error.message : 'preflight_failed';
  process.stderr.write('[AEGIS][PREFLIGHT][FATAL] ' + code + '\n');
  process.exit(1);
}

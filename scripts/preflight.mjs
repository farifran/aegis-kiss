#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { buildPreflight, maxDemandBytes, normalizeDemand, semanticRequest } from './lib/preflight_core.mjs';
import { canonicalDigest } from './lib/canonical_json.mjs';

const root = resolve(process.env.AEGIS_ROOT ?? fileURLToPath(new URL('..', import.meta.url)));
let target = '';
let internalEnvelope = false;
let saveEnvelope = false;
let digestOnly = false;
let changeKind = 'PRODUCT';
let supervisorMode = 'IDE';
let supervisorId = 'ide-active-model';
let supervisorConfigDigest = '';
const runtimeLockName = 'preflight.lock';
const staleLockMs = 120_000;
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
  } else if (process.argv[index] === '--supervisor-mode' && ['IDE', 'EXTERNAL'].includes(process.argv[index + 1])) {
    supervisorMode = process.argv[index + 1];
    index += 2;
  } else if (process.argv[index] === '--supervisor-id' && typeof process.argv[index + 1] === 'string') {
    supervisorId = process.argv[index + 1];
    index += 2;
  } else if (process.argv[index] === '--supervisor-config-digest' && /^[a-f0-9]{64}$/.test(process.argv[index + 1] ?? '')) {
    supervisorConfigDigest = process.argv[index + 1];
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
  let total = 0;
  for await (const chunk of process.stdin) {
    total += chunk.length;
    if (total > maxDemandBytes) throw new Error('input_too_large');
    chunks.push(chunk);
  }
  const rawDemand = Buffer.concat(chunks);
  if (digestOnly) {
    if (internalEnvelope || saveEnvelope || target.length > 0) throw new Error('invalid_digest_only_combination');
    process.stdout.write(`${normalizeDemand(rawDemand).digest}\n`);
    process.exit(0);
  }
  if (!digestOnly && supervisorConfigDigest.length === 0) {
    supervisorConfigDigest = canonicalDigest({ schema: 'aegis.supervisor_config.v1', mode: 'IDE' });
  }
  const envelope = await buildPreflight(rawDemand, target, root, changeKind, {
    mode: supervisorMode,
    id: supervisorId,
    configDigest: supervisorConfigDigest,
  });
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
    const lockDirectory = resolve(runtimeDirectory, runtimeLockName);
    try {
      await mkdir(lockDirectory);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const age = Date.now() - (await stat(lockDirectory)).mtimeMs;
      if (age < staleLockMs) throw new Error('preflight_execution_busy');
      await rm(lockDirectory, { recursive: true, force: true });
      await mkdir(lockDirectory);
    }
    try {
      await writeFile(resolve(lockDirectory, 'owner.json'), `${JSON.stringify({ pid: process.pid, startedAtEpochMs })}\n`, 'utf8');
      await Promise.all([
        'preflight_envelope.json',
        'preflight_decision.json',
        'preflight_review_request.json',
        'preflight_review.json',
        'preflight_resolution.json',
        'supervisor_execution.json',
        'finalization.json',
      ].map((name) => rm(resolve(runtimeDirectory, name), { force: true })));
      await writeFile(temporaryPath, `${JSON.stringify(frozenEnvelope)}\n`, 'utf8');
      await rename(temporaryPath, envelopePath);
    } finally {
      await rm(lockDirectory, { recursive: true, force: true });
    }
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

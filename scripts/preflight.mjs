#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import process from 'node:process';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { buildPreflight } from './lib/preflight_core.mjs';

const root = resolve(process.env.AEGIS_ROOT ?? fileURLToPath(new URL('..', import.meta.url)));
let target = '';
if (process.argv.length > 2) {
  if (process.argv.length !== 4 || process.argv[2] !== '--target') {
    process.stderr.write('[AEGIS][PREFLIGHT][FATAL] invalid_arguments\n');
    process.exit(1);
  }
  target = process.argv[3];
}

try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  process.stdout.write(JSON.stringify(await buildPreflight(Buffer.concat(chunks), target, root)) + '\n');
} catch (error) {
  const code = error instanceof Error ? error.message : 'preflight_failed';
  process.stderr.write('[AEGIS][PREFLIGHT][FATAL] ' + code + '\n');
  process.exit(1);
}

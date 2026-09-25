#!/usr/bin/env node

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

const outputFlag = process.argv.indexOf('--output-last-message');
const opinionPath = process.env.AEGIS_FAKE_CODEX_OPINION;
if (outputFlag === -1 || !process.argv[outputFlag + 1] || !opinionPath) process.exit(2);
const opinion = readFileSync(opinionPath, 'utf8');
writeFileSync(process.argv[outputFlag + 1], opinion);
if (process.env.AEGIS_FAKE_CODEX_LOG) appendFileSync(process.env.AEGIS_FAKE_CODEX_LOG, 'call\n');
process.stdout.write(opinion);

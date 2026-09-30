#!/usr/bin/env node

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import Ajv2020 from 'ajv/dist/2020.js';

const outputFlag = process.argv.indexOf('--output-last-message');
const opinionPath = process.env.AEGIS_FAKE_CODEX_OPINION;
if (outputFlag === -1 || !process.argv[outputFlag + 1] || !opinionPath) process.exit(2);
const opinion = readFileSync(opinionPath, 'utf8');
const schemaFlag = process.argv.indexOf('--output-schema');
if (schemaFlag === -1) process.exit(2);
const schema = JSON.parse(readFileSync(process.argv[schemaFlag + 1], 'utf8'));
const validate = new Ajv2020({ strict: false }).compile(schema);
if (!validate(JSON.parse(opinion))) throw new Error(`fake_codex_response_violates_wire_schema:${JSON.stringify(validate.errors)}`);
writeFileSync(process.argv[outputFlag + 1], opinion);
if (process.env.AEGIS_FAKE_CODEX_LOG) appendFileSync(process.env.AEGIS_FAKE_CODEX_LOG, 'call\n');
process.stdout.write(opinion);

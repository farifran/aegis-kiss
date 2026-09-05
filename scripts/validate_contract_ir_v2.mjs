#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { validateContract } from './lib/contract_validator.mjs';

const defaultRoot = resolve(process.env.AEGIS_ROOT ?? fileURLToPath(new URL('..', import.meta.url)));

function fail(code) {
  process.stderr.write(`[AEGIS][CONTRACT][FATAL] ${code}\n`);
  process.exit(1);
}

function parseArguments(argv) {
  const options = {
    root: defaultRoot,
    contract: '.harness/active_contract_ir.json',
    clarified: '.harness/active_clarified_demand.json',
    registry: '.harness/proof_registry.json',
    policy: 'governance/architecture.policy.json',
    phase: 'promotion',
  };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--root', '--contract', '--clarified', '--registry', '--policy', '--phase'].includes(flag) || value === undefined) {
      fail('invalid_arguments');
    }
    options[flag.slice(2)] = value;
  }
  return options;
}

function readJson(root, path, code) {
  try {
    const text = readFileSync(resolve(root, path), 'utf8');
    return { text, value: JSON.parse(text) };
  } catch {
    fail(code);
  }
}

const options = parseArguments(process.argv.slice(2));
const root = resolve(options.root);
const contract = readJson(root, options.contract, 'unreadable_contract').value;
const clarified = readJson(root, options.clarified, 'unreadable_clarified_demand').value;
const policyFile = readJson(root, options.policy, 'unreadable_architecture_policy');
const registry = options.phase === 'promotion'
  ? readJson(root, options.registry, 'unreadable_proof_registry').value
  : undefined;
try {
  const result = validateContract({
    root,
    contract,
    clarified,
    policy: policyFile.value,
    policyText: policyFile.text,
    registry,
    phase: options.phase,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  fail(error instanceof Error ? error.message : 'contract_validation_failed');
}

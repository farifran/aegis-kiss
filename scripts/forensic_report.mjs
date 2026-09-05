#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const root = resolve(process.env.AEGIS_ROOT ?? fileURLToPath(new URL('..', import.meta.url)));

function fail(code) {
  process.stderr.write(`[AEGIS][REPORT][FATAL] ${code}\n`);
  process.exit(1);
}

function gitPath(name) {
  const path = execFileSync('git', ['-C', root, 'rev-parse', '--git-path', `aegis/${name}`], { encoding: 'utf8' }).trim();
  return path.startsWith('/') ? path : resolve(root, path);
}

function readReceipt(name) {
  const path = gitPath(name);
  if (!existsSync(path)) fail(`missing_${name.replace(/\.json$/u, '')}`);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail(`invalid_${name.replace(/\.json$/u, '')}`);
  }
}

let head;
let files;
let status;
try {
  head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  files = execFileSync('git', ['-C', root, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'], { encoding: 'utf8' })
    .trim().split('\n').filter(Boolean).sort();
  status = execFileSync('git', ['-C', root, 'status', '--short'], { encoding: 'utf8' }).trim();
} catch {
  fail('git_state_unavailable');
}
const precommit = readReceipt('precommit_receipt.json');
const postcommit = readReceipt('postcommit_receipt.json');
if (postcommit.commit !== head || postcommit.executionId !== precommit.executionId) fail('receipt_not_bound_to_head');
if (JSON.stringify([...precommit.files].sort()) !== JSON.stringify(files)) fail('receipt_files_mismatch');
const runtimeTiming = {};
for (const [name, path] of [
  ['preflight', resolve(root, '.harness/runtime/preflight_envelope.json')],
  ['finalization', resolve(root, '.harness/runtime/finalization.json')],
]) {
  if (!existsSync(path)) continue;
  let value;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail(`invalid_${name}_telemetry`);
  }
  if (value.executionId !== precommit.executionId) fail(`${name}_execution_mismatch`);
  runtimeTiming[name] = value.timing;
}

const report = {
  schema: 'aegis.forensic_report.v1',
  status: 'PROVEN',
  executionId: postcommit.executionId,
  transition: {
    baseCommit: postcommit.baseCommit,
    commit: postcommit.commit,
    files,
    worktreeClean: status.length === 0,
  },
  evidence: {
    committedManifest: postcommit.committedManifest,
    contractDigest: precommit.contractDigest,
    clarifiedDemandDigest: precommit.clarifiedDemandDigest,
    proofRegistryDigest: precommit.proofRegistryDigest,
    architecturePolicyDigest: precommit.architecturePolicyDigest,
    proofProfile: precommit.proofProfile,
    proofPlanDigest: precommit.proofPlanDigest,
    validationAuthority: precommit.validationAuthority,
    verificationDurationMs: precommit.verificationDurationMs,
    authorizedAtEpoch: precommit.issuedAtEpoch,
    postcommitVerifiedAtEpoch: postcommit.verifiedAtEpoch,
    runtimeTiming,
  },
};
process.stdout.write(`${JSON.stringify(report)}\n`);

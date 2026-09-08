#!/usr/bin/env node

import { readFile, stat, writeFile, rename, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { sha256 } from './lib/canonical_json.mjs';
import { loadSupervisorConfig, reviewerIdentity } from './lib/supervisor_config.mjs';
import { assertSchema } from './lib/schema_validator.mjs';

const root = resolve(process.env.AEGIS_ROOT ?? fileURLToPath(new URL('..', import.meta.url)));

function fail(code) {
  throw new Error(code);
}

function sameBinding(request, review) {
  return review.normalizedDemandDigest === request.normalizedDemandDigest
    && review.decisionDigest === request.decisionDigest
    && review.producerId === request.producerId
    && review.reviewerId === request.reviewerId
    && review.producerExecutionId === request.producerExecutionId
    && review.reviewExecutionId === request.reviewExecutionId
    && review.reviewRequestDigest === request.reviewRequestDigest;
}

async function writeAtomic(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, 'utf8');
  await rename(temporary, path);
}

export async function acceptIdeReview({ repositoryRoot = root } = {}) {
  const requestBytes = await readFile(resolve(repositoryRoot, '.harness/runtime/preflight_review_request.json'));
  const reviewBytes = await readFile(resolve(repositoryRoot, '.harness/runtime/preflight_review.json'));
  let request;
  let review;
  try {
    request = JSON.parse(requestBytes.toString('utf8'));
    review = JSON.parse(reviewBytes.toString('utf8'));
    assertSchema('aegis.preflight_review_request.v2', request);
    assertSchema('aegis.preflight_review.v2', review);
  } catch {
    fail('invalid_ide_review_artifact');
  }
  const config = await loadSupervisorConfig(repositoryRoot);
  const reviewer = reviewerIdentity(config);
  if (reviewer === null || reviewer.mode !== 'IDE') fail('ide_reviewer_not_configured');
  if (reviewer.id !== request.reviewerId || reviewer.configDigest !== request.reviewerConfigDigest) {
    fail('ide_reviewer_configuration_mismatch');
  }
  if (!sameBinding(request, review)) fail('ide_reviewer_binding_mismatch');
  const reviewStat = await stat(resolve(repositoryRoot, '.harness/runtime/preflight_review.json'));
  const execution = {
    schema: 'aegis.reviewer_execution.v1',
    reviewRequestDigest: request.reviewRequestDigest,
    reviewer,
    reviewArtifactBytesDigest: sha256(reviewBytes),
    timing: {
      phase: 'ide_reviewer_receipt',
      startedAtEpochMs: Math.max(0, Math.floor(reviewStat.mtimeMs)),
      durationMs: 0,
    },
    usage: { promptTokens: null, completionTokens: null },
  };
  const runtimeDirectory = resolve(repositoryRoot, '.harness/runtime');
  await mkdir(runtimeDirectory, { recursive: true });
  await writeAtomic(resolve(runtimeDirectory, 'reviewer_execution.json'), execution);
  return {
    schema: 'aegis.internal_review_result.v1',
    status: 'INDEPENDENT_REVIEW_READY',
    reviewPath: '.harness/runtime/preflight_review.json',
    reviewer,
    verdict: review.verdict,
    execution,
  };
}

if ((process.argv[1] ?? '').endsWith('/ide_reviewer.mjs')) {
  try {
    process.stdout.write(`${JSON.stringify(await acceptIdeReview())}\n`);
  } catch (error) {
    process.stderr.write(`[AEGIS][IDE-REVIEWER][FATAL] ${error instanceof Error ? error.message : 'ide_reviewer_failed'}\n`);
    process.exit(1);
  }
}

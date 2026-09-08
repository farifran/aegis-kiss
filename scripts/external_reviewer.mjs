#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { sha256 } from './lib/canonical_json.mjs';
import { requestOpenAiJson } from './lib/openai_compatible.mjs';
import { reviewerIdentity, loadSupervisorConfig } from './lib/supervisor_config.mjs';
import { assertSchema } from './lib/schema_validator.mjs';

const root = resolve(process.env.AEGIS_ROOT ?? fileURLToPath(new URL('..', import.meta.url)));
const maxRequestBytes = 256 * 1024;
const maxResponseBytes = 256 * 1024;
const maxCompletionTokens = 1024;

function fail(code) {
  throw new Error(code);
}

async function readBoundedStdin() {
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    total += chunk.length;
    if (total > maxRequestBytes) fail('review_request_budget_exceeded');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    fail('invalid_review_request');
  }
}

async function writeAtomic(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, 'utf8');
  await rename(temporary, path);
}

function assertReviewBinding(request, review) {
  if (
    review.normalizedDemandDigest !== request.normalizedDemandDigest
    || review.decisionDigest !== request.decisionDigest
    || review.producerId !== request.producerId
    || review.reviewerId !== request.reviewerId
    || review.producerExecutionId !== request.producerExecutionId
    || review.reviewExecutionId !== request.reviewExecutionId
    || review.reviewRequestDigest !== request.reviewRequestDigest
  ) {
    fail('external_reviewer_binding_mismatch');
  }
}

export async function runExternalReviewer(request, { repositoryRoot = root, requestFn = globalThis.fetch } = {}) {
  const startedAtEpochMs = Date.now();
  const started = performance.now();
  assertSchema('aegis.preflight_review_request.v2', request);
  const config = await loadSupervisorConfig(repositoryRoot);
  const reviewer = reviewerIdentity(config);
  if (reviewer === null || reviewer.mode !== 'EXTERNAL') fail('external_reviewer_not_configured');
  if (reviewer.id !== request.reviewerId || reviewer.configDigest !== request.reviewerConfigDigest) {
    fail('independent_reviewer_configuration_mismatch');
  }
  const response = await requestOpenAiJson({
    config: config.reviewer,
    system: 'Você é o revisor independente do Aegis. Responda exclusivamente com o JSON exigido no prompt recebido.',
    prompt: request.prompt,
    maxResponseBytes,
    maxCompletionTokens,
    unavailableCode: 'external_reviewer_unavailable',
    timeoutCode: 'external_reviewer_timeout',
    responseCode: 'external_reviewer_invalid_response',
    requestFn,
  });
  const review = response.value;
  assertSchema('aegis.preflight_review.v2', review);
  assertReviewBinding(request, review);
  const runtime = resolve(repositoryRoot, '.harness/runtime');
  await mkdir(runtime, { recursive: true });
  const reviewBytes = Buffer.from(`${JSON.stringify(review)}\n`, 'utf8');
  const execution = {
    schema: 'aegis.reviewer_execution.v1',
    reviewRequestDigest: request.reviewRequestDigest,
    reviewer,
    reviewArtifactBytesDigest: sha256(reviewBytes),
    timing: {
      phase: 'external_reviewer',
      startedAtEpochMs,
      durationMs: Math.round((performance.now() - started) * 1000) / 1000,
    },
    usage: response.usage,
  };
  await writeAtomic(resolve(runtime, 'preflight_review.json'), review);
  await writeAtomic(resolve(runtime, 'reviewer_execution.json'), execution);
  return {
    schema: 'aegis.internal_review_result.v1',
    status: 'INDEPENDENT_REVIEW_READY',
    reviewPath: '.harness/runtime/preflight_review.json',
    reviewer,
    verdict: review.verdict,
    execution,
  };
}

if ((process.argv[1] ?? '').endsWith('/external_reviewer.mjs')) {
  try {
    process.stdout.write(`${JSON.stringify(await runExternalReviewer(await readBoundedStdin()))}\n`);
  } catch (error) {
    process.stderr.write(`[AEGIS][REVIEWER][FATAL] ${error instanceof Error ? error.message : 'external_reviewer_failed'}\n`);
    process.exit(1);
  }
}

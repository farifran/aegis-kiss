#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/aegis-external-reviewer.XXXXXX")"
cleanup() { local status=$?; rm -rf "${WORK_DIR}"; exit "${status}"; }
trap cleanup EXIT

mkdir -p "${WORK_DIR}/.harness/runtime"
printf '.harness/runtime/\n.harness/supervisor.json\n' > "${WORK_DIR}/.gitignore"
AEGIS_ROOT="${WORK_DIR}" node "${ROOT_DIR}/scripts/lib/supervisor_config.mjs" reviewer external \
  --endpoint https://fixture.invalid/v1 --model fixture-reviewer-11b --timeout-ms 5000 > /dev/null

AEGIS_ROOT="${WORK_DIR}" node --input-type=module - "${ROOT_DIR}" <<'NODE'
import { readFileSync } from 'node:fs';
const root = process.argv[2];
const { loadSupervisorConfig, reviewerIdentity } = await import(`${root}/scripts/lib/supervisor_config.mjs`);
const { runExternalReviewer } = await import(`${root}/scripts/external_reviewer.mjs`);
const reviewer = reviewerIdentity(await loadSupervisorConfig(process.env.AEGIS_ROOT));
const request = {
  schema: 'aegis.preflight_review_request.v2',
  status: 'PENDING_INDEPENDENT_REVIEW',
  normalizedDemandDigest: 'a'.repeat(64),
  decisionDigest: 'b'.repeat(64),
  producerId: 'ide-active-model',
  reviewerId: reviewer.id,
  reviewerConfigDigest: reviewer.configDigest,
  producerExecutionId: 'c'.repeat(64),
  reviewExecutionId: 'd'.repeat(64),
  reviewRequestDigest: 'e'.repeat(64),
  promptDigest: 'f'.repeat(64),
  prompt: 'Revise o contrato.',
};
const review = {
  schema: 'aegis.preflight_review.v2',
  normalizedDemandDigest: request.normalizedDemandDigest,
  decisionDigest: request.decisionDigest,
  producerId: request.producerId,
  reviewerId: request.reviewerId,
  producerExecutionId: request.producerExecutionId,
  reviewExecutionId: request.reviewExecutionId,
  reviewRequestDigest: request.reviewRequestDigest,
  verdict: 'APPROVED',
  findings: [],
  stateSemantics: [],
  governanceAssessment: [],
};
const result = await runExternalReviewer(request, {
  repositoryRoot: process.env.AEGIS_ROOT,
  requestFn: async (url, init) => {
    if (url !== 'https://fixture.invalid/v1/chat/completions') throw new Error('unexpected_endpoint');
    const body = JSON.parse(init.body);
    if (body.model !== 'fixture-reviewer-11b') throw new Error('unexpected_model');
    if (body.max_tokens !== 1024) throw new Error('missing_reviewer_completion_budget');
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(review) } }], usage: { prompt_tokens: 13, completion_tokens: 5 } }), { status: 200 });
  },
});
if (result.status !== 'INDEPENDENT_REVIEW_READY' || result.verdict !== 'APPROVED') throw new Error('review_not_ready');
const execution = JSON.parse(readFileSync(`${process.env.AEGIS_ROOT}/.harness/runtime/reviewer_execution.json`, 'utf8'));
if (execution.reviewer.id !== reviewer.id || execution.reviewRequestDigest !== request.reviewRequestDigest || execution.usage.promptTokens !== 13) {
  throw new Error('review_execution_not_bound');
}
NODE

echo '[AEGIS][TEST][PASS] external reviewer passed'

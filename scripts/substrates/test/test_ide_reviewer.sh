#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/aegis-ide-reviewer.XXXXXX")"
cleanup() { local status=$?; rm -rf "${WORK_DIR}"; exit "${status}"; }
trap cleanup EXIT

mkdir -p "${WORK_DIR}/.harness/runtime"
AEGIS_ROOT="${WORK_DIR}" node "${ROOT_DIR}/scripts/lib/supervisor_config.mjs" external \
  --endpoint https://fixture.invalid/v1 --model fixture-supervisor --timeout-ms 5000 >/dev/null
AEGIS_ROOT="${WORK_DIR}" node "${ROOT_DIR}/scripts/lib/supervisor_config.mjs" reviewer ide >/dev/null
REVIEWER_DIGEST="$(AEGIS_ROOT="${WORK_DIR}" node "${ROOT_DIR}/scripts/lib/supervisor_config.mjs" show | jq -r '.reviewer.configDigest')"

node --input-type=module - "${WORK_DIR}" "${REVIEWER_DIGEST}" <<'NODE'
import { writeFileSync } from 'node:fs';

const root = process.argv[2];
const reviewerConfigDigest = process.argv[3];
const digest = (character) => character.repeat(64);
const request = {
  schema: 'aegis.preflight_review_request.v2',
  status: 'PENDING_INDEPENDENT_REVIEW',
  normalizedDemandDigest: digest('a'),
  decisionDigest: digest('b'),
  producerId: 'fixture-supervisor',
  reviewerId: 'ide-active-model',
  reviewerConfigDigest,
  producerExecutionId: digest('c'),
  reviewExecutionId: digest('d'),
  reviewRequestDigest: digest('e'),
  promptDigest: digest('f'),
  prompt: 'Retorne JSON.',
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
writeFileSync(`${root}/.harness/runtime/preflight_review_request.json`, `${JSON.stringify(request)}\n`);
writeFileSync(`${root}/.harness/runtime/preflight_review.json`, `${JSON.stringify(review)}\n`);
NODE

output="$(AEGIS_ROOT="${WORK_DIR}" node "${ROOT_DIR}/scripts/ide_reviewer.mjs")"
printf '%s' "${output}" | jq -e '.status == "INDEPENDENT_REVIEW_READY" and .reviewer.mode == "IDE" and .usage.promptTokens == null' >/dev/null
jq -e '.reviewer.mode == "IDE" and .timing.phase == "ide_reviewer_receipt" and .usage.completionTokens == null' \
  "${WORK_DIR}/.harness/runtime/reviewer_execution.json" >/dev/null

echo '[AEGIS][TEST][PASS] IDE reviewer passed'

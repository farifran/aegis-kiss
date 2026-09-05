#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
NORMALIZER=(node "${ROOT_DIR}/scripts/normalize_architecture.mjs")
temporary_policy="$(mktemp "${ROOT_DIR}/governance/architecture-policy-test.XXXXXX.json")"
temporary_relative="governance/$(basename "${temporary_policy}")"
cleanup() { rm -f "${temporary_policy}"; }
trap cleanup EXIT

output="$("${NORMALIZER[@]}" --tag stateful-operation)"
printf '%s' "${output}" | jq -e '
  .schema == "aegis.architecture_projection.v1"
  and .sourceStatus == "CURRENT"
  and .tags == ["stateful-operation"]
  and (.rules | length == 1)
  and .rules[0].id == "ARCH-FAILURE-EXPLICIT"
  and .rules[0].level == "hard"
  and .rules[0].appliesMode == "any"
' >/dev/null

output="$("${NORMALIZER[@]}" --tag documentation)"
printf '%s' "${output}" | jq -e '.sourceStatus == "CURRENT" and .rules == []' >/dev/null

output="$("${NORMALIZER[@]}" --tag time-dependent)"
printf '%s' "${output}" | jq -e '
  .sourceStatus == "CURRENT"
  and (.rules | length == 1)
  and .rules[0].id == "ARCH-DETERMINISTIC-TIME"
  and .rules[0].level == "hard"
' >/dev/null

output="$("${NORMALIZER[@]}" --all)"
printf '%s' "${output}" | jq -e '
  .sourceStatus == "CURRENT"
  and ([.rules[].id] | sort == ["ARCH-DETERMINISTIC-TIME", "ARCH-FAILURE-EXPLICIT"])
' >/dev/null

jq '.origin.sourceDigest = "0000000000000000000000000000000000000000000000000000000000000000"' \
  "${ROOT_DIR}/governance/architecture.policy.json" > "${temporary_policy}"
output="$("${NORMALIZER[@]}" --policy "${temporary_relative}" --tag stateful-operation)"
printf '%s' "${output}" | jq -e '.sourceStatus == "STALE" and .rules[0].id == "ARCH-FAILURE-EXPLICIT"' >/dev/null

jq '.rules += [.rules[0]]' "${ROOT_DIR}/governance/architecture.policy.json" > "${temporary_policy}"
if "${NORMALIZER[@]}" --policy "${temporary_relative}" >/dev/null 2>&1; then
  echo 'duplicate architecture rule was accepted' >&2
  exit 1
fi

if "${NORMALIZER[@]}" --tag 'Stateful Operation' >/dev/null 2>&1; then
  echo 'unsafe architecture tag was accepted' >&2
  exit 1
fi

printf '[AEGIS][TEST] architecture normalizer: PASS\n'

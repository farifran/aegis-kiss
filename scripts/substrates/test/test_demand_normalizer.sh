#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
NORMALIZER=(node "${ROOT_DIR}/scripts/normalize_demand.mjs")

demand=$'# Título\r\n- `src/example.ts`\r\n```text\r\nvalor\r\n```\r\nUse `parseInput` em https://example.test/spec\r\n'
first="$(printf '%s' "${demand}" | "${NORMALIZER[@]}")"
second="$(printf '%s' "${demand}" | "${NORMALIZER[@]}")"
[[ "${first}" == "${second}" ]] || { echo 'normalizer is not deterministic' >&2; exit 1; }

printf '%s' "${first}" | jq -e '
  .schema == "aegis.normalized_demand.v1"
  and .normalizerVersion == "1"
  and (.rawDigest | test("^[a-f0-9]{64}$"))
  and (.normalizedDigest | test("^[a-f0-9]{64}$"))
  and .rawByteLength > .normalizedByteLength
  and (.text | contains("\r") | not)
  and .transformations == [{kind:"CRLF_TO_LF",count:6}]
  and ([.sourceMap[] | select((.raw.endByte - .raw.startByte) == 2 and (.normalized.endByte - .normalized.startByte) == 1)] | length == 6)
  and ([.blocks[].kind] | index("heading") and index("list") and index("code"))
  and ([.references[] | select(.kind == "path" and .value == "src/example.ts")] | length == 1)
  and ([.references[] | select(.kind == "symbol" and .value == "parseInput")] | length == 1)
  and ([.references[] | select(.kind == "url" and .value == "https://example.test/spec")] | length == 1)
  and ([.references[] | select(.value == "example.test/spec")] | length == 0)
  and .correctionCandidates == []
' >/dev/null

if printf '\377' | "${NORMALIZER[@]}" >/dev/null 2>&1; then
  echo 'invalid UTF-8 was accepted' >&2
  exit 1
fi

if printf 'abcdef' | "${NORMALIZER[@]}" --max-bytes 5 >/dev/null 2>&1; then
  echo 'oversized demand was accepted' >&2
  exit 1
fi

printf '[AEGIS][TEST] demand normalizer: PASS\n'

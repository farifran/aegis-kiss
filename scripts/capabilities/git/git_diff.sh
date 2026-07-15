#!/usr/bin/env bash

set -Eeuo pipefail

# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/../_emit.sh"

readonly CAPABILITY_NAME="git.diff"

if ! DIFF_OUTPUT="$(
  git diff --no-color
)"; then
  aegis_emit_capability_failure "${CAPABILITY_NAME}" "git_diff_failed" "."
  exit 1
fi

aegis_emit_capability_success "${CAPABILITY_NAME}" "$(
  jq -nc --arg diff "${DIFF_OUTPUT}" '{diff: $diff}'
)"

#!/usr/bin/env bash

set -Eeuo pipefail

# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/../_emit.sh"

readonly CAPABILITY_NAME="git.status"

if ! STATUS_OUTPUT="$(
  git status --short
)"; then
  aegis_emit_capability_failure "${CAPABILITY_NAME}" "git_status_failed" "."
  exit 1
fi

aegis_emit_capability_success "${CAPABILITY_NAME}" "$(
  jq -nc --arg status "${STATUS_OUTPUT}" '{status: $status}'
)"

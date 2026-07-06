#!/usr/bin/env bash

# =========================================================
# AEGIS TEST — SHARED TEST LIBRARY
# =========================================================
#
# Source this from any scripts/substrates/test/test_*.sh:
#
#   source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"
#
# Provides:
#
# - repo-root resolution and cwd (AEGIS_TEST_ROOT / TEST_ROOT)
# - .harness/config.sh sourcing
# - fail(), array_contains(), extract_first_artifact_payload()
# - epistemic handover backup/restore
# - mock provider start/stop (via mock_provider.sh)
# - a common EXIT cleanup trap; tests may define test_cleanup_extra()
#   for their own additional teardown
#
# =========================================================

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "[AEGIS][TEST][FATAL] test_lib_not_invocable" >&2
  exit 1
fi

set -Eeuo pipefail

readonly AEGIS_TEST_ROOT="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd
)"
readonly TEST_ROOT="${AEGIS_TEST_ROOT}"

cd "${AEGIS_TEST_ROOT}"

# shellcheck disable=SC1091
source ".harness/config.sh"

fail() {
  echo "[AEGIS][TEST][FATAL] $*" >&2
  exit 1
}

array_contains() {
  local needle="$1"
  shift

  local item
  for item in "$@"; do
    [[ "${item}" == "${needle}" ]] && return 0
  done

  return 1
}

extract_first_artifact_payload() {
  local runtime_output="$1"

  printf '%s\n' "${runtime_output}" | awk '
    $0 == "AEGIS_ARTIFACT_BEGIN" {
      if (seen == 0) {
        seen = 1
        next
      }
    }

    $0 == "AEGIS_ARTIFACT_END" {
      if (seen == 1) {
        exit
      }
    }

    seen == 1 {
      print
    }
  '
}

# ---------------------------------------------------------
# Epistemic handover backup/restore
# ---------------------------------------------------------

_HANDOVER_BACKUP_FILE=""
_HAD_EPISTEMIC_HANDOVER="false"

backup_epistemic_handover() {
  _HANDOVER_BACKUP_FILE="$(mktemp)"

  if [[ -f "${AEGIS_EPISTEMIC_HANDOVER_FILE}" ]]; then
    cp "${AEGIS_EPISTEMIC_HANDOVER_FILE}" "${_HANDOVER_BACKUP_FILE}"
    _HAD_EPISTEMIC_HANDOVER="true"
  fi
}

restore_epistemic_handover() {
  [[ -n "${_HANDOVER_BACKUP_FILE}" ]] || return 0

  mkdir -p "$(dirname "${AEGIS_EPISTEMIC_HANDOVER_FILE}")"

  if [[ "${_HAD_EPISTEMIC_HANDOVER}" == "true" ]]; then
    cp "${_HANDOVER_BACKUP_FILE}" "${AEGIS_EPISTEMIC_HANDOVER_FILE}" \
      >/dev/null 2>&1 || true
  else
    rm -f "${AEGIS_EPISTEMIC_HANDOVER_FILE}" >/dev/null 2>&1 || true
  fi

  rm -f "${_HANDOVER_BACKUP_FILE}" >/dev/null 2>&1 || true
  _HANDOVER_BACKUP_FILE=""
}

# ---------------------------------------------------------
# Mock providers
# ---------------------------------------------------------

# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/mock_provider.sh"

# ---------------------------------------------------------
# Common cleanup
# ---------------------------------------------------------

aegis_test_cleanup() {
  set +e

  stop_mock_provider
  restore_epistemic_handover

  rm -rf \
    "${AEGIS_CAPABILITY_ENV_DIR}" \
    "${AEGIS_CAPABILITY_PAYLOAD_DIR}" \
    ".harness/execution_surfaces/discovery" \
    ".harness/execution_surfaces/forensics" \
    ".harness/execution_surfaces/validation" \
    ".harness/execution_surfaces/adversarial" \
    >/dev/null 2>&1 || true

  if declare -F test_cleanup_extra >/dev/null; then
    test_cleanup_extra
  fi

  set -e
}

trap aegis_test_cleanup EXIT

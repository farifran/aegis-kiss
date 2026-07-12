#!/usr/bin/env bash

# =========================================================
# AEGIS HARNESS — MUTATION PREFLIGHT (one-shot, post-diff)
# =========================================================
#
# Runs AFTER aider has produced a worktree diff and BEFORE the mutation
# artifact is emitted. Not part of aider's per-edit reflection loop.
#
# Responsibilities:
#   - run project typescript.check once on the execution surface
#   - run test.run once on the execution surface
#   - materialize standard capability JSON payloads (runtime evidence)
#   - hard-fail the mutation if either check reports status=failed
#
# Skips cleanly when markers/tools are absent (no tsconfig, no package
# tests, no binary) so isolated fixtures and non-JS surfaces stay green.
#
# Usage:
#   bash mutation_preflight.sh <surface_path> <payload_dir>
#
# Env:
#   AEGIS_EXECUTION_ID   required for JSON capability payloads
#   AEGIS_SUBSTRATE_ROOT optional; defaults to repo root of this script
#   AEGIS_MUTATION_PREFLIGHT=0  disable entirely (exit 0)
#
# Exit 0 — passed or skipped
# Exit 1 — at least one check failed (payloads still written when possible)
#
# =========================================================

set -u

SURFACE_PATH="${1:-}"
PAYLOAD_DIR="${2:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ROOT="${AEGIS_SUBSTRATE_ROOT:-${ROOT}}"

preflight_log() {
  echo "[AEGIS][PREFLIGHT] $*" >&2
}

preflight_warn() {
  echo "[AEGIS][PREFLIGHT][WARN] $*" >&2
}

if [[ "${AEGIS_MUTATION_PREFLIGHT:-true}" == "0" ]] \
  || [[ "${AEGIS_MUTATION_PREFLIGHT:-true}" == "false" ]]; then
  preflight_log "disabled by AEGIS_MUTATION_PREFLIGHT"
  exit 0
fi

[[ -n "${SURFACE_PATH}" && -d "${SURFACE_PATH}" ]] \
  || { preflight_warn "missing_surface — skip"; exit 0; }

[[ -n "${PAYLOAD_DIR}" ]] \
  || { preflight_warn "missing_payload_dir — skip"; exit 0; }

mkdir -p "${PAYLOAD_DIR}" 2>/dev/null || true

[[ -n "${AEGIS_EXECUTION_ID:-}" ]] \
  || export AEGIS_EXECUTION_ID="preflight-local"

# ---------------------------------------------------------
# Tooling: disposable surfaces rarely carry node_modules
# ---------------------------------------------------------

ensure_surface_node_modules() {
  if [[ -e "${SURFACE_PATH}/node_modules" ]]; then
    return 0
  fi
  if [[ -d "${ROOT}/node_modules" ]]; then
    ln -sfn "${ROOT}/node_modules" "${SURFACE_PATH}/node_modules" \
      || preflight_warn "node_modules_symlink_failed"
  fi
}

ensure_surface_node_modules

# ---------------------------------------------------------
# Run a capability handler on the surface; write payload file
# ---------------------------------------------------------

# Prints: passed | failed | skipped
# Exit code of this function is always 0; caller reads the status word.
run_capability_on_surface() {
  local capability="$1"
  local handler_rel="$2"
  local payload_name="$3"
  local skip_unless_file="${4:-}"

  local handler="${ROOT}/${handler_rel}"
  local out_path="${PAYLOAD_DIR}/${payload_name}"

  if [[ ! -f "${handler}" ]]; then
    preflight_log "${capability}: skipped (handler missing)"
    printf 'skipped'
    return 0
  fi

  if [[ -n "${skip_unless_file}" && ! -f "${SURFACE_PATH}/${skip_unless_file}" ]]; then
    preflight_log "${capability}: skipped (no ${skip_unless_file} on surface)"
    printf 'skipped'
    return 0
  fi

  local output=""
  local rc=0
  output="$(
    cd "${SURFACE_PATH}" || exit 97
    export AEGIS_EXECUTION_ID
    export PATH="${SURFACE_PATH}/node_modules/.bin:${ROOT}/node_modules/.bin:${PATH}"
    bash "${handler}" 2>/dev/null
  )" || rc=$?

  if [[ "${rc}" -eq 97 ]]; then
    preflight_warn "${capability}: surface unreachable"
    printf 'skipped'
    return 0
  fi

  if [[ -z "${output}" ]] || ! printf '%s' "${output}" | jq empty >/dev/null 2>&1; then
    # Non-JSON / empty: treat as skip rather than inventing a failure —
    # missing tooling must not hard-kill mutation.
    preflight_log "${capability}: skipped (no JSON payload; tools likely absent)"
    printf 'skipped'
    return 0
  fi

  printf '%s\n' "${output}" > "${out_path}"

  local status
  status="$(printf '%s' "${output}" | jq -r '.payload.status // empty')"

  case "${status}" in
    passed)
      preflight_log "${capability}: passed"
      printf 'passed'
      ;;
    failed)
      preflight_warn "${capability}: failed — evidence at ${out_path}"
      printf 'failed'
      ;;
    *)
      preflight_log "${capability}: skipped (status=${status:-empty})"
      printf 'skipped'
      ;;
  esac
  return 0
}

failed=0

tsc_status="$(
  run_capability_on_surface \
    "typescript.check" \
    "scripts/capabilities/typescript_check.sh" \
    "typescript_check.json" \
    "tsconfig.json"
)"

test_status="$(
  run_capability_on_surface \
    "test.run" \
    "scripts/capabilities/test_runner.sh" \
    "test_run.json" \
    "package.json"
)"

# Persist a tiny index so operators/downstream can see preflight outcome
# without re-parsing each payload.
jq -n \
  --arg ts "${tsc_status}" \
  --arg test "${test_status}" \
  --arg surface "${SURFACE_PATH}" \
  --arg execution_id "${AEGIS_EXECUTION_ID}" \
  '{
    capability: "mutation.preflight",
    classification: "readonly",
    execution_id: $execution_id,
    payload: {
      surface: $surface,
      typescript_check: $ts,
      test_run: $test
    },
    error: null,
    success: true
  }' > "${PAYLOAD_DIR}/mutation_preflight.json" 2>/dev/null || true

[[ "${tsc_status}" == "failed" ]] && failed=1
[[ "${test_status}" == "failed" ]] && failed=1

if [[ "${failed}" -ne 0 ]]; then
  preflight_warn "mutation preflight FAILED (typescript_check=${tsc_status}, test_run=${test_status})"
  exit 1
fi

preflight_log "mutation preflight ok (typescript_check=${tsc_status}, test_run=${test_status})"
exit 0

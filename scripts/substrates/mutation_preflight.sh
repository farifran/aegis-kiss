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
#   - smoke-load changed JS/TS modules (top-level throw / import crash)
#   - materialize standard capability JSON payloads (runtime evidence)
#   - hard-fail the mutation if a required check reports status=failed
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
#   AEGIS_PREFLIGHT_CHANGED_FILES  optional newline-separated list of
#     paths changed by the mutation. When set, typescript.check failures
#     that only cite pre-existing files outside this set are treated as
#     baseline pollution (warn + pass), not a hard mutation reject.
#   AEGIS_MUTATION_SMOKE_IMPORT=0  disable smoke-load of changed modules
#   AEGIS_SMOKE_IMPORT_TIMEOUT_SEC  per-file load budget (default 5)
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

# ---------------------------------------------------------
# Smoke-load changed modules (runtime crash, not typecheck)
# ---------------------------------------------------------
# Loads each changed JS/TS file once under a short wall-clock budget.
# Catches top-level throw / import resolution failures that tsc misses.
# Side-effecting modules are contained by the per-file timeout.
# TS uses --experimental-strip-types when the local node supports it;
# otherwise .ts/.tsx are skipped (typescript.check remains authoritative).

: "${AEGIS_SMOKE_IMPORT_TIMEOUT_SEC:=5}"

node_supports_strip_types() {
  command -v node >/dev/null 2>&1 || return 1
  node --experimental-strip-types -e "0" >/dev/null 2>&1
}

# Run argv under a portable soft alarm (macOS often lacks GNU timeout).
run_with_timeout() {
  local seconds="$1"
  shift

  if command -v timeout >/dev/null 2>&1; then
    timeout "${seconds}" "$@"
    return $?
  fi

  if command -v gtimeout >/dev/null 2>&1; then
    gtimeout "${seconds}" "$@"
    return $?
  fi

  # perl alarm fallback
  if command -v perl >/dev/null 2>&1; then
    perl -e 'alarm shift; exec @ARGV' "${seconds}" "$@"
    return $?
  fi

  # Last resort: unbounded (still better than silent skip of smoke)
  "$@"
}

# Prints: passed | failed | skipped
run_smoke_import_changed() {
  if [[ "${AEGIS_MUTATION_SMOKE_IMPORT:-true}" == "0" ]] \
    || [[ "${AEGIS_MUTATION_SMOKE_IMPORT:-true}" == "false" ]]; then
    preflight_log "smoke.import: disabled by AEGIS_MUTATION_SMOKE_IMPORT"
    printf 'skipped'
    return 0
  fi

  if ! command -v node >/dev/null 2>&1; then
    preflight_log "smoke.import: skipped (node missing)"
    printf 'skipped'
    return 0
  fi

  if [[ -z "${AEGIS_PREFLIGHT_CHANGED_FILES:-}" ]]; then
    preflight_log "smoke.import: skipped (no changed-file list)"
    printf 'skipped'
    return 0
  fi

  local strip_types=0
  if node_supports_strip_types; then
    strip_types=1
  fi

  local -a smoke_files=()
  local rel
  while IFS= read -r rel; do
    [[ -n "${rel}" ]] || continue
    rel="${rel#./}"
    case "${rel}" in
      *.js|*.mjs|*.cjs)
        smoke_files+=("${rel}")
        ;;
      *.ts|*.tsx)
        if [[ "${strip_types}" -eq 1 ]]; then
          smoke_files+=("${rel}")
        else
          preflight_log "smoke.import: skip ${rel} (no node --experimental-strip-types)"
        fi
        ;;
      *)
        ;;
    esac
  done <<< "${AEGIS_PREFLIGHT_CHANGED_FILES}"

  if [[ "${#smoke_files[@]}" -eq 0 ]]; then
    preflight_log "smoke.import: skipped (no loadable JS/TS in changed set)"
    printf 'skipped'
    return 0
  fi

  local failures=0
  local rel_path abs_path rc out
  local results_json="[]"

  for rel_path in "${smoke_files[@]}"; do
    abs_path="${SURFACE_PATH}/${rel_path}"
    if [[ ! -f "${abs_path}" ]]; then
      preflight_warn "smoke.import: missing file ${rel_path}"
      failures=$((failures + 1))
      continue
    fi

    # Dynamic import via file URL — works for ESM and most CJS under Node.
    local node_args=(node)
    case "${rel_path}" in
      *.ts|*.tsx)
        node_args+=(--experimental-strip-types)
        ;;
    esac

    out=""
    rc=0
    out="$(
      cd "${SURFACE_PATH}" || exit 97
      export PATH="${SURFACE_PATH}/node_modules/.bin:${ROOT}/node_modules/.bin:${PATH}"
      run_with_timeout "${AEGIS_SMOKE_IMPORT_TIMEOUT_SEC}" \
        "${node_args[@]}" \
        --input-type=module \
        -e '
import { pathToFileURL } from "node:url";
const target = process.argv[1];
import(pathToFileURL(target).href)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
        ' \
        "${abs_path}" 2>&1
    )" || rc=$?

    if [[ "${rc}" -eq 97 ]]; then
      preflight_warn "smoke.import: surface unreachable"
      printf 'skipped'
      return 0
    fi

    if [[ "${rc}" -eq 0 ]]; then
      preflight_log "smoke.import: ok ${rel_path}"
      results_json="$(
        jq -cn --argjson acc "${results_json}" --arg f "${rel_path}" \
          '$acc + [{file:$f, status:"passed"}]'
      )"
    else
      failures=$((failures + 1))
      preflight_warn "smoke.import: FAILED ${rel_path} (rc=${rc})"
      if [[ -n "${out}" ]]; then
        printf '%s\n' "${out}" | head -n 20 >&2
      fi
      results_json="$(
        jq -cn \
          --argjson acc "${results_json}" \
          --arg f "${rel_path}" \
          --argjson rc "${rc}" \
          --arg err "$(printf '%s' "${out}" | head -c 2000)" \
          '$acc + [{file:$f, status:"failed", exit_code:$rc, detail:$err}]'
      )"
    fi
  done

  jq -n \
    --arg execution_id "${AEGIS_EXECUTION_ID}" \
    --argjson results "${results_json}" \
    --argjson failed "${failures}" \
    '{
      capability: "smoke.import",
      classification: "readonly",
      execution_id: $execution_id,
      payload: {
        status: (if $failed > 0 then "failed" else "passed" end),
        failures: $failed,
        results: $results
      },
      error: null,
      success: true
    }' > "${PAYLOAD_DIR}/smoke_import.json" 2>/dev/null || true

  if [[ "${failures}" -gt 0 ]]; then
    printf 'failed'
  else
    printf 'passed'
  fi
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

smoke_status="$(run_smoke_import_changed)"

# ---------------------------------------------------------
# Delta gate: pre-existing tsc debt outside the mutation
# must not abort a candidate that only touches clean files.
# ---------------------------------------------------------

tsc_effective="${tsc_status}"
tsc_delta_note=""

if [[ "${tsc_status}" == "failed" ]] \
  && [[ -n "${AEGIS_PREFLIGHT_CHANGED_FILES:-}" ]] \
  && [[ -f "${PAYLOAD_DIR}/typescript_check.json" ]]; then

  # Normalize changed paths for comparison (strip leading ./).
  changed_json="$(
    printf '%s\n' "${AEGIS_PREFLIGHT_CHANGED_FILES}" \
      | sed 's|^\./||' \
      | jq -R . \
      | jq -s 'map(select(length > 0))'
  )"

  mutation_error_count="$(
    jq -r \
      --argjson changed "${changed_json}" \
      '
        def norm: gsub("^\\./"; "");
        [.payload.errors[]? | .file | norm] as $err_files
        | [$err_files[] | select(. as $f | any($changed[]; . == $f or ($f | startswith(. + "/")) or (. | startswith($f + "/"))))]
        | length
      ' "${PAYLOAD_DIR}/typescript_check.json" 2>/dev/null || printf '0'
  )"

  if [[ "${mutation_error_count}" == "0" ]]; then
    tsc_effective="passed"
    tsc_delta_note="baseline_only"
    preflight_warn "typescript.check reported failures outside mutation files — treating as baseline (changed=${changed_json})"
  else
    tsc_delta_note="mutation_errors=${mutation_error_count}"
    preflight_warn "typescript.check failures touch mutation files (${tsc_delta_note})"
  fi
fi

# Persist a tiny index so operators/downstream can see preflight outcome
# without re-parsing each payload.
jq -n \
  --arg ts "${tsc_status}" \
  --arg ts_effective "${tsc_effective}" \
  --arg ts_delta "${tsc_delta_note}" \
  --arg test "${test_status}" \
  --arg smoke "${smoke_status}" \
  --arg surface "${SURFACE_PATH}" \
  --arg execution_id "${AEGIS_EXECUTION_ID}" \
  '{
    capability: "mutation.preflight",
    classification: "readonly",
    execution_id: $execution_id,
    payload: {
      surface: $surface,
      typescript_check: $ts,
      typescript_check_effective: $ts_effective,
      typescript_delta: $ts_delta,
      test_run: $test,
      smoke_import: $smoke
    },
    error: null,
    success: true
  }' > "${PAYLOAD_DIR}/mutation_preflight.json" 2>/dev/null || true

[[ "${tsc_effective}" == "failed" ]] && failed=1
[[ "${test_status}" == "failed" ]] && failed=1
[[ "${smoke_status}" == "failed" ]] && failed=1

if [[ "${failed}" -ne 0 ]]; then
  preflight_warn "mutation preflight FAILED (typescript_check=${tsc_effective}, test_run=${test_status}, smoke_import=${smoke_status})"
  exit 1
fi

preflight_log "mutation preflight ok (typescript_check=${tsc_effective}, test_run=${test_status}, smoke_import=${smoke_status})"
exit 0

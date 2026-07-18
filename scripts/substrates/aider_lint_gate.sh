#!/usr/bin/env bash

# =========================================================
# AEGIS HARNESS — AIDER LOCAL VALIDATION GATE
# =========================================================
#
# Hyper-focused per-file check invoked by aider's auto-lint
# reflection step (--lint-cmd) after each applied edit. Scope is the
# file aider just modified so the internal correct-and-retry loop
# stays high-velocity.
#
# Order (cheap → structural → project-aware delta):
#   1. syntax      — bash -n / node --check / jq; TS uses project
#                    tsc delta when tsconfig exists (errors only on
#                    THIS file), else tsc --noResolve single-file
#   2. prettier    — --write on the file only (pass-through if absent)
#   3. eslint      — --fix on the file only; residual errors fail
#   4. static_gate — empty-catch, eval, undeclared imports
#
# Deliberately NOT in this gate:
#   - full test suites (mutation_preflight one-shot)
#   - intent / demand-token gates (post-diff)
#
# Project-wide tsc still runs in mutation_preflight as a safety net;
# the delta here surfaces type errors on the edited file *inside*
# Aider's reflection loop (P1).
#
# Env:
#   AEGIS_LINT_PROJECT_TSC=0  disable project tsc delta (syntax-only TS)
#
# Exit 0  = edit structurally sound, aider finalizes immediately.
# Exit !0 = diagnostics feed aider's bounded internal reflection.
#
# =========================================================

set -u

TARGET_FILE="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATIC_GATE="${SCRIPT_DIR}/static_gate.sh"

[[ -n "${TARGET_FILE}" ]] || exit 0
[[ -f "${TARGET_FILE}" ]] || exit 0

resolve_local_bin() {
  local name="$1"
  if [[ -x "node_modules/.bin/${name}" ]]; then
    printf '%s\n' "node_modules/.bin/${name}"
    return 0
  fi
  if command -v "${name}" >/dev/null 2>&1; then
    command -v "${name}"
    return 0
  fi
  return 1
}

# Normalize path for tsc diagnostic matching (strip ./ and abs→rel if under cwd).
lint_norm_path() {
  local p="${1-}"
  p="${p#./}"
  if [[ "${p}" == /* ]]; then
    local cwd
    cwd="$(pwd -P 2>/dev/null || pwd)"
    if [[ "${p}" == "${cwd}/"* ]]; then
      p="${p#"${cwd}/"}"
    fi
  fi
  printf '%s' "${p}"
}

# Project tsc; fail only when diagnostics cite TARGET_FILE (baseline ignored).
# Prints matching diagnostics on stderr for Aider. Exit 1 if any match.
lint_tsc_project_delta() {
  local target="$1"
  local tsc_bin tsconfig out rc=0
  local target_norm line file_part

  [[ "${AEGIS_LINT_PROJECT_TSC:-1}" == "0" \
    || "${AEGIS_LINT_PROJECT_TSC:-1}" == "false" ]] && return 0

  tsconfig=""
  if [[ -f "tsconfig.json" ]]; then
    tsconfig="tsconfig.json"
  elif [[ -f "./tsconfig.json" ]]; then
    tsconfig="./tsconfig.json"
  fi
  [[ -n "${tsconfig}" ]] || return 0

  tsc_bin=""
  TSC_BIN="$(resolve_local_bin tsc)" || return 0
  tsc_bin="${TSC_BIN}"

  target_norm="$(lint_norm_path "${target}")"
  [[ -n "${target_norm}" ]] || return 0

  out="$("${tsc_bin}" --noEmit --pretty false 2>&1)" || rc=$?
  if [[ "${rc}" -eq 0 ]]; then
    return 0
  fi

  local matched=0
  while IFS= read -r line; do
    [[ -n "${line}" ]] || continue
    # tsc: path(line,col): error TS…  |  path(line,col): error …
    if [[ "${line}" =~ ^([^\(]+)\([0-9]+,[0-9]+\): ]]; then
      file_part="$(lint_norm_path "${BASH_REMATCH[1]}")"
      if [[ "${file_part}" == "${target_norm}" ]] \
        || [[ "${file_part}" == */"${target_norm}" ]] \
        || [[ "${target_norm}" == */"${file_part}" ]]; then
        printf '%s\n' "${line}" >&2
        matched=1
      fi
    fi
  done <<< "${out}"

  if [[ "${matched}" -eq 1 ]]; then
    return 1
  fi
  # Baseline debt only — do not block Aider on unrelated files.
  return 0
}

# Cheap single-file TS parse when project check is unavailable / disabled.
lint_tsc_single_file() {
  local target="$1"
  local tsc_bin
  tsc_bin=""
  if tsc_bin="$(resolve_local_bin tsc)"; then
    "${tsc_bin}" --noEmit --noResolve --skipLibCheck --pretty false \
      "${target}" || return $?
  fi
  return 0
}

# ---------------------------------------------------------
# 1. SYNTAX
# ---------------------------------------------------------

case "${TARGET_FILE}" in
  *.sh|*.bash)
    bash -n "${TARGET_FILE}" || exit $?
    ;;
  *.js|*.mjs|*.cjs|*.jsx)
    if command -v node >/dev/null 2>&1; then
      node --check "${TARGET_FILE}" || exit $?
    fi
    ;;
  *.ts|*.tsx)
    # Prefer project tsc delta (errors on THIS file only) so Aider's
    # auto-lint loop sees real type/import failures, not just parse.
    # Same tsc rails as repair (including optimize refine path).
    if [[ -f "tsconfig.json" || -f "./tsconfig.json" ]] \
      && [[ "${AEGIS_LINT_PROJECT_TSC:-1}" != "0" ]] \
      && [[ "${AEGIS_LINT_PROJECT_TSC:-1}" != "false" ]] \
      && resolve_local_bin tsc >/dev/null 2>&1; then
      lint_tsc_project_delta "${TARGET_FILE}" || exit $?
    else
      lint_tsc_single_file "${TARGET_FILE}" || exit $?
    fi
    ;;
  *.json)
    if command -v jq >/dev/null 2>&1; then
      jq empty "${TARGET_FILE}" || exit $?
    fi
    ;;
  *)
    ;;
esac

# ---------------------------------------------------------
# 2. PRETTIER (auto-format, file-scoped)
# ---------------------------------------------------------

case "${TARGET_FILE}" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.json|*.css|*.md|*.yml|*.yaml)
    if PRETTIER_BIN="$(resolve_local_bin prettier)"; then
      "${PRETTIER_BIN}" --write --log-level warn "${TARGET_FILE}" || exit $?
    fi
    ;;
esac

# ---------------------------------------------------------
# 3. ESLINT --fix (auto-fix + residual errors fail)
# ---------------------------------------------------------

eslint_config_present() {
  # ESLint v9 flat config or legacy rc — skip when neither exists so a
  # linked node_modules without project config does not fail the gate.
  [[ -f eslint.config.js || -f eslint.config.mjs || -f eslint.config.cjs \
    || -f eslint.config.ts || -f .eslintrc.js || -f .eslintrc.cjs \
    || -f .eslintrc.json || -f .eslintrc.yml || -f .eslintrc.yaml \
    || -f .eslintrc ]] && return 0
  return 1
}

case "${TARGET_FILE}" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs)
    if ESLINT_BIN="$(resolve_local_bin eslint)" && eslint_config_present; then
      # --fix rewrites safe issues; non-zero exit means residual
      # unfixed problems that aider must address or abandon.
      "${ESLINT_BIN}" --fix --no-error-on-unmatched-pattern \
        "${TARGET_FILE}" || exit $?
    fi
    ;;
esac

# ---------------------------------------------------------
# 4. STATIC STRUCTURAL GATE
# ---------------------------------------------------------

if [[ -f "${STATIC_GATE}" ]]; then
  bash "${STATIC_GATE}" "${TARGET_FILE}" || exit $?
fi

exit 0

#!/usr/bin/env bash

# =========================================================
# AEGIS HARNESS — AIDER LOCAL VALIDATION GATE
# =========================================================
#
# Hyper-focused per-file structural check invoked by aider's auto-lint
# reflection step (--lint-cmd) after each applied edit. Scope is ONLY
# the file aider just modified — never the workspace — so the internal
# correct-and-retry loop stays high-velocity:
#
# Order (cheap → structural):
#   1. syntax      — bash -n / node --check / tsc --noResolve 1-file / jq
#   2. prettier    — --write on the file only (pass-through if absent)
#   3. eslint      — --fix on the file only; residual errors fail the gate
#   4. static_gate — empty-catch, eval, undeclared imports
#
# Deliberately NOT in this gate (wrong loop / wrong cost model):
#   - project-wide tsc
#   - test suites
# Those belong to the one-shot mutation preflight (mutation_preflight.sh)
# and/or runtime capability evidence for adversarial/validation.
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
    # Mode-scoped compiler gate: optimize simplifies an already-repaired,
    # already-gated diff, so the tsc Node VM cold-start buys nothing there.
    if [[ "${AEGIS_MODE:-}" != "optimize" ]]; then
      TSC_BIN=""
      if TSC_BIN="$(resolve_local_bin tsc)"; then
        "${TSC_BIN}" --noEmit --noResolve --skipLibCheck --pretty false \
          "${TARGET_FILE}" || exit $?
      fi
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

case "${TARGET_FILE}" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs)
    if ESLINT_BIN="$(resolve_local_bin eslint)"; then
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

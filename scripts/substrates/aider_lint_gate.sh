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
# - shell   → bash -n            (syntax only, milliseconds)
# - js      → node --check       (parse only, no execution)
# - ts/tsx  → tsc single-file, --noResolve --skipLibCheck (structure
#             only; project-graph resolution is validation's job)
# - json    → jq empty
# - other   → pass-through (no gate, no latency)
#
# Exit 0  = edit structurally sound, aider finalizes immediately.
# Exit !0 = diagnostics on stdout/stderr feed aider's bounded internal
#           reflection (capped by aider itself and by the substrate's
#           wall-clock watchdog).
#
# This gate deliberately runs NO test suites, NO workspace-wide
# typecheck, NO installs — deep verification belongs to the
# adversarial/validation pipeline stages.
#
# =========================================================

set -u

TARGET_FILE="${1:-}"

[[ -n "${TARGET_FILE}" ]] || exit 0
[[ -f "${TARGET_FILE}" ]] || exit 0

case "${TARGET_FILE}" in
  *.sh|*.bash)
    bash -n "${TARGET_FILE}"
    ;;
  *.js|*.mjs|*.cjs|*.jsx)
    command -v node >/dev/null 2>&1 || exit 0
    node --check "${TARGET_FILE}"
    ;;
  *.ts|*.tsx)
    # Prefer the project-local compiler; fall back to PATH; pass through
    # when neither exists (no gate is better than a hanging install).
    TSC_BIN=""
    if [[ -x "node_modules/.bin/tsc" ]]; then
      TSC_BIN="node_modules/.bin/tsc"
    elif command -v tsc >/dev/null 2>&1; then
      TSC_BIN="tsc"
    fi
    [[ -n "${TSC_BIN}" ]] || exit 0
    "${TSC_BIN}" --noEmit --noResolve --skipLibCheck --pretty false "${TARGET_FILE}"
    ;;
  *.json)
    command -v jq >/dev/null 2>&1 || exit 0
    jq empty "${TARGET_FILE}"
    ;;
  *)
    exit 0
    ;;
esac

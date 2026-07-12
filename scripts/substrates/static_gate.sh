#!/usr/bin/env bash

# =========================================================
# AEGIS HARNESS — STATIC STRUCTURAL GATE
# =========================================================
#
# Mechanical, low-ambiguity structural checks. Not cognition.
# Not architectural interpretation. Only unequivocal failures:
#
#   1. AST rules under .harness/enforcement/rules/ (ast-grep)
#   2. Undeclared bare package imports vs package.json
#   3. Grep fallback for eval/new Function when sg is absent
#
# Usage:
#   bash static_gate.sh <file>                         # single file (lint path)
#   bash static_gate.sh --workspace [--imports] [paths...]
#
# Single-file mode (mutation lint path) always checks undeclared imports.
# Workspace mode checks AST rules always; undeclared imports only with
# --imports (or AEGIS_STATIC_GATE_IMPORTS=1) so operator enforce stays
# focused on structural physics without re-litigating dependency debt.
#
# Exit 0  = clean
# Exit !0 = at least one mechanical violation (diagnostics on stderr)
#
# =========================================================

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# substrates/ → repo root
AEGIS_STATIC_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
RULES_DIR="${AEGIS_STATIC_ROOT}/.harness/enforcement/rules"

# import check policy: on | off  (set by main())
STATIC_GATE_IMPORTS="on"

gate_error() {
  echo "[AEGIS][STATIC_GATE] $*" >&2
}

resolve_sg() {
  if [[ -x "${AEGIS_STATIC_ROOT}/node_modules/.bin/sg" ]]; then
    printf '%s\n' "${AEGIS_STATIC_ROOT}/node_modules/.bin/sg"
    return 0
  fi
  if command -v sg >/dev/null 2>&1; then
    command -v sg
    return 0
  fi
  return 1
}

# ---------------------------------------------------------
# AST-GREP RULES
# ---------------------------------------------------------

run_ast_rules_on_path() {
  local target="$1"
  local sg_bin
  local rule
  local failed=0
  local out
  local rc

  if ! sg_bin="$(resolve_sg)"; then
    return 0
  fi

  [[ -d "${RULES_DIR}" ]] || return 0

  shopt -s nullglob
  local rules=("${RULES_DIR}"/*.yml "${RULES_DIR}"/*.yaml)
  shopt -u nullglob

  [[ "${#rules[@]}" -gt 0 ]] || return 0

  for rule in "${rules[@]}"; do
    # short report keeps aider reflection payloads small
    rc=0
    out="$("${sg_bin}" scan \
      -r "${rule}" \
      --report-style short \
      --error \
      -- "${target}" 2>&1)" || rc=$?

    if [[ "${rc}" -ne 0 ]]; then
      failed=1
      if [[ -n "${out}" ]]; then
        while IFS= read -r line; do
          [[ -n "${line}" ]] && gate_error "${line}"
        done <<< "${out}"
      fi
    fi
  done

  return "${failed}"
}

# ---------------------------------------------------------
# EVAL FALLBACK (no ast-grep)
# ---------------------------------------------------------

run_eval_grep_fallback() {
  local file="$1"
  local hits
  local failed=0

  case "${file}" in
    *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs) ;;
    *) return 0 ;;
  esac

  # Only when sg is unavailable — otherwise AST rules own this surface.
  if ! resolve_sg >/dev/null 2>&1; then
    hits="$(
      grep -nE \
        '(^|[^[:alnum:]_$])eval[[:space:]]*\(|(^|[^[:alnum:]_$])new[[:space:]]+Function[[:space:]]*\(' \
        "${file}" 2>/dev/null || true
    )"

    if [[ -n "${hits}" ]]; then
      failed=1
      gate_error "eval/new Function is a hidden execution surface: ${file}"
      printf '%s\n' "${hits}" | while IFS= read -r line; do
        gate_error "  ${line}"
      done
    fi
  fi

  # Mechanical type-escape ban (works with or without sg for dual coverage
  # when rule YAML is missing; cheap enough to always run on TS).
  case "${file}" in
    *.ts|*.tsx)
      hits="$(
        grep -nE \
          '([[:space:]]as[[:space:]]+any\b)|(:[[:space:]]*any\b)|(<any>)|(as[[:space:]]+any\b)' \
          "${file}" 2>/dev/null || true
      )"
      # Drop false positives from comments/strings is imperfect; keep
      # conservative — lint eslint no-explicit-any is authoritative.
      if [[ -n "${hits}" ]]; then
        # Prefer sg rule when present; grep is a belt for mutation surfaces.
        if ! resolve_sg >/dev/null 2>&1; then
          failed=1
          gate_error "explicit any / as any is forbidden type escape: ${file}"
          printf '%s\n' "${hits}" | while IFS= read -r line; do
            gate_error "  ${line}"
          done
        fi
      fi
      ;;
  esac

  return "${failed}"
}

# ---------------------------------------------------------
# UNDECLARED BARE IMPORTS
# ---------------------------------------------------------

find_nearest_package_json() {
  local start="$1"
  local dir

  if [[ -f "${start}" ]]; then
    dir="$(cd "$(dirname "${start}")" && pwd)"
  elif [[ -d "${start}" ]]; then
    dir="$(cd "${start}" && pwd)"
  else
    return 1
  fi

  while true; do
    if [[ -f "${dir}/package.json" ]]; then
      printf '%s\n' "${dir}/package.json"
      return 0
    fi
    if [[ "${dir}" == "/" ]]; then
      return 1
    fi
    dir="$(dirname "${dir}")"
  done
}

is_node_builtin() {
  case "$1" in
    assert|async_hooks|buffer|child_process|cluster|console|constants|crypto| \
    dgram|diagnostics_channel|dns|domain|events|fs|fs/promises|http|http2| \
    https|inspector|module|net|os|path|path/posix|path/win32|perf_hooks| \
    process|punycode|querystring|readline|repl|stream|stream/promises| \
    string_decoder|sys|timers|tls|trace_events|tty|url|util|v8|vm|wasi| \
    worker_threads|zlib)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

# Bare specifier → package root name (@scope/pkg or pkg).
# Prints nothing and returns 1 for relative/absolute/node: paths.
package_root_name() {
  local spec="$1"

  case "${spec}" in
    ./*|../*|/*|node:*)
      return 1
      ;;
  esac

  if [[ "${spec}" == @*/* ]]; then
    local rest="${spec#@}"
    local scope="${rest%%/*}"
    local after="${rest#*/}"
    local name="${after%%/*}"
    printf '%s\n' "@${scope}/${name}"
    return 0
  fi

  printf '%s\n' "${spec%%/*}"
  return 0
}

declared_package_set() {
  local pkg_json="$1"

  command -v jq >/dev/null 2>&1 || return 1

  jq -r '
    [
      (.dependencies // {}),
      (.devDependencies // {}),
      (.peerDependencies // {}),
      (.optionalDependencies // {})
    ]
    | add
    | keys[]?
  ' "${pkg_json}" 2>/dev/null
}

extract_bare_specifiers() {
  local file="$1"

  # from 'x' / from "x"
  grep -oE "from[[:space:]]+['\"][^'\"]+['\"]" "${file}" 2>/dev/null \
    | sed -E "s/^from[[:space:]]+['\"]//; s/['\"]$//" || true

  # require('x') / require("x")
  grep -oE "require\([[:space:]]*['\"][^'\"]+['\"]" "${file}" 2>/dev/null \
    | sed -E "s/^require\([[:space:]]*['\"]//; s/['\"]$//" || true

  # import('x') dynamic
  grep -oE "import\([[:space:]]*['\"][^'\"]+['\"]" "${file}" 2>/dev/null \
    | sed -E "s/^import\([[:space:]]*['\"]//; s/['\"]$//" || true
}

check_undeclared_imports() {
  local file="$1"
  local pkg_json
  local -A declared=()
  local spec root name
  local failed=0
  local -A reported=()

  [[ "${STATIC_GATE_IMPORTS}" == "on" ]] || return 0

  case "${file}" in
    *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs) ;;
    *) return 0 ;;
  esac

  [[ -f "${file}" ]] || return 0

  pkg_json="$(find_nearest_package_json "${file}")" || return 0

  while IFS= read -r name; do
    [[ -n "${name}" ]] || continue
    declared["${name}"]=1
  done < <(declared_package_set "${pkg_json}" || true)

  # No dependency table → nothing to enforce.
  [[ "${#declared[@]}" -gt 0 ]] || return 0

  while IFS= read -r spec; do
    [[ -n "${spec}" ]] || continue
    root="$(package_root_name "${spec}")" || continue
    is_node_builtin "${root}" && continue
    [[ -n "${declared[$root]:-}" ]] && continue
    [[ -n "${reported[$root]:-}" ]] && continue
    reported["${root}"]=1
    gate_error "undeclared_import: '${root}' in ${file} (not in package.json dependencies)"
    failed=1
  done < <(extract_bare_specifiers "${file}")

  return "${failed}"
}

# ---------------------------------------------------------
# PUBLIC ENTRY
# ---------------------------------------------------------

gate_file() {
  local file="$1"
  local failed=0

  [[ -n "${file}" ]] || return 0
  [[ -f "${file}" ]] || return 0

  run_ast_rules_on_path "${file}" || failed=1
  run_eval_grep_fallback "${file}" || failed=1
  check_undeclared_imports "${file}" || failed=1

  return "${failed}"
}

gate_workspace() {
  local -a paths=("$@")
  local failed=0
  local p

  if [[ "${#paths[@]}" -eq 0 ]]; then
    paths=("${AEGIS_STATIC_ROOT}/src")
  fi

  for p in "${paths[@]}"; do
    if [[ -f "${p}" ]]; then
      gate_file "${p}" || failed=1
    elif [[ -d "${p}" ]]; then
      run_ast_rules_on_path "${p}" || failed=1
      # Import check is per-file (needs package.json proximity).
      while IFS= read -r -d '' f; do
        check_undeclared_imports "${f}" || failed=1
        run_eval_grep_fallback "${f}" || failed=1
      done < <(
        find "${p}" \( \
          -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o \
          -name '*.jsx' -o -name '*.mjs' -o -name '*.cjs' \
        \) -type f -print0 2>/dev/null
      )
    else
      gate_error "missing_path: ${p}"
      failed=1
    fi
  done

  return "${failed}"
}

main() {
  if [[ "${1:-}" == "--workspace" ]]; then
    shift
    # Workspace defaults to AST-only; opt into import ledger explicitly.
    STATIC_GATE_IMPORTS="off"
    if [[ "${AEGIS_STATIC_GATE_IMPORTS:-}" == "1" ]]; then
      STATIC_GATE_IMPORTS="on"
    fi
    while [[ "${1:-}" == "--imports" ]]; do
      STATIC_GATE_IMPORTS="on"
      shift
    done
    if gate_workspace "$@"; then
      echo "[AEGIS][STATIC_GATE] workspace clean" >&2
      exit 0
    fi
    gate_error "workspace_violations"
    exit 1
  fi

  if [[ "$#" -lt 1 ]]; then
    gate_error "usage: static_gate.sh <file> | --workspace [--imports] [paths...]"
    exit 2
  fi

  # Single-file (mutation lint path): full mechanical surface.
  STATIC_GATE_IMPORTS="on"
  if gate_file "$1"; then
    exit 0
  fi
  exit 1
}

main "$@"

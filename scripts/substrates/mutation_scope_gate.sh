#!/usr/bin/env bash

# =========================================================
# AEGIS HARNESS — MUTATION SCOPE GATE (mechanical authority)
# =========================================================
#
# Pure, deterministic check: every changed path must be ⊆ authorized
# mutation targets. No cognition. No formatters.
#
# Usage (CLI):
#   bash mutation_scope_gate.sh \
#     --authorized-file <newline paths> \
#     --changed-file <newline paths>
#
# Usage (source):
#   source mutation_scope_gate.sh
#   mutation_scope_check <authorized_newline> <changed_newline>
#   → prints unauthorized paths on stdout; exit 1 if any
#
# Exit 0 — all changed paths authorized (or changed empty)
# Exit 1 — at least one unauthorized path (listed on stdout)
# Exit 2 — usage / IO error
#
# When authorized set is empty, the gate is a no-op (exit 0): the
# substrate already warned that no targets resolved; inventing a
# total deny would break the intentional no-targets fallback.
#
# =========================================================

mutation_scope_norm_path() {
  local p="${1:-}"
  p="${p#./}"
  # git may emit a/ or b/ prefixes outside unified +++ lines; strip if present
  p="${p#a/}"
  p="${p#b/}"
  printf '%s' "${p}"
}

# Returns 0 if $1 is authorized by the newline list in $2 (exact match).
mutation_scope_is_authorized() {
  local candidate="$1"
  local authorized_blob="$2"
  local line

  [[ -n "${candidate}" ]] || return 0

  while IFS= read -r line; do
    [[ -n "${line}" ]] || continue
    line="$(mutation_scope_norm_path "${line}")"
    [[ "${candidate}" == "${line}" ]] && return 0
  done <<< "${authorized_blob}"

  return 1
}

# Args: authorized_blob changed_blob (both newline-separated).
# Prints unauthorized paths (one per line). Exit 1 if any.
mutation_scope_check() {
  local authorized_blob="${1:-}"
  local changed_blob="${2:-}"
  local path
  local offenders=()

  # Empty authorized set → skip (caller documents no-targets fallback).
  if [[ -z "$(printf '%s' "${authorized_blob}" | sed '/^$/d')" ]]; then
    return 0
  fi

  while IFS= read -r path; do
    [[ -n "${path}" ]] || continue
    path="$(mutation_scope_norm_path "${path}")"
    [[ -n "${path}" ]] || continue
    if ! mutation_scope_is_authorized "${path}" "${authorized_blob}"; then
      offenders+=("${path}")
    fi
  done <<< "${changed_blob}"

  if [[ "${#offenders[@]}" -eq 0 ]]; then
    return 0
  fi

  local o
  for o in "${offenders[@]}"; do
    printf '%s\n' "${o}"
  done
  return 1
}

# CLI entry when executed (not sourced).
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  set -u

  authorized_file=""
  changed_file=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --authorized-file)
        shift
        authorized_file="${1:-}"
        ;;
      --changed-file)
        shift
        changed_file="${1:-}"
        ;;
      -h|--help)
        echo "Usage: $0 --authorized-file PATH --changed-file PATH" >&2
        exit 0
        ;;
      *)
        echo "[AEGIS][SCOPE_GATE] unknown argument: $1" >&2
        exit 2
        ;;
    esac
    shift
  done

  [[ -n "${authorized_file}" && -f "${authorized_file}" ]] \
    || { echo "[AEGIS][SCOPE_GATE] missing --authorized-file" >&2; exit 2; }
  [[ -n "${changed_file}" && -f "${changed_file}" ]] \
    || { echo "[AEGIS][SCOPE_GATE] missing --changed-file" >&2; exit 2; }

  authorized_blob="$(cat "${authorized_file}")"
  changed_blob="$(cat "${changed_file}")"

  if offenders="$(mutation_scope_check "${authorized_blob}" "${changed_blob}")"; then
    exit 0
  else
    printf '%s\n' "${offenders}"
    exit 1
  fi
fi

#!/usr/bin/env bash

# =========================================================
# AEGIS — MANAGED COMMIT RECORD
# =========================================================
#
# Source-only. Reads and renders the trailer record that
# ./aegis writes on an operator-approved commit:
#
#   Aegis-Issue:  <n>
#   Aegis-Accept: <token>[, <token>...]
#   Aegis-Why:    <one line, human, optional>
#
# Three fields, and every one of them has a reader: Accept feeds the
# regression gate, Issue feeds the digest, Why is for whoever opens the
# file next. A field nobody reads would carry no information.
#
# Only commits carrying Aegis-Accept are record. Free-text runs,
# the harness auto-commit and hand-made commits stay invisible
# here by construction — no seeding, no history rewriting.
#
# Every read is scoped by pathspec so harness construction
# commits never leak into the target's record.
#
# No network. No LLM. git + awk only.
#
# =========================================================

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "[AEGIS][FATAL] record_lib_not_invocable" >&2
  exit 1
fi

: "${AEGIS_RECORD_MAX_COMMITS:=100}"

# Native git trailer extraction: one process, no body parsing.
# Emits TSV <short sha> <issue> <accept csv>; commits without
# Aegis-Accept are dropped (they are not record).
aegis_record_entries() {
  local scope="${1:-.}"
  git log -n "${AEGIS_RECORD_MAX_COMMITS}" \
    --format='%h%x09%(trailers:key=Aegis-Issue,valueonly,separator=%x20)%x09%(trailers:key=Aegis-Accept,valueonly,separator=%x2C)' \
    -- "${scope}" 2>/dev/null \
    | awk -F'\t' 'NF >= 3 && $3 != ""' \
    || true
}

# Tokens an earlier managed commit proved on this path. The mutation
# intent gate treats their silent removal as a regression.
aegis_record_protected_tokens() {
  local path="${1-}"
  [[ -n "${path}" ]] || return 0
  aegis_record_entries "${path}" \
    | cut -f3 \
    | tr ',' '\n' \
    | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//' \
    | grep -v '^$' \
    | sort -u \
    || true
}

# Files a record commit touched, restricted to the scope.
aegis_record_commit_files() {
  local sha="${1-}"
  local scope="${2:-.}"
  [[ -n "${sha}" ]] || return 0
  git show --name-only --format= "${sha}" -- "${scope}" 2>/dev/null \
    | grep -v '^$' \
    || true
}

# Commit message for an approved managed commit.
# Args: issue, summary, accept_csv
aegis_record_render_message() {
  local issue="${1-}"
  local summary="${2-}"
  local accept="${3-}"
  printf 'aegis: issue#%s %s\n\n' "${issue}" "${summary}"
  printf 'Aegis-Issue: %s\n' "${issue}"
  printf 'Aegis-Accept: %s\n' "${accept}"
}

# One-page digest for an operator or a coding assistant: what the
# record proved on each file, and whether it is still there.
# A missing token is exactly what the regression gate blocks.
aegis_record_digest() {
  local scope="${1:-.}"
  local entries count rows
  entries="$(aegis_record_entries "${scope}")"
  count="$(printf '%s' "${entries}" | grep -c . || true)"
  count="${count//[^0-9]/}"
  count="${count:-0}"

  printf 'target: %s · registo: %s commits geridos\n' "${scope}" "${count}"

  if [[ "${count}" -eq 0 ]]; then
    printf '\n(sem registo — nenhum commit gerido ainda; nada protegido)\n'
    return 0
  fi

  # file <tab> token <tab> issue, one row per proven token.
  rows="$(
    printf '%s\n' "${entries}" | while IFS=$'\t' read -r sha issue accept; do
      [[ -n "${sha}" ]] || continue
      local file token
      while IFS= read -r file; do
        [[ -n "${file}" ]] || continue
        while IFS= read -r token; do
          [[ -n "${token}" ]] || continue
          printf '%s\t%s\t%s\n' "${file}" "${token}" "${issue}"
        done < <(
          printf '%s' "${accept}" | tr ',' '\n' \
            | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//' | grep -v '^$'
        )
      done < <(aegis_record_commit_files "${sha}" "${scope}")
    done | sort -u
  )"

  # A herestring keeps the loop in this shell, so the counter survives it.
  local current_file="" file token issue mark missing=0
  while IFS=$'\t' read -r file token issue; do
    [[ -n "${file}" ]] || continue
    if [[ "${file}" != "${current_file}" ]]; then
      printf '\n%s\n' "${file}"
      current_file="${file}"
    fi
    mark='✓'
    if [[ ! -f "${file}" ]] || ! grep -Fq -- "${token}" "${file}" 2>/dev/null; then
      mark='✗'
      missing=$((missing + 1))
    fi
    printf '  %s %-40s issue#%s\n' "${mark}" "${token}" "${issue}"
  done <<< "${rows}"

  [[ "${missing}" -eq 0 ]] \
    || printf '\n✗ = provado antes e já não está no ficheiro (%s)\n' "${missing}"
}

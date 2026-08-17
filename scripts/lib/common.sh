#!/usr/bin/env bash

# =========================================================
# AEGIS HARNESS — SHARED SCRIPT LIBRARY
# =========================================================
#
# Source-only. Provides tagged logging (AEGIS_LOG_TAG) and
# timing shared by every script family.
#
# =========================================================

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "[AEGIS][FATAL] common_lib_not_invocable" >&2
  exit 1
fi

aegis_log() {
  echo "[AEGIS][${AEGIS_LOG_TAG:-HARNESS}] $*" >&2
}

aegis_warn() {
  echo "[AEGIS][${AEGIS_LOG_TAG:-HARNESS}][WARN] $*" >&2
}

aegis_fatal() {
  local msg="$*"
  echo "[AEGIS][${AEGIS_LOG_TAG:-HARNESS}][FATAL] ${msg}" >&2
  local breadcrumb_dir="${AEGIS_RUNTIME_DIR:-.harness/runtime}"
  mkdir -p "${breadcrumb_dir}" 2>/dev/null || true
  printf '%s\n' "${msg}" > "${breadcrumb_dir}/last_fatal" 2>/dev/null || true

  local root_dir="${AEGIS_ROOT_DIR:-${ROOT:-}}"
  if [[ -n "${root_dir}" && "${root_dir}/.harness/runtime" != "${breadcrumb_dir}" ]]; then
    mkdir -p "${root_dir}/.harness/runtime" 2>/dev/null || true
    printf '%s\n' "${msg}" > "${root_dir}/.harness/runtime/last_fatal" 2>/dev/null || true
  fi
  exit 1
}

# ---------------------------------------------------------
# Operator-named source paths (single regex family)
# ---------------------------------------------------------
# Shared by mutation target resolution and artifact authorization.
# grep -oE and jq match() must stay byte-equivalent on this pattern.
# Word-boundary after extension so "package.json" does NOT match as "package.js".
readonly AEGIS_SOURCE_PATH_RE='[A-Za-z0-9_./-]+\.(ts|tsx|js|jsx|mjs|cjs|sh|py)\b'

aegis_demand_md_section() {
  local heading="$1"
  local text="${2-}"
  [[ -n "${text}" ]] || return 0
  printf '%s\n' "${text}" | command awk -v h="## ${heading}" '
    BEGIN { p = 0 }
    /^## / {
      if (p) { exit }
      if ($0 == h) { p = 1; next }
      next
    }
    p { print }
  '
}

aegis_demand_is_structured() {
  local text="${1-}"
  printf '%s\n' "${text}" | command grep -qE '^## (Goal|Targets|Acceptance|Change|Out of scope|Constraints)\s*$'
}

# Newline-separated unique paths; strips leading ./. Empty text → no lines.
# Structured demand (## Targets present with body): only scrape that section so
# Change/Acceptance/Out of scope do not invent ghost paths (tokenBucket.js).
aegis_extract_operator_named_paths() {
  local text="${1-}"
  local scope=""
  [[ -n "${text}" ]] || return 0
  if printf '%s\n' "${text}" | command grep -qE '^## Targets[[:space:]]*$'; then
    scope="$(
      printf '%s\n' "${text}" | awk '
        BEGIN { p = 0 }
        /^## / {
          if (p) { exit }
          if ($0 == "## Targets") { p = 1; next }
          next
        }
        p { print }
      '
    )"
    if [[ -n "$(printf '%s' "${scope}" | tr -d '[:space:]')" ]]; then
      text="${scope}"
    fi
  fi
  printf '%s' "${text}" \
    | command grep -oE "${AEGIS_SOURCE_PATH_RE}" 2>/dev/null \
    | command sed 's|^\./||' \
    | command grep -Ev '[<>]' \
    | sort -u \
    || true
}

# Always emits a compact JSON array (possibly empty).
aegis_extract_operator_named_paths_json() {
  local text="${1-}"
  local raw=""
  raw="$(aegis_extract_operator_named_paths "${text}")"
  if [[ -z "${raw}" ]]; then
    printf '[]'
    return 0
  fi
  if ! printf '%s\n' "${raw}" \
    | jq -R -s -c 'split("\n") | map(select(length > 0))' 2>/dev/null; then
    printf '[]'
  fi
}

# Successor of $1 in whitespace-separated sequence $2 (empty if last/missing).
aegis_next_in_sequence() {
  local current="$1"
  local -a sequence=()
  local i
  read -r -a sequence <<< "${2:-}"
  for i in "${!sequence[@]}"; do
    if [[ "${sequence[$i]}" == "${current}" ]]; then
      printf '%s' "${sequence[$((i + 1))]:-}"
      return 0
    fi
  done
  printf ''
}

# Timestamps via portable date subshells: the printf '%(%s)T' builtin
# token requires Bash >= 4.2 and evaluates empty on macOS stock Bash 3.2,
# which would break the $((end-start)) arithmetic below.
# When AEGIS_METRICS_FILE is set, append one JSON line for pipeline reports.
measure() {
  local label="$1"
  local start end elapsed
  start=$(date +%s)
  shift
  "$@"
  end=$(date +%s)
  elapsed=$((end - start))
  echo "[AEGIS][TIMING] ${label}: ${elapsed}s" >&2
  if [[ -n "${AEGIS_METRICS_FILE:-}" ]]; then
    jq -cn \
      --arg label "${label}" \
      --argjson seconds "${elapsed}" \
      --arg mode "${AEGIS_MODE:-}" \
      --arg at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
      '{kind:"timing",label:$label,seconds:$seconds,mode:$mode,at:$at}' \
      >> "${AEGIS_METRICS_FILE}" 2>/dev/null || true
  fi
}

# ---------------------------------------------------------
# Shared Prompt & Envelope Helpers
# ---------------------------------------------------------

aegis_hash_file() {
  local target_file="${1:-}"
  [[ -f "${target_file}" ]] || return 0
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 < "${target_file}" | awk '{print $1}'
  else
    cksum < "${target_file}" | awk '{print $1}'
  fi
}

# Deterministic architecture directives resolution across disposable worktrees
# and substrate roots. Emits custom project architecture or Universal Core + Language Presets.
aegis_resolve_architecture_section() {
  local surface_path="${1:-}"
  local substrate_root="${2:-${AEGIS_SUBSTRATE_ROOT:-.}}"
  local arch_path="" arch_candidate
  local -a candidates=()

  if [[ -n "${surface_path}" ]]; then
    candidates+=(
      "${surface_path}/ARCHITECTURE.md"
      "${surface_path}/src/ARCHITECTURE.md"
    )
  fi
  candidates+=(
    "${substrate_root}/ARCHITECTURE.md"
    "${substrate_root}/src/ARCHITECTURE.md"
  )

  for arch_candidate in "${candidates[@]}"; do
    if [[ -f "${arch_candidate}" ]]; then
      arch_path="${arch_candidate}"
      break
    fi
  done

  if [[ -n "${arch_path}" ]]; then
    local arch_label="${arch_path}"
    arch_label="${arch_label#${surface_path:-__none__}/}"
    arch_label="${arch_label#${substrate_root}/}"
    printf '\nTarget application architecture directives (%s):\n%s\n' "${arch_label}" "$(cat "${arch_path}")"
  else
    # Fallback to Universal Core + Language Facet Presets
    local presets_dir="${AEGIS_ROOT_DIR:-.}/.harness/presets"
    if [[ -d "${presets_dir}" ]]; then
      local lang="typescript"
      if declare -f aegis_detect_target_language >/dev/null 2>&1; then
        lang="$(aegis_detect_target_language "${surface_path:-${substrate_root}}")"
      fi
      local core_preset="${presets_dir}/ARCHITECTURE.core.md"
      local lang_preset="${presets_dir}/ARCHITECTURE.${lang}.md"
      local content=""
      [[ -f "${core_preset}" ]] && content="$(cat "${core_preset}")"
      if [[ -f "${lang_preset}" ]]; then
        [[ -n "${content}" ]] && content="${content}"$'\n\n'
        content="${content}$(cat "${lang_preset}")"
      fi
      if [[ -n "${content}" ]]; then
        printf '\nTarget application architecture directives (preset:%s):\n%s\n' "${lang}" "${content}"
      fi
    fi
  fi
}

# Envelope identity (execution_id, generated_at) is dropped from the RENDERED
# projection only; the on-disk payload keeps full provenance for auditing.
aegis_project_capability_envelope() {
  local payload_path="$1"
  local output_file="$2"
  if jq -c '
        if (type == "object")
          and has("capability")
          and has("classification")
        then del(.execution_id, .generated_at)
        else . end
      ' "${payload_path}" > "${output_file}" 2>/dev/null; then
    return 0
  fi
  cat "${payload_path}" > "${output_file}"
}

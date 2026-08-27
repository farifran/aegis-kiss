#!/usr/bin/env bash

# =========================================================
# AEGIS HARNESS — DEMAND INTAKE & EPISTEMIC ANCHORS (TOPIC 1)
# =========================================================
#
# Runtime-owned investigation demand helpers:
#   - GitHub issue fetch (real body with cache in RAM/disk)
#   - Demand normalization & mechanical path-safety
#   - Shared demand tokenization & dense search queries
#   - Pre-intake discovery (exports, barrel, pocket map)
#   - Mechanical discovery & forensics substrate dispatchers
#
# =========================================================

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "[AEGIS][FATAL] demand_lib_not_invocable" >&2
  exit 1
fi

# Multi-token search delimiter (not valid in token alphabet):
readonly AEGIS_DEMAND_TOKEN_SEP=';;'

# Sourcing modular subsystems (preserves 100% backward compatibility)
_aegis_lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1090
[[ -f "${_aegis_lib_dir}/mutation_helpers.sh" ]] && source "${_aegis_lib_dir}/mutation_helpers.sh"
# shellcheck disable=SC1090
[[ -f "${_aegis_lib_dir}/mechanical_scans.sh" ]] && source "${_aegis_lib_dir}/mechanical_scans.sh"
unset _aegis_lib_dir

aegis_demand_is_stopword() {
  case "$(printf '%s' "${1-}" | tr '[:upper:]' '[:lower:]')" in
    # EN glue
    that|this|with|from|have|been|will|into|your|about|after|before|over|under|when|what|which|where|while|than|then|them|they|were|also|just|only|more|most|some|such|each|other|into|onto|upon|make|made|like|using|used|use|function|functions|helper|helpers|module|modules|file|files|code|test|tests|add|fix|create|update|change|changes|implement|please|need|needs|want|should|could|would|investigate|analysis|analyze|repository|project|feature)
      return 0
      ;;
    # PT glue (keep domain stems like conversao/megabits out of this list)
    como|para|pelo|pela|pelos|pelas|uma|umas|uns|este|esta|estes|estas|isso|aquele|aquela|sobre|entre|sem|com|dos|das|nos|nas|funcao|funcoes|funcionalidade|arquivo|arquivos|codigo|projeto|repositorio|preciso|adicionar|corrigir|criar|implementar|analise|analisar)
      return 0
      ;;
    # Structured-demand header labels (never domain signal)
    goal|goals|target|targets|acceptance|constraint|constraints|change|scope|demand|structured|when)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

# Ultra-common stems: OK for path/basename hints, too noisy for content
# resonance and primary search in larger trees (e.g. "bytes" everywhere).

aegis_demand_is_generic_token() {
  case "$(printf '%s' "${1-}" | tr '[:upper:]' '[:lower:]')" in
    byte|bytes|bit|bits|data|type|types|name|names|value|values|list|item|items|path|paths|text|json|http|https|main|index|app|src|lib|util|utils|core|base|info|error|errors|true|false|null|void|string|number|object|array|class|const|export|import|return|async|await|public|private|static|input|output|result|results|config|default|option|options|param|params|arg|args|key|keys|id|ids|user|users|request|response|service|server|client|model|models|state|status|content|context|message|messages|line|lines|size|length|count|total|unit|units|time|date|year|home|root|node|package|script|scripts|build|dist|temp|tmp|todo|note|notes|readme|license|version|v1|v2)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

# Newline-separated unique tokens (lowercase). Empty text → no lines.
# Accent fold via Python NFKD (macOS iconv//TRANSLIT mangles ões/ão).

aegis_demand_tokens() {
  local text="${1-}"
  [[ -n "${text}" ]] || return 0

  printf '%s' "${text}" | python3 -c '
import re
import sys
import unicodedata

raw = sys.stdin.read()
folded = unicodedata.normalize("NFKD", raw)
folded = "".join(ch for ch in folded if not unicodedata.combining(ch))
folded = folded.lower()
# Identifier-ish tokens only (search + path resonance safe).
tokens = re.findall(r"[a-z0-9][a-z0-9_.-]*[a-z0-9]|[a-z0-9]{4,}", folded)
seen = set()
for t in tokens:
    if len(t) < 4 or t in seen:
        continue
    seen.add(t)
    print(t)
' | while IFS= read -r token; do
    [[ -n "${token}" ]] || continue
    aegis_demand_is_stopword "${token}" && continue
    printf '%s\n' "${token}"
  done | sort -u
}

# Dense tokens: non-generic, length >= 5. Preferred for content resonance
# and search so short/common stems do not flood monorepos.

aegis_demand_dense_tokens() {
  local text="${1-}"
  local token
  while IFS= read -r token; do
    [[ -n "${token}" ]] || continue
    [[ "${#token}" -ge 5 ]] || continue
    aegis_demand_is_generic_token "${token}" && continue
    printf '%s\n' "${token}"
  done < <(aegis_demand_tokens "${text}")
}

# Compact search query for filesystem.search_symbol.
# Prefers dense tokens (longest first), falls back to any tokens, then $2.
# Multiple tokens joined with AEGIS_DEMAND_TOKEN_SEP for multi -F search
# (never ERE — dots in identifiers must stay literal).

aegis_demand_search_query() {
  local text="${1-}"
  local fallback="${2:-AEGIS}"
  local max_tokens="${3:-3}"
  local tokens query

  tokens="$(aegis_demand_dense_tokens "${text}")"
  # Fallback when demand is only short/generic stems.
  if [[ -z "${tokens}" ]]; then
    tokens="$(aegis_demand_tokens "${text}")"
  fi
  tokens="$(
    printf '%s\n' "${tokens}" \
      | awk 'NF { print length, $0 }' \
      | sort -rn \
      | awk '{ print $2 }' \
      | awk '!seen[$0]++' \
      | head -n "${max_tokens}"
  )"

  if [[ -z "${tokens}" ]]; then
    printf '%s' "${fallback}"
    return 0
  fi

  # paste -d only takes single-char delimiters; join multi-char manually.
  query="$(
    printf '%s\n' "${tokens}" | awk -v sep="${AEGIS_DEMAND_TOKEN_SEP}" '
      NF {
        if (n++) printf "%s", sep
        printf "%s", $0
      }
    '
  )"
  printf '%s' "${query}"
}

# Pathspecs for filesystem.search_symbol (newline-separated, repo-relative).
# Mechanical only — never invents paths:
#   1. operator-named source paths in demand text
#   2. handover next_attention_targets
#   3. live attention_seed payload (if present)
#   4. if still empty and ./src exists → "src" (product root default)
# Empty stdout → search_symbol falls back to SEARCH_ROOT (usually ".").

aegis_search_symbol_pathspecs() {
  local text="${1-${AEGIS_INVESTIGATION_INPUT:-}}"
  local payload_dir="${2-${AEGIS_CAPABILITY_PAYLOAD_DIR:-}}"
  local handover="${3-${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-${AEGIS_EPISTEMIC_HANDOVER_FILE:-}}}"

  local specs
  specs="$(
    {
      if declare -f aegis_extract_operator_named_paths >/dev/null 2>&1; then
        aegis_extract_operator_named_paths "${text}"
      fi
      if [[ -n "${handover}" && -f "${handover}" ]]; then
        jq -r '.epistemic_state.next_attention_targets[]? // empty' "${handover}" 2>/dev/null || true
      fi
      if [[ -n "${payload_dir}" && -f "${payload_dir}/runtime_attention_seed.json" ]]; then
        jq -r '.payload.attention_targets[]? // empty' "${payload_dir}/runtime_attention_seed.json" 2>/dev/null || true
      fi
    } | sed 's|^filesystem\.read:||; s|^\./||' \
      | awk 'NF && $0 !~ /^\// && $0 !~ /\.\./ { if ($0 ~ /\./ || $0 ~ /\//) print; else if (system("test -e \"" $0 "\"") == 0) print }' \
      | awk '!seen[$0]++'
  )"

  if [[ -z "${specs}" ]]; then
    [[ -d "src" ]] && printf 'src\n'
    return 0
  fi
  printf '%s\n' "${specs}"
}

# Resolve + export AEGIS_SEARCH_SYMBOL_PATHSPECS for the search handler.

aegis_export_search_symbol_pathspecs() {
  if ! declare -f aegis_search_symbol_pathspecs >/dev/null 2>&1; then
    return 0
  fi
  AEGIS_SEARCH_SYMBOL_PATHSPECS="$(
    aegis_search_symbol_pathspecs \
      "${1-${AEGIS_INVESTIGATION_INPUT:-}}" \
      "${2-${AEGIS_CAPABILITY_PAYLOAD_DIR:-}}" \
      "${3-${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-${AEGIS_EPISTEMIC_HANDOVER_FILE:-}}}"
  )"
  export AEGIS_SEARCH_SYMBOL_PATHSPECS
}

# ---------------------------------------------------------
# Section extract (optional ## Headers)
# ---------------------------------------------------------

# Print body under first "## <Heading>" (case-sensitive), until next "## ".

aegis_demand_md_section() {
  local heading="$1"
  local text="${2-}"
  [[ -n "${text}" ]] || return 0
  printf '%s\n' "${text}" | awk -v h="## ${heading}" '
    BEGIN { p = 0 }
    /^## / {
      if (p) { exit }
      if ($0 == h) { p = 1; next }
      next
    }
    p { print }
  '
}

# True when text carries at least one demand-shaped header.

aegis_demand_is_structured() {
  local text="${1-}"
  printf '%s\n' "${text}" | grep -qE '^## (Goal|Targets|Acceptance|Change|Out of scope|Constraints)\s*$'
}

# Collapse a multi-line section to a single dense line (spaces, trim).

aegis_demand_flatten_section() {
  local raw="${1-}"
  [[ -n "${raw}" ]] || return 0
  printf '%s' "${raw}" \
    | tr '\n' ' ' \
    | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//'
}

# ---------------------------------------------------------
# Path safety (mechanical)
# ---------------------------------------------------------

# Fatal on path traversal / absolute paths in operator-named tokens.

aegis_demand_assert_paths_safe() {
  local text="${1-}"
  local path
  while IFS= read -r path; do
    [[ -n "${path}" ]] || continue
    if [[ "${path}" == /* ]] || [[ "${path}" == *..* ]]; then
      if declare -f aegis_fatal >/dev/null 2>&1; then
        aegis_fatal "demand_path_unsafe:${path}"
      fi
      echo "[AEGIS][DEMAND][FATAL] demand_path_unsafe:${path}" >&2
      exit 1
    fi
  done < <(aegis_extract_operator_named_paths "${text}")
}

# ---------------------------------------------------------
# Soft normalize (structured → short head + original body)
# ---------------------------------------------------------

# When ## Goal / ## Targets / … are present, emit a compact head that
# small models parse reliably, then the original body so path regex and
# human audit remain complete. Unstructured free-text is unchanged.

aegis_normalize_demand_text() {
  local text="${1-}"
  local goal targets acceptance change oos constraints
  local head=""

  [[ -n "${text}" ]] || {
    printf ''
    return 0
  }

  # Idempotent: already materialised structured or task-scoped demand.
  if printf '%s' "${text}" | head -n 1 | grep -qx 'Demand (structured):'; then
    printf '%s' "${text}"
    return 0
  fi
  if printf '%s' "${text}" | head -n 1 | grep -qE '^AEGIS_DEMAND '; then
    printf '%s' "${text}"
    return 0
  fi

  if ! aegis_demand_is_structured "${text}"; then
    printf '%s' "${text}"
    return 0
  fi

  goal="$(aegis_demand_flatten_section "$(aegis_demand_md_section "Goal" "${text}")")"
  targets="$(aegis_demand_flatten_section "$(aegis_demand_md_section "Targets" "${text}")")"
  acceptance="$(aegis_demand_flatten_section "$(aegis_demand_md_section "Acceptance" "${text}")")"
  change="$(aegis_demand_flatten_section "$(aegis_demand_md_section "Change" "${text}")")"
  oos="$(aegis_demand_flatten_section "$(aegis_demand_md_section "Out of scope" "${text}")")"
  constraints="$(aegis_demand_flatten_section "$(aegis_demand_md_section "Constraints" "${text}")")"

  head="Demand (structured):"
  [[ -n "${goal}" ]] && head+=$'\n'"Goal: ${goal}"
  [[ -n "${targets}" ]] && head+=$'\n'"Targets: ${targets}"
  [[ -n "${change}" ]] && head+=$'\n'"Change: ${change}"
  [[ -n "${acceptance}" ]] && head+=$'\n'"Done when: ${acceptance}"
  [[ -n "${oos}" ]] && head+=$'\n'"Out of scope: ${oos}"
  [[ -n "${constraints}" ]] && head+=$'\n'"Constraints: ${constraints}"

  printf '%s\n\n---\n\n%s' "${head}" "${text}"
}

# ---------------------------------------------------------
# GitHub issue materialization
# ---------------------------------------------------------

# Fetch issue title+body via `gh`. Emits a demand document; never the
# placeholder "issue #N". Fatal when gh is missing or the fetch fails.

aegis_fetch_issue_demand() {
  local issue_number="$1"
  local json title body

  [[ "${issue_number}" =~ ^[0-9]+$ ]] || {
    if declare -f aegis_fatal >/dev/null 2>&1; then
      aegis_fatal "invalid_issue_number"
    fi
    echo "[AEGIS][DEMAND][FATAL] invalid_issue_number" >&2
    exit 1
  }

  # Pipeline re-enters runtime per mode; cache avoids mid-run gh flakes
  # (seen as issue_fetch_failed on late modes after discovery succeeded).
  local cache_dir cache_file
  cache_dir="${AEGIS_RUNTIME_DIR:-${AEGIS_ROOT_DIR:-.}/.harness/runtime}/issue_cache"
  cache_file="${cache_dir}/issue_${issue_number}.md"
  if [[ -f "${cache_file}" && -s "${cache_file}" ]] \
    && [[ "${AEGIS_ISSUE_CACHE_REFRESH:-0}" != "1" ]]; then
    cat "${cache_file}"
    return 0
  fi

  if ! command -v gh >/dev/null 2>&1; then
    if declare -f aegis_fatal >/dev/null 2>&1; then
      aegis_fatal "missing_gh_for_issue_fetch"
    fi
    echo "[AEGIS][DEMAND][FATAL] missing_gh_for_issue_fetch" >&2
    exit 1
  fi

  if ! json="$(
    env -u GITHUB_TOKEN gh issue view "${issue_number}" --json title,body 2>/dev/null
  )"; then
    # One retry without env -u (some setups only have GITHUB_TOKEN).
    if ! json="$(
      gh issue view "${issue_number}" --json title,body 2>/dev/null
    )"; then
      if [[ -f "${cache_file}" && -s "${cache_file}" ]]; then
        cat "${cache_file}"
        return 0
      fi
      if declare -f aegis_fatal >/dev/null 2>&1; then
        aegis_fatal "issue_fetch_failed:${issue_number}"
      fi
      echo "[AEGIS][DEMAND][FATAL] issue_fetch_failed:${issue_number}" >&2
      exit 1
    fi
  fi

  title="$(printf '%s' "${json}" | jq -r '.title // empty')"
  body="$(printf '%s' "${json}" | jq -r '.body // empty')"

  if [[ -z "${title}" ]] && [[ -z "${body}" ]]; then
    if declare -f aegis_fatal >/dev/null 2>&1; then
      aegis_fatal "issue_empty:${issue_number}"
    fi
    echo "[AEGIS][DEMAND][FATAL] issue_empty:${issue_number}" >&2
    exit 1
  fi

  mkdir -p "${cache_dir}" 2>/dev/null || true
  {
    printf '# Issue #%s: %s\n\n%s' "${issue_number}" "${title}" "${body}"
  } | tee "${cache_file}" 2>/dev/null || printf '# Issue #%s: %s\n\n%s' "${issue_number}" "${title}" "${body}"
}

# ---------------------------------------------------------
# Task-scoped demand (issue global context + micro-task)
# ---------------------------------------------------------
# ## Tasks checklist items (order preserved). One title per line.
# Matches "- [ ] …" / "- [x] …" (GitHub task list).

aegis_demand_task_titles() {
  local text="${1-}"
  local section
  section="$(aegis_demand_md_section "Tasks" "${text}")"
  [[ -n "$(printf '%s' "${section}" | tr -d '[:space:]')" ]] || return 0
  printf '%s\n' "${section}" \
    | sed -nE 's/^[[:space:]]*[-*][[:space:]]+\[([ xX])\][[:space:]]+//p' \
    | sed -E 's/[[:space:]]+$//' \
    | awk 'NF'
}


aegis_demand_task_count() {
  local text="${1-}"
  aegis_demand_task_titles "${text}" | awk 'NF {c++} END {print c+0}'
}

# 1-based task title; empty if missing.
aegis_demand_task_title_at() {
  local text="${1-}" k="${2-}"
  [[ "${k}" =~ ^[1-9][0-9]*$ ]] || return 0
  aegis_demand_task_titles "${text}" | sed -n "${k}p"
}


aegis_demand_short_sha() {
  local payload="${1-}"
  local h=""
  if command -v shasum >/dev/null 2>&1; then
    h="$(printf '%s' "${payload}" | shasum -a 256 2>/dev/null | awk '{print $1}')"
  elif command -v sha256sum >/dev/null 2>&1; then
    h="$(printf '%s' "${payload}" | sha256sum 2>/dev/null | awk '{print $1}')"
  elif command -v md5 >/dev/null 2>&1; then
    h="$(printf '%s' "${payload}" | md5 -q 2>/dev/null || true)"
  fi
  if [[ -n "${h}" ]]; then
    printf '%s' "${h:0:12}"
  else
    printf 'unknown'
  fi
}

# Fatal helper for demand-layer errors (works outside full runtime too).

aegis_demand_fatal() {
  local code="$1"
  if declare -f aegis_fatal >/dev/null 2>&1; then
    aegis_fatal "${code}"
  fi
  echo "[AEGIS][DEMAND][FATAL] ${code}" >&2
  exit 1
}

# Materialize investigation input for task K of an issue-shaped document.
#
# Global issue context is kept (Goal → ISSUE_CONTEXT, Targets, Change,
# Acceptance, Out of scope, Constraints). Other tasks and Notes are omitted.
# Task title becomes the unit GOAL so modes focus on one micro-op.
#
# Args: <issue_doc> <task_k> [issue_number]

aegis_materialize_task_scoped_demand() {
  local text="${1-}"
  local task_k="${2-}"
  local issue_n="${3:-${AEGIS_ISSUE_NUMBER:-}}"
  local n title
  local goal_s targets_s acceptance_s change_s oos_s constraints_s
  local targets_raw acceptance_raw change_raw oos_raw constraints_raw
  local sha head slim

  [[ -n "$(printf '%s' "${text}" | tr -d '[:space:]')" ]] \
    || aegis_demand_fatal "demand_empty"
  [[ "${task_k}" =~ ^[1-9][0-9]*$ ]] \
    || aegis_demand_fatal "demand_task_invalid:${task_k}"

  n="$(aegis_demand_task_count "${text}")"
  if [[ "${n}" -eq 0 ]]; then
    aegis_demand_fatal "demand_task_list_empty"
  fi
  if [[ "${task_k}" -gt "${n}" ]]; then
    aegis_demand_fatal "demand_task_missing:${task_k}/${n}"
  fi

  title="$(aegis_demand_task_title_at "${text}" "${task_k}")"
  [[ -n "$(printf '%s' "${title}" | tr -d '[:space:]')" ]] \
    || aegis_demand_fatal "demand_task_empty:${task_k}"

  goal_s="$(aegis_demand_flatten_section "$(aegis_demand_md_section "Goal" "${text}")")"
  targets_raw="$(aegis_demand_md_section "Targets" "${text}")"
  targets_s="$(aegis_demand_flatten_section "${targets_raw}")"
  acceptance_raw="$(aegis_demand_md_section "Acceptance" "${text}")"
  acceptance_s="$(aegis_demand_flatten_section "${acceptance_raw}")"
  change_raw="$(aegis_demand_md_section "Change" "${text}")"
  change_s="$(aegis_demand_flatten_section "${change_raw}")"
  oos_raw="$(aegis_demand_md_section "Out of scope" "${text}")"
  oos_s="$(aegis_demand_flatten_section "${oos_raw}")"
  constraints_raw="$(aegis_demand_md_section "Constraints" "${text}")"
  constraints_s="$(aegis_demand_flatten_section "${constraints_raw}")"

  # Prefer global Change; else the task title is the change statement.
  if [[ -z "$(printf '%s' "${change_s}" | tr -d '[:space:]')" ]]; then
    change_s="${title}"
    change_raw="- ${title}"
  fi

  sha="$(
    aegis_demand_short_sha \
      "issue=${issue_n};task=${task_k};title=${title};goal=${goal_s};targets=${targets_s};change=${change_s};acceptance=${acceptance_s};oos=${oos_s};constraints=${constraints_s}"
  )"
  export AEGIS_DEMAND_SHA="${sha}"

  head="AEGIS_DEMAND issue:${issue_n:-?} task:${task_k} sha:${sha}"
  head+=$'\n'
  [[ -n "${goal_s}" ]] && head+=$'\n'"ISSUE_CONTEXT: ${goal_s}"
  head+=$'\n'"GOAL: ${title}"
  [[ -n "${targets_s}" ]] && head+=$'\n'"TARGETS: ${targets_s}"
  head+=$'\n'"CHANGE: ${change_s}"
  [[ -n "${acceptance_s}" ]] && head+=$'\n'"ACCEPTANCE: ${acceptance_s}"
  [[ -n "${oos_s}" ]] && head+=$'\n'"OUT_OF_SCOPE: ${oos_s}"
  [[ -n "${constraints_s}" ]] && head+=$'\n'"CONSTRAINTS: ${constraints_s}"

  # Slim structured body for anchors/path extraction — no task list, no Notes.
  slim="## Goal"$'\n'"${title}"$'\n'
  if [[ -n "${goal_s}" ]]; then
    slim+=$'\n'"## Issue context"$'\n'"${goal_s}"$'\n'
  fi
  if [[ -n "$(printf '%s' "${targets_raw}" | tr -d '[:space:]')" ]]; then
    slim+=$'\n'"## Targets"$'\n'"${targets_raw}"$'\n'
  fi
  slim+=$'\n'"## Change"$'\n'"${change_raw}"$'\n'
  if [[ -n "$(printf '%s' "${acceptance_raw}" | tr -d '[:space:]')" ]]; then
    slim+=$'\n'"## Acceptance"$'\n'"${acceptance_raw}"$'\n'
  fi
  if [[ -n "$(printf '%s' "${oos_raw}" | tr -d '[:space:]')" ]]; then
    slim+=$'\n'"## Out of scope"$'\n'"${oos_raw}"$'\n'
  fi
  if [[ -n "$(printf '%s' "${constraints_raw}" | tr -d '[:space:]')" ]]; then
    slim+=$'\n'"## Constraints"$'\n'"${constraints_raw}"$'\n'
  fi

  printf '%s\n\n---\n\n%s' "${head}" "${slim}"
}

# Full pipeline: optional issue fetch already done → normalize + safety.
# When AEGIS_ISSUE_TASK is set, scopes to that checklist item while keeping
# issue-level Goal/Targets/Constraints as context (other tasks omitted).

aegis_materialize_investigation_input() {
  local text="${1-}"
  local normalized
  local task_k="${AEGIS_ISSUE_TASK:-}"

  # Already task-scoped (idempotent).
  if printf '%s' "${text}" | head -n 1 | grep -qE '^AEGIS_DEMAND '; then
    normalized="${text}"
  elif [[ -n "${task_k}" ]]; then
    normalized="$(
      aegis_materialize_task_scoped_demand \
        "${text}" \
        "${task_k}" \
        "${AEGIS_ISSUE_NUMBER:-}"
    )"
  else
    normalized="$(aegis_normalize_demand_text "${text}")"
  fi

  aegis_demand_assert_paths_safe "${normalized}"
  printf '%s' "${normalized}"
}

# ---------------------------------------------------------
# Demand anchors (runtime-owned mechanical projection)
# ---------------------------------------------------------
# Stable JSON object every mode can consume without re-tokenizing
# free-text. Sources (priority for seed_targets):
#   1. epistemic handover next_attention_targets
#   2. runtime_attention_seed.json payload (if present)
#   3. runtime_layer0_facts.json hot_files with resonance==1
#   4. empty
# operator_named_paths / dense_tokens / search_query always from demand text.


aegis_materialize_demand_anchors_json() {
  local text="${1-${AEGIS_INVESTIGATION_INPUT:-}}"
  local handover="${2-${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-${AEGIS_EPISTEMIC_HANDOVER_FILE:-}}}"
  local payload_dir="${3-${AEGIS_CAPABILITY_PAYLOAD_DIR:-}}"

  local operator_json="[]" dense_json="[]" search_query="" seed_json="[]" seed_source="none" resonance_json="[]"
  local goal_s="" targets_json="[]" done_when_json="[]" token_source="${text}"

  # 1. Structured vs Free-text extraction
  if aegis_demand_is_structured "${text}"; then
    local t_sec c_sec a_sec
    t_sec="$(aegis_demand_md_section "Targets" "${text}")"
    c_sec="$(aegis_demand_md_section "Change" "${text}")"
    a_sec="$(aegis_demand_md_section "Acceptance" "${text}")"
    goal_s="$(aegis_demand_flatten_section "$(aegis_demand_md_section "Goal" "${text}")")"

    if declare -f aegis_extract_operator_named_paths_json >/dev/null 2>&1; then
      operator_json="$(aegis_extract_operator_named_paths_json "${t_sec:-${text}}")"
      targets_json="$(aegis_extract_operator_named_paths_json "${t_sec}")"
    fi
    done_when_json="$(printf '%s\n' "${a_sec}" | sed -E 's/^[[:space:]]*[-*0-9.)]+[[:space:]]*//; s/[[:space:]]+/ /g; s/^ //; s/ $//' | awk 'NF && length($0) >= 3' | head -n 5 | jq -R -s -c 'split("\n") | map(select(length > 0))' 2>/dev/null || printf '[]')"
    token_source="${goal_s} ${c_sec} ${a_sec}"
    [[ -n "$(printf '%s' "${token_source}" | tr -d '[:space:]')" ]] || token_source="${text}"
  elif declare -f aegis_extract_operator_named_paths_json >/dev/null 2>&1; then
    operator_json="$(aegis_extract_operator_named_paths_json "${text}")"
  fi

  dense_json="$(aegis_demand_dense_tokens "${token_source}" | jq -R -s -c 'split("\n") | map(select(length > 0))' 2>/dev/null || printf '[]')"
  search_query="$(aegis_demand_search_query "${token_source}" "AEGIS" 3)"

  # 2. Layer 0 Content Resonance
  if [[ -n "${payload_dir}" && -f "${payload_dir}/runtime_layer0_facts.json" ]]; then
    resonance_json="$(jq -c '[(.payload.hot_files // [])[] | select(.resonance == 1 and (.file | type == "string")) | {file: .file, score: (.score // 0), churn: (.churn // 0)}][0:5]' "${payload_dir}/runtime_layer0_facts.json" 2>/dev/null || printf '[]')"
  fi

  # 3. Seed Targets resolution (priority ladder)
  if [[ -n "${handover}" && -f "${handover}" ]]; then
    local from_h
    from_h="$(jq -c '[.epistemic_state.next_attention_targets[]? | select(type == "string" and length > 0)]' "${handover}" 2>/dev/null || printf '[]')"
    if printf '%s' "${from_h}" | jq -e 'length > 0' >/dev/null 2>&1; then
      seed_json="${from_h}"; seed_source="handover"
    fi
  fi
  if [[ "${seed_source}" == "none" && -n "${payload_dir}" && -f "${payload_dir}/runtime_attention_seed.json" ]]; then
    local from_s
    from_s="$(jq -c '[(.payload?.handover_attention?.next_attention_targets? // .payload?.attention_targets? // [])[]? | select(type == "string" and length > 0)]' "${payload_dir}/runtime_attention_seed.json" 2>/dev/null || printf '[]')"
    if printf '%s' "${from_s}" | jq -e 'length > 0' >/dev/null 2>&1; then
      seed_json="${from_s}"; seed_source="attention_seed"
    fi
  fi
  if [[ "${seed_source}" == "none" ]] && printf '%s' "${resonance_json}" | jq -e 'length > 0' >/dev/null 2>&1; then
    seed_json="$(printf '%s' "${resonance_json}" | jq -c '[.[].file] | unique' 2>/dev/null || printf '[]')"
    seed_source="layer0_resonance"
  fi
  if [[ "${seed_source}" == "none" && -n "${handover}" && -f "${handover}" ]]; then
    local prior
    prior="$(jq -c '.artifact_snapshot.operational_context.demand_anchors // empty' "${handover}" 2>/dev/null || true)"
    if printf '%s' "${prior}" | jq -e 'type == "object"' >/dev/null 2>&1; then
      seed_json="$(printf '%s' "${prior}" | jq -c '.seed_targets // []')"
      seed_source="prior_$(printf '%s' "${prior}" | jq -r '.seed_source // "none"')"
      [[ "${resonance_json}" == "[]" ]] && resonance_json="$(printf '%s' "${prior}" | jq -c '.content_resonance // []')"
    fi
  fi

  jq -n \
    --argjson operator_named_paths "${operator_json:-[]}" \
    --argjson dense_tokens "${dense_json:-[]}" \
    --arg search_query "${search_query}" \
    --argjson seed_targets "${seed_json:-[]}" \
    --arg seed_source "${seed_source}" \
    --argjson content_resonance "${resonance_json:-[]}" \
    --arg goal "${goal_s}" \
    --argjson targets_header "${targets_json:-[]}" \
    --argjson done_when "${done_when_json:-[]}" \
    '{
      operator_named_paths: $operator_named_paths,
      dense_tokens: $dense_tokens,
      search_query: $search_query,
      seed_targets: $seed_targets,
      seed_source: $seed_source,
      content_resonance: $content_resonance,
      goal: $goal,
      targets_header: $targets_header,
      done_when: $done_when
    }'
}

aegis_file_top_level_export_names() {
  local body="${1-}"
  [[ -n "${body}" ]] || return 0
  {
    printf '%s\n' "${body}" \
      | grep -Ei \
        '^[[:space:]]*export[[:space:]]+(default[[:space:]]+)?(async[[:space:]]+)?(function|const|class|let|var|type|interface|enum)[[:space:]]+[A-Za-z_]' \
      | sed -E 's/^[[:space:]]*export[[:space:]]+(default[[:space:]]+)?(async[[:space:]]+)?(function|const|class|let|var|type|interface|enum)[[:space:]]+([A-Za-z_][A-Za-z0-9_]*).*$/\4/' \
      || true
    printf '%s\n' "${body}" \
      | grep -E '^[[:space:]]*export[[:space:]]*\{' \
      | sed -E 's/.*\{([^}]*)\}.*/\1/' \
      | tr ',' '\n' \
      | sed -E 's/^[[:space:]]*//; s/[[:space:]]*$//; s/^type[[:space:]]+//; s/[[:space:]]+as[[:space:]].*$//' \
      || true
  } | grep -E '^[A-Za-z_][A-Za-z0-9_]*$' | awk 'NF && !seen[$0]++' || true
}

# Snapshot canônico de Discovery & Forensics para o intake (JSON estruturado).
# Inspeciona os targets, descobre entry point (barrel) e topologia do workspace.

aegis_intake_discover_context() {
  local targets_raw="${1:-}"
  local targets=() t
  
  # 1. Normaliza targets (seguro contra vírgulas ou múltiplos argumentos)
  for t in $(printf '%s' "${targets_raw}" | tr ',' ' '); do
    [[ -n "${t}" ]] && targets+=("${t}")
  done

  # 2. Se o entry point principal existir (ex: src/index.ts) e não estiver na lista, inclui para contexto
  for ec in src/index.ts src/mod.ts src/main.ts index.ts; do
    if [[ -f "${ec}" ]]; then
      [[ " ${targets[*]} " != *" ${ec} "* ]] && targets+=("${ec}")
      break
    fi
  done

  # 3. Extrai evidência de cada arquivo alvo (orçamento de 16 KB)
  local files_evidence="[]"
  local max_bytes=16384
  for t in "${targets[@]}"; do
    local exists=false exports="[]" snippet="" is_truncated=false file_bytes=0
    if [[ -f "${t}" ]]; then
      exists=true
      local content
      content="$(cat "${t}" 2>/dev/null || true)"
      file_bytes="${#content}"
      local raw_exports
      raw_exports="$(aegis_file_top_level_export_names "${content}" 2>/dev/null || true)"
      if [[ -n "${raw_exports}" ]]; then
        exports="$(printf '%s\n' "${raw_exports}" | sed '/^$/d' | jq -R . | jq -s . 2>/dev/null || printf '[]')"
      fi
      if [[ "${file_bytes}" -le "${max_bytes}" ]]; then
        snippet="${content}"
      else
        snippet="${content:0:max_bytes}"
        is_truncated=true
      fi
    fi
    files_evidence="$(jq \
      --arg path "${t}" \
      --argjson exists "${exists}" \
      --argjson exports "${exports}" \
      --arg snippet "${snippet}" \
      --argjson truncated "${is_truncated}" \
      --argjson bytes "${file_bytes}" \
      '. + [{path: $path, exists: $exists, exports: $exports, snippet: $snippet, bytes: $bytes, truncated: $truncated}]' \
      <<< "${files_evidence}" 2>/dev/null || printf '%s' "${files_evidence}")"
  done

  # 4. Pocket map universal do workspace (*.ts, *.tsx, *.js, *.jsx)
  local pocket_map_json="[]"
  if command -v git >/dev/null 2>&1; then
    pocket_map_json="$(git ls-files '*.ts' '*.tsx' '*.js' '*.jsx' 2>/dev/null | head -n 50 | jq -R . | jq -s . 2>/dev/null || printf '[]')"
  fi

  jq -cn \
    --argjson targets "${files_evidence}" \
    --argjson topology "${pocket_map_json}" \
    '{topology: $topology, targets: $targets}'
}

# Acceptance tokens from demand markdown (one per line).

aegis_demand_acceptance_names() {
  local text="${1-}"
  printf '%s\n' "${text}" \
    | awk '/^## Acceptance[[:space:]]*$/ {p=1;next} /^## / {p=0} p' \
    | sed -E 's/^[[:space:]]*-[[:space:]]*//' \
    | command grep -oE '[A-Za-z_][A-Za-z0-9_]*' 2>/dev/null \
    | awk 'NF && !seen[$0]++' \
    || true
}

aegis_mechanical_demand_anchors_json() {
  local text="${1-${AEGIS_INVESTIGATION_INPUT:-}}"
  local payload_dir="${2-${AEGIS_CAPABILITY_PAYLOAD_DIR:-}}"
  local handover="${3-${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-${AEGIS_EPISTEMIC_HANDOVER_FILE:-}}}"

  local anchors_json
  anchors_json="$(aegis_materialize_demand_anchors_json "${text}" "${handover}" "${payload_dir}")"
  if printf '%s' "${anchors_json}" | jq -e 'type == "object"' >/dev/null 2>&1; then
    printf '%s' "${anchors_json}"
  else
    printf '{}'
  fi
}

# Frame a JSON object body with AEGIS artifact markers (substrate stdout).

aegis_emit_framed_json_artifact() {
  local body="${1-}"
  printf '%s' "${body}" | jq -e 'type == "object"' >/dev/null 2>&1 \
    || return 1
  local begin="${AEGIS_ARTIFACT_BEGIN_MARKER:-AEGIS_ARTIFACT_BEGIN}"
  local end="${AEGIS_ARTIFACT_END_MARKER:-AEGIS_ARTIFACT_END}"
  printf '%s\n%s\n%s\n' "${begin}" "${body}" "${end}"
}

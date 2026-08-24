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
  local payload_dir handover
  local specs path

  if [[ "$#" -ge 2 ]]; then
    payload_dir="$2"
  else
    payload_dir="${AEGIS_CAPABILITY_PAYLOAD_DIR:-}"
  fi
  if [[ "$#" -ge 3 ]]; then
    handover="$3"
  else
    handover="${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-${AEGIS_EPISTEMIC_HANDOVER_FILE:-}}"
  fi

  specs="$(
    {
      if declare -f aegis_extract_operator_named_paths >/dev/null 2>&1; then
        aegis_extract_operator_named_paths "${text}"
      fi
      if [[ -n "${handover}" && -f "${handover}" ]]; then
        jq -r '.epistemic_state.next_attention_targets[]? // empty' \
          "${handover}" 2>/dev/null || true
      fi
      if [[ -n "${payload_dir}" \
        && -f "${payload_dir}/runtime_attention_seed.json" ]]; then
        jq -r '.payload.attention_targets[]? // empty' \
          "${payload_dir}/runtime_attention_seed.json" 2>/dev/null || true
      fi
    } | sed 's|^filesystem\.read:||; s|^\./||' \
      | awk 'NF && $0 !~ /^\// && $0 !~ /\.\./ { print }' \
      | awk '!seen[$0]++'
  )"

  # Keep path-like tokens only (file/dir), drop free-text noise.
  specs="$(
    while IFS= read -r path; do
      [[ -n "${path}" ]] || continue
      if [[ "${path}" == *.* || "${path}" == */* || -e "${path}" ]]; then
        printf '%s\n' "${path}"
      fi
    done <<< "${specs}"
  )"

  if [[ -z "${specs}" ]]; then
    # Product default: confine demand search to src/ when present.
    if [[ -d "src" ]]; then
      printf 'src\n'
    fi
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
  local n=0
  while IFS= read -r _; do
    n=$((n + 1))
  done < <(aegis_demand_task_titles "${text}")
  printf '%s' "${n}"
}

# 1-based task title; empty if missing.

aegis_demand_task_title_at() {
  local text="${1-}"
  local k="${2-}"
  local i=0
  local line
  [[ "${k}" =~ ^[1-9][0-9]*$ ]] || return 0
  while IFS= read -r line; do
    i=$((i + 1))
    if [[ "${i}" -eq "${k}" ]]; then
      printf '%s' "${line}"
      return 0
    fi
  done < <(aegis_demand_task_titles "${text}")
  return 0
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
  # Explicit args win (even empty). Env fallback only when arg omitted.
  local handover payload_dir
  if [[ "$#" -ge 2 ]]; then
    handover="$2"
  else
    handover="${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-${AEGIS_EPISTEMIC_HANDOVER_FILE:-}}"
  fi
  if [[ "$#" -ge 3 ]]; then
    payload_dir="$3"
  else
    payload_dir="${AEGIS_CAPABILITY_PAYLOAD_DIR:-}"
  fi

  local operator_json="[]"
  local dense_json="[]"
  local search_query=""
  local seed_json="[]"
  local seed_source="none"
  local resonance_json="[]"

  # Structured demands: paths only from ## Targets (not Change/Acceptance/
  # Out of scope where "tokenBucket.js" / "package.json" create false paths).
  if declare -f aegis_extract_operator_named_paths_json >/dev/null 2>&1; then
    if aegis_demand_is_structured "${text}"; then
      local targets_only
      targets_only="$(aegis_demand_md_section "Targets" "${text}")"
      if [[ -n "$(printf '%s' "${targets_only}" | tr -d '[:space:]')" ]]; then
        operator_json="$(aegis_extract_operator_named_paths_json "${targets_only}")"
      else
        operator_json="$(aegis_extract_operator_named_paths_json "${text}")"
      fi
    else
      operator_json="$(aegis_extract_operator_named_paths_json "${text}")"
    fi
  else
    operator_json="[]"
  fi
  if ! printf '%s' "${operator_json}" | jq -e 'type == "array"' >/dev/null 2>&1; then
    operator_json="[]"
  fi

  # When structured, tokenize Goal/Change/Acceptance bodies only — not
  # header labels ("targets", "acceptance") that pollute dense tokens.
  local token_source="${text}"
  if aegis_demand_is_structured "${text}"; then
    token_source="$(
      {
        aegis_demand_md_section "Goal" "${text}"
        aegis_demand_md_section "Change" "${text}"
        aegis_demand_md_section "Acceptance" "${text}"
      } | tr '\n' ' '
    )"
    [[ -n "$(printf '%s' "${token_source}" | tr -d '[:space:]')" ]] \
      || token_source="${text}"
  fi

  dense_json="$(
    aegis_demand_dense_tokens "${token_source}" \
      | jq -R -s -c 'split("\n") | map(select(length > 0))' 2>/dev/null \
      || printf '[]'
  )"
  if ! printf '%s' "${dense_json}" | jq -e 'type == "array"' >/dev/null 2>&1; then
    dense_json="[]"
  fi

  search_query="$(aegis_demand_search_query "${token_source}" "AEGIS" 3)"

  # --- seed_targets (mechanical attention prior) ---
  if [[ -n "${handover}" && -f "${handover}" ]]; then
    local from_handover
    from_handover="$(
      jq -c '
        [.epistemic_state.next_attention_targets[]?
          | select(type == "string" and length > 0)]
      ' "${handover}" 2>/dev/null || printf '[]'
    )"
    if printf '%s' "${from_handover}" | jq -e 'type == "array" and length > 0' >/dev/null 2>&1; then
      seed_json="${from_handover}"
      seed_source="handover"
    fi
  fi

  if [[ "${seed_source}" == "none" \
    && -n "${payload_dir}" \
    && -f "${payload_dir}/runtime_attention_seed.json" ]]; then
    local from_seed
    from_seed="$(
      jq -c '
        [(.payload?.handover_attention?.next_attention_targets? // .payload?.attention_targets? // [])[]?
          | select(type == "string" and length > 0)]
      ' "${payload_dir}/runtime_attention_seed.json" 2>/dev/null || printf '[]'
    )"
    if printf '%s' "${from_seed}" | jq -e 'type == "array" and length > 0' >/dev/null 2>&1; then
      seed_json="${from_seed}"
      seed_source="attention_seed"
    fi
  fi

  if [[ -n "${payload_dir}" && -f "${payload_dir}/runtime_layer0_facts.json" ]]; then
    resonance_json="$(
      jq -c '
        [(.payload.hot_files // [])[]
          | select(.resonance == 1 and (.file | type == "string"))
          | {file: .file, score: (.score // 0), churn: (.churn // 0)}]
        | .[0:5]
      ' "${payload_dir}/runtime_layer0_facts.json" 2>/dev/null || printf '[]'
    )"
    if ! printf '%s' "${resonance_json}" | jq -e 'type == "array"' >/dev/null 2>&1; then
      resonance_json="[]"
    fi

    if [[ "${seed_source}" == "none" ]]; then
      local from_layer0
      from_layer0="$(
        printf '%s' "${resonance_json}" \
          | jq -c '[.[].file] | unique' 2>/dev/null || printf '[]'
      )"
      if printf '%s' "${from_layer0}" | jq -e 'type == "array" and length > 0' >/dev/null 2>&1; then
        seed_json="${from_layer0}"
        seed_source="layer0_resonance"
      fi
    fi
  fi

  # Prefer preserving prior demand_anchors.seed_* when re-materializing
  # mid-pipeline without payloads (stable investigation anchors).
  if [[ "${seed_source}" == "none" \
    && -n "${handover}" \
    && -f "${handover}" ]]; then
    local prior
    prior="$(
      jq -c '.artifact_snapshot.operational_context.demand_anchors // empty' \
        "${handover}" 2>/dev/null || true
    )"
    if printf '%s' "${prior}" | jq -e 'type == "object"' >/dev/null 2>&1; then
      local prior_seed prior_src prior_res
      prior_seed="$(printf '%s' "${prior}" | jq -c '.seed_targets // []')"
      prior_src="$(printf '%s' "${prior}" | jq -r '.seed_source // "none"')"
      prior_res="$(printf '%s' "${prior}" | jq -c '.content_resonance // []')"
      if printf '%s' "${prior_seed}" | jq -e 'type == "array" and length > 0' >/dev/null 2>&1; then
        seed_json="${prior_seed}"
        seed_source="prior_${prior_src}"
      fi
      if printf '%s' "${prior_res}" | jq -e 'type == "array" and length > 0' >/dev/null 2>&1; then
        resonance_json="${prior_res}"
      fi
    fi
  fi

  # Structured demand sections (optional ## headers) — empty when free-text.
  local goal_s="" targets_json="[]" done_when_json="[]"
  if aegis_demand_is_structured "${text}"; then
    goal_s="$(aegis_demand_flatten_section "$(aegis_demand_md_section "Goal" "${text}")")"
    local targets_raw acceptance_raw
    targets_raw="$(aegis_demand_md_section "Targets" "${text}")"
    acceptance_raw="$(aegis_demand_md_section "Acceptance" "${text}")"
    # Paths from Targets section (same regex family as operator-named).
    if declare -f aegis_extract_operator_named_paths_json >/dev/null 2>&1; then
      targets_json="$(aegis_extract_operator_named_paths_json "${targets_raw}")"
    fi
    if ! printf '%s' "${targets_json}" | jq -e 'type == "array"' >/dev/null 2>&1; then
      targets_json="[]"
    fi
    # Acceptance bullets → short done_when strings (cap 5).
    done_when_json="$(
      printf '%s\n' "${acceptance_raw}" \
        | sed -E 's/^[[:space:]]*[-*][[:space:]]*//; s/^[[:space:]]*[0-9]+[.)][[:space:]]*//' \
        | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//' \
        | awk 'NF && length($0) >= 3 { print }' \
        | head -n 5 \
        | jq -R -s -c 'split("\n") | map(select(length > 0))' 2>/dev/null \
        || printf '[]'
    )"
    if ! printf '%s' "${done_when_json}" | jq -e 'type == "array"' >/dev/null 2>&1; then
      done_when_json="[]"
    fi
  fi

  jq -n \
    --argjson operator_named_paths "${operator_json}" \
    --argjson dense_tokens "${dense_json}" \
    --arg search_query "${search_query}" \
    --argjson seed_targets "${seed_json}" \
    --arg seed_source "${seed_source}" \
    --argjson content_resonance "${resonance_json}" \
    --arg goal "${goal_s}" \
    --argjson targets_header "${targets_json}" \
    --argjson done_when "${done_when_json}" \
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
      file_bytes="$(wc -c < "${t}" 2>/dev/null || echo 0)"
      local raw_exports
      raw_exports="$(aegis_file_top_level_export_names "$(cat "${t}" 2>/dev/null || true)" 2>/dev/null || true)"
      if [[ -n "${raw_exports}" ]]; then
        exports="$(printf '%s\n' "${raw_exports}" | sed '/^$/d' | jq -R . | jq -s . 2>/dev/null || printf '[]')"
      fi
      if [[ "${file_bytes}" -le "${max_bytes}" ]]; then
        snippet="$(cat "${t}" 2>/dev/null || true)"
      else
        snippet="$(head -c "${max_bytes}" "${t}" 2>/dev/null || true)"
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

# Mechanical barrel merge for reexport units: start from HEAD content, ensure
# import + export of Acceptance names, never drop pre-existing exports.
# Args: rel_path, demand_text [, surface_root] [, force]
#   force=1 → always write (reexport-only fast path; works with empty HEAD).
# Writes surface file; exit 0 if rewritten, 1 if no-op/skip.

aegis_mechanical_demand_anchors_json() {
  local text="${1-${AEGIS_INVESTIGATION_INPUT:-}}"
  local payload_dir handover anchors_json

  if [[ "$#" -ge 2 ]]; then
    payload_dir="$2"
  else
    payload_dir="${AEGIS_CAPABILITY_PAYLOAD_DIR:-}"
  fi
  if [[ "$#" -ge 3 ]]; then
    handover="$3"
  else
    handover="${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-${AEGIS_EPISTEMIC_HANDOVER_FILE:-}}"
  fi

  anchors_json="$(
    aegis_materialize_demand_anchors_json "${text}" "${handover}" "${payload_dir}"
  )"
  if ! printf '%s' "${anchors_json}" | jq -e 'type == "object"' >/dev/null 2>&1; then
    printf '%s' '{}'
    return 0
  fi
  printf '%s' "${anchors_json}"
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

# Probe one repo-relative path for demand-token hits (fixed-string, case-ins).
# Prints: missing | present_no_hits | present_hits:<id1,id2,...>

aegis_discovery_probe_path() {
  local path="$1"
  local tokens_nl="$2"
  local root="${3:-.}"
  local full hits hit_list token

  full="${root%/}/${path}"
  full="${full#./}"
  if [[ ! -f "${full}" ]]; then
    printf 'missing'
    return 0
  fi

  hits=""
  while IFS= read -r token; do
    [[ -n "${token}" ]] || continue
    [[ "${#token}" -ge 4 ]] || continue
    if grep -Fqi -- "${token}" "${full}" 2>/dev/null; then
      # Prefer exported identifiers that contain the token (KISS signal).
      local exports
      exports="$(
        grep -Eio "export[[:space:]]+(async[[:space:]]+)?function[[:space:]]+[A-Za-z0-9_]+|export[[:space:]]+const[[:space:]]+[A-Za-z0-9_]+" \
          "${full}" 2>/dev/null \
          | grep -Fi -- "${token}" \
          | sed -E 's/.*[[:space:]]([A-Za-z0-9_]+)$/\1/' \
          | head -n 3 \
          || true
      )"
      if [[ -n "${exports}" ]]; then
        while IFS= read -r hit; do
          [[ -n "${hit}" ]] || continue
          hits="${hits}${hits:+,}${hit}"
        done <<< "${exports}"
      else
        hits="${hits}${hits:+,}~${token}"
      fi
    fi
  done <<< "${tokens_nl}"

  if [[ -z "${hits}" ]]; then
    printf 'present_no_hits'
  else
    # unique, cap 4 identifiers for observation density
    hit_list="$(
      printf '%s' "${hits}" | tr ',' '\n' | awk 'NF && !seen[$0]++' | head -n 4 | paste -sd ',' -
    )"
    printf 'present_hits:%s' "${hit_list}"
  fi
}


aegis_build_mechanical_discovery_json() {
  local text="${1-${AEGIS_INVESTIGATION_INPUT:-}}"
  local anchors_json named_json seed_json paths_json
  local tokens_nl dense_json search_q seed_source
  local probes_json path probe status hits obs

  anchors_json="$(aegis_mechanical_demand_anchors_json "$@")"

  named_json="$(printf '%s' "${anchors_json}" | jq -c '.operator_named_paths // []')"
  seed_json="$(printf '%s' "${anchors_json}" | jq -c '.seed_targets // []')"
  dense_json="$(printf '%s' "${anchors_json}" | jq -c '.dense_tokens // []')"
  search_q="$(printf '%s' "${anchors_json}" | jq -r '.search_query // "AEGIS"')"
  seed_source="$(printf '%s' "${anchors_json}" | jq -r '.seed_source // "none"')"
  paths_json="$(
    jq -n --argjson n "${named_json}" --argjson s "${seed_json}" \
      '($n + $s) | unique'
  )"
  tokens_nl="$(printf '%s' "${dense_json}" | jq -r '.[]?' 2>/dev/null || true)"

  # Per-path content probes (deterministic; no LLM).
  probes_json="[]"
  while IFS= read -r path; do
    [[ -n "${path}" ]] || continue
    probe="$(aegis_discovery_probe_path "${path}" "${tokens_nl}" ".")"
    case "${probe}" in
      missing)
        status="missing"
        hits="[]"
        obs="Path ${path} is absent on disk (net-new or missing) — filesystem.read still required; forensics may create if operator-named."
        ;;
      present_no_hits)
        status="present_no_hits"
        hits="[]"
        obs="Path ${path} exists; demand tokens not found in content — likely mutation target; forensics needs file body."
        ;;
      present_hits:*)
        status="present_hits"
        hits="$(
          printf '%s' "${probe#present_hits:}" \
            | tr ',' '\n' \
            | awk 'NF' \
            | jq -R -s -c 'split("\n") | map(select(length > 0))' 2>/dev/null \
            || printf '[]'
        )"
        obs="Path ${path} exists and already contains demand-related identifiers ($(printf '%s' "${probe#present_hits:}")) — forensics must confirm edit vs already-satisfied."
        ;;
      *)
        status="unknown"
        hits="[]"
        obs="Path ${path}: probe inconclusive — forensics needs filesystem.read."
        ;;
    esac
    probes_json="$(
      jq -n -c \
        --argjson acc "${probes_json}" \
        --arg path "${path}" \
        --arg status "${status}" \
        --argjson hits "${hits}" \
        --arg observation "${obs}" \
        '$acc + [{path: $path, status: $status, hits: $hits, observation: $observation}]'
    )"
  done < <(printf '%s' "${paths_json}" | jq -r '.[]?')

  jq -n \
    --argjson paths "${paths_json}" \
    --argjson named "${named_json}" \
    --argjson seed "${seed_json}" \
    --argjson dense "${dense_json}" \
    --argjson probes "${probes_json}" \
    --arg seed_source "${seed_source}" \
    --arg search_query "${search_q}" \
    '
      def rationale_line:
        if ($named | length) > 0 then
          "Operator-named path(s): " + ($named | join(", "))
            + (if ($seed | length) > 0 then "; seed: " + ($seed | join(", ")) else "" end)
        elif ($seed | length) > 0 then
          "Attention seed (" + $seed_source + "): " + ($seed | join(", "))
        else
          "empty demand path anchors"
        end
        + (if ($dense | length) > 0 then "; tokens: " + ($dense | join(", ")) else "" end);

      if ($probes | length) > 0 then
        {
          observations: [ $probes[].observation ],
          rationale: rationale_line,
          required_evidence: [ $probes[].path | "filesystem.read:" + . ]
        }
      else
        {
          observations: (
            if ($dense | length) > 0 then
              [
                "No mechanical path anchor (operator-named or Layer0/attention seed); forensics targeting will be weak.",
                "Demand tokens available for search_symbol: " + ($dense | join(", "))
                  + " (query " + $search_query + ")."
              ]
            else
              [
                "No mechanical path anchor and no dense demand tokens; forensics targeting will be weak."
              ]
            end
          ),
          rationale: rationale_line,
          required_evidence: []
        }
      end
    '
}


aegis_emit_mechanical_discovery_substrate() {
  local body
  body="$(aegis_build_mechanical_discovery_json "$@")" || return 1
  aegis_emit_framed_json_artifact "${body}"
}

# Thin projection for needs_llm / forensics body: named + seed + dense.

aegis_forensics_anchor_sets_json() {
  local anchors_json
  anchors_json="$(aegis_mechanical_demand_anchors_json "$@")"
  printf '%s' "${anchors_json}" | jq -c '
    {
      named: (.operator_named_paths // []),
      seed: (.seed_targets // []),
      dense: (.dense_tokens // [])
    }
  ' 2>/dev/null || printf '{"named":[],"seed":[],"dense":[]}'
}

# Rank a content probe for multi-seed discrimination (higher = stronger).
#   missing          → 0
#   present_no_hits  → 5
#   present_hits:…   → 10 + hit count

aegis_forensics_probe_score() {
  local probe="${1-}"
  local n
  case "${probe}" in
    missing)
      printf '0'
      ;;
    present_no_hits)
      printf '5'
      ;;
    present_hits:*)
      n="$(
        printf '%s' "${probe#present_hits:}" \
          | tr ',' '\n' \
          | awk 'NF' \
          | wc -l \
          | tr -d '[:space:]'
      )"
      [[ -n "${n}" ]] || n=0
      printf '%s' "$((10 + n))"
      ;;
    *)
      printf '0'
      ;;
  esac
}

# Among seed paths, print unique winner by probe score, or empty if tie / no signal.
# Args: tokens_nl, seeds_json_array [, root]

aegis_forensics_discriminate_seeds() {
  local tokens_nl="${1-}"
  local seeds_json="${2:-[]}"
  local root="${3:-.}"
  local path probe score
  local best_score=-1
  local best_path=""
  local tie=0

  if ! printf '%s' "${seeds_json}" | jq -e 'type == "array" and length > 0' >/dev/null 2>&1; then
    printf ''
    return 0
  fi

  while IFS= read -r path; do
    [[ -n "${path}" ]] || continue
    probe="$(aegis_discovery_probe_path "${path}" "${tokens_nl}" "${root}")"
    score="$(aegis_forensics_probe_score "${probe}")"
    if [[ "${score}" -gt "${best_score}" ]]; then
      best_score="${score}"
      best_path="${path}"
      tie=0
    elif [[ "${score}" -eq "${best_score}" ]]; then
      tie=1
    fi
  done < <(printf '%s' "${seeds_json}" | jq -r '.[]?')

  # No unique positive winner → empty (caller may use LLM or first-seed force).
  if [[ "${best_score}" -le 0 || "${tie}" -eq 1 || -z "${best_path}" ]]; then
    printf ''
    return 0
  fi
  printf '%s' "${best_path}"
}

# Exit 0 → use LLM. Exit 1 → mechanical is enough.

aegis_forensics_needs_llm() {
  local mode_flag sets named_n seed_n tokens_nl seed_json winner

  mode_flag="$(printf '%s' "${AEGIS_FORENSICS_LLM:-auto}" | tr '[:upper:]' '[:lower:]')"
  case "${mode_flag}" in
    1|true|yes|on|llm) return 0 ;;
    0|false|no|off|mechanical|mech) return 1 ;;
  esac

  # auto: LLM only when multi-seed cannot be discriminated by content probes.
  sets="$(aegis_forensics_anchor_sets_json "$@")"
  named_n="$(printf '%s' "${sets}" | jq -r '.named | length')"
  seed_n="$(printf '%s' "${sets}" | jq -r '.seed | length')"

  if [[ "${named_n}" -ge 1 ]]; then
    return 1
  fi
  if [[ "${seed_n}" -le 1 ]]; then
    # 0 seeds → inconclusive mechanical (do not invent); 1 seed → Alvo Único.
    return 1
  fi

  tokens_nl="$(printf '%s' "${sets}" | jq -r '.dense[]?' 2>/dev/null || true)"
  seed_json="$(printf '%s' "${sets}" | jq -c '.seed // []')"
  winner="$(aegis_forensics_discriminate_seeds "${tokens_nl}" "${seed_json}" ".")"
  if [[ -n "${winner}" ]]; then
    # Unique probe winner → mechanical Alvo Único on that path.
    return 1
  fi
  # True ambiguity (tie / no signal) → LLM guarantee.
  return 0
}


aegis_forensics_mechanical_reason() {
  local text="${1-}"
  local path="${2-}"
  local probe="${3-}"
  local tokens_nl="${4-}"
  local from_u to_u reason token_line low

  # Directed phrase: "X para Y" / "X to Y" (ASCII fold via lower).
  low="$(printf '%s' "${text}" | tr '[:upper:]' '[:lower:]')"
  if [[ "${low}" =~ ([a-z][a-z0-9_]{3,})[[:space:]]+(para|to)[[:space:]]+([a-z][a-z0-9_]{3,}) ]]; then
    from_u="${BASH_REMATCH[1]}"
    to_u="${BASH_REMATCH[3]}"
    reason="Demand: convert ${from_u} to ${to_u} (one new export in ${path})"
  else
    token_line="$(printf '%s\n' "${tokens_nl}" | head -n 3 | paste -sd ' ' -)"
    if [[ -n "${token_line}" ]]; then
      reason="Demand: ${token_line} (one new export in ${path})"
    else
      reason="Demand: apply investigation (one new export in ${path})"
    fi
  fi

  case "${probe}" in
    missing)
      reason="${reason}; path missing — create if operator-named"
      ;;
    present_hits:*)
      reason="${reason}; related symbols exist — confirm edit vs already-satisfied"
      ;;
    present_no_hits)
      reason="${reason}; no demand-token hits yet"
      ;;
  esac
  printf '%s' "${reason}"
}


aegis_build_mechanical_forensics_json() {
  local text="${1-${AEGIS_INVESTIGATION_INPUT:-}}"
  local sets named_json seed_json paths_json tokens_nl
  local cands_json="[]"
  local path probe reason winner

  sets="$(aegis_forensics_anchor_sets_json "$@")"
  named_json="$(printf '%s' "${sets}" | jq -c '.named // []')"
  seed_json="$(printf '%s' "${sets}" | jq -c '.seed // []')"
  tokens_nl="$(printf '%s' "${sets}" | jq -r '.dense[]?' 2>/dev/null || true)"

  # Multi operator-named → one candidate each.
  # Else Alvo Único: single seed, or multi-seed probe winner, else first seed.
  if printf '%s' "${named_json}" | jq -e 'length >= 1' >/dev/null 2>&1; then
    paths_json="${named_json}"
  elif printf '%s' "${seed_json}" | jq -e 'length == 1' >/dev/null 2>&1; then
    paths_json="${seed_json}"
  elif printf '%s' "${seed_json}" | jq -e 'length > 1' >/dev/null 2>&1; then
    winner="$(aegis_forensics_discriminate_seeds "${tokens_nl}" "${seed_json}" ".")"
    if [[ -n "${winner}" ]]; then
      paths_json="$(jq -n -c --arg p "${winner}" '[ $p ]')"
    else
      # Force-mechanical / fallthrough: first seed only (never invent).
      paths_json="$(printf '%s' "${seed_json}" | jq -c '.[0:1]')"
    fi
  else
    paths_json='[]'
  fi

  if ! printf '%s' "${paths_json}" | jq -e 'type == "array" and length > 0' >/dev/null 2>&1; then
    jq -n '{status: "inconclusive", mutation_candidates: []}'
    return 0
  fi

  local tmp_cands
  tmp_cands="$(mktemp)"
  printf '[]' > "${tmp_cands}"

  while IFS= read -r path; do
    [[ -n "${path}" ]] || continue
    probe="$(aegis_discovery_probe_path "${path}" "${tokens_nl}" ".")"
    reason="$(aegis_forensics_mechanical_reason "${text}" "${path}" "${probe}" "${tokens_nl}")"
    if jq --arg id "${path}" --arg reason "${reason}" '. + [{id: $id, reason: $reason}]' "${tmp_cands}" > "${tmp_cands}.tmp" 2>/dev/null; then
      mv "${tmp_cands}.tmp" "${tmp_cands}"
    fi
  done < <(printf '%s' "${paths_json}" | jq -r '.[]?')

  cands_json="$(cat "${tmp_cands}")"
  rm -f "${tmp_cands}" "${tmp_cands}.tmp" 2>/dev/null || true

  jq -n --argjson cands "${cands_json:-[]}" \
    '{status: "interpreted", mutation_candidates: $cands}'
}


aegis_emit_mechanical_forensics_substrate() {
  local body
  body="$(aegis_build_mechanical_forensics_json "$@")" || return 1
  aegis_emit_framed_json_artifact "${body}"
}

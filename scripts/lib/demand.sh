#!/usr/bin/env bash

# =========================================================
# AEGIS HARNESS — DEMAND MATERIALIZATION (source-only)
# =========================================================
#
# Runtime-owned investigation demand helpers:
#   - GitHub issue fetch (real body, not "issue #N" placeholder)
#   - Soft normalize of optional markdown headers into a short head
#   - Mechanical path-safety on operator-named source paths
#   - Shared demand tokenization (search_symbol + Layer 0 resonance)
#
# Free-text demands remain valid. Structured headers improve small
# models and give the runtime stable Targets/Done-when anchors.
# Modes never rewrite demand text.
#
# =========================================================

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "[AEGIS][FATAL] demand_lib_not_invocable" >&2
  exit 1
fi

# ---------------------------------------------------------
# Demand tokens (shared by search_symbol + Layer 0)
# ---------------------------------------------------------
# Mechanical only: ASCII-fold when iconv exists, drop short tokens
# and a small EN/PT stopword set, keep [a-z0-9_.-] length >= 4.

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

# Compact search query for filesystem.search_symbol.
# Picks up to max tokens (longest first) joined with | for grep -E.
# Falls back to $2 (default AEGIS) when no tokens survive.
aegis_demand_search_query() {
  local text="${1-}"
  local fallback="${2:-AEGIS}"
  local max_tokens="${3:-3}"
  local tokens query

  tokens="$(
    aegis_demand_tokens "${text}" \
      | awk '{ print length, $0 }' \
      | sort -rn \
      | awk '{ print $2 }' \
      | head -n "${max_tokens}"
  )"

  if [[ -z "${tokens}" ]]; then
    printf '%s' "${fallback}"
    return 0
  fi

  query="$(printf '%s\n' "${tokens}" | paste -sd '|' -)"
  printf '%s' "${query}"
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

  # Idempotent: already materialised structured demand.
  if printf '%s' "${text}" | head -n 1 | grep -qx 'Demand (structured):'; then
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

  if ! command -v gh >/dev/null 2>&1; then
    if declare -f aegis_fatal >/dev/null 2>&1; then
      aegis_fatal "missing_gh_for_issue_fetch"
    fi
    echo "[AEGIS][DEMAND][FATAL] missing_gh_for_issue_fetch" >&2
    exit 1
  fi

  if ! json="$(
    gh issue view "${issue_number}" --json title,body 2>/dev/null
  )"; then
    if declare -f aegis_fatal >/dev/null 2>&1; then
      aegis_fatal "issue_fetch_failed:${issue_number}"
    fi
    echo "[AEGIS][DEMAND][FATAL] issue_fetch_failed:${issue_number}" >&2
    exit 1
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

  printf '# Issue #%s: %s\n\n%s' "${issue_number}" "${title}" "${body}"
}

# Full pipeline: optional issue fetch already done → normalize + safety.
aegis_materialize_investigation_input() {
  local text="${1-}"
  local normalized
  normalized="$(aegis_normalize_demand_text "${text}")"
  aegis_demand_assert_paths_safe "${normalized}"
  printf '%s' "${normalized}"
}

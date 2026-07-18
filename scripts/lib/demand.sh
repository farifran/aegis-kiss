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
#
# Multi-token search delimiter (not valid in token alphabet):
# search_symbol splits on this and runs fixed-string greps (no ERE).
readonly AEGIS_DEMAND_TOKEN_SEP=';;'

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
  local handover="${2-}"
  local payload_dir="${3-}"

  if [[ -z "${handover}" ]]; then
    handover="${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-${AEGIS_EPISTEMIC_HANDOVER_FILE:-}}"
  fi
  if [[ -z "${payload_dir}" ]]; then
    payload_dir="${AEGIS_CAPABILITY_PAYLOAD_DIR:-}"
  fi

  local operator_json="[]"
  local dense_json="[]"
  local search_query=""
  local seed_json="[]"
  local seed_source="none"
  local resonance_json="[]"

  if declare -f aegis_extract_operator_named_paths_json >/dev/null 2>&1; then
    operator_json="$(aegis_extract_operator_named_paths_json "${text}")"
  else
    operator_json="[]"
  fi
  if ! printf '%s' "${operator_json}" | jq -e 'type == "array"' >/dev/null 2>&1; then
    operator_json="[]"
  fi

  dense_json="$(
    aegis_demand_dense_tokens "${text}" \
      | jq -R -s -c 'split("\n") | map(select(length > 0))' 2>/dev/null \
      || printf '[]'
  )"
  if ! printf '%s' "${dense_json}" | jq -e 'type == "array"' >/dev/null 2>&1; then
    dense_json="[]"
  fi

  search_query="$(aegis_demand_search_query "${text}" "AEGIS" 3)"

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
        [.payload.attention_targets[]?
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

  jq -n \
    --argjson operator_named_paths "${operator_json}" \
    --argjson dense_tokens "${dense_json}" \
    --arg search_query "${search_query}" \
    --argjson seed_targets "${seed_json}" \
    --arg seed_source "${seed_source}" \
    --argjson content_resonance "${resonance_json}" \
    '{
      operator_named_paths: $operator_named_paths,
      dense_tokens: $dense_tokens,
      search_query: $search_query,
      seed_targets: $seed_targets,
      seed_source: $seed_source,
      content_resonance: $content_resonance
    }'
}

# Human-readable block for raw/aider prompts (mechanical only).
aegis_format_demand_anchors_section() {
  local anchors_json="${1-}"
  if [[ -z "${anchors_json}" ]]; then
    anchors_json="$(aegis_materialize_demand_anchors_json)"
  fi
  if ! printf '%s' "${anchors_json}" | jq -e 'type == "object"' >/dev/null 2>&1; then
    anchors_json='{"operator_named_paths":[],"dense_tokens":[],"search_query":"AEGIS","seed_targets":[],"seed_source":"none","content_resonance":[]}'
  fi

  {
    echo "=== DEMAND ANCHORS (runtime-owned, mechanical) ==="
    echo
    echo "Treat these as authoritative investigation anchors. Do not invent"
    echo "operator-named paths or seed targets that are absent here."
    echo
    printf '%s\n' "${anchors_json}" | jq -c '.'
    echo
  }
}

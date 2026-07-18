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

  if declare -f aegis_extract_operator_named_paths_json >/dev/null 2>&1; then
    operator_json="$(aegis_extract_operator_named_paths_json "${text}")"
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

# Human-readable block for raw/aider prompts (mechanical only).
# Lines only — full JSON lives in capability payload / handover (one machine shape).
aegis_format_demand_anchors_section() {
  local anchors_json="${1-}"
  if [[ -z "${anchors_json}" ]]; then
    anchors_json="$(aegis_materialize_demand_anchors_json)"
  fi
  if ! printf '%s' "${anchors_json}" | jq -e 'type == "object"' >/dev/null 2>&1; then
    anchors_json='{"operator_named_paths":[],"dense_tokens":[],"search_query":"AEGIS","seed_targets":[],"seed_source":"none","content_resonance":[],"goal":"","targets_header":[],"done_when":[]}'
  fi

  local seed_line tokens_line search_line ops_line goal_line targets_line done_line
  seed_line="$(
    printf '%s' "${anchors_json}" | jq -r '
      ((.seed_targets // []) | join(", ")) as $t
      | (.seed_source // "none") as $src
      | if ($t | length) == 0 then "(none)"
        elif $src == "none" then $t
        else $t + " (" + $src + ")"
        end
    ' 2>/dev/null || echo "(none)"
  )"
  tokens_line="$(
    printf '%s' "${anchors_json}" | jq -r '
      ((.dense_tokens // []) | join(", ")) as $t
      | if ($t | length) > 0 then $t else "(none)" end
    ' 2>/dev/null || echo "(none)"
  )"
  search_line="$(
    printf '%s' "${anchors_json}" | jq -r '.search_query // "AEGIS"' 2>/dev/null || echo "AEGIS"
  )"
  ops_line="$(
    printf '%s' "${anchors_json}" | jq -r '
      ((.operator_named_paths // []) | join(", ")) as $t
      | if ($t | length) > 0 then $t else "(none)" end
    ' 2>/dev/null || echo "(none)"
  )"
  goal_line="$(
    printf '%s' "${anchors_json}" | jq -r '
      (.goal // "") as $g
      | if ($g | length) > 0 then $g else empty end
    ' 2>/dev/null || true
  )"
  targets_line="$(
    printf '%s' "${anchors_json}" | jq -r '
      ((.targets_header // []) | join(", ")) as $t
      | if ($t | length) > 0 then $t else empty end
    ' 2>/dev/null || true
  )"
  done_line="$(
    printf '%s' "${anchors_json}" | jq -r '
      ((.done_when // []) | join(" | ")) as $t
      | if ($t | length) > 0 then $t else empty end
    ' 2>/dev/null || true
  )"

  {
    echo "=== DEMAND ANCHORS (runtime-owned, mechanical) ==="
    echo
    echo "Authoritative. Prefer SEED/TOKENS over free-text. Do not invent paths."
    echo
    echo "SEED: ${seed_line}"
    echo "TOKENS: ${tokens_line}"
    echo "SEARCH: ${search_line}"
    echo "OPERATOR PATHS: ${ops_line}"
    if [[ -n "${goal_line}" ]]; then
      echo "GOAL: ${goal_line}"
    fi
    if [[ -n "${targets_line}" ]]; then
      echo "TARGETS (header): ${targets_line}"
    fi
    if [[ -n "${done_line}" ]]; then
      echo "DONE WHEN: ${done_line}"
    fi
    echo
  }
}

# Compact forensics→repair handoff lines (alvo + reason + done_when).
aegis_format_forensics_handoff_section() {
  local handover="${1-}"
  if [[ -z "${handover}" ]]; then
    handover="${AEGIS_EPISTEMIC_HANDOVER_FILE:-${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}}"
  fi
  [[ -n "${handover}" && -f "${handover}" ]] || return 0

  local lines
  lines="$(
    jq -r '
      .artifact_snapshot as $snap
      | ($snap.operational_context // {}) as $oc
      | ($oc.repair_candidates // []) as $cands
      | ($oc.demand_anchors // {}) as $da
      # TOKENS live in DEMAND ANCHORS above — handoff is alvo/reason only.
      | if ($cands | length) == 0 and (($da.seed_targets // []) | length) == 0
        then empty
        else
          "=== FORENSICS HANDOFF (runtime) ===",
          "",
          (
            if ($cands | length) > 0 then
              ($cands[] | "ALVO: \(.id) — \(.reason // "unspecified")")
            else
              "ALVO: \($da.seed_targets[0]) — Demand: \((($da.dense_tokens // [])[0:3] | join(" ")))"
            end
          ),
          (
            if (($da.done_when // []) | length) > 0 then
              "DONE WHEN: \($da.done_when | join(" | "))"
            else empty end
          ),
          ""
        end
    ' "${handover}" 2>/dev/null || true
  )"
  [[ -n "${lines}" ]] || return 0
  printf '%s\n' "${lines}"
}

# ---------------------------------------------------------
# Mechanical discovery / forensics (default — no LLM)
# ---------------------------------------------------------
# One seed authority: aegis_materialize_demand_anchors_json
#   handover > attention_seed > layer0_resonance > prior
# Mechanical modes only project that object — no re-ranking.
#
# Discovery: content-aware gap projection (probe each path).
# Forensics: {id, reason}; multi named → one each; else Alvo Único
#   (1 seed, or multi-seed unique probe winner, else first seed if forced).
# AEGIS_DISCOVERY_LLM=1  → force discovery LLM
# AEGIS_FORENSICS_LLM:
#   auto (default) — LLM only on multi-seed probe tie / no signal
#   1|llm          — always LLM
#   0|mechanical   — always mechanical
# Search evidence: LLM path only (see execute_mode + ensure_search).
#
# Call shape (execute_mode): text, payload_dir, handover
# (materialize itself takes text, handover, payload_dir).

# Resolve anchors for mechanical modes. Arg order: text, payload_dir, handover.
# Explicit empty strings pin "no file" (no env leak in tests).
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
  jq -n -c --argjson a "${anchors_json}" \
    '{
      named: ($a.operator_named_paths // []),
      seed: ($a.seed_targets // []),
      dense: ($a.dense_tokens // [])
    }'
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
    jq -n '{status: "inconclusive", repair_candidates: []}'
    return 0
  fi

  while IFS= read -r path; do
    [[ -n "${path}" ]] || continue
    probe="$(aegis_discovery_probe_path "${path}" "${tokens_nl}" ".")"
    reason="$(aegis_forensics_mechanical_reason "${text}" "${path}" "${probe}" "${tokens_nl}")"
    cands_json="$(
      jq -n -c \
        --argjson acc "${cands_json}" \
        --arg id "${path}" \
        --arg reason "${reason}" \
        '$acc + [{id: $id, reason: $reason}]'
    )"
  done < <(printf '%s' "${paths_json}" | jq -r '.[]?')

  jq -n --argjson cands "${cands_json}" \
    '{status: "interpreted", repair_candidates: $cands}'
}

aegis_emit_mechanical_forensics_substrate() {
  local body
  body="$(aegis_build_mechanical_forensics_json "$@")" || return 1
  aegis_emit_framed_json_artifact "${body}"
}

# Runtime tribunal snapshot for validation prompts (from handover + optional tools).
aegis_format_tribunal_summary_section() {
  local handover="${1-}"
  if [[ -z "${handover}" ]]; then
    handover="${AEGIS_EPISTEMIC_HANDOVER_FILE:-${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}}"
  fi
  [[ -n "${handover}" && -f "${handover}" ]] || return 0

  jq -r '
    .artifact_snapshot as $snap
    | ($snap.operational_context // {}) as $oc
    | ($oc.findings // $snap.findings // []) as $f
    | ($oc.candidate_result // {}) as $c
    | ($c.files_changed // $oc.files_changed // []) as $files
    | "=== TRIBUNAL SUMMARY (runtime) ===",
      "",
      "candidate_files: " + (if ($files | length) > 0 then ($files | join(", ")) else "(none)" end),
      "findings_count: " + (($f | length) | tostring),
      "blocking_findings: " + ([ $f[]? | select(
          (.supported_by_evidence == true)
          and ((.severity == "high") or (.severity == "medium"))
        )] | length | tostring),
      "adversarial_status: " + (
        if ($snap.mode == "adversarial") then ($oc.status // $snap.status // "?")
        else ($oc.status // "n/a") end
      ),
      "Prefer tools + evidence-backed findings; do not invent new defects.",
      ""
  ' "${handover}" 2>/dev/null || true
}

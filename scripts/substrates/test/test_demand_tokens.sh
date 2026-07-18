#!/usr/bin/env bash

# =========================================================
# Demand tokens + search query binding + dense resonance
# =========================================================

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

# shellcheck disable=SC1091
source "${AEGIS_TEST_ROOT}/scripts/lib/common.sh"
source "${AEGIS_TEST_ROOT}/scripts/lib/demand.sh"

# --- tokens strip stopwords, keep domain units ---
tokens="$(aegis_demand_tokens "funções de conversão, como Megabits para Gigabits")"
printf '%s\n' "${tokens}" | grep -qx 'megabits' \
  || fail "missing_megabits_token: ${tokens}"
printf '%s\n' "${tokens}" | grep -qx 'gigabits' \
  || fail "missing_gigabits_token: ${tokens}"
printf '%s\n' "${tokens}" | grep -qx 'como' \
  && fail "stopword_como_leaked"
printf '%s\n' "${tokens}" | grep -qx 'para' \
  && fail "stopword_para_leaked"
printf '%s\n' "${tokens}" | grep -qx 'funcoes' \
  && fail "stopword_funcoes_leaked"

# --- dense tokens drop generic stems (bytes) keep domain units ---
dense="$(aegis_demand_dense_tokens "funções de conversão, como Megabits para bytes")"
printf '%s\n' "${dense}" | grep -qx 'megabits' \
  || fail "dense_missing_megabits: ${dense}"
printf '%s\n' "${dense}" | grep -qx 'bytes' \
  && fail "dense_kept_generic_bytes: ${dense}"
printf '%s\n' "${dense}" | grep -qx 'conversao' \
  || fail "dense_missing_conversao: ${dense}"

# --- search query joins dense tokens with ;; (fixed-string multi) ---
q="$(aegis_demand_search_query "funções de conversão, como Megabits para bytes" "AEGIS" 3)"
printf '%s' "${q}" | grep -q 'megabits' \
  || fail "search_query_missing_megabits: ${q}"
[[ "${q}" != *AEGIS* ]] \
  || fail "search_query_should_not_fallback_when_tokens_exist: ${q}"
[[ "${q}" != *'|'* ]] \
  || fail "search_query_must_not_use_ere_pipe: ${q}"
if [[ "${q}" == *"${AEGIS_DEMAND_TOKEN_SEP}"* ]]; then
  :
elif [[ "${q}" == *megabits* ]]; then
  # single dense token is fine
  :
else
  fail "search_query_unexpected_shape: ${q}"
fi
printf '%s' "${q}" | grep -q 'bytes' \
  && fail "search_query_should_prefer_dense_skip_bytes: ${q}"

# --- empty / glue-only demand falls back ---
fb="$(aegis_demand_search_query "the and for para como" "AEGIS" 3)"
[[ "${fb}" == "AEGIS" ]] \
  || fail "expected_fallback_AEGIS: ${fb}"

# --- resolve_capability_argument binds search to demand ---
export AEGIS_MODE="forensics"
export AEGIS_INVESTIGATION_INPUT="Megabits to Gigabits conversion helpers"
# shellcheck disable=SC1091
source <(
  sed -n \
    '/^resolve_capability_argument()/,/^run_with_isolated_base_env()/p' \
    scripts/execute_mode.sh \
    | sed '$d'
)
# config already sourced by test lib → AEGIS_CAPABILITY_ARGUMENTS present
resolved="$(resolve_capability_argument "filesystem.search_symbol" "")"
printf '%s' "${resolved}" | grep -Eiq 'megabits|gigabits' \
  || fail "resolve_search_not_demand_bound: ${resolved}"
[[ "${resolved}" != "AEGIS" ]] \
  || fail "resolve_still_static_AEGIS"

# --- content resonance: megabits lives in src/index.ts ---
if [[ -f src/index.ts ]] && grep -qi megabit src/index.ts; then
  hits="$(
    AEGIS_LAYER0_SOURCE_ONLY=1 \
    AEGIS_INVESTIGATION_INPUT="funções de conversão, como Megabits para Gigabits" \
    bash -c '
      set -Eeuo pipefail
      source scripts/capabilities/runtime/layer0_facts.sh
      cd "$(pwd)"
      build_layer0_census
      layer0_hot_files
    '
  )"
  echo "${hits}" | jq -e '
    map(select(.file == "src/index.ts" and .resonance == 1)) | length > 0
  ' >/dev/null \
    || fail "layer0_missing_content_resonance_on_index: ${hits}"
fi

# --- search_symbol envelope must survive multi-token ;; queries ---
# Regression: ERE | + broken grep -c crashed jq --argjson in forensics.
export AEGIS_EXECUTION_ID="test-demand-tokens"
export AEGIS_EXECUTION_TIMESTAMP="1970-01-01T00:00:00Z"
export AEGIS_EXECUTION_SURFACE_PATH="${AEGIS_TEST_ROOT}"
multi_q="$(aegis_demand_search_query "funções de conversão, como Megabits para Gigabits" "AEGIS" 3)"
printf '%s' "${multi_q}" | grep -q "${AEGIS_DEMAND_TOKEN_SEP}" \
  || fail "expected_multi_token_query_with_sep: ${multi_q}"
search_json="$(
  bash scripts/capabilities/filesystem/search_symbol.sh "${multi_q}" src 2>/dev/null
)" || fail "search_symbol_multi_token_exit: ${multi_q}"
echo "${search_json}" | jq -e '
  .success == true
  and .capability == "filesystem.search_symbol"
  and (.payload.total_matches | type == "number")
  and (.payload.query | contains(";;"))
' >/dev/null \
  || fail "search_symbol_multi_token_payload_invalid: ${search_json}"

# --- discovery enrich: invent-on-disk required_evidence dropped when seed set ---
# shellcheck disable=SC1091
source "${AEGIS_TEST_ROOT}/scripts/lib/artifact_protocol.sh"
export AEGIS_MODE="discovery"
export AEGIS_INVESTIGATION_INPUT="funções de conversão, como Megabits para bytes"
raw_disc='{
  "observations": ["need content"],
  "rationale": "probe",
  "required_evidence": [
    "filesystem.read:src/index.ts",
    "filesystem.read:src/ui/fake_import.ts"
  ]
}'
ctx_disc="$(
  jq -n \
    --argjson evidence_refs '["runtime.layer0_facts"]' \
    --argjson observed_payloads '["runtime_layer0_facts.json"]' \
    --argjson prev_candidate 'null' \
    --argjson prev_findings 'null' \
    --argjson seed_scope '{"scope_type":"layer0","scope_targets":["src/index.ts"],"scope_confidence":"high"}' \
    --argjson seed_targets '["src/index.ts"]' \
    --argjson seed_conditions '[]' \
    --argjson operator_named_paths '[]' \
    --argjson existing_paths '["src/index.ts","src/ui/fake_import.ts"]' \
    --argjson tools_gate '{}' \
    '{
      evidence_refs: $evidence_refs,
      observed_payloads: $observed_payloads,
      prev_candidate: $prev_candidate,
      prev_findings: $prev_findings,
      seed_scope: $seed_scope,
      seed_targets: $seed_targets,
      seed_conditions: $seed_conditions,
      operator_named_paths: $operator_named_paths,
      existing_paths: $existing_paths,
      tools_gate: $tools_gate
    }'
)"
enriched="$(enrich_cognitive_artifact "${raw_disc}" "${ctx_disc}")"
echo "${enriched}" | jq -e '
  (.operational_context.required_evidence | index("filesystem.read:src/index.ts")) != null
  and (.operational_context.required_evidence | index("filesystem.read:src/ui/fake_import.ts")) == null
  and (.handover_attention.next_attention_targets | index("src/index.ts")) != null
  and (.handover_attention.next_attention_targets | index("src/ui/fake_import.ts")) == null
' >/dev/null \
  || fail "discovery_should_drop_invented_on_disk_path: ${enriched}"

# Operator-named path always kept even if not in seed.
export AEGIS_INVESTIGATION_INPUT="add helper in src/ui/fake_import.ts for megabits"
raw_named='{
  "observations": ["named"],
  "rationale": "op",
  "required_evidence": ["filesystem.read:src/ui/fake_import.ts"]
}'
ctx_named="$(
  printf '%s' "${ctx_disc}" | jq \
    --argjson named "$(aegis_extract_operator_named_paths_json "${AEGIS_INVESTIGATION_INPUT}")" \
    '.operator_named_paths = $named'
)"
enriched_named="$(enrich_cognitive_artifact "${raw_named}" "${ctx_named}")"
echo "${enriched_named}" | jq -e '
  (.operational_context.required_evidence | index("filesystem.read:src/ui/fake_import.ts")) != null
  and (.operational_context.operator_named_paths | index("src/ui/fake_import.ts")) != null
' >/dev/null \
  || fail "operator_named_must_survive_enrich: ${enriched_named}"

# --- prioritize_evidence_entries ranks anchors/reads before search/git ---
# shellcheck disable=SC1091
source <(
  sed -n \
    '/^_evidence_entry_priority_rank()/,/^resolve_evidence_entry_capability()/p' \
    scripts/execute_mode.sh \
    | sed '$d'
)
AEGIS_ACTIVE_EVIDENCE_ENTRIES=(
  "git.status"
  "filesystem.search_symbol"
  "runtime.attention_seed"
  "runtime.layer0_facts"
  "filesystem.read:src/index.ts"
  "runtime.demand_anchors"
  "filesystem.read:epistemic_handover"
)
prioritize_evidence_entries
[[ "${AEGIS_ACTIVE_EVIDENCE_ENTRIES[0]}" == "runtime.demand_anchors" ]] \
  || fail "priority_first_should_be_demand_anchors: ${AEGIS_ACTIVE_EVIDENCE_ENTRIES[*]}"
# layer0 must precede attention_seed (predecessor payload dependency)
_l0_pos=-1
_seed_pos=-1
_i=0
for _e in "${AEGIS_ACTIVE_EVIDENCE_ENTRIES[@]}"; do
  [[ "${_e}" == "runtime.layer0_facts" ]] && _l0_pos="${_i}"
  [[ "${_e}" == "runtime.attention_seed" ]] && _seed_pos="${_i}"
  _i=$((_i + 1))
done
[[ "${_l0_pos}" -ge 0 && "${_seed_pos}" -ge 0 && "${_l0_pos}" -lt "${_seed_pos}" ]] \
  || fail "priority_layer0_before_attention_seed: ${AEGIS_ACTIVE_EVIDENCE_ENTRIES[*]}"
_last_idx=$((${#AEGIS_ACTIVE_EVIDENCE_ENTRIES[@]} - 1))
[[ "${AEGIS_ACTIVE_EVIDENCE_ENTRIES[_last_idx]}" == "git.status" ]] \
  || fail "priority_git_should_be_last: ${AEGIS_ACTIVE_EVIDENCE_ENTRIES[*]}"
unset _last_idx _l0_pos _seed_pos _i _e

# --- demand_anchors mechanical projection ---
export AEGIS_INVESTIGATION_INPUT="funções de conversão, como Megabits para bytes"
anchors="$(aegis_materialize_demand_anchors_json "${AEGIS_INVESTIGATION_INPUT}" "" "")"
echo "${anchors}" | jq -e '
  (.dense_tokens | index("megabits")) != null
  and (.dense_tokens | index("bytes") | not)
  and (.search_query | contains("megabits"))
  and (.search_query | contains(";;") or (.search_query | contains("conversao")))
  and (.operator_named_paths | type == "array")
  and (.seed_targets | type == "array")
  and (.seed_source | type == "string")
  and (.content_resonance | type == "array")
' >/dev/null \
  || fail "demand_anchors_shape_invalid: ${anchors}"

# seed from synthetic handover
tmp_h="$(mktemp)"
jq -n '{
  artifact_snapshot: null,
  epistemic_state: {
    next_attention_targets: ["src/index.ts"],
    attention_scope: "layer0",
    attention_reason: "test"
  }
}' > "${tmp_h}"
anchors_h="$(aegis_materialize_demand_anchors_json "${AEGIS_INVESTIGATION_INPUT}" "${tmp_h}" "")"
rm -f "${tmp_h}"
echo "${anchors_h}" | jq -e '
  (.seed_targets | index("src/index.ts")) != null
  and .seed_source == "handover"
' >/dev/null \
  || fail "demand_anchors_handover_seed: ${anchors_h}"

# section formatter emits header + json
section="$(aegis_format_demand_anchors_section "${anchors}")"
printf '%s' "${section}" | grep -q 'DEMAND ANCHORS' \
  || fail "demand_anchors_section_missing_header"
printf '%s' "${section}" | grep -q 'dense_tokens' \
  || fail "demand_anchors_section_missing_json"

# named path demand
named_a="$(aegis_materialize_demand_anchors_json "edit src/index.ts convert megabits" "" "")"
echo "${named_a}" | jq -e '
  (.operator_named_paths | index("src/index.ts")) != null
' >/dev/null \
  || fail "demand_anchors_operator_path: ${named_a}"

echo "[AEGIS][TEST] demand tokens passed"

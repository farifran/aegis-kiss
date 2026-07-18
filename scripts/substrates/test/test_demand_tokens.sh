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

# --- search_symbol pathspecs confine to mechanical targets (not harness) ---
ps="$(aegis_search_symbol_pathspecs "edit src/index.ts convert terabits" "" "")"
printf '%s\n' "${ps}" | grep -qx 'src/index.ts' \
  || fail "pathspecs_should_include_operator_named: ${ps}"
# no anchors → product default src/
ps_default="$(aegis_search_symbol_pathspecs "the and for para como" "" "")"
printf '%s\n' "${ps_default}" | grep -qx 'src' \
  || fail "pathspecs_empty_anchors_default_src: ${ps_default}"
# scoped search must not pull matches from scripts/docs when pathspec is src only
scoped_json="$(
  AEGIS_SEARCH_SYMBOL_PATHSPECS=$'src/index.ts\n' \
    bash scripts/capabilities/filesystem/search_symbol.sh "terabit" . 2>/dev/null
)" || fail "search_symbol_scoped_exit"
echo "${scoped_json}" | jq -e '
  .success == true
  and (.payload.pathspecs | index("src/index.ts")) != null
  and ((.payload.matches | test("scripts/|entry\\.md|README"; "i")) | not)
' >/dev/null \
  || fail "search_symbol_should_stay_on_target: ${scoped_json}"

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
    --argjson demand_anchors '{}' \
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
      tools_gate: $tools_gate,
      demand_anchors: $demand_anchors
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
# layer0 → attention_seed → demand_anchors (seed predecessor + seed-aware anchors)
_l0_pos=-1
_seed_pos=-1
_da_pos=-1
_i=0
for _e in "${AEGIS_ACTIVE_EVIDENCE_ENTRIES[@]}"; do
  [[ "${_e}" == "runtime.layer0_facts" ]] && _l0_pos="${_i}"
  [[ "${_e}" == "runtime.attention_seed" ]] && _seed_pos="${_i}"
  [[ "${_e}" == "runtime.demand_anchors" ]] && _da_pos="${_i}"
  _i=$((_i + 1))
done
[[ "${_l0_pos}" -ge 0 && "${_seed_pos}" -ge 0 && "${_l0_pos}" -lt "${_seed_pos}" ]] \
  || fail "priority_layer0_before_attention_seed: ${AEGIS_ACTIVE_EVIDENCE_ENTRIES[*]}"
[[ "${_seed_pos}" -ge 0 && "${_da_pos}" -ge 0 && "${_seed_pos}" -lt "${_da_pos}" ]] \
  || fail "priority_attention_seed_before_demand_anchors: ${AEGIS_ACTIVE_EVIDENCE_ENTRIES[*]}"
_last_idx=$((${#AEGIS_ACTIVE_EVIDENCE_ENTRIES[@]} - 1))
[[ "${AEGIS_ACTIVE_EVIDENCE_ENTRIES[_last_idx]}" == "git.status" ]] \
  || fail "priority_git_should_be_last: ${AEGIS_ACTIVE_EVIDENCE_ENTRIES[*]}"
unset _last_idx _l0_pos _seed_pos _i _e

# --- forensics enrich: rewrite hallucinated reason + force seed alvo ---
export AEGIS_MODE="forensics"
export AEGIS_INVESTIGATION_INPUT="funções de conversão, como Terabits para Gigabits"
raw_for='{
  "status": "interpreted",
  "repair_candidates": [
    {"id": "src/index.ts", "reason": "Request: add power function."},
    {"id": "src/ui/fake_import.ts", "reason": "also maybe"}
  ]
}'
ctx_for="$(
  jq -n \
    --argjson evidence_refs '["runtime.demand_anchors","filesystem.read:src/index.ts"]' \
    --argjson observed_payloads '["runtime_demand_anchors.json"]' \
    --argjson prev_candidate 'null' \
    --argjson prev_findings 'null' \
    --argjson seed_scope '{"scope_type":"layer0","scope_targets":["src/index.ts"],"scope_confidence":"high"}' \
    --argjson seed_targets '["src/index.ts"]' \
    --argjson seed_conditions '[]' \
    --argjson operator_named_paths '[]' \
    --argjson existing_paths '["src/index.ts","src/ui/fake_import.ts"]' \
    --argjson tools_gate '{}' \
    --argjson demand_anchors "$(aegis_materialize_demand_anchors_json "${AEGIS_INVESTIGATION_INPUT}" "" "")" \
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
      tools_gate: $tools_gate,
      demand_anchors: $demand_anchors
    }'
)"
enriched_for="$(enrich_cognitive_artifact "${raw_for}" "${ctx_for}")"
echo "${enriched_for}" | jq -e '
  (.repair_candidates | length) == 1
  and .repair_candidates[0].id == "src/index.ts"
  and (.repair_candidates[0].reason | test("power"; "i") | not)
  and (
    (.repair_candidates[0].reason | test("terabit"; "i"))
    or (.repair_candidates[0].reason | test("gigabit"; "i"))
    or (.repair_candidates[0].reason | test("convers"; "i"))
    or (.repair_candidates[0].reason | startswith("Demand:"))
  )
' >/dev/null \
  || fail "forensics_should_bind_reason_and_single_seed: ${enriched_for}"

# reason that already cites a dense token is preserved
raw_ok='{
  "status": "interpreted",
  "repair_candidates": [
    {"id": "src/index.ts", "reason": "add terabitsToGigabits helper"}
  ]
}'
enriched_ok="$(enrich_cognitive_artifact "${raw_ok}" "${ctx_for}")"
echo "${enriched_ok}" | jq -e '
  .repair_candidates[0].reason == "add terabitsToGigabits helper"
' >/dev/null \
  || fail "forensics_should_keep_token_aligned_reason: ${enriched_ok}"

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

# section formatter: human lines only (JSON lives in capability payload)
section="$(aegis_format_demand_anchors_section "${anchors}")"
printf '%s' "${section}" | grep -q 'DEMAND ANCHORS' \
  || fail "demand_anchors_section_missing_header"
printf '%s' "${section}" | grep -q '^SEED:' \
  || fail "demand_anchors_section_missing_seed_line"
printf '%s' "${section}" | grep -q '^TOKENS:' \
  || fail "demand_anchors_section_missing_tokens_line"
printf '%s' "${section}" | grep -q 'megabits' \
  || fail "demand_anchors_section_missing_token_value"
printf '%s' "${section}" | grep -q '^json:' \
  && fail "demand_anchors_section_should_not_duplicate_json"

# named path demand
named_a="$(aegis_materialize_demand_anchors_json "edit src/index.ts convert megabits" "" "")"
echo "${named_a}" | jq -e '
  (.operator_named_paths | index("src/index.ts")) != null
' >/dev/null \
  || fail "demand_anchors_operator_path: ${named_a}"

# structured demand → goal / targets_header / done_when
structured_demand="$(cat <<'EOF'
## Goal
Add terabits conversion helper.

## Targets
- src/index.ts

## Acceptance
- terabitsToGigabits(1) returns 1024
- exported from index

## Change
one function

## Out of scope
UI
EOF
)"
struct_a="$(aegis_materialize_demand_anchors_json "${structured_demand}" "" "")"
echo "${struct_a}" | jq -e '
  (.goal | test("terabits"; "i"))
  and (.targets_header | index("src/index.ts")) != null
  and (.done_when | length) >= 1
  and (.done_when[0] | test("1024|terabits"; "i"))
' >/dev/null \
  || fail "structured_demand_anchors_incomplete: ${struct_a}"
struct_sec="$(aegis_format_demand_anchors_section "${struct_a}")"
printf '%s' "${struct_sec}" | grep -q '^GOAL:' \
  || fail "structured_section_missing_goal"
printf '%s' "${struct_sec}" | grep -q '^DONE WHEN:' \
  || fail "structured_section_missing_done_when"

# discovery scrub + path clamp + mechanical rationale when seed present
export AEGIS_MODE="discovery"
export AEGIS_INVESTIGATION_INPUT="funções de conversão, como Terabits para Gigabits"
raw_scrub='{
  "observations": [
    "Operator named src/index.ts; Layer 0 lists it as an entrypoint.",
    "Investigation needs content of src/ui/fake_import.ts before forensics can choose a mutation target.",
    "Investigation needs content of src/index.ts before forensics can choose a mutation target."
  ],
  "rationale": "Operator named src/index.ts without demand path.",
  "required_evidence": [
    "filesystem.read:src/index.ts",
    "filesystem.read:src/ui/fake_import.ts"
  ]
}'
ctx_scrub="$(
  printf '%s' "${ctx_disc}" | jq \
    --argjson named '[]' \
    --argjson seed '["src/index.ts"]' \
    '.operator_named_paths = $named | .seed_targets = $seed'
)"
enriched_scrub="$(enrich_cognitive_artifact "${raw_scrub}" "${ctx_scrub}")"
echo "${enriched_scrub}" | jq -e '
  (.operational_context.operational_observations | tostring | test("Operator named"; "i") | not)
  and (.operational_context.operational_observations | tostring | test("fake_import") | not)
  and (.operational_context.operational_observations | map(select(test("src/index.ts"))) | length) >= 1
  and (.operational_context.rationale | tostring | test("Operator named"; "i") | not)
  and (.operational_context.rationale | tostring | test("seed|src/index"; "i"))
  and (.operational_context.required_evidence | index("filesystem.read:src/ui/fake_import.ts")) == null
' >/dev/null \
  || fail "discovery_should_clamp_paths_and_mechanical_rationale: ${enriched_scrub}"

# mechanical discovery: seed path + content probe
export AEGIS_INVESTIGATION_INPUT="funções de conversão, como Terabits para Megabits"
mech_pd="$(mktemp -d)"
jq -n '{
  success: true,
  capability: "runtime.attention_seed",
  payload: {
    attention_targets: ["src/index.ts"],
    investigation_scope: {
      scope_type: "layer0",
      scope_targets: ["src/index.ts"],
      scope_confidence: "high"
    }
  }
}' > "${mech_pd}/runtime_attention_seed.json"
mech="$(aegis_build_mechanical_discovery_json "${AEGIS_INVESTIGATION_INPUT}" "${mech_pd}" "")"
rm -rf "${mech_pd}"
echo "${mech}" | jq -e '
  (.required_evidence | index("filesystem.read:src/index.ts")) != null
  and (.observations | length) >= 1
  and (.observations[0] | test("src/index.ts"))
  and (.rationale | test("seed|src/index|token"; "i"))
' >/dev/null \
  || fail "mechanical_discovery_seed_shape: ${mech}"
# content-aware: if index already has megabit/terabit symbols, expect present_hits tone
if grep -qiE 'megabit|terabit' src/index.ts 2>/dev/null; then
  echo "${mech}" | jq -e '
    .observations[0] | test("already contains|demand-related|exists"; "i")
  ' >/dev/null \
    || fail "mechanical_discovery_should_report_token_hits: ${mech}"
fi

# missing path probe
probe_miss="$(aegis_discovery_probe_path "src/does_not_exist_zz.ts" $'megabits\nterabits' ".")"
[[ "${probe_miss}" == "missing" ]] \
  || fail "probe_expected_missing: ${probe_miss}"

# mechanical empty anchors (explicit empty handover/payload — no env leak)
mech_empty="$(aegis_build_mechanical_discovery_json "the and for para como" "" "")"
echo "${mech_empty}" | jq -e '
  (.required_evidence | length) == 0
  and (.observations | length) >= 1
  and (.rationale | test("empty"; "i"))
' >/dev/null \
  || fail "mechanical_discovery_empty_shape: ${mech_empty}"

# mechanical forensics: single seed → interpreted candidate + directed reason
export AEGIS_INVESTIGATION_INPUT="funções de conversão, como Terabits para Megabits"
for_pd="$(mktemp -d)"
jq -n '{
  success: true,
  payload: { attention_targets: ["src/index.ts"] }
}' > "${for_pd}/runtime_attention_seed.json"
for_mech="$(aegis_build_mechanical_forensics_json "${AEGIS_INVESTIGATION_INPUT}" "${for_pd}" "")"
# auto: single seed must NOT request LLM
if aegis_forensics_needs_llm "${AEGIS_INVESTIGATION_INPUT}" "${for_pd}" ""; then
  fail "forensics_auto_should_be_mechanical_on_single_seed"
fi
echo "${for_mech}" | jq -e '
  .status == "interpreted"
  and (.repair_candidates | length) == 1
  and .repair_candidates[0].id == "src/index.ts"
  and (.repair_candidates[0].reason | test("terabit|megabit|Demand"; "i"))
  and (.repair_candidates[0].reason | test("power"; "i") | not)
' >/dev/null \
  || fail "mechanical_forensics_shape: ${for_mech}"

# multi-seed, both no demand hits → probe tie → needs LLM
jq -n '{
  success: true,
  payload: { attention_targets: ["src/index.ts", "src/ui/fake_import.ts"] }
}' > "${for_pd}/runtime_attention_seed.json"
if ! aegis_forensics_needs_llm "${AEGIS_INVESTIGATION_INPUT}" "${for_pd}" ""; then
  fail "forensics_auto_should_need_llm_on_multi_seed_tie"
fi
# force mechanical
if AEGIS_FORENSICS_LLM=0 aegis_forensics_needs_llm "${AEGIS_INVESTIGATION_INPUT}" "${for_pd}" ""; then
  fail "forensics_llm=0_should_force_mechanical"
fi
# force LLM
if ! AEGIS_FORENSICS_LLM=1 aegis_forensics_needs_llm "${AEGIS_INVESTIGATION_INPUT}" "${for_pd}" ""; then
  fail "forensics_llm=1_should_force_llm"
fi

# multi-seed with unique probe winner → mechanical (no LLM)
_win_a="src/.aegis_test_forensics_win_a.ts"
_win_b="src/.aegis_test_forensics_win_b.ts"
printf '%s\n' 'export function terabitsToMegabits(x: number): number { return x; }' > "${_win_a}"
printf '%s\n' 'export function unrelatedHelper(): void {}' > "${_win_b}"
jq -n \
  --arg a "${_win_a}" --arg b "${_win_b}" \
  '{ success: true, payload: { attention_targets: [ $a, $b ] } }' \
  > "${for_pd}/runtime_attention_seed.json"
if aegis_forensics_needs_llm "${AEGIS_INVESTIGATION_INPUT}" "${for_pd}" ""; then
  fail "forensics_auto_should_be_mechanical_on_probe_winner"
fi
for_win="$(aegis_build_mechanical_forensics_json "${AEGIS_INVESTIGATION_INPUT}" "${for_pd}" "")"
echo "${for_win}" | jq -e \
  --arg a "${_win_a}" \
  '.status == "interpreted"
   and (.repair_candidates | length) == 1
   and .repair_candidates[0].id == $a
   and (.repair_candidates[0].reason | test("terabit|megabit|Demand"; "i"))' \
  >/dev/null \
  || fail "mechanical_forensics_probe_winner: ${for_win}"
rm -f "${_win_a}" "${_win_b}"
rm -rf "${for_pd}"

# forensics empty anchors → inconclusive + no LLM (do not invent paths)
for_empty="$(aegis_build_mechanical_forensics_json "the and for para como" "" "")"
echo "${for_empty}" | jq -e '
  .status == "inconclusive"
  and (.repair_candidates | length) == 0
' >/dev/null \
  || fail "mechanical_forensics_empty: ${for_empty}"
if aegis_forensics_needs_llm "the and for para como" "" ""; then
  fail "forensics_empty_anchors_should_not_use_llm"
fi

# forensics handoff section for repair
tmp_fh="$(mktemp)"
jq -n \
  --argjson anchors "${struct_a}" \
  '{
    artifact_snapshot: {
      mode: "forensics",
      investigation_input: "terabits",
      generated_at: "2026-07-18T00:00:00Z",
      operational_context: {
        status: "interpreted",
        repair_candidates: [
          {id: "src/index.ts", reason: "Demand: terabits gigabits"}
        ],
        demand_anchors: $anchors
      }
    },
    epistemic_state: {
      next_attention_targets: ["src/index.ts"],
      attention_scope: "forensics",
      attention_reason: "test"
    }
  }' > "${tmp_fh}"
handoff="$(aegis_format_forensics_handoff_section "${tmp_fh}")"
printf '%s' "${handoff}" | grep -q 'FORENSICS HANDOFF' \
  || fail "forensics_handoff_missing_header: ${handoff}"
printf '%s' "${handoff}" | grep -q 'ALVO: src/index.ts' \
  || fail "forensics_handoff_missing_alvo: ${handoff}"

# mutation brief for repair (exports + probe state on ALVO)
brief="$(aegis_format_mutation_brief_section "${tmp_fh}" ".")"
printf '%s' "${brief}" | grep -q 'MUTATION BRIEF' \
  || fail "mutation_brief_missing_header: ${brief}"
printf '%s' "${brief}" | grep -q 'FILE: src/index.ts' \
  || fail "mutation_brief_missing_file: ${brief}"
printf '%s' "${brief}" | grep -q 'EXPORTS NOW:' \
  || fail "mutation_brief_missing_exports: ${brief}"
printf '%s' "${brief}" | grep -q 'one new export\|One demand' \
  || fail "mutation_brief_missing_rules: ${brief}"
aegis_handover_has_repair_alvo "${tmp_fh}" \
  || fail "handover_should_report_repair_alvo"
rm -f "${tmp_fh}"

# demand token preflight soft miss
export AEGIS_MODE="repair"
export AEGIS_INVESTIGATION_INPUT="funções de conversão, como Terabits para Gigabits"
# shellcheck disable=SC1091
source "${AEGIS_TEST_ROOT}/scripts/substrates/aider/preflight.sh" 2>/dev/null || true
if declare -f assert_demand_tokens_in_mutation_diff >/dev/null 2>&1; then
  bad_diff=$'diff --git a/src/index.ts b/src/index.ts\n+export function power(x: number): number { return x; }\n'
  assert_demand_tokens_in_mutation_diff "${bad_diff}" \
    || fail "soft_token_preflight_should_warn_not_fail"
  good_diff=$'diff --git a/src/index.ts b/src/index.ts\n+export function terabitsToGigabits(t: number): number { return t * 1024; }\n'
  assert_demand_tokens_in_mutation_diff "${good_diff}" \
    || fail "token_preflight_should_pass_when_token_in_diff"
fi

# Intent gates: tokens + over-export (used by repair preflight retry)
if declare -f collect_mutation_intent_violations >/dev/null 2>&1; then
  if collect_mutation_intent_violations "${bad_diff:-}"; then
    fail "intent_should_flag_missing_demand_tokens"
  fi
  printf '%s' "${AEGIS_MUTATION_INTENT_DIAGNOSTICS}" | grep -q 'demand_tokens' \
    || fail "intent_diag_should_mention_tokens: ${AEGIS_MUTATION_INTENT_DIAGNOSTICS}"

  if ! collect_mutation_intent_violations "${good_diff:-}"; then
    fail "intent_should_pass_aligned_export: ${AEGIS_MUTATION_INTENT_DIAGNOSTICS}"
  fi

  over_diff=$'diff --git a/src/index.ts b/src/index.ts\n+export function terabitsToGigabits(t: number): number { return t; }\n+export function terabitsToGigabitsExact(t: number): number { return t; }\n'
  if collect_mutation_intent_violations "${over_diff}"; then
    fail "intent_should_flag_over_export"
  fi
  printf '%s' "${AEGIS_MUTATION_INTENT_DIAGNOSTICS}" | grep -q 'over_export' \
    || fail "intent_diag_should_mention_over_export: ${AEGIS_MUTATION_INTENT_DIAGNOSTICS}"

  n_exp="$(count_diff_added_exports "${over_diff}")"
  [[ "${n_exp}" == "2" ]] || fail "export_count_expected_2: ${n_exp}"

  # soft gate fails (for retry); hard also fails
  if AEGIS_MUTATION_INTENT_PREFLIGHT=soft assert_mutation_intent_gates "${over_diff}"; then
    fail "soft_intent_gate_should_fail_to_trigger_retry"
  fi
  if AEGIS_MUTATION_INTENT_PREFLIGHT=off assert_mutation_intent_gates "${over_diff}"; then
    : # warn-only pass
  else
    fail "off_intent_gate_should_not_block"
  fi
fi

# R3: repair_feedback section + validation demand_mismatch merge shape
tmp_rf="$(mktemp)"
jq -n '{
  artifact_snapshot: {
    mode: "validation",
    operational_context: {
      verdict: "rejected",
      repair_feedback: {
        authorized_scopes: ["src/index.ts"],
        violations: [
          {
            origin: "demand_mismatch",
            severity: "high",
            target_files: ["src/index.ts"],
            structural_reason: "over_export: 2 new exports"
          }
        ]
      }
    }
  },
  epistemic_state: {
    next_attention_targets: ["src/index.ts"],
    attention_scope: "validation_result",
    attention_reason: "test"
  }
}' > "${tmp_rf}"
rf_sec="$(aegis_format_repair_feedback_section "${tmp_rf}")"
printf '%s' "${rf_sec}" | grep -q 'REPAIR FEEDBACK' \
  || fail "repair_feedback_section_missing: ${rf_sec}"
printf '%s' "${rf_sec}" | grep -q 'demand_mismatch' \
  || fail "repair_feedback_should_list_demand_mismatch: ${rf_sec}"
printf '%s' "${rf_sec}" | grep -q 'src/index.ts' \
  || fail "repair_feedback_should_list_scope: ${rf_sec}"
rm -f "${tmp_rf}"

# validation enrich forces reject when candidate carries intent_violations
val_raw='{"verdict":"accepted","basis":[],"findings":[]}'
prev_cand_json="$(
  jq -nc '{
    source_mode: "optimize",
    diff: "diff --git a/src/index.ts b/src/index.ts\n+++ b/src/index.ts\n+export function power(): void {}",
    files_changed: ["src/index.ts"],
    intent_violations: [
      {
        origin: "demand_mismatch",
        severity: "high",
        target_files: ["src/index.ts"],
        structural_reason: "demand_tokens: missing",
        evidence_refs: ["mutation.intent"]
      }
    ]
  }'
)"
val_ctx="$(
  jq -nc --argjson prev "${prev_cand_json}" '{
    evidence_refs: [],
    observed_payloads: [],
    prev_candidate: $prev,
    prev_findings: [],
    seed_scope: {scope_type:"none",scope_targets:[],scope_confidence:"none"},
    seed_targets: [],
    seed_conditions: [],
    operator_named_paths: [],
    existing_paths: ["src/index.ts"],
    tools_gate: {mutation_clean: true, typescript_errors_in_scope: [], eslint_errors_in_scope: []},
    demand_anchors: {}
  }'
)"
# shellcheck disable=SC1091
source "${AEGIS_TEST_ROOT}/scripts/lib/artifact_protocol.sh" 2>/dev/null || true
if declare -f enrich_cognitive_artifact >/dev/null 2>&1; then
  export AEGIS_MODE="validation"
  val_out="$(enrich_cognitive_artifact "${val_raw}" "${val_ctx}")"
  echo "${val_out}" | jq -e '
    .verdict == "rejected"
    and ((.basis | index("demand_mismatch")) != null)
    and (.repair_feedback.violations | map(.origin) | index("demand_mismatch") != null)
    and (.repair_feedback.authorized_scopes | index("src/index.ts") != null)
  ' >/dev/null \
    || fail "validation_should_reject_intent_violations: ${val_out}"
fi

echo "[AEGIS][TEST] demand tokens passed"

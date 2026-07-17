#!/usr/bin/env bash

# =========================================================
# Demand tokens + search query binding
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

# --- search query joins longest tokens ---
q="$(aegis_demand_search_query "funções de conversão, como Megabits para Gigabits" "AEGIS" 3)"
printf '%s' "${q}" | grep -q 'megabits' \
  || fail "search_query_missing_megabits: ${q}"
printf '%s' "${q}" | grep -q 'gigabits' \
  || fail "search_query_missing_gigabits: ${q}"
[[ "${q}" != *AEGIS* ]] \
  || fail "search_query_should_not_fallback_when_tokens_exist: ${q}"

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

# --- search_symbol envelope must survive multi-token | queries ---
# Regression: grep -c without -E + `|| echo 0` produced "0\n0" and
# crashed jq --argjson during forensics payload materialization.
export AEGIS_EXECUTION_ID="test-demand-tokens"
export AEGIS_EXECUTION_TIMESTAMP="1970-01-01T00:00:00Z"
export AEGIS_EXECUTION_SURFACE_PATH="${AEGIS_TEST_ROOT}"
multi_q="$(aegis_demand_search_query "funções de conversão, como Megabits para bytes" "AEGIS" 3)"
printf '%s' "${multi_q}" | grep -q '|' \
  || fail "expected_multi_token_query_with_pipe: ${multi_q}"
search_json="$(
  bash scripts/capabilities/filesystem/search_symbol.sh "${multi_q}" src 2>/dev/null
)" || fail "search_symbol_multi_token_exit: ${multi_q}"
echo "${search_json}" | jq -e '
  .success == true
  and .capability == "filesystem.search_symbol"
  and (.payload.total_matches | type == "number")
  and (.payload.query | test("\\|"))
' >/dev/null \
  || fail "search_symbol_multi_token_payload_invalid: ${search_json}"

echo "[AEGIS][TEST] demand tokens passed"

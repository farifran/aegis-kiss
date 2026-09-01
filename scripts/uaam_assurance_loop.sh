#!/usr/bin/env bash

# =========================================================
# AEGIS — UNIVERSAL ASSURANCE LOOP
# =========================================================
#
# Runs independent proof families until all pass, progress stops, or the
# bounded iteration budget is exhausted. When an authorized repair command is
# configured, each failed iteration is converted into a repair request and
# followed by a complete re-proof.
#
# =========================================================

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}" || exit 1

MAX_ITERATIONS="${AEGIS_UAAM_LOOP_MAX_ITERATIONS:-3}"
LOOP_DIR="${AEGIS_UAAM_LOOP_DIR:-${ROOT_DIR}/.harness/runtime/uaam_loop}"
REPAIR_CMD="${AEGIS_UAAM_REPAIR_CMD:-}"
if [[ -z "${REPAIR_CMD}" && "${AEGIS_UAAM_AUTO_REPAIR:-false}" == "true" ]]; then
  REPAIR_CMD='bash scripts/uaam_repair_aegis.sh'
fi

[[ "${MAX_ITERATIONS}" =~ ^[1-9][0-9]*$ ]] || {
  echo "[AEGIS][UAAM_LOOP] invalid_iteration_budget" >&2
  exit 2
}

mkdir -p "${LOOP_DIR}" || exit 1

run_check() {
  case "$1" in
    typecheck) npm run aegis:typecheck ;;
    lint) npm run aegis:lint ;;
    contract) bash scripts/uaam_contract_gate.sh ;;
    proof) bash scripts/capabilities/test_runner.sh ;;
    uaam_v3) npm run aegis:test:uaam-v3 ;;
    uaam_runtime) npm run aegis:test:uaam-runtime ;;
    composition) npm run aegis:test:compositional-proofs ;;
    evidence_compiler) npm run aegis:test:evidence-compiler ;;
    authority) npm run aegis:test:uaam-authority ;;
    *) echo "[AEGIS][UAAM_LOOP] unknown_check:$1" >&2; return 2 ;;
  esac
}

check_names=(typecheck lint contract proof uaam_v3 uaam_runtime composition evidence_compiler authority)
previous_fingerprint=""

for ((iteration = 1; iteration <= MAX_ITERATIONS; iteration++)); do
  iteration_dir="${LOOP_DIR}/iteration-${iteration}"
  mkdir -p "${iteration_dir}"
  check_records=()
  fingerprint_input=""
  all_passed=true

  for check_name in "${check_names[@]}"; do
    log_file="${iteration_dir}/${check_name}.log"
    check_rc=0
    run_check "${check_name}" >"${log_file}" 2>&1 || check_rc=$?
    check_status="passed"
    [[ "${check_rc}" -eq 0 ]] || { check_status="failed"; all_passed=false; }
    check_matrix='null'
    matrix_line="$(sed -n 's/^\[AEGIS\]\[EVIDENCE_MATRIX_JSON\]//p' "${log_file}" | tail -1)"
    if [[ -n "${matrix_line}" ]] && jq -e . >/dev/null 2>&1 <<<"${matrix_line}"; then
      check_matrix="${matrix_line}"
    fi
    fingerprint_input+="${check_name}:${check_status}:${check_rc}:${check_matrix}\n"
    check_records+=("$(jq -nc \
      --arg name "${check_name}" \
      --arg status "${check_status}" \
      --arg authority "$(if [[ "${check_name}" == "proof" ]]; then printf authoritative; else printf diagnostic; fi)" \
      --arg log "${log_file#${ROOT_DIR}/}" \
      --argjson exit_code "${check_rc}" \
      --argjson evidence_matrix "${check_matrix}" \
      '{name:$name,status:$status,authority:$authority,exit_code:$exit_code,evidence_log:$log,evidence_matrix:$evidence_matrix}')")
  done

  checks_json="$(printf '%s\n' "${check_records[@]}" | jq -s '.')"
  fingerprint="$(printf '%b' "${fingerprint_input}" | {
    if command -v shasum >/dev/null 2>&1; then shasum -a 256; else sha256sum; fi
  } | awk '{print $1}')"
  jq -n \
    --arg status "$(if ${all_passed}; then printf SUCCESS; else printf UNPROVEN; fi)" \
    --argjson iteration "${iteration}" \
    --arg fingerprint "${fingerprint}" \
    --argjson checks "${checks_json}" \
    '{version:"uaam-loop-v1",iteration:$iteration,status:$status,fingerprint:$fingerprint,checks:$checks}' \
    > "${iteration_dir}/evidence.json"
  cp "${iteration_dir}/evidence.json" "${LOOP_DIR}/latest.json"

  if ${all_passed}; then
    jq -n --argjson iteration "${iteration}" --arg fingerprint "${fingerprint}" \
      '{version:"uaam-loop-v1",status:"SUCCESS",iteration:$iteration,fingerprint:$fingerprint}' \
      > "${LOOP_DIR}/result.json"
    echo "[AEGIS][UAAM_LOOP] SUCCESS iteration=${iteration}"
    exit 0
  fi

  echo "[AEGIS][UAAM_LOOP] UNPROVEN iteration=${iteration} failed_checks=$(printf '%s\n' "${check_records[@]}" | jq -r 'select(.status == "failed") | .name' | paste -sd, -)"

  repair_request="${iteration_dir}/repair_request.json"
  failed_obligations="$(jq '[.[] | select(.status == "failed") | if (.evidence_matrix | type) == "array" then .evidence_matrix[] | select(.required != false and (.status == "DISPROVEN" or .status == "UNPROVEN")) else {id:.name, kind:"check", domain:"HARNESS", status:"UNPROVEN", required:true, evidence:(.name + " failed without structured evidence")} end]' <<<"${checks_json}")"
  jq -n \
    --argjson iteration "${iteration}" \
    --arg evidence "${iteration_dir#${ROOT_DIR}/}/evidence.json" \
    --argjson checks "${checks_json}" \
    --argjson failed_obligations "${failed_obligations}" \
    '{version:"uaam-repair-request-v1",iteration:$iteration,evidence_file:$evidence,failed_checks:[$checks[] | select(.status == "failed")],failed_obligations:$failed_obligations,mutation_policy:{mode:"minimal",scope:"authorized_by_repair_provider",reprove_after_mutation:true}}' \
    > "${repair_request}"

  if [[ -z "${REPAIR_CMD}" ]]; then
    jq -n \
      --argjson iteration "${iteration}" \
      --arg fingerprint "${fingerprint}" \
      '{version:"uaam-loop-v1",status:"UNPROVEN",reason:"repair_provider_missing",iteration:$iteration,fingerprint:$fingerprint}' \
      > "${LOOP_DIR}/result.json"
    echo "[AEGIS][UAAM_LOOP] UNPROVEN repair_provider_missing" >&2
    exit 1
  fi

  repair_log="${iteration_dir}/repair.log"
  repair_result="${iteration_dir}/repair_result.json"
  repair_rc=0
  AEGIS_UAAM_REPAIR_REQUEST="${repair_request}" \
    AEGIS_UAAM_FAILURE_EVIDENCE="${iteration_dir}/evidence.json" \
    AEGIS_UAAM_ITERATION="${iteration}" \
    AEGIS_UAAM_LOOP_DIR="${LOOP_DIR}" \
    AEGIS_UAAM_REPAIR_RESULT="${repair_result}" \
    AEGIS_UAAM_TARGETS="$(jq -c '(.targets // [])' .harness/active_contract_ir.json 2>/dev/null || printf '[]')" \
    bash -c "${REPAIR_CMD}" >"${repair_log}" 2>&1 || repair_rc=$?
  receipt_valid=0
  if [[ -s "${repair_result}" ]] && jq -e '
    .status == "APPLIED"
    and (.changedFiles | type == "array" and length > 0)
    and (.diffHash | type == "string" and length > 0)
    and (.scopeVerified == true)
  ' "${repair_result}" >/dev/null 2>&1; then
    receipt_valid=1
  fi
  jq --argjson exit_code "${repair_rc}" --arg log "${repair_log#${ROOT_DIR}/}" --arg receipt "${repair_result#${ROOT_DIR}/}" --argjson receipt_valid "${receipt_valid}" \
    '.repair={status:(if $exit_code == 0 and $receipt_valid == 1 then "APPLIED" else "FAILED" end),exit_code:$exit_code,evidence_log:$log,receipt:$receipt,receipt_valid:($receipt_valid == 1)}' \
    "${iteration_dir}/evidence.json" > "${iteration_dir}/evidence.with-repair.json"
  mv "${iteration_dir}/evidence.with-repair.json" "${iteration_dir}/evidence.json"
  cp "${iteration_dir}/evidence.json" "${LOOP_DIR}/latest.json"

  if [[ "${repair_rc}" -ne 0 || "${receipt_valid}" -ne 1 ]]; then
    repair_reason="repair_failed"
    [[ -s "${repair_result}" ]] || repair_reason="repair_receipt_missing"
    [[ "${repair_rc}" -eq 0 && "${receipt_valid}" -eq 0 && -s "${repair_result}" ]] && repair_reason="invalid_repair_receipt"
    jq -n \
      --argjson iteration "${iteration}" \
      --arg fingerprint "${fingerprint}" \
      --argjson repair_exit_code "${repair_rc}" \
      --arg reason "${repair_reason}" \
      --arg receipt "${repair_result#${ROOT_DIR}/}" \
      '{version:"uaam-loop-v1",status:"UNPROVEN",reason:$reason,iteration:$iteration,fingerprint:$fingerprint,repair_exit_code:$repair_exit_code,repair_receipt:$receipt}' \
      > "${LOOP_DIR}/result.json"
    echo "[AEGIS][UAAM_LOOP] UNPROVEN ${repair_reason} exit_code=${repair_rc}" >&2
    exit 1
  fi

  echo "[AEGIS][UAAM_LOOP] REPAIR_APPLIED iteration=${iteration}"
  if [[ "${fingerprint}" == "${previous_fingerprint}" ]]; then
    jq -n --argjson iteration "${iteration}" --arg fingerprint "${fingerprint}" \
      '{version:"uaam-loop-v1",status:"UNPROVEN",reason:"no_progress",iteration:$iteration,fingerprint:$fingerprint}' \
      > "${LOOP_DIR}/result.json"
    exit 1
  fi
  previous_fingerprint="${fingerprint}"
done

jq -n --argjson iteration "${MAX_ITERATIONS}" --arg fingerprint "${previous_fingerprint}" \
  '{version:"uaam-loop-v1",status:"UNPROVEN",reason:"iteration_budget_exhausted",iteration:$iteration,fingerprint:$fingerprint}' \
  > "${LOOP_DIR}/result.json"
echo "[AEGIS][UAAM_LOOP] UNPROVEN iteration_budget_exhausted=${MAX_ITERATIONS}" >&2
exit 1

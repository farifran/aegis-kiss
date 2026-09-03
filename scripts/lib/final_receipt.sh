#!/usr/bin/env bash

# =========================================================
# AEGIS — FINAL EXECUTION RECEIPT (source-only)
# =========================================================
#
# Binds the accepted contract to the validated candidate, the commit that was
# actually created, the post-commit tree, and the proof results available to
# the runtime. Missing evidence yields UNPROVEN, never VERIFIED.
#
# =========================================================

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "[AEGIS][FATAL] final_receipt_lib_not_invocable" >&2
  exit 1
fi

aegis_receipt_sha256() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 | awk '{print $1}'
  else
    cksum | awk '{print $1}'
  fi
}

aegis_receipt_patch_digest() {
  local patch="${1-}"
  local digest
  digest="$(printf '%s\n' "${patch}" | git patch-id --stable 2>/dev/null | awk 'NR == 1 {print $1}' || true)"
  if [[ -n "${digest}" ]]; then
    printf '%s' "${digest}"
  else
    printf '%s\n' "${patch}" | aegis_receipt_sha256
  fi
}

aegis_receipt_scope_digest() {
  local repository_root="${1-}"
  local commit="${2-}"
  local files_json="${3-[]}"
  local -a files=()
  local file
  while IFS= read -r file; do
    [[ -n "${file}" ]] && files+=("${file}")
  done < <(printf '%s' "${files_json}" | jq -r '.[]?')

  [[ -n "${repository_root}" && -n "${commit}" && "${#files[@]}" -gt 0 ]] || {
    printf 'missing-scope\n'
    return 0
  }
  git -C "${repository_root}" ls-tree -r -z "${commit}" -- "${files[@]}" 2>/dev/null \
    | aegis_receipt_sha256
}

aegis_final_receipt_assert_verified() {
  local receipt_file="${1-}"
  [[ -s "${receipt_file}" ]] || return 1
  jq -e '
    .schema == "aegis.final_receipt.v1"
    and .verification_status == "VERIFIED"
    and .verified == true
    and .contract.status == "equivalent"
    and .post_commit.contract_matches_commit == true
    and .post_commit.required_targets_present == true
    and .post_commit.scope_matches_candidate == true
    and .post_commit.candidate_patch_matches_commit == true
    and .post_commit.clean == true
  ' "${receipt_file}" >/dev/null 2>&1
}

# Args: commit issue target contract_file handover_file outcome_file metrics_file
aegis_write_final_receipt() {
  local commit="${1-}"
  local issue="${2-}"
  local target="${3-}"
  local contract_file="${4-}"
  local handover_file="${5-}"
  local outcome_file="${6-}"
  local metrics_file="${7-}"
  local runtime_dir="${AEGIS_RUNTIME_DIR:-.harness/runtime}"
  local repository_root="${AEGIS_ROOT_DIR:-.}"
  local receipt_file="${runtime_dir}/final_receipt.json"
  local receipt_archive_dir="${runtime_dir}/final_receipts"
  local receipt_archive_file
  local candidate_json contract_json committed_contract_json recon_json outcome_json
  local files_json candidate_diff candidate_digest actual_patch actual_patch_digest
  local contract_digest committed_contract_digest tree_digest state_digest commit_files_json
  local contract_equivalent validation_verdict findings_count blocking_findings
  local outcome_status pipeline_status uaam_status invariant_count proof_count
  local invariant_status scope_matches_commit candidate_matches_commit post_commit_clean
  local all_verified contract_matches_commit required_targets_present committed_contract_present tmp_file resolved_commit
  local -a files=()
  local file

  [[ -n "${commit}" && -f "${contract_file}" && -f "${handover_file}" ]] || return 1
  resolved_commit="$(git -C "${repository_root}" rev-parse --verify "${commit}^{commit}" 2>/dev/null)" || return 1
  commit="${resolved_commit}"

  contract_json="$(jq -c '.' "${contract_file}" 2>/dev/null)" || return 1
  recon_json="$(printf '%s' "${contract_json}" | jq -c '.contractReconciliation // {}')"
  contract_digest="$(
    if declare -F aegis_briefing_contract_digest >/dev/null 2>&1; then
      aegis_briefing_contract_digest "${contract_json}"
    else
      printf '%s' "${contract_json}" | jq -S -c . | aegis_receipt_sha256
    fi
  )" || return 1
  contract_equivalent="$(printf '%s' "${recon_json}" | jq -r 'if .equivalent == true then "true" else "false" end')"

  committed_contract_json="$(git -C "${repository_root}" show "${commit}:.harness/active_contract_ir.json" 2>/dev/null || true)"
  committed_contract_present="false"
  committed_contract_digest=""
  contract_matches_commit="false"
  required_targets_present="false"
  if [[ -n "${committed_contract_json}" ]] \
    && jq -e '.' >/dev/null 2>&1 <<<"${committed_contract_json}"; then
    committed_contract_present="true"
    committed_contract_digest="$(
      if declare -F aegis_briefing_contract_digest >/dev/null 2>&1; then
        aegis_briefing_contract_digest "${committed_contract_json}"
      else
        printf '%s' "${committed_contract_json}" | jq -S -c . | aegis_receipt_sha256
      fi
    )" || return 1
    contract_matches_commit="$(
      [[ "${contract_digest}" == "${committed_contract_digest}" ]] && printf true || printf false
    )"
    required_targets_present=true
    while IFS= read -r file; do
      [[ -n "${file}" ]] || continue
      if ! git -C "${repository_root}" cat-file -e "${commit}:${file}" 2>/dev/null; then
        required_targets_present=false
        break
      fi
    done < <(printf '%s' "${contract_json}" | jq -r '.targets[]? // empty')
  fi

  candidate_json="$(jq -c '(.artifact_snapshot.operational_context.validated_candidate // .validated_candidate // {})' \
    "${handover_file}" 2>/dev/null)" || return 1
  files_json="$(printf '%s' "${candidate_json}" | jq -c '(.files_changed // []) | map(select(type == "string")) | unique | sort')"
  while IFS= read -r file; do
    [[ -n "${file}" ]] && files+=("${file}")
  done < <(printf '%s' "${files_json}" | jq -r '.[]?')
  candidate_diff="$(printf '%s' "${candidate_json}" | jq -r '.diff // empty')"
  candidate_digest="$(printf '%s' "${candidate_json}" | jq -S -c '{diff:(.diff // ""),files_changed:(.files_changed // [])}' | aegis_receipt_sha256)"

  actual_patch="$(git -C "${repository_root}" show --format= --binary "${commit}" -- \
    "${files[@]}" 2>/dev/null || true)"
  actual_patch_digest="$(aegis_receipt_patch_digest "${actual_patch}")"
  candidate_matches_commit="$(
    [[ -n "${candidate_diff}" ]] \
      && [[ "$(aegis_receipt_patch_digest "${candidate_diff}")" == "${actual_patch_digest}" ]] \
      && printf true || printf false
  )"

  commit_files_json="$(git -C "${repository_root}" diff-tree --no-commit-id --name-only -r "${commit}" -- \
    "${files[@]}" 2>/dev/null \
    | jq -R -s 'split("\n") | map(select(length > 0)) | unique | sort' 2>/dev/null || printf '[]')"
  scope_matches_commit="$(jq -n --argjson expected "${files_json}" --argjson actual "${commit_files_json}" '$expected == $actual')"

  tree_digest="$(git -C "${repository_root}" rev-parse "${commit}^{tree}" 2>/dev/null || printf 'unavailable')"
  state_digest="$(aegis_receipt_scope_digest "${repository_root}" "${commit}" "${files_json}")"
  post_commit_clean="$(
    [[ "$(git -C "${repository_root}" rev-parse HEAD 2>/dev/null || true)" == "${commit}" ]] \
      && [[ -z "$(git -C "${repository_root}" status --porcelain -- "${files[@]}" 2>/dev/null || true)" ]] \
      && printf true || printf false
  )"

  validation_verdict="$(jq -r '.artifact_snapshot.operational_context.verdict // .verdict // empty' "${handover_file}" 2>/dev/null || true)"
  findings_count="$(jq -r '(.artifact_snapshot.operational_context.findings // .findings // []) | length' "${handover_file}" 2>/dev/null || printf '0')"
  blocking_findings="$(jq -r '[ (.artifact_snapshot.operational_context.findings // .findings // [])[]?
    | select(.blocking == true or .severity == "critical" or .severity == "high") ] | length' \
    "${handover_file}" 2>/dev/null || printf '0')"
  outcome_json='{}'
  [[ -f "${outcome_file}" ]] && outcome_json="$(jq -c '.' "${outcome_file}" 2>/dev/null || printf '{}')"
  outcome_status="$(printf '%s' "${outcome_json}" | jq -r '.status // empty')"
  pipeline_status="$(printf '%s' "${outcome_json}" | jq -r '.pipeline_status // empty')"

  invariant_count="$(printf '%s' "${contract_json}" | jq -r '((.invariants // []) + (.conservationLaws // [])) | length')"
  proof_count="$(printf '%s' "${contract_json}" | jq -r '(.proofObligations // []) | length')"
  uaam_status="not_run"
  if [[ -f "${runtime_dir}/uaam_loop/result.json" ]]; then
    uaam_status="$(jq -r '.status // "unknown"' "${runtime_dir}/uaam_loop/result.json" 2>/dev/null || printf 'unknown')"
  fi
  if [[ "${invariant_count}" -eq 0 && "${proof_count}" -eq 0 ]]; then
    invariant_status="not_applicable"
  elif [[ "${uaam_status}" == "PROVEN" ]]; then
    invariant_status="proven"
  else
    invariant_status="not_proven"
  fi

  all_verified="false"
  if [[ "${contract_equivalent}" == "true" ]] \
    && [[ "${contract_matches_commit}" == "true" ]] \
    && [[ "${required_targets_present}" == "true" ]] \
    && [[ "${validation_verdict}" == "accepted" ]] \
    && [[ "${blocking_findings}" == "0" ]] \
    && [[ "${outcome_status}" == "SUCCESS" ]] \
    && [[ "${pipeline_status}" == "SUCCESS" ]] \
    && [[ "${scope_matches_commit}" == "true" ]] \
    && [[ "${candidate_matches_commit}" == "true" ]] \
    && [[ "${post_commit_clean}" == "true" ]] \
    && [[ "${invariant_status}" != "not_proven" ]]; then
    all_verified="true"
  fi

  mkdir -p "${runtime_dir}" "${receipt_archive_dir}" 2>/dev/null || true
  receipt_archive_file="${receipt_archive_dir}/${commit}.json"
  tmp_file="${receipt_archive_file}.tmp.$$"
  jq -n \
    --arg schema "aegis.final_receipt.v1" \
    --arg verification_status "$(if [[ "${all_verified}" == "true" ]]; then printf VERIFIED; else printf UNPROVEN; fi)" \
    --arg issue "${issue}" \
    --arg target "${target}" \
    --arg contract_digest "${contract_digest}" \
    --arg committed_contract_digest "${committed_contract_digest}" \
    --arg contract_status "$(if [[ "${contract_equivalent}" == "true" ]]; then printf equivalent; else printf unreconciled; fi)" \
    --argjson contract_reconciliation "${recon_json}" \
    --arg candidate_digest "${candidate_digest}" \
    --arg candidate_patch_digest "$(aegis_receipt_patch_digest "${candidate_diff}")" \
    --arg actual_patch_digest "${actual_patch_digest}" \
    --arg commit "${commit}" \
    --arg tree_digest "${tree_digest}" \
    --arg state_digest "${state_digest}" \
    --argjson committed_contract_present "${committed_contract_present}" \
    --argjson contract_matches_commit "${contract_matches_commit}" \
    --argjson required_targets_present "${required_targets_present}" \
    --argjson candidate_files "${files_json}" \
    --argjson commit_files "${commit_files_json}" \
    --argjson scope_matches_commit "${scope_matches_commit}" \
    --argjson candidate_matches_commit "${candidate_matches_commit}" \
    --argjson post_commit_clean "${post_commit_clean}" \
    --arg validation_verdict "${validation_verdict}" \
    --argjson findings_count "${findings_count:-0}" \
    --argjson blocking_findings "${blocking_findings:-0}" \
    --arg outcome_status "${outcome_status}" \
    --arg pipeline_status "${pipeline_status}" \
    --arg invariant_status "${invariant_status}" \
    --arg uaam_status "${uaam_status}" \
    --argjson invariant_count "${invariant_count:-0}" \
    --argjson proof_count "${proof_count:-0}" \
    --arg metrics_file "${metrics_file}" \
    --arg at "$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || printf '')" \
    '{
      schema: $schema,
      verification_status: $verification_status,
      verified: ($verification_status == "VERIFIED"),
      issue: $issue,
      target: $target,
      contract: {digest: $contract_digest, committed_digest: $committed_contract_digest, status: $contract_status, reconciliation: $contract_reconciliation},
      candidate: {digest: $candidate_digest, files_changed: $candidate_files},
      commit: {sha: $commit, tree_digest: $tree_digest, diff_digest: $actual_patch_digest},
      post_commit: {
        state_digest: $state_digest,
        contract_present_in_commit: $committed_contract_present,
        contract_matches_commit: $contract_matches_commit,
        required_targets_present: $required_targets_present,
        files_changed: $commit_files,
        scope_matches_candidate: $scope_matches_commit,
        candidate_patch_matches_commit: $candidate_matches_commit,
        clean: $post_commit_clean
      },
      proofs: {
        validation_verdict: $validation_verdict,
        findings_count: $findings_count,
        blocking_findings: $blocking_findings,
        invariant_status: $invariant_status,
        declared_invariants: $invariant_count,
        declared_proof_obligations: $proof_count,
        uaam_status: $uaam_status,
        metrics_file: $metrics_file
      },
      at: $at
    }' > "${tmp_file}" 2>/dev/null || {
      rm -f "${tmp_file}" 2>/dev/null || true
      return 1
    }
  mv -f "${tmp_file}" "${receipt_archive_file}"
  cp "${receipt_archive_file}" "${receipt_file}.tmp.$$" 2>/dev/null \
    && mv -f "${receipt_file}.tmp.$$" "${receipt_file}" \
    || return 1
  printf '%s' "${receipt_file}"
}

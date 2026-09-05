#!/usr/bin/env bash
set -Eeuo pipefail

command_name="${1:-}"
repository_root="${2:-}"
artifact_file="${3:-}"
script_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck disable=SC1091
source "${script_root}/lib/proof_governance.sh"

fatal() {
  echo "[AEGIS][FORMAL][FATAL] $1" >&2
  exit 1
}

[[ -n "${repository_root}" ]] || fatal "missing_repository_root"
git -C "${repository_root}" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || fatal "not_git_repository"

authorization_path() {
  local path
  path="$(git -C "${repository_root}" rev-parse --git-path aegis/precommit_receipt.json)"
  if [[ "${path}" == /* ]]; then
    printf '%s\n' "${path}"
  else
    printf '%s/%s\n' "${repository_root}" "${path}"
  fi
}

safe_path() {
  local path="${1:-}"
  [[ -n "${path}" && "${path}" != /* && ! "${path}" =~ (^|/)\.\.(/|$) ]]
}

manifest_from_worktree() {
  local files="${1:-}" path
  while IFS= read -r path; do
    [[ -n "${path}" ]] || continue
    printf 'path=%s\n' "${path}"
    if [[ -f "${repository_root}/${path}" ]]; then
      shasum -a 256 "${repository_root}/${path}" | awk '{print $1}'
    else
      printf 'missing\n'
    fi
  done <<< "${files}" | shasum -a 256 | awk '{print $1}'
}

manifest_from_index() {
  local files="${1:-}" path
  while IFS= read -r path; do
    [[ -n "${path}" ]] || continue
    printf 'path=%s\n' "${path}"
    if git -C "${repository_root}" cat-file -e ":${path}" 2>/dev/null; then
      git -C "${repository_root}" show ":${path}" | shasum -a 256 | awk '{print $1}'
    else
      printf 'missing\n'
    fi
  done <<< "${files}" | shasum -a 256 | awk '{print $1}'
}

file_digest_from_worktree() {
  local path="${1:-}"
  [[ -f "${repository_root}/${path}" ]] || fatal "receipt_input_missing:${path}"
  shasum -a 256 "${repository_root}/${path}" | awk '{print $1}'
}

file_digest_from_index() {
  local path="${1:-}"
  git -C "${repository_root}" cat-file -e ":${path}" 2>/dev/null \
    || fatal "receipt_input_missing_from_index:${path}"
  git -C "${repository_root}" show ":${path}" | shasum -a 256 | awk '{print $1}'
}

absent_metadata_digest() {
  local path="${1:-}"
  printf 'aegis.metadata.absent.v1:%s\n' "${path}" | shasum -a 256 | awk '{print $1}'
}

metadata_digest_from_worktree() {
  local path="${1:-}"
  if [[ -f "${repository_root}/${path}" ]]; then
    file_digest_from_worktree "${path}"
  else
    absent_metadata_digest "${path}"
  fi
}

metadata_digest_from_index() {
  local path="${1:-}"
  if git -C "${repository_root}" cat-file -e ":${path}" 2>/dev/null; then
    file_digest_from_index "${path}"
  else
    absent_metadata_digest "${path}"
  fi
}

canonical_json_digest_from_worktree() {
  local path="${1:-}"
  [[ -f "${repository_root}/${path}" ]] || fatal "receipt_input_missing:${path}"
  jq -S -c . "${repository_root}/${path}" | shasum -a 256 | awk '{print $1}'
}

canonical_json_digest_from_index() {
  local path="${1:-}"
  git -C "${repository_root}" cat-file -e ":${path}" 2>/dev/null \
    || fatal "receipt_input_missing_from_index:${path}"
  git -C "${repository_root}" show ":${path}" | jq -S -c . | shasum -a 256 | awk '{print $1}'
}

clarified_digest_from_worktree() {
  if [[ -f "${repository_root}/.harness/active_clarified_demand.json" ]]; then
    canonical_json_digest_from_worktree .harness/active_clarified_demand.json
  else
    absent_metadata_digest .harness/active_clarified_demand.json
  fi
}

clarified_digest_from_index() {
  if git -C "${repository_root}" cat-file -e ':.harness/active_clarified_demand.json' 2>/dev/null; then
    canonical_json_digest_from_index .harness/active_clarified_demand.json
  else
    absent_metadata_digest .harness/active_clarified_demand.json
  fi
}

validation_authority_json() {
  local validation_llm="$(printf '%s' "${AEGIS_VALIDATION_LLM:-0}" | tr '[:upper:]' '[:lower:]')"
  case "${validation_llm}" in
    1|true|yes|on|llm)
      local validator="${AEGIS_VALIDATION_MODEL:-}"
      [[ -n "${validator}" ]] || fatal "validation_model_required_for_independent_llm"
      [[ "${validator}" != "${AEGIS_MUTATION_MODEL:-}" ]] \
        || fatal "validation_model_must_differ_from_mutation_model"
      jq -n --arg id "${validator}" '{kind:"independent_model",id:$id}'
      ;;
    *) jq -n '{kind:"deterministic_tribunal",id:"mechanical_validation.v1"}' ;;
  esac
}

write_receipt() {
  local base="${1:-}" files="${2:-}" manifest="${3:-}" artifact_digest="${4:-}"
  local contract_digest="${5:-}" registry_digest="${6:-}" clarified_digest="${7:-}" policy_digest="${8:-}"
  local profile="${9:-}" proof_plan_digest="${10:-}" authority="${11:-}" proof_plan="${12:-}"
  local auth_file auth_dir now expires

  auth_file="$(authorization_path)"
  auth_dir="$(dirname "${auth_file}")"
  now="$(date +%s)"
  expires=$((now + 900))
  mkdir -p "${auth_dir}"
  jq -n \
    --arg base "${base}" \
    --arg files "${files}" \
    --arg manifest "${manifest}" \
    --arg artifact_digest "${artifact_digest}" \
    --arg contract_digest "${contract_digest}" \
    --arg registry_digest "${registry_digest}" \
    --arg clarified_digest "${clarified_digest}" \
    --arg policy_digest "${policy_digest}" \
    --arg profile "${profile}" \
    --arg proof_plan_digest "${proof_plan_digest}" \
    --argjson authority "${authority}" \
    --argjson proof_plan "${proof_plan}" \
    --argjson expires "${expires}" \
    '{schema:"aegis.precommit_receipt.v1",status:"PROVEN",baseCommit:$base,files:($files|split("\n")|map(select(length>0))),worktreeManifest:$manifest,contractDigest:$contract_digest,proofRegistryDigest:$registry_digest,clarifiedDemandDigest:$clarified_digest,architecturePolicyDigest:$policy_digest,validationArtifactDigest:$artifact_digest,validationAuthority:$authority,proofProfile:$profile,proofPlanDigest:$proof_plan_digest,proofs:$proof_plan.proofs,expiresAtEpoch:$expires}' \
    > "${auth_file}"
  echo "[AEGIS][FORMAL] precommit_receipt_created profile=${profile}" >&2
}

profile_for_files() {
  local files="${1:-}" profile_json
  profile_json="$(AEGIS_ROOT_DIR="${repository_root}" aegis_proof_profile_for_change \
    "${repository_root}/.harness/proof_registry.json" "${files}")" \
    || fatal "automatic_profile_resolution_failed"
  printf '%s' "${profile_json}"
}

run_structure_verification() {
  if [[ -f "${repository_root}/package.json" ]] \
    && jq -e '.scripts["aegis:verify-structure"] | type == "string"' \
      "${repository_root}/package.json" >/dev/null 2>&1; then
    (cd "${repository_root}" && npm run aegis:verify-structure) \
      || fatal "promotion_structure_verification_failed"
  fi
}

create_authorization() {
  # This is the sole structural tribunal for an authorization. The IDE has
  # already synchronized the index; running it here binds the receipt to one
  # verification pass instead of repeating type, lint and proof work.
  run_structure_verification
  bash "${script_root}/contract_evidence_gate.sh" --staged \
    || fatal "promotion_contract_evidence_verification_failed"
  if [[ ! -e "${repository_root}/.harness/active_contract_ir.json" \
    && ! -e "${repository_root}/.harness/proof_registry.json" ]]; then
    create_baseline_authorization
    return
  fi

  [[ -s "${artifact_file}" ]] || fatal "missing_validation_artifact"
  jq -e '
    .mode == "validation" and .verdict == "accepted"
    and (.validated_candidate.files_changed | type == "array" and length > 0)
    and (.validated_candidate.files_changed | all(type == "string" and length > 0))
  ' "${artifact_file}" >/dev/null 2>&1 || fatal "validation_not_accepted"

  local files base manifest artifact_digest auth_file auth_dir now expires
  local contract_digest registry_digest clarified_digest policy_digest authority profile_json profile profile_plan proof_plan proof_plan_digest
  files="$(jq -r '.validated_candidate.files_changed[]' "${artifact_file}" | sort -u)"
  while IFS= read -r path; do safe_path "${path}" || fatal "unsafe_candidate_path:${path}"; done <<< "${files}"
  base="$(git -C "${repository_root}" rev-parse HEAD)"
  manifest="$(manifest_from_worktree "${files}")"
  artifact_digest="$(shasum -a 256 "${artifact_file}" | awk '{print $1}')"
  contract_digest="$(file_digest_from_worktree .harness/active_contract_ir.json)"
  registry_digest="$(file_digest_from_worktree .harness/proof_registry.json)"
  clarified_digest="$(clarified_digest_from_worktree)"
  policy_digest="$(metadata_digest_from_worktree governance/architecture.policy.json)"
  authority="$(validation_authority_json)"
  profile_json="$(profile_for_files "${files}")"
  profile="$(printf '%s' "${profile_json}" | jq -r '.profile')"
  case "${profile}" in fast|targeted|release|forensic) ;; *) fatal "invalid_automatic_profile" ;; esac
  proof_plan="$(AEGIS_ROOT_DIR="${repository_root}" aegis_proof_profile_plan "${profile}" \
    "${repository_root}/.harness/proof_registry.json" "${files}")" \
    || fatal "proof_plan_generation_failed"

  # A receipt is issued only after the profile selected from this exact diff
  # has executed. The runner itself owns caching; the receipt records the
  # deterministic plan, not bulky test output.
  if ! AEGIS_ROOT_DIR="${repository_root}" \
    AEGIS_RUNTIME_DIR="${repository_root}/.harness/runtime" \
    bash "${script_root}/proof_runner.sh" --profile "${profile}" --changed "${files}"; then
    fatal "required_proof_profile_failed:${profile}"
  fi
  proof_plan_digest="$(printf '%s' "${proof_plan}" | jq -S -c . | shasum -a 256 | awk '{print $1}')"
  write_receipt "${base}" "${files}" "${manifest}" "${artifact_digest}" \
    "${contract_digest}" "${registry_digest}" "${clarified_digest}" "${policy_digest}" "${profile}" "${proof_plan_digest}" \
    "${authority}" "${proof_plan}"
}

create_baseline_authorization() {
  local files base worktree_manifest index_manifest artifact_digest authority profile proof_plan proof_plan_digest

  files="$(git -C "${repository_root}" diff --cached --name-only | sort -u)"
  [[ -n "${files}" ]] || fatal "baseline_authorization_requires_staged_changes"
  while IFS= read -r path; do safe_path "${path}" || fatal "unsafe_staged_path:${path}"; done <<< "${files}"

  # Synchronize staged files with worktree state so the tribunal verifies
  # the exact bytes that are staged for commit.
  while IFS= read -r path; do
    [[ -n "${path}" ]] || continue
    if [[ -f "${repository_root}/${path}" ]]; then
      git -C "${repository_root}" add -- "${path}"
    elif [[ ! -e "${repository_root}/${path}" ]]; then
      git -C "${repository_root}" rm --quiet --cached --ignore-unmatch -- "${path}"
    fi
  done <<< "${files}"
  files="$(git -C "${repository_root}" diff --cached --name-only | sort -u)"
  [[ -n "${files}" ]] || fatal "baseline_authorization_requires_staged_changes"

  base="$(git -C "${repository_root}" rev-parse HEAD)"
  worktree_manifest="$(manifest_from_worktree "${files}")"
  index_manifest="$(manifest_from_index "${files}")"
  if [[ "${worktree_manifest}" != "${index_manifest}" ]]; then
    echo "[AEGIS][FORMAL][ERROR] baseline_worktree_index_mismatch: files differ between index and worktree:" >&2
    while IFS= read -r path; do
      [[ -n "${path}" ]] || continue
      local w_hash i_hash
      if [[ -f "${repository_root}/${path}" ]]; then
        w_hash="$(shasum -a 256 "${repository_root}/${path}" | awk '{print $1}')"
      else
        w_hash="missing"
      fi
      if git -C "${repository_root}" cat-file -e ":${path}" 2>/dev/null; then
        i_hash="$(git -C "${repository_root}" show ":${path}" | shasum -a 256 | awk '{print $1}')"
      else
        i_hash="missing"
      fi
      if [[ "${w_hash}" != "${i_hash}" ]]; then
        echo "  - ${path} (worktree=${w_hash:0:8}, index=${i_hash:0:8})" >&2
      fi
    done <<< "${files}"
    fatal "baseline_worktree_index_mismatch"
  fi
  git -C "${repository_root}" diff --cached --check || fatal "baseline_staged_diff_invalid"

  artifact_digest="$(printf 'aegis.baseline.validation.v1\nbase=%s\nfiles=%s\nmanifest=%s\n' \
    "${base}" "${files}" "${index_manifest}" | shasum -a 256 | awk '{print $1}')"
  authority="$(jq -n '{kind:"deterministic_tribunal",id:"mechanical_validation.v1"}')"
  profile="fast"
  proof_plan="$(jq -n '{profile:"fast",count:0,proofs:[]}')"
  proof_plan_digest="$(printf '%s' "${proof_plan}" | jq -S -c . | shasum -a 256 | awk '{print $1}')"
  write_receipt "${base}" "${files}" "${index_manifest}" "${artifact_digest}" \
    "$(metadata_digest_from_worktree .harness/active_contract_ir.json)" \
    "$(metadata_digest_from_worktree .harness/proof_registry.json)" \
    "$(clarified_digest_from_worktree)" \
    "$(metadata_digest_from_worktree governance/architecture.policy.json)" \
    "${profile}" "${proof_plan_digest}" "${authority}" "${proof_plan}"
}

requires_authorization() {
  local changed
  changed="$(git -C "${repository_root}" diff --cached --name-only)"
  is_complete_baseline_reset_staged && return 1
  # A commit is the durable boundary of a demand, not merely a source-code
  # boundary. Requiring the receipt for every non-empty staged transition
  # prevents an IDE from bypassing the formal route by moving logic into a
  # script, contract, or configuration file.
  [[ -n "${changed}" ]]
}

is_complete_baseline_reset_staged() {
  local contract_path=".harness/active_contract_ir.json"
  local registry_path=".harness/proof_registry.json"
  local target reset_index

  # A reset is valid only when the *previous* governed unit existed and the
  # index removes both its metadata files. This cannot turn an arbitrary
  # source deletion into a receipt bypass.
  git -C "${repository_root}" cat-file -e "HEAD:${contract_path}" 2>/dev/null || return 1
  git -C "${repository_root}" cat-file -e "HEAD:${registry_path}" 2>/dev/null || return 1
  ! git -C "${repository_root}" cat-file -e ":${contract_path}" 2>/dev/null || return 1
  ! git -C "${repository_root}" cat-file -e ":${registry_path}" 2>/dev/null || return 1

  # Every former target other than the deliberately recreated entry point
  # must be absent from the staged state.
  while IFS= read -r target; do
    [[ -n "${target}" && "${target}" != "src/index.ts" ]] || continue
    ! git -C "${repository_root}" cat-file -e ":${target}" 2>/dev/null || return 1
  done < <(git -C "${repository_root}" show "HEAD:${contract_path}" | jq -r 'if .schema == "aegis.contract_ir.v2" then .scope.authorizedPaths[]? else .targets[]? end')

  git -C "${repository_root}" cat-file -e ':src/index.ts' 2>/dev/null || return 1
  reset_index="$(git -C "${repository_root}" show :src/index.ts)"
  [[ "${reset_index}" == $'// Ponto de entrada canônico para a próxima demanda.\nexport {};' ]]
}

verify_authorization() {
  local auth_file base files expected manifest now staged_files
  local contract_digest registry_digest clarified_digest policy_digest
  local expected_contract_digest expected_registry_digest expected_clarified_digest expected_policy_digest
  auth_file="$(authorization_path)"
  [[ -s "${auth_file}" ]] || fatal "formal_promotion_authorization_missing"
  base="$(git -C "${repository_root}" rev-parse HEAD)"
  now="$(date +%s)"
  jq -e --arg base "${base}" --argjson now "${now}" '
    .schema == "aegis.precommit_receipt.v1"
    and .status == "PROVEN"
    and .baseCommit == $base
    and (.expiresAtEpoch | type == "number" and . >= $now)
    and (.files | type == "array" and length > 0 and all(type == "string" and length > 0))
    and (.worktreeManifest | type == "string" and length == 64)
    and (.contractDigest | type == "string" and length == 64)
    and (.proofRegistryDigest | type == "string" and length == 64)
    and (.clarifiedDemandDigest | type == "string" and length == 64)
    and (.architecturePolicyDigest | type == "string" and length == 64)
    and (.validationAuthority.kind | IN("deterministic_tribunal", "independent_model"))
    and (.validationAuthority.id | type == "string" and length > 0)
    and (.proofProfile | IN("fast", "targeted", "release", "forensic"))
    and (.proofPlanDigest | type == "string" and length == 64)
  ' "${auth_file}" >/dev/null 2>&1 || fatal "formal_promotion_authorization_invalid_or_expired"
  files="$(jq -r '.files[]' "${auth_file}" | sort -u)"
  staged_files="$(git -C "${repository_root}" diff --cached --name-only | sort -u)"
  [[ "${files}" == "${staged_files}" ]] || fatal "formal_promotion_files_changed_mismatch"
  expected="$(jq -r '.worktreeManifest' "${auth_file}")"
  manifest="$(manifest_from_index "${files}")"
  [[ "${expected}" == "${manifest}" ]] || fatal "formal_promotion_manifest_mismatch"
  expected_contract_digest="$(jq -r '.contractDigest' "${auth_file}")"
  expected_registry_digest="$(jq -r '.proofRegistryDigest' "${auth_file}")"
  expected_clarified_digest="$(jq -r '.clarifiedDemandDigest' "${auth_file}")"
  expected_policy_digest="$(jq -r '.architecturePolicyDigest' "${auth_file}")"
  contract_digest="$(metadata_digest_from_index .harness/active_contract_ir.json)"
  registry_digest="$(metadata_digest_from_index .harness/proof_registry.json)"
  clarified_digest="$(clarified_digest_from_index)"
  policy_digest="$(metadata_digest_from_index governance/architecture.policy.json)"
  [[ "${expected_contract_digest}" == "${contract_digest}" ]] || fatal "formal_promotion_contract_digest_mismatch"
  [[ "${expected_registry_digest}" == "${registry_digest}" ]] || fatal "formal_promotion_registry_digest_mismatch"
  [[ "${expected_clarified_digest}" == "${clarified_digest}" ]] || fatal "formal_promotion_clarified_demand_digest_mismatch"
  [[ "${expected_policy_digest}" == "${policy_digest}" ]] || fatal "formal_promotion_architecture_policy_digest_mismatch"
}

case "${command_name}" in
  create) create_authorization ;;
  requires) requires_authorization ;;
  verify) verify_authorization ;;
  *) fatal "unknown_formal_promotion_command:${command_name}" ;;
esac

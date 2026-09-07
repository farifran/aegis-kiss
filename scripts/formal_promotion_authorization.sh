#!/usr/bin/env bash
set -Eeuo pipefail

command_name="${1:-}"
repository_root="${2:-}"
artifact_file="${3:-}"
script_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
semantic_record="src/.aegis/semantic-state.json"

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

legacy_metadata_present() {
  local path
  for path in contract-ir.json clarified-demand.json proof-registry.json; do
    [[ ! -e "${repository_root}/src/.aegis/${path}" ]] || return 0
  done
  return 1
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

manifest_from_commit() {
  local commit="${1:-}" files="${2:-}" path
  while IFS= read -r path; do
    [[ -n "${path}" ]] || continue
    printf 'path=%s\n' "${path}"
    if git -C "${repository_root}" cat-file -e "${commit}:${path}" 2>/dev/null; then
      git -C "${repository_root}" show "${commit}:${path}" | shasum -a 256 | awk '{print $1}'
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

metadata_digest_from_commit() {
  local commit="${1:-}" path="${2:-}"
  if git -C "${repository_root}" cat-file -e "${commit}:${path}" 2>/dev/null; then
    git -C "${repository_root}" show "${commit}:${path}" | shasum -a 256 | awk '{print $1}'
  else
    absent_metadata_digest "${path}"
  fi
}

semantic_field_digest_from_worktree() {
  local field="${1:-}"
  if [[ -f "${repository_root}/${semantic_record}" ]]; then
    jq -S -c --arg field "${field}" '.[$field]' "${repository_root}/${semantic_record}" | shasum -a 256 | awk '{print $1}'
  else
    printf 'aegis.semantic_field.absent.v1:%s\n' "${field}" | shasum -a 256 | awk '{print $1}'
  fi
}

semantic_field_digest_from_index() {
  local field="${1:-}"
  if git -C "${repository_root}" cat-file -e ":${semantic_record}" 2>/dev/null; then
    git -C "${repository_root}" show ":${semantic_record}" | jq -S -c --arg field "${field}" '.[$field]' | shasum -a 256 | awk '{print $1}'
  else
    printf 'aegis.semantic_field.absent.v1:%s\n' "${field}" | shasum -a 256 | awk '{print $1}'
  fi
}

semantic_field_digest_from_commit() {
  local commit="${1:-}" field="${2:-}"
  if git -C "${repository_root}" cat-file -e "${commit}:${semantic_record}" 2>/dev/null; then
    git -C "${repository_root}" show "${commit}:${semantic_record}" | jq -S -c --arg field "${field}" '.[$field]' | shasum -a 256 | awk '{print $1}'
  else
    printf 'aegis.semantic_field.absent.v1:%s\n' "${field}" | shasum -a 256 | awk '{print $1}'
  fi
}

contract_digest_from_worktree() { semantic_field_digest_from_worktree contract; }
registry_digest_from_worktree() { semantic_field_digest_from_worktree proofRegistry; }
clarified_digest_from_worktree() { semantic_field_digest_from_worktree clarifiedDemand; }
contract_digest_from_index() { semantic_field_digest_from_index contract; }
registry_digest_from_index() { semantic_field_digest_from_index proofRegistry; }
clarified_digest_from_index() { semantic_field_digest_from_index clarifiedDemand; }
contract_digest_from_commit() { semantic_field_digest_from_commit "$1" contract; }
registry_digest_from_commit() { semantic_field_digest_from_commit "$1" proofRegistry; }
clarified_digest_from_commit() { semantic_field_digest_from_commit "$1" clarifiedDemand; }

contract_worktree_file() {
  [[ -f "${repository_root}/${semantic_record}" ]] || fatal "missing_semantic_state"
  local file="${repository_root}/.harness/runtime/semantic-state/contract-ir.json"
  mkdir -p "$(dirname "${file}")"
  jq '.contract' "${repository_root}/${semantic_record}" > "${file}"
  printf '%s\n' "${file}"
}

forensic_candidate_review_path() {
  printf '%s\n' "${repository_root}/.harness/runtime/forensic_candidate_review.json"
}

require_forensic_candidate_review() {
  local contract_digest="${1:-}" candidate_manifest="${2:-}" supervisor="${3:-null}" contract_file="${4:-}"
  local review_file supervisor_id obligation_ids
  review_file="$(forensic_candidate_review_path)"
  [[ -s "${review_file}" ]] || fatal "forensic_candidate_review_missing"
  supervisor_id="$(jq -r '.id // empty' <<< "${supervisor}")"
  obligation_ids="$(jq -c '[
    .behavior[].id,
    (.preconditions // [])[].id,
    .invariants[].id,
    (.postconditions // [])[].id,
    (.failureSemantics // [])[].id
  ] | unique' "${contract_file}")"
  jq -e \
    --arg contract "${contract_digest}" \
    --arg manifest "${candidate_manifest}" \
    --arg supervisor "${supervisor_id}" \
    --argjson obligations "${obligation_ids}" '
      .schema == "aegis.forensic_candidate_review.v1"
      and .contractDigest == $contract
      and .candidateManifest == $manifest
      and .verdict == "APPROVED"
      and (.reviewer.id | type == "string" and length > 0)
      and (.reviewer.executionId | type == "string" and test("^[a-f0-9]{64}$"))
      and (if $supervisor == "" then true else .reviewer.id != $supervisor end)
      and (.assessments | type == "array")
      and ([.assessments[].contractId] | unique) == $obligations
      and (.assessments | all(
        (.contractId | type == "string")
        and (.verdict == "PROVEN")
        and (.evidence | type == "string" and length > 0)
      ))
    ' "${review_file}" >/dev/null 2>&1 \
    || fatal "forensic_candidate_review_invalid"
}

execution_id_for_base() {
  local base="${1:-}" requested_kind="${2:-}" supervisor="${3:-null}" demand_digest="ABSENT" change_kind="BASELINE" supervisor_digest=""
  if [[ -f "${repository_root}/${semantic_record}" ]]; then
    demand_digest="$(jq -r '.clarifiedDemand.normalizedDemandDigest' "${repository_root}/${semantic_record}")"
    change_kind="$(jq -r '.clarifiedDemand.changeKind' "${repository_root}/${semantic_record}")"
  fi
  [[ -z "${requested_kind}" ]] || change_kind="${requested_kind}"
  if [[ -n "${supervisor}" && "${supervisor}" != "null" ]]; then
    supervisor_digest="$(jq -r '.configDigest // empty' <<< "${supervisor}")"
  fi
  if [[ -n "${supervisor_digest}" ]]; then
    printf 'base=%s\ndemand=%s\nkind=%s\nsupervisor=%s\n' "${base}" "${demand_digest}" "${change_kind}" "${supervisor_digest}" | shasum -a 256 | awk '{print $1}'
  else
    printf 'base=%s\ndemand=%s\nkind=%s\n' "${base}" "${demand_digest}" "${change_kind}" | shasum -a 256 | awk '{print $1}'
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

supplemental_inventory_digest() {
  local base="${1:-}" inventory="${repository_root}/.harness/runtime/mechanical_inventory.json"
  if [[ -s "${inventory}" ]] && jq -e --arg base "${base}" \
    '.schema == "aegis.mechanical_inventory.v1" and .baseCommit == $base' "${inventory}" >/dev/null 2>&1; then
    shasum -a 256 "${inventory}" | awk '{print $1}'
  else
    printf 'null'
  fi
}

semantic_supervisor_json() {
  local base="${1:-}" finalization="${repository_root}/.harness/runtime/finalization.json"
  if [[ -s "${finalization}" ]] && jq -e --arg base "${base}" '
    .schema == "aegis.preflight_finalization.v2"
    and .status == "SEMANTIC_STATE_PERSISTED"
    and .baseCommit == $base
    and (.supervisor | type == "object")
    and (.supervisor.mode | IN("IDE", "EXTERNAL"))
    and (.supervisor.id | type == "string" and length > 0)
    and (.supervisor.configDigest | type == "string" and test("^[a-f0-9]{64}$"))
  ' "${finalization}" >/dev/null 2>&1; then
    jq -c '.supervisor' "${finalization}"
  else
    printf 'null'
  fi
}

write_receipt() {
  local base="${1:-}" files="${2:-}" manifest="${3:-}" artifact_digest="${4:-}"
  local contract_digest="${5:-}" registry_digest="${6:-}" clarified_digest="${7:-}" policy_digest="${8:-}"
  local profile="${9:-}" proof_plan_digest="${10:-}" authority="${11:-}" proof_plan="${12:-}"
  local duration_ms="${13:-0}"
  local change_kind="${14:-PRODUCT}" supervisor="${15:-null}"
  local auth_file auth_dir now expires execution_id inventory_digest

  auth_file="$(authorization_path)"
  auth_dir="$(dirname "${auth_file}")"
  now="$(date +%s)"
  expires=$((now + 900))
  execution_id="$(execution_id_for_base "${base}" "${change_kind}" "${supervisor}")"
  inventory_digest="$(supplemental_inventory_digest "${base}")"
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
    --arg execution_id "${execution_id}" \
    --argjson authority "${authority}" \
    --argjson proof_plan "${proof_plan}" \
    --argjson issued "${now}" \
    --argjson expires "${expires}" \
    --argjson duration_ms "${duration_ms}" \
    --arg change_kind "${change_kind}" \
    --arg inventory_digest "${inventory_digest}" \
    --argjson supervisor "${supervisor}" \
    '{schema:"aegis.precommit_receipt.v1",status:"PROVEN",changeKind:$change_kind,executionId:$execution_id,baseCommit:$base,files:($files|split("\n")|map(select(length>0))),worktreeManifest:$manifest,contractDigest:$contract_digest,proofRegistryDigest:$registry_digest,clarifiedDemandDigest:$clarified_digest,architecturePolicyDigest:$policy_digest,validationArtifactDigest:$artifact_digest,validationAuthority:$authority,semanticSupervisor:$supervisor,proofProfile:$profile,proofPlanDigest:$proof_plan_digest,proofs:$proof_plan.proofs,supplementalEvidence:{inventoryArtifactBytesDigest:(if $inventory_digest == "null" then null else $inventory_digest end)},issuedAtEpoch:$issued,expiresAtEpoch:$expires,verificationDurationMs:$duration_ms}' \
    > "${auth_file}"
  echo "[AEGIS][FORMAL] precommit_receipt_created profile=${profile}" >&2
}

is_harness_path() {
  local path="${1:-}"
  safe_path "${path}" || return 1
  case "${path}" in
    src|src/*|.harness|.harness/*|.git|.git/*) return 1 ;;
    *) return 0 ;;
  esac
}

create_harness_authorization() {
  local files staged_files base worktree_manifest index_manifest artifact_digest authority profile proof_plan proof_plan_digest
  files="$(jq -r '.validated_candidate.files_changed[]' "${artifact_file}" | sort -u)"
  [[ -n "${files}" ]] || fatal "harness_authorization_requires_staged_changes"
  staged_files="$(git -C "${repository_root}" diff --cached --name-only | sort -u)"
  [[ "${files}" == "${staged_files}" ]] || fatal "harness_validation_files_changed_mismatch"
  while IFS= read -r path; do
    [[ -n "${path}" ]] || continue
    is_harness_path "${path}" || fatal "harness_path_not_authorized:${path}"
  done <<< "${files}"

  base="$(git -C "${repository_root}" rev-parse HEAD)"
  worktree_manifest="$(manifest_from_worktree "${files}")"
  index_manifest="$(manifest_from_index "${files}")"
  [[ "${worktree_manifest}" == "${index_manifest}" ]] || fatal "harness_worktree_index_mismatch"
  git -C "${repository_root}" diff --cached --check || fatal "harness_staged_diff_invalid"

  artifact_digest="$(shasum -a 256 "${artifact_file}" | awk '{print $1}')"
  authority="$(jq -n '{kind:"deterministic_tribunal",id:"harness_validation.v1"}')"
  profile="fast"
  proof_plan="$(jq -n '{profile:"fast",count:0,proofs:[]}')"
  proof_plan_digest="$(printf '%s' "${proof_plan}" | jq -S -c . | shasum -a 256 | awk '{print $1}')"
  write_receipt "${base}" "${files}" "${index_manifest}" "${artifact_digest}" \
    "$(contract_digest_from_worktree)" \
    "$(registry_digest_from_worktree)" \
    "$(clarified_digest_from_worktree)" \
    "$(metadata_digest_from_worktree governance/architecture.policy.json)" \
    "${profile}" "${proof_plan_digest}" "${authority}" "${proof_plan}" "0" "HARNESS"
}

profile_for_files() {
  local files="${1:-}" profile_json registry_file
  registry_file="$(AEGIS_ROOT_DIR="${repository_root}" AEGIS_RUNTIME_DIR="${repository_root}/.harness/runtime" aegis_proof_registry_path)" \
    || fatal "semantic_registry_unavailable"
  profile_json="$(AEGIS_ROOT_DIR="${repository_root}" aegis_proof_profile_for_change \
    "${registry_file}" "${files}")" \
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
  local started_seconds duration_ms
  started_seconds="$(date +%s)"
  run_structure_verification
  legacy_metadata_present && fatal "legacy_semantic_metadata_detected"
  if [[ ! -e "${repository_root}/${semantic_record}" ]]; then
    create_baseline_authorization
    return
  fi

  [[ -s "${artifact_file}" ]] || fatal "missing_validation_artifact"
  jq -e '
    .mode == "validation" and .verdict == "accepted"
    and ((.changeKind // "PRODUCT") | IN("PRODUCT", "HARNESS"))
    and (.validated_candidate.files_changed | type == "array" and length > 0)
    and (.validated_candidate.files_changed | all(type == "string" and length > 0))
  ' "${artifact_file}" >/dev/null 2>&1 || fatal "validation_not_accepted"

  local artifact_kind
  artifact_kind="$(jq -r '.changeKind // "PRODUCT"' "${artifact_file}")"
  if [[ "${artifact_kind}" == "HARNESS" ]]; then
    create_harness_authorization
    return
  fi

  AEGIS_ROOT_DIR="${repository_root}" bash "${script_root}/contract_evidence_gate.sh" --staged \
    || fatal "promotion_contract_evidence_verification_failed"

  local files base manifest artifact_digest auth_file auth_dir now expires
  local contract_digest registry_digest clarified_digest policy_digest authority profile_json profile profile_plan proof_plan proof_plan_digest supervisor
  files="$(jq -r '.validated_candidate.files_changed[]' "${artifact_file}" | sort -u)"
  while IFS= read -r path; do safe_path "${path}" || fatal "unsafe_candidate_path:${path}"; done <<< "${files}"
  base="$(git -C "${repository_root}" rev-parse HEAD)"
  manifest="$(manifest_from_worktree "${files}")"
  artifact_digest="$(shasum -a 256 "${artifact_file}" | awk '{print $1}')"
  contract_digest="$(contract_digest_from_worktree)"
  registry_digest="$(registry_digest_from_worktree)"
  clarified_digest="$(clarified_digest_from_worktree)"
  policy_digest="$(metadata_digest_from_worktree governance/architecture.policy.json)"
  supervisor="$(semantic_supervisor_json "${base}")"
  authority="$(validation_authority_json)"
  profile_json="$(profile_for_files "${files}")"
  profile="$(printf '%s' "${profile_json}" | jq -r '.profile')"
  case "${profile}" in fast|targeted|release|forensic) ;; *) fatal "invalid_automatic_profile" ;; esac
  local contract_file registry_file
  contract_file="$(contract_worktree_file)"
  registry_file="$(AEGIS_ROOT_DIR="${repository_root}" AEGIS_RUNTIME_DIR="${repository_root}/.harness/runtime" aegis_proof_registry_path)"
  if jq -e '.verification?.riskProfile == "forensic" and (.verification.independentReviewDigest | type == "string" and test("^[a-f0-9]{64}$"))' \
    "${contract_file}" >/dev/null; then
    [[ "${profile}" == "forensic" ]] || fatal "forensic_profile_required"
    require_forensic_candidate_review "${contract_digest}" "$(manifest_from_index "${files}")" "${supervisor}" "${contract_file}"
  elif jq -e '.verification?.riskProfile == "forensic"' "${contract_file}" >/dev/null; then
    fatal "forensic_review_missing"
  fi
  proof_plan="$(AEGIS_ROOT_DIR="${repository_root}" aegis_proof_profile_plan "${profile}" \
    "${registry_file}" "${files}")" \
    || fatal "proof_plan_generation_failed"

  # A receipt is issued only after the profile selected from this exact diff
  # has executed. The runner itself owns caching; the receipt records the
  # deterministic plan, not bulky test output.
  if ! AEGIS_ROOT_DIR="${repository_root}" \
    AEGIS_RUNTIME_DIR="${repository_root}/.harness/runtime" \
    AEGIS_PROOF_GOVERNANCE_VALIDATED=1 \
    bash "${script_root}/proof_runner.sh" --profile "${profile}" --changed "${files}"; then
    fatal "required_proof_profile_failed:${profile}"
  fi
  proof_plan_digest="$(printf '%s' "${proof_plan}" | jq -S -c . | shasum -a 256 | awk '{print $1}')"
  duration_ms="$(( ($(date +%s) - started_seconds) * 1000 ))"
  write_receipt "${base}" "${files}" "${manifest}" "${artifact_digest}" \
    "${contract_digest}" "${registry_digest}" "${clarified_digest}" "${policy_digest}" "${profile}" "${proof_plan_digest}" \
    "${authority}" "${proof_plan}" "${duration_ms}" "PRODUCT" "${supervisor}"
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
    "$(contract_digest_from_worktree)" \
    "$(registry_digest_from_worktree)" \
    "$(clarified_digest_from_worktree)" \
    "$(metadata_digest_from_worktree governance/architecture.policy.json)" \
    "${profile}" "${proof_plan_digest}" "${authority}" "${proof_plan}" "0" "BASELINE"
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
  local target reset_index

  if git -C "${repository_root}" cat-file -e "HEAD:${semantic_record}" 2>/dev/null; then
    ! git -C "${repository_root}" cat-file -e ":${semantic_record}" 2>/dev/null || return 1
    while IFS= read -r target; do
      [[ -n "${target}" && "${target}" != "src/index.ts" ]] || continue
      ! git -C "${repository_root}" cat-file -e ":${target}" 2>/dev/null || return 1
    done < <(git -C "${repository_root}" show "HEAD:${semantic_record}" | jq -r '.contract.scope.authorizedPaths[]?')
    git -C "${repository_root}" cat-file -e ':src/index.ts' 2>/dev/null || return 1
    reset_index="$(git -C "${repository_root}" show :src/index.ts)"
    [[ "${reset_index}" == $'// Ponto de entrada canônico para a próxima demanda.\nexport {};' ]]
    return
  fi
  return 1
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
    and ((.changeKind // "PRODUCT") | IN("PRODUCT", "HARNESS", "BASELINE"))
    and (.executionId | type == "string" and length == 64)
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
    and (.issuedAtEpoch | type == "number")
    and (.verificationDurationMs | type == "number" and . >= 0)
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
  contract_digest="$(contract_digest_from_index)"
  registry_digest="$(registry_digest_from_index)"
  clarified_digest="$(clarified_digest_from_index)"
  policy_digest="$(metadata_digest_from_index governance/architecture.policy.json)"
  [[ "${expected_contract_digest}" == "${contract_digest}" ]] || fatal "formal_promotion_contract_digest_mismatch"
  [[ "${expected_registry_digest}" == "${registry_digest}" ]] || fatal "formal_promotion_registry_digest_mismatch"
  [[ "${expected_clarified_digest}" == "${clarified_digest}" ]] || fatal "formal_promotion_clarified_demand_digest_mismatch"
  [[ "${expected_policy_digest}" == "${policy_digest}" ]] || fatal "formal_promotion_architecture_policy_digest_mismatch"
}

verify_committed_transition() {
  local auth_file postcommit_path head base files committed_files expected_manifest actual_manifest
  local expected_contract expected_registry expected_clarified expected_policy
  auth_file="$(authorization_path)"
  [[ -s "${auth_file}" ]] || fatal "postcommit_receipt_missing"
  jq -e '
    .schema == "aegis.precommit_receipt.v1"
    and .status == "PROVEN"
    and (.executionId | type == "string" and length == 64)
    and (.baseCommit | type == "string" and length >= 40)
    and (.files | type == "array" and length > 0)
    and (.worktreeManifest | type == "string" and length == 64)
  ' "${auth_file}" >/dev/null 2>&1 || fatal "postcommit_receipt_invalid"
  head="$(git -C "${repository_root}" rev-parse HEAD)"
  base="$(jq -r '.baseCommit' "${auth_file}")"
  [[ "$(git -C "${repository_root}" rev-parse "${head}^")" == "${base}" ]] \
    || fatal "postcommit_base_mismatch"
  files="$(jq -r '.files[]' "${auth_file}" | sort -u)"
  committed_files="$(git -C "${repository_root}" diff-tree --no-commit-id --name-only -r "${head}" | sort -u)"
  [[ "${files}" == "${committed_files}" ]] || fatal "postcommit_files_mismatch"
  expected_manifest="$(jq -r '.worktreeManifest' "${auth_file}")"
  actual_manifest="$(manifest_from_commit "${head}" "${files}")"
  [[ "${expected_manifest}" == "${actual_manifest}" ]] || fatal "postcommit_manifest_mismatch"

  expected_contract="$(jq -r '.contractDigest' "${auth_file}")"
  expected_registry="$(jq -r '.proofRegistryDigest' "${auth_file}")"
  expected_clarified="$(jq -r '.clarifiedDemandDigest' "${auth_file}")"
  expected_policy="$(jq -r '.architecturePolicyDigest' "${auth_file}")"
  [[ "${expected_contract}" == "$(contract_digest_from_commit "${head}")" ]] \
    || fatal "postcommit_contract_digest_mismatch"
  [[ "${expected_registry}" == "$(registry_digest_from_commit "${head}")" ]] \
    || fatal "postcommit_registry_digest_mismatch"
  [[ "${expected_clarified}" == "$(clarified_digest_from_commit "${head}")" ]] \
    || fatal "postcommit_clarified_demand_digest_mismatch"
  [[ "${expected_policy}" == "$(metadata_digest_from_commit "${head}" governance/architecture.policy.json)" ]] \
    || fatal "postcommit_architecture_policy_digest_mismatch"

  postcommit_path="$(git -C "${repository_root}" rev-parse --git-path aegis/postcommit_receipt.json)"
  [[ "${postcommit_path}" == /* ]] || postcommit_path="${repository_root}/${postcommit_path}"
  mkdir -p "$(dirname "${postcommit_path}")"
  jq -n \
    --arg execution_id "$(jq -r '.executionId' "${auth_file}")" \
    --arg commit "${head}" \
    --arg base "${base}" \
    --arg manifest "${actual_manifest}" \
    --argjson verified "$(date +%s)" \
    '{schema:"aegis.postcommit_receipt.v1",status:"PROVEN",executionId:$execution_id,commit:$commit,baseCommit:$base,committedManifest:$manifest,verifiedAtEpoch:$verified}' \
    > "${postcommit_path}"
  echo "[AEGIS][FORMAL] postcommit=PROVEN execution=$(jq -r '.executionId' "${auth_file}")" >&2
}

case "${command_name}" in
  create) create_authorization ;;
  requires) requires_authorization ;;
  verify) verify_authorization ;;
  verify-commit) verify_committed_transition ;;
  *) fatal "unknown_formal_promotion_command:${command_name}" ;;
esac

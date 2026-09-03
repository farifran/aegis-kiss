#!/usr/bin/env bash

# =========================================================
# AEGIS — PROOF GOVERNANCE
# =========================================================
#
# The registry is the admission control for verification itself. A proof may
# be used only when it has a unique identity, an explicit risk, an authority,
# a cost/cadence policy, and concrete targets. This keeps expensive checks out
# of the fast path without allowing them to disappear.
#

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "[AEGIS][FATAL] proof_governance_lib_not_invocable" >&2
  exit 1
fi

aegis_proof_registry_path() {
  printf '%s' "${AEGIS_PROOF_REGISTRY_FILE:-${AEGIS_ROOT_DIR:-.}/.harness/proof_registry.json}"
}

aegis_proof_contract_path() {
  printf '%s' "${AEGIS_PROOF_CONTRACT_FILE:-${AEGIS_ROOT_DIR:-.}/.harness/active_contract_ir.json}"
}

aegis_proof_governance_validate() {
  local registry_file="${1:-$(aegis_proof_registry_path)}"
  local contract_file="${2:-$(aegis_proof_contract_path)}"
  local root_dir="${AEGIS_ROOT_DIR:-.}"
  local duplicate_ids duplicate_coverage invalid_targets missing_contract_targets missing_proofs
  local profile_error proof_target

  [[ -s "${registry_file}" ]] || { echo "[AEGIS][PROOF][FATAL] missing_registry:${registry_file}" >&2; return 1; }
  [[ -s "${contract_file}" ]] || { echo "[AEGIS][PROOF][FATAL] missing_contract:${contract_file}" >&2; return 1; }

  jq -e '
    .schema == "aegis.proof_registry.v1"
    and .policy.mode == "enforced"
    and (.profiles | type == "array" and length > 0)
    and (.proofs | type == "array" and length > 0)
    and all(.proofs[];
      (.id | type == "string" and test("^[A-Z0-9][A-Z0-9_-]+$"))
      and (.risk | type == "string" and length > 0)
      and (.coverageKey | type == "string" and length > 0)
      and (.authority | type == "string" and length > 0)
      and (.cost | IN("low", "medium", "high"))
      and (.cadence | IN("always", "targeted", "release", "forensic"))
      and (.status | IN("experimental", "active", "retired"))
      and (.targets | type == "array" and length > 0)
      and (.executionKey | type == "string" and test("^[a-z0-9][a-z0-9_-]+$"))
      and (.command | type == "string" and test("^(npm run [A-Za-z0-9:_-]+|bash [A-Za-z0-9_./-]+)$"))
      and (if .status == "experimental" then (.expiresOn | type == "string" and length > 0) else true end)
    )
    and all(.profiles[];
      (.id | IN("fast", "targeted", "release", "forensic"))
      and (.proofIds | type == "array" and length > 0)
    )
  ' "${registry_file}" >/dev/null 2>&1 || {
    echo "[AEGIS][PROOF][FATAL] malformed_registry" >&2
    return 1
  }

  duplicate_ids="$(jq -r '[.proofs[].id] | group_by(.)[] | select(length > 1) | .[0]' "${registry_file}")"
  [[ -z "${duplicate_ids}" ]] || { echo "[AEGIS][PROOF][FATAL] duplicate_proof_id:${duplicate_ids}" >&2; return 1; }
  duplicate_coverage="$(jq -r '[.proofs[] | select(.status != "retired") | .coverageKey] | group_by(.)[] | select(length > 1) | .[0]' "${registry_file}")"
  [[ -z "${duplicate_coverage}" ]] || { echo "[AEGIS][PROOF][FATAL] duplicate_coverage_key:${duplicate_coverage}" >&2; return 1; }

  profile_error="$(jq -r '
    . as $r |
    .profiles[] as $p |
    select(($p.proofIds | length) > ($r.policy.maxActiveProofsPerProfile[$p.id] // 0)) |
    $p.id
  ' "${registry_file}")"
  [[ -z "${profile_error}" ]] || { echo "[AEGIS][PROOF][FATAL] profile_budget_exceeded:${profile_error}" >&2; return 1; }

  while IFS= read -r proof_target; do
    [[ -n "${proof_target}" ]] || continue
    [[ -e "${root_dir}/${proof_target}" ]] || {
      echo "[AEGIS][PROOF][FATAL] proof_target_missing:${proof_target}" >&2
      return 1
    }
  done < <(jq -r '.proofs[] | select(.status != "retired") | .targets[]' "${registry_file}")

  missing_contract_targets=""
  missing_contract_targets="$(jq -r '.targets[]? // empty' "${contract_file}" | while IFS= read -r proof_target; do
    [[ -e "${root_dir}/${proof_target}" ]] || printf '%s\n' "${proof_target}"
  done)"
  [[ -z "${missing_contract_targets}" ]] || {
    echo "[AEGIS][PROOF][FATAL] contract_target_missing:$(printf '%s' "${missing_contract_targets}" | tr '\n' ',')" >&2
    return 1
  }

  missing_proofs=""
  missing_proofs="$(jq -r '
    .proofObligations[]?.id // empty
  ' "${contract_file}" | while IFS= read -r proof_id; do
    jq -e --arg id "${proof_id}" '.proofs[] | select(.id == $id)' "${registry_file}" >/dev/null 2>&1 || printf '%s\n' "${proof_id}"
  done)"
  [[ -z "${missing_proofs}" ]] || {
    echo "[AEGIS][PROOF][FATAL] obligation_without_registry:$(printf '%s' "${missing_proofs}" | tr '\n' ',')" >&2
    return 1
  }

  jq -e '
    . as $r |
    all(.profiles[];
      all(.proofIds[];
        . as $id | any($r.proofs[]; .id == $id and .status != "retired")
      )
    )
  ' "${registry_file}" >/dev/null 2>&1 || {
    echo "[AEGIS][PROOF][FATAL] profile_references_unknown_or_retired_proof" >&2
    return 1
  }

  echo "[AEGIS][PROOF] governance: PASS"
}

aegis_proof_profile_plan() {
  local profile="${1:-fast}"
  local registry_file="${2:-$(aegis_proof_registry_path)}"
  local changed_files="${3:-}"
  [[ -s "${registry_file}" ]] || return 1
  jq -c --arg profile "${profile}" --arg changed "${changed_files}" '
    . as $r |
    ($r.profiles[] | select(.id == $profile)) as $p |
    [ $p.proofIds[] as $id |
      $r.proofs[] | select(.id == $id and .status != "retired") |
      . as $proof |
      {id:$proof.id, risk:$proof.risk, authority:$proof.authority, cost:$proof.cost, cadence:$proof.cadence,
       executionKey:$proof.executionKey, command:$proof.command,
       targets:$proof.targets, selected:(if $profile == "targeted" and ($changed | length) > 0
         then any($proof.targets[]; ($changed | split("\n")) | index(.) != null)
         else true end)}
    ] | {profile:$profile, proofs:map(select(.selected)), count:(map(select(.selected)) | length)}
  ' "${registry_file}"
}

aegis_proof_cache_key() {
  local proof_id="${1:-}"
  local profile="${2:-fast}"
  local contract_file="${3:-$(aegis_proof_contract_path)}"
  local registry_file="${4:-$(aegis_proof_registry_path)}"
  local files="${5:-}"
  {
    printf 'proof=%s\nprofile=%s\n' "${proof_id}" "${profile}"
    jq -S -c --arg id "${proof_id}" '.proofs[] | select(.id == $id)' "${registry_file}"
    jq -S -c . "${contract_file}"
    while IFS= read -r file; do
      [[ -n "${file}" ]] || continue
      if [[ -f "${file}" ]]; then
        printf 'file=%s\n' "${file}"
        shasum -a 256 "${file}"
      elif [[ -d "${file}" ]]; then
        while IFS= read -r nested; do
          printf 'file=%s\n' "${nested}"
          shasum -a 256 "${nested}"
        done < <(find "${file}" -type f -print | sort)
      fi
    done <<< "${files}"
  } | shasum -a 256 | awk '{print $1}'
}

aegis_proof_execution_cache_key() {
  local execution_key="${1:-}"
  local profile="${2:-fast}"
  local contract_file="${3:-$(aegis_proof_contract_path)}"
  local registry_file="${4:-$(aegis_proof_registry_path)}"
  local files="${5:-}"
  {
    printf 'execution=%s\nprofile=%s\n' "${execution_key}" "${profile}"
    jq -S -c . "${registry_file}"
    jq -S -c . "${contract_file}"
    while IFS= read -r file; do
      [[ -n "${file}" ]] || continue
      if [[ -f "${file}" ]]; then
        printf 'file=%s\n' "${file}"
        shasum -a 256 "${file}"
      elif [[ -d "${file}" ]]; then
        while IFS= read -r nested; do
          printf 'file=%s\n' "${nested}"
          shasum -a 256 "${nested}"
        done < <(find "${file}" -type f -print | sort)
      fi
    done <<< "${files}"
  } | shasum -a 256 | awk '{print $1}'
}

aegis_proof_cache_lookup() {
  local key="${1:-}"
  local cache_dir="${AEGIS_RUNTIME_DIR:-.harness/runtime}/evidence_cache"
  [[ "${key}" =~ ^[a-f0-9]{64}$ ]] || return 1
  [[ -s "${cache_dir}/${key}.json" ]] || return 1
  jq -e --arg key "${key}" '.cache_key == $key and .status == "PROVEN"' "${cache_dir}/${key}.json" >/dev/null 2>&1
}

aegis_proof_cache_store() {
  local key="${1:-}"
  local proof_id="${2:-}"
  local status="${3:-UNPROVEN}"
  local authority="${4:-unknown}"
  local cache_dir="${AEGIS_RUNTIME_DIR:-.harness/runtime}/evidence_cache"
  [[ "${key}" =~ ^[a-f0-9]{64}$ ]] || return 1
  mkdir -p "${cache_dir}" || return 1
  jq -n --arg key "${key}" --arg proof "${proof_id}" --arg status "${status}" --arg authority "${authority}" \
    '{schema:"aegis.evidence_cache.v1",cache_key:$key,proof_id:$proof,status:$status,authority:$authority,created_at:(now|todateiso8601)}' \
    > "${cache_dir}/${key}.json"
}

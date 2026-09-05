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

aegis_proof_safe_repository_path() {
  local path="${1:-}"
  [[ -n "${path}" && "${path}" != /* && ! "${path}" =~ (^|/)\.\.(/|$) ]]
}

aegis_contract_targets() {
  local contract_file="${1:-$(aegis_proof_contract_path)}"
  jq -r 'if .schema == "aegis.contract_ir.v2" then .scope.authorizedPaths[]? else .targets[]? end' "${contract_file}"
}

aegis_path_within_scope() {
  local path="${1:-}" declared="${2:-}"
  [[ "${path}" == "${declared}" || "${path}" == "${declared}/"* ]]
}

# Every persistent staged path must be part of the semantic scope. Only the
# three generated governance records are implicit; all code, tests, prompts,
# configuration and harness files must be named by the contract.
aegis_staged_scope_validate() {
  local repository_root="${1:-${AEGIS_ROOT_DIR:-.}}"
  local staged_contract="${2:-}"
  local path declared allowed
  [[ -s "${staged_contract}" ]] || return 1

  while IFS= read -r path; do
    [[ -n "${path}" ]] || continue
    case "${path}" in
      .harness/active_contract_ir.json|.harness/active_clarified_demand.json|.harness/proof_registry.json)
        continue
        ;;
    esac
    allowed=0
    while IFS= read -r declared; do
      [[ -n "${declared}" ]] || continue
      if aegis_path_within_scope "${path}" "${declared}"; then
        allowed=1
        break
      fi
    done < <(
      {
        aegis_contract_targets "${staged_contract}"
        jq -r '(.continuity.retirements // [])[] | select(.kind == "target") | .id' "${staged_contract}"
      } | sort -u
    )
    if [[ "${allowed}" -ne 1 ]]; then
      echo "[AEGIS][SCOPE][FATAL] staged_path_outside_contract:${path}" >&2
      return 1
    fi
  done < <(git -C "${repository_root}" diff --cached --name-only | sort -u)
}

# A proof command is part of its definition, not an opaque string.  We do not
# execute it here; this merely proves that the staged/working tree can resolve
# the declared entry point before a commit is allowed to claim the proof.
aegis_proof_commands_resolve() {
  local registry_file="${1:-}"
  local root_dir="${2:-.}"
  local command_string command_name command_path

  while IFS= read -r command_string; do
    [[ -n "${command_string}" ]] || continue
    if [[ "${command_string}" =~ ^npm[[:space:]]+run[[:space:]]+([A-Za-z0-9:_-]+)$ ]]; then
      command_name="${BASH_REMATCH[1]}"
      jq -e --arg name "${command_name}" \
        '(.scripts[$name] | type == "string" and length > 0)' \
        "${root_dir}/package.json" >/dev/null 2>&1 || {
          echo "[AEGIS][PROOF][FATAL] unresolved_npm_proof_command:${command_name}" >&2
          return 1
        }
    elif [[ "${command_string}" =~ ^bash[[:space:]]+([A-Za-z0-9_./-]+)$ ]]; then
      command_path="${BASH_REMATCH[1]}"
      aegis_proof_safe_repository_path "${command_path}" \
        && [[ -f "${root_dir}/${command_path}" ]] || {
          echo "[AEGIS][PROOF][FATAL] unresolved_bash_proof_command:${command_path}" >&2
          return 1
        }
    else
      echo "[AEGIS][PROOF][FATAL] untrusted_proof_command" >&2
      return 1
    fi
  done < <(jq -r '.proofs[] | select(.status != "retired") | .command' "${registry_file}")
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
      and (if has("minimumProfile") then (.minimumProfile | IN("fast", "targeted", "release", "forensic")) else true end)
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

  aegis_proof_commands_resolve "${registry_file}" "${root_dir}" || return 1

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
  missing_contract_targets="$(aegis_contract_targets "${contract_file}" | while IFS= read -r proof_target; do
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

# Validates the exact tree in Git's index.  This closes the gap where an agent
# runs checks against the working tree and then stages a deletion before a
# direct `git commit`.  Only declared contract/proof files plus command entry
# points are materialized in a temporary tree; no source is changed.
aegis_proof_materialize_staged_path() {
  local repository_root="${1:-}"
  local staged_root="${2:-}"
  local target="${3:-}"
  local staged_file

  aegis_proof_safe_repository_path "${target}" || return 1
  if git -C "${repository_root}" cat-file -e ":${target}" 2>/dev/null; then
    mkdir -p "${staged_root}/$(dirname "${target}")"
    git -C "${repository_root}" show ":${target}" > "${staged_root}/${target}"
    return 0
  fi

  staged_file="$(git -C "${repository_root}" ls-files --cached -- "${target}" | head -1)"
  [[ -n "${staged_file}" ]] || return 1
  while IFS= read -r staged_file; do
    [[ -n "${staged_file}" ]] || continue
    mkdir -p "${staged_root}/$(dirname "${staged_file}")"
    git -C "${repository_root}" show ":${staged_file}" > "${staged_root}/${staged_file}"
  done < <(git -C "${repository_root}" ls-files --cached -- "${target}")
}

aegis_proof_staged_path_exists() {
  local repository_root="${1:-}"
  local target="${2:-}"
  aegis_proof_safe_repository_path "${target}" || return 1
  git -C "${repository_root}" cat-file -e ":${target}" 2>/dev/null \
    || [[ -n "$(git -C "${repository_root}" ls-files --cached -- "${target}" | head -1)" ]]
}

# An evolution may add or change evidence, but it may not silently remove a
# previously active proof or its source target.  The only exception is an
# explicit retirement in the candidate contract, tied to the demand that
# authorizes it.  Git history remains the durable audit log; this metadata is
# per-transition, not a growing registry of old tests.
aegis_proof_continuity_validate_staged() {
  local repository_root="${1:-${AEGIS_ROOT_DIR:-.}}"
  local continuity_root old_registry old_contract new_registry new_contract proof_id target old_proof new_proof rc=0

  git -C "${repository_root}" rev-parse --verify HEAD >/dev/null 2>&1 || return 0
  for target in .harness/proof_registry.json .harness/active_contract_ir.json; do
    git -C "${repository_root}" cat-file -e "HEAD:${target}" 2>/dev/null || return 0
    git -C "${repository_root}" cat-file -e ":${target}" 2>/dev/null || {
      echo "[AEGIS][CONTINUITY][FATAL] staged_metadata_missing:${target}" >&2
      return 1
    }
  done

  continuity_root="$(mktemp -d "${TMPDIR:-/tmp}/aegis-proof-continuity.XXXXXX")" || return 1
  old_registry="${continuity_root}/old-registry.json"
  old_contract="${continuity_root}/old-contract.json"
  new_registry="${continuity_root}/new-registry.json"
  new_contract="${continuity_root}/new-contract.json"
  git -C "${repository_root}" show HEAD:.harness/proof_registry.json > "${old_registry}"
  git -C "${repository_root}" show HEAD:.harness/active_contract_ir.json > "${old_contract}"
  git -C "${repository_root}" show :.harness/proof_registry.json > "${new_registry}"
  git -C "${repository_root}" show :.harness/active_contract_ir.json > "${new_contract}"

  jq -e '
    if has("continuity") then
      (.continuity | type == "object")
      and ((.continuity.retirements // []) | type == "array")
      and ((.continuity.retirements // []) | all(
        type == "object"
        and (.kind | IN("proof", "target"))
        and (.id | type == "string" and length > 0)
        and (.reason | type == "string" and length > 0)
        and (.demandEvidence | type == "string" and length > 0)
        and (if has("successor") then (.successor | type == "string" and length > 0) else true end)
      ))
      and (((.continuity.retirements // []) | map(.kind + "\u0000" + .id) | unique | length) == ((.continuity.retirements // []) | length))
      and ((.continuity.proofChanges // []) | type == "array")
      and ((.continuity.proofChanges // []) | all(
        type == "object"
        and (.id | type == "string" and length > 0)
        and (.reason | type == "string" and length > 0)
        and (.demandEvidence | type == "string" and length > 0)
      ))
      and (((.continuity.proofChanges // []) | map(.id) | unique | length) == ((.continuity.proofChanges // []) | length))
    else true end
  ' "${new_contract}" >/dev/null 2>&1 || {
    echo "[AEGIS][CONTINUITY][FATAL] malformed_retirement_record" >&2
    rc=1
  }

  if [[ "${rc}" -eq 0 ]]; then
    while IFS= read -r proof_id; do
      [[ -n "${proof_id}" ]] || continue
      if ! jq -e --arg id "${proof_id}" '.proofs[] | select(.status != "retired" and .id == $id)' "${new_registry}" >/dev/null 2>&1; then
        if ! jq -e --arg id "${proof_id}" '(.continuity.retirements // []) | any(.kind == "proof" and .id == $id)' "${new_contract}" >/dev/null 2>&1; then
          echo "[AEGIS][CONTINUITY][FATAL] active_proof_removed_without_retirement:${proof_id}" >&2
          rc=1
        fi
      else
        old_proof="$(jq -S -c --arg id "${proof_id}" '.proofs[] | select(.status != "retired" and .id == $id) | {risk,coverageKey,authority,command,targets:(.targets | sort)}' "${old_registry}")"
        new_proof="$(jq -S -c --arg id "${proof_id}" '.proofs[] | select(.status != "retired" and .id == $id) | {risk,coverageKey,authority,command,targets:(.targets | sort)}' "${new_registry}")"
        if [[ "${old_proof}" != "${new_proof}" ]] \
          && ! jq -e --arg id "${proof_id}" '(.continuity.proofChanges // []) | any(.id == $id)' "${new_contract}" >/dev/null 2>&1; then
          echo "[AEGIS][CONTINUITY][FATAL] active_proof_changed_without_record:${proof_id}" >&2
          rc=1
        fi
      fi
    done < <(jq -r '.proofs[] | select(.status != "retired") | .id' "${old_registry}")
  fi

  if [[ "${rc}" -eq 0 ]]; then
    while IFS= read -r target; do
      [[ -n "${target}" ]] || continue
      if ! aegis_proof_staged_path_exists "${repository_root}" "${target}"; then
        if ! jq -e --arg id "${target}" '(.continuity.retirements // []) | any(.kind == "target" and .id == $id)' "${new_contract}" >/dev/null 2>&1; then
          echo "[AEGIS][CONTINUITY][FATAL] target_removed_without_retirement:${target}" >&2
          rc=1
        fi
      fi
    done < <(
      {
        aegis_contract_targets "${old_contract}"
        jq -r '.proofs[] | select(.status != "retired") | .targets[]' "${old_registry}"
      } | sort -u
    )
  fi

  rm -rf "${continuity_root}"
  return "${rc}"
}

aegis_proof_governance_validate_staged() {
  local repository_root="${1:-${AEGIS_ROOT_DIR:-.}}"
  local staged_root registry_file contract_file target command_path rc=0

  git -C "${repository_root}" rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
    echo "[AEGIS][PROOF][FATAL] staged_validation_requires_git_repository" >&2
    return 1
  }
  for target in .harness/proof_registry.json .harness/active_contract_ir.json; do
    git -C "${repository_root}" cat-file -e ":${target}" 2>/dev/null || {
      echo "[AEGIS][PROOF][FATAL] staged_metadata_missing:${target}" >&2
      return 1
    }
  done

  staged_root="$(mktemp -d "${TMPDIR:-/tmp}/aegis-staged-proof.XXXXXX")" || return 1
  registry_file="${staged_root}/.harness/proof_registry.json"
  contract_file="${staged_root}/.harness/active_contract_ir.json"
  mkdir -p "${staged_root}/.harness"
  git -C "${repository_root}" show :.harness/proof_registry.json > "${registry_file}"
  git -C "${repository_root}" show :.harness/active_contract_ir.json > "${contract_file}"

  while IFS= read -r target; do
    [[ -n "${target}" ]] || continue
    if ! aegis_proof_materialize_staged_path "${repository_root}" "${staged_root}" "${target}"; then
      echo "[AEGIS][PROOF][FATAL] staged_target_missing:${target}" >&2
      rc=1
      break
    fi
  done < <(
    { aegis_contract_targets "${contract_file}"; jq -r '.proofs[]? | select(.status != "retired") | .targets[]?' "${registry_file}"; } | sort -u
  )

  if [[ "${rc}" -eq 0 ]]; then
    if git -C "${repository_root}" cat-file -e :package.json 2>/dev/null; then
      git -C "${repository_root}" show :package.json > "${staged_root}/package.json"
    fi
    while IFS= read -r command_path; do
      [[ -n "${command_path}" ]] || continue
      if ! aegis_proof_safe_repository_path "${command_path}" \
        || ! git -C "${repository_root}" cat-file -e ":${command_path}" 2>/dev/null; then
        echo "[AEGIS][PROOF][FATAL] staged_command_target_missing:${command_path}" >&2
        rc=1
        break
      fi
      mkdir -p "${staged_root}/$(dirname "${command_path}")"
      git -C "${repository_root}" show ":${command_path}" > "${staged_root}/${command_path}"
    done < <(jq -r '.proofs[] | select(.status != "retired") | .command | select(startswith("bash ")) | ltrimstr("bash ")' "${registry_file}")
  fi

  if [[ "${rc}" -eq 0 ]]; then
    AEGIS_ROOT_DIR="${staged_root}" aegis_proof_governance_validate "${registry_file}" "${contract_file}" >/dev/null || rc=1
  fi
  rm -rf "${staged_root}"
  return "${rc}"
}

aegis_proof_profile_plan() {
  local profile="${1:-fast}"
  local registry_file="${2:-$(aegis_proof_registry_path)}"
  local changed_files="${3:-}"
  local plan
  plan="$(jq -c --arg profile "${profile}" --arg changed "${changed_files}" '
    def overlaps($targets; $files):
      any($targets[] as $target | $files[]? as $file |
        $file == $target
        or ($file | startswith($target + "/"))
        or ($target | startswith($file + "/")));
    . as $r |
    ($changed | split("\n") | map(select(length > 0)) | unique) as $files |
    ($r.profiles[] | select(.id == $profile)) as $p |
    [ $p.proofIds[] as $id |
      $r.proofs[] | select(.id == $id and .status != "retired") |
      . as $proof |
      {id:$proof.id, risk:$proof.risk, authority:$proof.authority, cost:$proof.cost, cadence:$proof.cadence,
       executionKey:$proof.executionKey, command:$proof.command,
       targets:$proof.targets, selected:(if $profile == "targeted" and ($files | length) > 0
         then overlaps($proof.targets; $files)
         else true end)}
    ] | {profile:$profile, proofs:map(select(.selected)), count:(map(select(.selected)) | length)}
  ' "${registry_file}")" || return 1
  [[ -n "${plan}" && "${plan}" != "null" ]] || return 1
  printf '%s\n' "${plan}"
}

# Selects the smallest sufficient profile from the files that actually changed.
# The mapping is declared by each proof's cadence/cost, never inferred from a
# domain keyword. This keeps the harness universal: a project says which risk
# lives behind each target; Aegis merely composes the required evidence.
aegis_proof_profile_for_change() {
  local registry_file="${1:-$(aegis_proof_registry_path)}"
  local changed_files="${2:-}"
  [[ -s "${registry_file}" ]] || return 1

  jq -c --arg changed "${changed_files}" '
    def rank($profile):
      if $profile == "fast" then 0
      elif $profile == "targeted" then 1
      elif $profile == "release" then 2
      else 3 end;
    def profile_for_proof:
      if .minimumProfile? != null then .minimumProfile
      elif .cadence == "forensic" then "forensic"
      elif .cadence == "release" or .cost == "high" then "release"
      elif .cadence == "targeted" or .cost == "medium" then "targeted"
      else "fast" end;
    ($changed | split("\n") | map(select(length > 0)) | unique) as $files |
    [ .proofs[]
      | select(.status != "retired")
      | . as $proof
      | select(any($proof.targets[] as $target | $files[]? as $file |
          $file == $target
          or ($file | startswith($target + "/"))
          or ($target | startswith($file + "/"))))
      | {id, targets, requiredProfile: profile_for_proof}
    ] as $matched |
    (if ($matched | length) == 0 then "fast"
      else ($matched | max_by(rank(.requiredProfile)) | .requiredProfile)
     end) as $profile |
    {profile:$profile, matchedProofs:$matched, changedFiles:$files}
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

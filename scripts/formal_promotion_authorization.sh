#!/usr/bin/env bash
set -Eeuo pipefail

command_name="${1:-}"
repository_root="${2:-}"
artifact_file="${3:-}"

fatal() {
  echo "[AEGIS][FORMAL][FATAL] $1" >&2
  exit 1
}

[[ -n "${repository_root}" ]] || fatal "missing_repository_root"
git -C "${repository_root}" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || fatal "not_git_repository"

authorization_path() {
  git -C "${repository_root}" rev-parse --git-path aegis/formal_promotion.json
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
  local files="${1:-}" path content_file
  content_file="$(mktemp)"
  trap 'rm -f "${content_file}"' RETURN
  while IFS= read -r path; do
    [[ -n "${path}" ]] || continue
    printf 'path=%s\n' "${path}"
    if git -C "${repository_root}" cat-file -e ":${path}" 2>/dev/null; then
      git -C "${repository_root}" show ":${path}" > "${content_file}"
      shasum -a 256 "${content_file}" | awk '{print $1}'
    else
      printf 'missing\n'
    fi
  done <<< "${files}" | shasum -a 256 | awk '{print $1}'
  rm -f "${content_file}"
  trap - RETURN
}

create_authorization() {
  [[ -s "${artifact_file}" ]] || fatal "missing_validation_artifact"
  jq -e '
    .mode == "validation" and .verdict == "accepted"
    and (.validated_candidate.files_changed | type == "array" and length > 0)
    and (.validated_candidate.files_changed | all(type == "string" and length > 0))
  ' "${artifact_file}" >/dev/null 2>&1 || fatal "validation_not_accepted"

  local files base manifest artifact_digest auth_file auth_dir now expires
  files="$(jq -r '.validated_candidate.files_changed[]' "${artifact_file}" | sort -u)"
  while IFS= read -r path; do safe_path "${path}" || fatal "unsafe_candidate_path:${path}"; done <<< "${files}"
  base="$(git -C "${repository_root}" rev-parse HEAD)"
  manifest="$(manifest_from_worktree "${files}")"
  artifact_digest="$(shasum -a 256 "${artifact_file}" | awk '{print $1}')"
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
    --argjson expires "${expires}" \
    '{schema:"aegis.formal_promotion.v1",baseCommit:$base,files:($files|split("\n")|map(select(length>0))),worktreeManifest:$manifest,validationArtifactDigest:$artifact_digest,expiresAtEpoch:$expires}' \
    > "${auth_file}"
  echo "[AEGIS][FORMAL] authorization_created" >&2
}

requires_authorization() {
  local contract registry changed targets path target
  contract="$(git -C "${repository_root}" show :.harness/active_contract_ir.json 2>/dev/null || printf '{}')"
  registry="$(git -C "${repository_root}" show :.harness/proof_registry.json 2>/dev/null || printf '{}')"
  changed="$(git -C "${repository_root}" diff --cached --name-only)"
  targets="$({ printf '%s' "${contract}" | jq -r '.targets[]? // empty'; printf '%s' "${registry}" | jq -r '.proofs[]? | select(.status != "retired") | .targets[]?'; } | sort -u)"
  while IFS= read -r path; do
    [[ -n "${path}" ]] || continue
    while IFS= read -r target; do
      [[ -n "${target}" ]] || continue
      [[ "${path}" == "${target}" || "${path}" == "${target}/"* ]] && return 0
    done <<< "${targets}"
  done <<< "${changed}"
  return 1
}

verify_authorization() {
  local auth_file base files expected manifest now staged_files
  auth_file="$(authorization_path)"
  [[ -s "${auth_file}" ]] || fatal "formal_promotion_authorization_missing"
  base="$(git -C "${repository_root}" rev-parse HEAD)"
  now="$(date +%s)"
  jq -e --arg base "${base}" --argjson now "${now}" '
    .schema == "aegis.formal_promotion.v1"
    and .baseCommit == $base
    and (.expiresAtEpoch | type == "number" and . >= $now)
    and (.files | type == "array" and length > 0 and all(type == "string" and length > 0))
    and (.worktreeManifest | type == "string" and length == 64)
  ' "${auth_file}" >/dev/null 2>&1 || fatal "formal_promotion_authorization_invalid_or_expired"
  files="$(jq -r '.files[]' "${auth_file}" | sort -u)"
  staged_files="$(git -C "${repository_root}" diff --cached --name-only | sort -u)"
  [[ "${files}" == "${staged_files}" ]] || fatal "formal_promotion_files_changed_mismatch"
  expected="$(jq -r '.worktreeManifest' "${auth_file}")"
  manifest="$(manifest_from_index "${files}")"
  [[ "${expected}" == "${manifest}" ]] || fatal "formal_promotion_manifest_mismatch"
}

case "${command_name}" in
  create) create_authorization ;;
  requires) requires_authorization ;;
  verify) verify_authorization ;;
  *) fatal "unknown_formal_promotion_command:${command_name}" ;;
esac

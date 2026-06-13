#!/usr/bin/env bash

set -Eeuo pipefail

readonly AEGIS_AUDIT_ROOT="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd
)"

cd "${AEGIS_AUDIT_ROOT}"

source ".harness/config.sh"

array_contains() {
  local expected="$1"
  shift
  local value

  for value in "$@"; do
    [[ "${value}" == "${expected}" ]] && return 0
  done

  return 1
}

skill_declares() {
  local skill_file="$1"
  local field="$2"

  grep -Eq "\"?${field}\"?" "${skill_file}"
}

mutation_resolver_consumes() {
  local field="$1"

  grep -Eq "\\.${field}" scripts/substrates/aider_substrate.sh
}

candidate_materializer_consumes() {
  local field="$1"

  grep -Eq "\\.${field}" scripts/runtime/apply_candidate_diff.sh
}

runtime_promotes_validated_diff() {
  grep -Eq 'git[[:space:]]+-C[[:space:]].*apply' \
    scripts/runtime/promote_validated_candidate.sh
}

emit_boundary() {
  local boundary="$1"
  local produced="$2"
  local consumed="$3"
  local required="$4"
  local isolated="$5"
  local status="$6"
  local reason="$7"

  jq -n \
    --arg boundary "${boundary}" \
    --argjson produced "${produced}" \
    --argjson consumed "${consumed}" \
    --argjson required "${required}" \
    --argjson isolated "${isolated}" \
    --arg status "${status}" \
    --arg reason "${reason}" \
    '{
      boundary: $boundary,
      produced_artifact: $produced,
      consumed_artifact: $consumed,
      required_information: $required,
      next_mode_operates_from_contract_only: $isolated,
      status: $status,
      reason: $reason
    }'
}

main() {
  local results=()
  local status
  local reason

  if skill_declares ".skills/discovery.md" "ranked_targets" \
    && skill_declares ".skills/discovery.md" "handover_attention" \
    && skill_declares ".skills/forensics.md" "artifact_snapshot.ranked_targets" \
    && array_contains "filesystem.read:epistemic_handover" "${AEGIS_FORENSICS_EVIDENCE[@]}"; then
    status="pass"
    reason="Forensics explicitly consumes Discovery routing fields while deriving evidence from exposed capability payloads."
  else
    status="fail"
    reason="The producer fields or the handover exposure required by Forensics are absent."
  fi

  results+=("$(
    emit_boundary \
      "Discovery -> Forensics" \
      '["observed_request_alignment","topology_summary","ranked_targets","gap_counts","handover_attention"]' \
      '["filesystem.read:epistemic_handover","filesystem.search_symbol","git.status"]' \
      '["ranked_targets","handover_attention"]' \
      "true" \
      "${status}" \
      "${reason}"
  )")

  if skill_declares ".skills/forensics.md" "repair_candidates" \
    && mutation_resolver_consumes "repair_candidates"; then
    status="pass"
    reason="Repair consumes explicit repair candidates emitted by Forensics."
  else
    status="fail"
    reason="Forensics does not require repair_candidates and Repair does not consume them; target continuity depends on optional attention strings."
  fi

  results+=("$(
    emit_boundary \
      "Forensics -> Repair" \
      '["status","summary","evidence","interpretations","observations","unresolved_questions","confidence","repair_candidates","handover_attention"]' \
      '["repair_candidates"]' \
      '["repair_candidates[].id"]' \
      "$([[ "${status}" == "pass" ]] && printf true || printf false)" \
      "${status}" \
      "${reason}"
  )")

  if candidate_materializer_consumes "diff" \
    && candidate_materializer_consumes "files_changed" \
    && mutation_resolver_consumes "files_changed"; then
    status="pass"
    reason="The runtime reconstructs the Repair candidate from diff and files_changed before Optimize executes."
  else
    status="fail"
    reason="Repair emits diff and files_changed, but Optimize starts from HEAD and consumes only target attention; the repaired state is discarded with the worktree."
  fi

  results+=("$(
    emit_boundary \
      "Repair -> Optimize" \
      '["diff","files_changed","handover_attention"]' \
      '["epistemic_state.next_attention_targets","original investigation_input"]' \
      '["diff","files_changed"]' \
      "$([[ "${status}" == "pass" ]] && printf true || printf false)" \
      "${status}" \
      "${reason}"
  )")

  if array_contains "filesystem.read:epistemic_handover" "${AEGIS_ADVERSARIAL_EVIDENCE[@]}" \
    && skill_declares ".skills/adversarial.md" "diff" \
    && skill_declares ".skills/adversarial.md" "files_changed"; then
    status="pass"
    reason="Adversarial receives the optimized candidate artifact."
  else
    status="fail"
    reason="Adversarial receives only filesystem.search_symbol and cannot observe the Optimize artifact or candidate diff."
  fi

  results+=("$(
    emit_boundary \
      "Optimize -> Adversarial" \
      '["diff","files_changed","handover_attention"]' \
      '["filesystem.read:epistemic_handover","filesystem.search_symbol"]' \
      '["diff","files_changed"]' \
      "$([[ "${status}" == "pass" ]] && printf true || printf false)" \
      "${status}" \
      "${reason}"
  )")

  if array_contains "filesystem.read:epistemic_handover" "${AEGIS_VALIDATION_EVIDENCE[@]}" \
    && skill_declares ".skills/adversarial.md" "adversarial_findings" \
    && skill_declares ".skills/validation.md" "adversarial_findings" \
    && skill_declares ".skills/validation.md" "verdict"; then
    status="pass"
    reason="Validation consumes an explicit adversarial findings contract and emits a verdict."
  else
    status="fail"
    reason="Validation can read the handover, but no adversarial_findings schema is required and the contract forbids treating handover as validation evidence."
  fi

  results+=("$(
    emit_boundary \
      "Adversarial -> Validation" \
      '["candidate_result","adversarial_findings","evidence_refs"]' \
      '["filesystem.read:epistemic_handover"]' \
      '["adversarial_findings","candidate_result"]' \
      "$([[ "${status}" == "pass" ]] && printf true || printf false)" \
      "${status}" \
      "${reason}"
  )")

  if runtime_promotes_validated_diff; then
    status="pass"
    reason="The runtime applies a validated candidate through an explicit promotion path."
  else
    status="fail"
    reason="Promotion only replaces epistemic_handover.json; no validated diff is applied to Git or the main worktree."
  fi

  results+=("$(
    emit_boundary \
      "Validation -> Promote" \
      '["verdict","validated_candidate","adversarial_findings","basis"]' \
      '["runtime.promote_validated_candidate"]' \
      '["verdict","validated diff","files_changed"]' \
      "$([[ "${status}" == "pass" ]] && printf true || printf false)" \
      "${status}" \
      "${reason}"
  )")

  printf '%s\n' "${results[@]}" \
    | jq -s '
        ([.[].status == "pass"] | all) as $all_pass
        |
        {
          pipeline_ok: $all_pass,
          mutation_pipeline_proven: $all_pass,
          epistemic_pipeline_proven: $all_pass,
          boundaries: .
        }
      '
}

main "$@"

#!/usr/bin/env bash

# =========================================================
# AEGIS HARNESS — EPISTEMIC PIPELINE AUDITOR
# =========================================================
#
# Statically proves the mode-boundary contracts of the
# epistemic pipeline and enforces containment hygiene on
# the runtime-owned handover state. Deterministic: only
# bash, grep, and jq over repository files.
#
# =========================================================

set -Eeuo pipefail

readonly AEGIS_AUDIT_ROOT="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd
)"

cd "${AEGIS_AUDIT_ROOT}"

source ".harness/config.sh"

audit_fatal() {
  echo "[AEGIS][AUDIT][FATAL] $*" >&2
  exit 1
}

array_contains() {
  local expected="$1"
  shift
  local value

  for value in "$@"; do
    [[ "${value}" == "${expected}" ]] && return 0
  done

  return 1
}

# Match the field as a whole token so substrings ("verdicts",
# "refindings") and formatting tricks cannot satisfy the audit.
# Grep mode-contract fields in .skills/<mode>.md (LLM residual schemas).
# Discovery has no skill file — mechanical path lives in scripts/lib/demand.sh.
skill_declares() {
  local skill_file="$1"
  local field="$2"

  [[ -f "${skill_file}" ]] || return 1

  grep -Eq "(^|[^[:alnum:]_])${field}([^[:alnum:]_]|$)" "${skill_file}"
}

# Discovery is runtime-only: builder + emitter + execute_mode short-circuit.
discovery_mechanical_path_ok() {
  grep -Eq 'aegis_build_mechanical_discovery_json' scripts/lib/demand.sh \
    && grep -Eq 'aegis_emit_mechanical_discovery_substrate' scripts/lib/demand.sh \
    && grep -Eq 'required_evidence' scripts/lib/demand.sh \
    && grep -Eq 'observations' scripts/lib/demand.sh \
    && grep -Eq 'aegis_emit_mechanical_discovery_substrate' scripts/execute_mode.sh
}

# Mutation target resolution lives in the aider module split (targets.sh),
# not only in the thin aider_substrate.sh entrypoint.
mutation_resolver_consumes() {
  local field="$1"

  grep -Eq "\\.${field}([^[:alnum:]_]|$)" scripts/substrates/aider_substrate.sh \
    || grep -Eq "\\.${field}([^[:alnum:]_]|$)" scripts/substrates/aider/targets.sh \
    || grep -Eq "\\.${field}([^[:alnum:]_]|$)" scripts/substrates/aider/invoke.sh
}

candidate_materializer_consumes() {
  local field="$1"

  grep -Eq "\\.${field}([^[:alnum:]_]|$)" scripts/runtime/apply_candidate_diff.sh
}

# Runtime-owned content seeds for forensics+ (operator paths + attention).
runtime_seeds_deterministic_reads() {
  grep -Eq 'augment_evidence_profile_from_anchors' scripts/execute_mode.sh \
    && grep -Eq 'AEGIS_DETERMINISTIC_READ_MAX' .harness/config.sh
}

runtime_promotes_validated_diff() {
  grep -Eq 'git[[:space:]]+-C[[:space:]].*apply' \
    scripts/runtime/promote_validated_candidate.sh
}

# =========================================================
# CONTAINMENT AUDITS (fatal — never reported as "pass" JSON)
# =========================================================

# The persisted handover must be structurally sane: a deep, type-strict
# schema over the runtime-owned state, enforced in a single jq pass.
#
# Contract (mirrors promote_epistemic_handover, type-strict):
#
#   root                 exactly {artifact_snapshot, epistemic_state}
#   artifact_snapshot    null (pre-investigation) OR exactly
#                        {mode, investigation_input, generated_at,
#                         operational_context}:
#                          mode / investigation_input / generated_at
#                            non-empty strings
#                          operational_context  object; optional status /
#                            summary non-empty strings; optional
#                            required_evidence / findings /
#                            repair_candidates arrays; optional
#                            repair_feedback object; optional
#                            demand_anchors object (runtime mechanical)
#   epistemic_state      exactly {next_attention_targets, attention_scope,
#                        attention_reason}
#
# Extra keys (including legacy structural_context) and type-coercion
# bypasses are unsanitized state transitions.
audit_handover_state() {

  local handover_file="${AEGIS_EPISTEMIC_HANDOVER_FILE:-.harness/runtime/epistemic_handover.json}"

  [[ -f "${handover_file}" ]] || return 0

  jq -e '
    def nonempty_string: type == "string" and length > 0;

    def valid_operational_context:
      type == "object"
      and (if has("status")            then .status            | nonempty_string else true end)
      and (if has("summary")           then .summary           | nonempty_string else true end)
      and (if has("required_evidence") then .required_evidence | type == "array" else true end)
      and (if has("findings")          then .findings          | type == "array" else true end)
      and (if has("repair_candidates") then .repair_candidates | type == "array" else true end)
      and (if has("repair_feedback")   then .repair_feedback
             | type == "object"
               and (.violations       | type == "array")
               and (.authorized_scopes | type == "array")
             else true end)
      and (if has("demand_anchors") then .demand_anchors
             | type == "object"
               and (.operator_named_paths | type == "array")
               and (.dense_tokens | type == "array")
               and (.search_query | type == "string")
               and (.seed_targets | type == "array")
               and (.seed_source | type == "string")
               and (.content_resonance | type == "array")
               and (if has("goal") then .goal | type == "string" else true end)
               and (if has("targets_header") then .targets_header | type == "array" else true end)
               and (if has("done_when") then .done_when | type == "array" else true end)
             else true end);

    def valid_artifact_snapshot:
      . == null
      or (
        type == "object"
        and ((keys | sort) == [
          "generated_at",
          "investigation_input",
          "mode",
          "operational_context"
        ])
        and (.mode                | nonempty_string)
        and (.investigation_input | nonempty_string)
        and (.generated_at        | nonempty_string)
        and (.operational_context | valid_operational_context)
      );

    def valid_epistemic_state:
      type == "object"
      and ((keys | sort) == [
        "attention_reason",
        "attention_scope",
        "next_attention_targets"
      ])
      and (.next_attention_targets | type == "array" and all(.[]; type == "string"))
      and (.attention_scope  | nonempty_string)
      and (.attention_reason | nonempty_string);

    type == "object"
    and ((keys | sort) == ["artifact_snapshot", "epistemic_state"])
    and (.artifact_snapshot | valid_artifact_snapshot)
    and (.epistemic_state   | valid_epistemic_state)
  ' "${handover_file}" >/dev/null 2>&1 \
    || audit_fatal "unsanitized_handover_state: ${handover_file}"
}

# Provider credentials must never persist into handover state or
# capability payloads.
audit_credential_containment() {

  local surface
  local surfaces=()

  local handover_file="${AEGIS_EPISTEMIC_HANDOVER_FILE:-.harness/runtime/epistemic_handover.json}"
  [[ -f "${handover_file}" ]] && surfaces+=("${handover_file}")

  if [[ -d "${AEGIS_CAPABILITY_PAYLOAD_DIR:-}" ]]; then
    while IFS= read -r surface; do
      surfaces+=("${surface}")
    done < <(find "${AEGIS_CAPABILITY_PAYLOAD_DIR}" -maxdepth 1 -type f 2>/dev/null)
  fi

  [[ "${#surfaces[@]}" -gt 0 ]] || return 0
  [[ -n "${OPENAI_API_KEY:-}" ]] || return 0

  # Payloads legitimately embed repository source that names credential
  # variables; only the secret value itself constitutes a leak.
  for surface in "${surfaces[@]}"; do
    grep -Fq "${OPENAI_API_KEY}" "${surface}" \
      && audit_fatal "credential_value_leak: ${surface}"
  done

  return 0
}

# =========================================================
# BOUNDARY EVALUATION
# =========================================================

BOUNDARY_RESULTS=()

record_boundary() {
  local boundary="$1"
  local produced="$2"
  local consumed="$3"
  local required="$4"
  local status="$5"
  local reason_pass="$6"
  local reason_fail="$7"

  local isolated="false"
  local reason="${reason_fail}"

  if [[ "${status}" == "pass" ]]; then
    isolated="true"
    reason="${reason_pass}"
  fi

  BOUNDARY_RESULTS+=("$(
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
  )")
}

# Evaluate a condition command list into "pass"/"fail".
verdict() {
  if "$@"; then
    printf 'pass'
  else
    printf 'fail'
  fi
}

check_discovery_to_forensics() {
  # Discovery: mechanical runtime only (no .skills/discovery.md).
  # Forensics: skill residual schema + handover/anchors evidence.
  discovery_mechanical_path_ok \
    && skill_declares ".skills/forensics.md" "repair_candidates" \
    && array_contains "filesystem.read:epistemic_handover" "${AEGIS_FORENSICS_EVIDENCE[@]}" \
    && array_contains "runtime.demand_anchors" "${AEGIS_FORENSICS_EVIDENCE[@]}" \
    && runtime_seeds_deterministic_reads
}

check_forensics_to_repair() {
  skill_declares ".skills/forensics.md" "repair_candidates" \
    && mutation_resolver_consumes "repair_candidates"
}

check_repair_to_optimize() {
  # Optimize is advisory (raw): skill declares plan fields; engine is raw.
  skill_declares ".skills/optimize.md" "can_improve" \
    && skill_declares ".skills/optimize.md" "no_improvement_needed" \
    && skill_declares ".skills/optimize.md" "improvements" \
    && grep -Eq '\["optimize"\]="raw"' .harness/config.sh
}

check_optimize_to_adversarial() {
  array_contains "filesystem.read:epistemic_handover" "${AEGIS_ADVERSARIAL_EVIDENCE[@]}" \
    && skill_declares ".skills/adversarial.md" "diff" \
    && skill_declares ".skills/adversarial.md" "files_changed" \
    && grep -Eq 'AEGIS_JQ_ENRICH_OPTIMIZE' scripts/lib/artifact_protocol.sh \
    && grep -Eq 'candidate_result' scripts/lib/artifact_protocol.sh
}

check_adversarial_to_validation() {
  array_contains "filesystem.read:epistemic_handover" "${AEGIS_VALIDATION_EVIDENCE[@]}" \
    && skill_declares ".skills/adversarial.md" "findings" \
    && skill_declares ".skills/validation.md" "findings" \
    && skill_declares ".skills/validation.md" "verdict"
}

main() {

  audit_handover_state
  audit_credential_containment

  record_boundary \
    "Discovery -> Forensics" \
    '["observations","rationale","required_evidence","handover_attention"]' \
    '["runtime.demand_anchors","filesystem.read:epistemic_handover","filesystem.search_symbol","filesystem.read:<anchors>"]' \
    '["required_evidence","handover_attention","operator_named_paths","demand_anchors"]' \
    "$(verdict check_discovery_to_forensics)" \
    "Forensics consumes Discovery routing via handover, demand_anchors, capability payloads, and runtime-owned content anchors." \
    "The producer fields, handover exposure, or deterministic read anchors required by Forensics are absent."

  record_boundary \
    "Forensics -> Repair" \
    '["status","repair_candidates","handover_attention"]' \
    '["repair_candidates"]' \
    '["repair_candidates[].id"]' \
    "$(verdict check_forensics_to_repair)" \
    "Repair consumes explicit repair candidates emitted by Forensics." \
    "Forensics does not require repair_candidates and Repair does not consume them; target continuity depends on optional attention strings."

  record_boundary \
    "Repair -> Optimize" \
    '["diff","files_changed","handover_attention"]' \
    '["filesystem.read:epistemic_handover","REPAIR RESULT","optimize skill plan"]' \
    '["status","improvements","candidate_result(from repair)"]' \
    "$(verdict check_repair_to_optimize)" \
    "Optimize is raw advisory: judges Repair via REPAIR RESULT; can_improve re-enters Repair once; else passthrough." \
    "Optimize skill/engine contract missing (raw + can_improve / no_improvement_needed)."

  record_boundary \
    "Optimize -> Adversarial" \
    '["diff","files_changed","handover_attention"]' \
    '["filesystem.read:epistemic_handover","typescript.check","eslint.check","test.run"]' \
    '["diff","files_changed"]' \
    "$(verdict check_optimize_to_adversarial)" \
    "Adversarial receives the optimized candidate artifact plus tools." \
    "Adversarial cannot observe the Optimize artifact or candidate diff."

  record_boundary \
    "Adversarial -> Validation" \
    '["candidate_result","findings","evidence_refs"]' \
    '["filesystem.read:epistemic_handover"]' \
    '["findings","candidate_result"]' \
    "$(verdict check_adversarial_to_validation)" \
    "Validation consumes an explicit adversarial findings contract and emits a verdict." \
    "Validation can read the handover, but no findings schema is required and the contract forbids treating handover as validation evidence."

  record_boundary \
    "Validation -> Promote" \
    '["verdict","validated_candidate","findings","basis"]' \
    '["runtime.promote_validated_candidate"]' \
    '["verdict","validated diff","files_changed"]' \
    "$(verdict runtime_promotes_validated_diff)" \
    "The runtime applies a validated candidate through an explicit promotion path." \
    "Promotion only replaces epistemic_handover.json; no validated diff is applied to Git or the main worktree."

  printf '%s\n' "${BOUNDARY_RESULTS[@]}" \
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

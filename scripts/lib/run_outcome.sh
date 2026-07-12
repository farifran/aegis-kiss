#!/usr/bin/env bash

# =========================================================
# AEGIS HARNESS — RUN OUTCOME PROJECTION (source-only)
# =========================================================
#
# Classifies fatal/halt tokens into reason_class + next_step,
# prints a short human OUTCOME block, and appends one
# kind:"outcome" line to pipeline_metrics.jsonl.
#
# Does not own orchestration, handover, or persistence.
# next_step is never stored in metrics — only recomputed
# from the static table below.
#
# =========================================================

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "[AEGIS][FATAL] run_outcome_lib_not_invocable" >&2
  exit 1
fi

# Classify a reason_code token into reason_class + next_step.
# Prints: <class>\t<next_step>
# Sets:   AEGIS_OUTCOME_CLASS, AEGIS_OUTCOME_NEXT_STEP
#
# Matching is exact first, then prefix/family patterns.
# Unknown tokens never invent causes — generic inspect-stderr next_step.
aegis_classify_reason() {
  local token="${1:-}"
  local class="unknown"
  local next_step="token não mapeado; inspecione stderr da run"

  case "${token}" in
    investigation_input_mismatch)
      class="operator_input"
      next_step="Handover guarda outra demanda: re-execute run_aegis.sh --fresh '<nova demanda>' para investigation nova, ou repita a demanda anterior byte-idêntica"
      ;;
    investigation_input_conflict)
      class="operator_input"
      next_step="Demanda CLI difere de AEGIS_INVESTIGATION_INPUT; passe só uma"
      ;;
    fresh_resume_conflict)
      class="operator_input"
      next_step="--fresh e --resume são mutuamente exclusivos; escolha um"
      ;;
    missing_provider_api_key)
      class="environment"
      next_step="Defina a API key em .harness/local.env"
      ;;
    missing_provider_api_base)
      class="environment"
      next_step="Defina OPENAI_API_BASE / provider base em .harness/local.env"
      ;;
    missing_aider_binary|missing_aider_model)
      class="environment"
      next_step="Instale/configure aider e o modelo no config"
      ;;
    missing_model|missing_model_configuration)
      class="environment"
      next_step="Configure AEGIS_OPERATOR_MODEL / AEGIS_AIDER_MODEL antes de reexecutar"
      ;;
    provider_authentication_failure)
      class="provider"
      next_step="Verifique validade da key/base do modelo configurado"
      ;;
    provider_http_failure)
      class="provider"
      next_step="Cheque rede/endpoint; status HTTP no stderr; retry"
      ;;
    provider_retry_limit_exceeded)
      class="provider"
      next_step="Provider instável; aguarde e re-execute, ou troque de modelo"
      ;;
    provider_context_length_exceeded)
      class="provider"
      next_step="Reduza evidence budget ou escopo do target"
      ;;
    empty_provider_response)
      class="provider"
      next_step="Re-execute; se persistir, troque de modelo"
      ;;
    invalid_forensics_artifact_contract|invalid_adversarial_artifact_contract|invalid_validation_artifact_contract|invalid_artifact_json|artifact_not_json|artifact_mode_mismatch|missing_artifact|missing_artifact_markers|empty_artifact_payload)
      class="contract"
      next_step="Output do modelo violou o contrato do artifact; re-execute o mode; persistindo, use modelo mais forte"
      ;;
    forensics_repair_candidate_outside_discovery_scope)
      class="scope"
      next_step="Re-execute discovery com target mais amplo que inclua o arquivo citado"
      ;;
    max_repair_attempts_exceeded)
      class="budget"
      next_step="Teto do loop de repair; leia findings no handover, refine a demanda ou aumente AEGIS_MAX_REPAIR_ATTEMPTS"
      ;;
    "forensics inconclusive")
      class="epistemic_halt"
      next_step="Nenhum defeito acionável; refine investigation input ou target"
      ;;
    "no repair candidates in forensics handover")
      class="epistemic_halt"
      next_step="Zero candidatos; refine a demanda"
      ;;
    aider_execution_failed)
      class="mutation"
      next_step="Inspecione stderr do aider; confira .aider.conf e versão do binário"
      ;;
    "")
      class="unknown"
      next_step="inspecione stderr"
      ;;
    *)
      # Prefix / family matches (token may carry a suffix after ':' or '*')
      if [[ "${token}" == empty_diff:* ]]; then
        class="mutation"
        next_step="Substrate não produziu mudança; demanda pode já estar satisfeita — confira worktree/git log antes de repetir"
      elif [[ "${token}" == precondition_failed_* ]]; then
        class="pipeline_state"
        next_step="Artifact upstream ausente/inválido; rode o mode anterior da cadeia"
      elif [[ "${token}" == missing_epistemic_handover_for_mode:* ]] \
        || [[ "${token}" == missing_epistemic_handover_for_mode* ]]; then
        class="pipeline_state"
        next_step="Rode o mode upstream primeiro ou o pipeline completo via run_aegis.sh"
      elif [[ "${token}" == stalling_model_configuration* ]]; then
        class="mutation"
        next_step="Modelo de mutação travando; troque o modelo do substrate"
      elif [[ "${token}" == validated_candidate_promotion_failed* ]] \
        || [[ "${token}" == promotion_target_is_dirty ]] \
        || [[ "${token}" == validated_candidate_apply_failed ]] \
        || [[ "${token}" == validated_candidate_files_changed_mismatch ]] \
        || [[ "${token}" == validated_candidate_apply_check_failed ]] \
        || [[ "${token}" == validated_candidate_paths_unreadable ]] \
        || [[ "${token}" == promotion_dirty_reset_failed ]] \
        || [[ "${token}" == invalid_accepted_validation_artifact ]] \
        || [[ "${token}" == missing_validation_artifact ]] \
        || [[ "${token}" == missing_repository_root ]]; then
        class="promotion"
        next_step="Leia [PROMOTION][DIAG] no stderr; causa típica: worktree sujo ou diff não aplica mais"
      fi
      ;;
  esac

  AEGIS_OUTCOME_CLASS="${class}"
  AEGIS_OUTCOME_NEXT_STEP="${next_step}"
  printf '%s\t%s\n' "${class}" "${next_step}"
}

# Human-facing outcome block (stdout). Recomputes next_step from the table.
# status: SUCCESS | HALTED | FAILED
# reason_code: fatal token, halt string, or empty on SUCCESS
aegis_emit_outcome_block() {
  local status="${1:-}"
  local reason_code="${2:-}"
  local class="—"
  local next_step="—"
  local reason_display="—"

  case "${status}" in
    SUCCESS)
      class="—"
      next_step="—"
      reason_display="—"
      ;;
    *)
      aegis_classify_reason "${reason_code}" >/dev/null
      class="${AEGIS_OUTCOME_CLASS:-unknown}"
      next_step="${AEGIS_OUTCOME_NEXT_STEP:-inspecione stderr}"
      if [[ -n "${reason_code}" ]]; then
        reason_display="${reason_code}"
      else
        reason_display="—"
      fi
      ;;
  esac

  echo
  echo "══════════════════════════════"
  echo "AEGIS OUTCOME"
  echo "══════════════════════════════"
  echo "Status:     ${status}"
  echo "Class:      ${class}"
  echo "Reason:     ${reason_display}"
  echo "Next:       ${next_step}"
  echo "══════════════════════════════"
}

# Append one kind:"outcome" line to the metrics JSONL (best-effort).
# next_step is intentionally NOT stored — recomputable from the table.
aegis_append_outcome_metric() {
  local status="${1:-}"
  local reason_code="${2:-}"
  local class="${3:-}"
  local mode="${4:-}"
  local metrics_file
  local at

  metrics_file="${AEGIS_METRICS_FILE:-${AEGIS_RUNTIME_DIR:-.harness/runtime}/pipeline_metrics.jsonl}"
  at="$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "")"

  mkdir -p "$(dirname "${metrics_file}")" 2>/dev/null || true

  jq -cn \
    --arg status "${status}" \
    --arg reason_code "${reason_code}" \
    --arg reason_class "${class}" \
    --arg mode "${mode}" \
    --arg at "${at}" \
    '{
      kind: "outcome",
      status: $status,
      reason_code: $reason_code,
      reason_class: $reason_class,
      mode: $mode,
      at: $at
    }' \
    >> "${metrics_file}" 2>/dev/null || true
}

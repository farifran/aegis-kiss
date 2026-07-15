#!/usr/bin/env bash

# =========================================================
# AEGIS CAPABILITY — runtime.attention_seed
# =========================================================
#
# Classification: readonly
# Layer: Second-order composition (Layer 0 only)
#
# - require runtime.layer0_facts payload
# - derive attention targets deterministically:
#     resonant hot_files → declared entrypoints → hot_files churn → []
# - emit handover_attention + investigation_scope for Discovery
#
# No LLM. No source reads. No structural.builder.
#
# =========================================================

set -Eeuo pipefail

readonly TARGET_PATH="${1:-.}"
readonly PAYLOAD_DIR="${AEGIS_CAPABILITY_PAYLOAD_DIR:-.harness/runtime/capability_payloads}"
readonly LAYER0_PAYLOAD_FILE="${PAYLOAD_DIR}/runtime_layer0_facts.json"
readonly EXECUTION_ID="${AEGIS_EXECUTION_ID:-unknown}"
readonly MAX_ATTENTION_TARGETS="${AEGIS_ATTENTION_SEED_MAX_TARGETS:-5}"
readonly GENERATED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

if [[ ! -f "${LAYER0_PAYLOAD_FILE}" ]]; then
  jq -n \
    --arg capability "runtime.attention_seed" \
    --arg classification "readonly" \
    --arg execution_id "${EXECUTION_ID}" \
    --arg generated_at "${GENERATED_AT}" \
    --arg target "${TARGET_PATH}" \
    '{
      success: false,
      capability: $capability,
      classification: $classification,
      execution_id: $execution_id,
      generated_at: $generated_at,
      payload: null,
      error: {
        type: "missing_required_predecessor",
        target: "runtime.layer0_facts"
      }
    }'
  exit 0
fi

LAYER0_PAYLOAD_JSON="$(
  jq -c '.payload // {}' "${LAYER0_PAYLOAD_FILE}" 2>/dev/null || printf '{}'
)"

jq -n \
  --arg capability "runtime.attention_seed" \
  --arg classification "readonly" \
  --arg execution_id "${EXECUTION_ID}" \
  --arg generated_at "${GENERATED_AT}" \
  --arg target "${TARGET_PATH}" \
  --arg max_targets "${MAX_ATTENTION_TARGETS}" \
  --argjson layer0 "${LAYER0_PAYLOAD_JSON}" \
  '
    ($max_targets | tonumber) as $max
    | ([($layer0.hot_files // [])[] | select(.resonance == 1)]) as $l0_resonant
    | ($layer0.entrypoints // []) as $l0_declared
    | ($layer0.hot_files // []) as $l0_hot

    | (
        if ($l0_resonant | length) > 0 then
          {
            targets: ([$l0_resonant[] | .file] | unique),
            scope: "layer0:hot_files",
            reason: "git mutation sniffing: churn files resonant with investigation input",
            rule: "layer0_hot_files",
            source: "runtime.layer0_facts.hot_files",
            confidence: "high",
            state: "layer0"
          }
        elif ($l0_declared | length) > 0 then
          {
            targets: ([$l0_declared[] | .file] | unique),
            scope: "layer0:declared_entrypoint",
            reason: "entrypoints declared by project manifests (package.json / tsconfig.json)",
            rule: "declared_entrypoint",
            source: "runtime.layer0_facts.entrypoints",
            confidence: "high",
            state: "layer0"
          }
        elif ($l0_hot | length) > 0 then
          {
            targets: ([$l0_hot[] | .file] | unique),
            scope: "layer0:hot_files",
            reason: "highest-churn files under evidence target (no resonant match)",
            rule: "layer0_hot_files_churn",
            source: "runtime.layer0_facts.hot_files",
            confidence: "medium",
            state: "layer0"
          }
        else
          {
            targets: [],
            scope: "none",
            reason: "no layer0 targets available",
            rule: "none",
            source: "none",
            confidence: "none",
            state: "none"
          }
        end
      ) as $sel0

    # Alvo unico: collapse multi-seed Layer0 attention to one focus path.
    | (
        if (($sel0.targets // []) | length) <= 1 then $sel0
        else
          (
            [($sel0.targets // [])[]
              | select(test("(^|/)index\\.(ts|tsx|js|jsx)$"))]
          ) as $entry
          | if ($entry | length) > 0 then
              ($sel0
                | .targets = $entry[0:1]
                | .reason = ((.reason // "") + " [alvo unico: entrypoint]"))
            else
              ($sel0
                | .targets = .targets[0:1]
                | .reason = ((.reason // "") + " [alvo unico: top seed]"))
            end
        end
      ) as $sel

    | ($sel.targets[0:$max]) as $capped

    | ({
        scope_type: (if $sel.state == "layer0" then "layer0"
                     else "none" end),
        scope_targets: $capped,
        scope_confidence: $sel.confidence
      }) as $investigation_scope

    | ([
        (if ($sel.state == "none") then "no layer0 targets available" else empty end)
      ]) as $blocking_conditions

    | {
        success: true,
        capability: $capability,
        classification: $classification,
        execution_id: $execution_id,
        generated_at: $generated_at,
        payload: {
          target: $target,
          selection_rule: $sel.rule,
          attention_state: ($sel.state // "none"),
          attention_source: $sel.source,
          attention_confidence: $sel.confidence,
          ambiguous_candidates: [],
          handover_attention: {
            next_attention_targets: $capped,
            attention_scope: $sel.scope,
            attention_reason: $sel.reason
          },
          investigation_plan: {
            primary_targets: ($capped | unique),
            secondary_targets: [],
            excluded_targets: []
          },
          investigation_scope: $investigation_scope,
          blocking_conditions: $blocking_conditions,
          attention_targets: $capped,
          relevant_surfaces: [],
          critical_relationships: []
        },
        error: null
      }
  '

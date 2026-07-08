#!/usr/bin/env bash

# =========================================================
# AEGIS CAPABILITY — runtime.attention_seed
# =========================================================
#
# Classification:
# readonly
#
# Layer: Second-order composition
#
# Responsibilities:
#
# - consume the structural.builder payload already materialized
#   in the capability payload directory
# - derive attention targets deterministically using the rule:
#
#     if observed_request_alignment.resolved_paths is non-empty
#         attention = resolved_paths (explicit request)
#     else if hotspots exist
#         attention = top hotspot files
#     else if bridges exist
#         attention = bridge endpoint files
#     else if entrypoints exist
#         attention = entrypoint files
#     else
#         attention = [] (no targets)
#
# - emit a handover_attention object consumable verbatim by
#   the Discovery mode and by runtime_aegis.sh for epistemic
#   handover promotion
#
# This capability intentionally:
#
# - performs no LLM calls or semantic inference
# - performs no filesystem reads of source code
# - derives attention from topology mathematics and request
#   alignment only
# - removes model judgment from attention selection
#
# =========================================================

set -Eeuo pipefail

# =========================================================
# INPUTS
# =========================================================

readonly TARGET_PATH="${1:-.}"

# =========================================================
# CONFIGURATION
# =========================================================

readonly PAYLOAD_DIR="${AEGIS_CAPABILITY_PAYLOAD_DIR:-.harness/runtime/capability_payloads}"
readonly BUILDER_PAYLOAD="${PAYLOAD_DIR}/structural_builder.json"
readonly EXECUTION_ID="${AEGIS_EXECUTION_ID:-unknown}"
readonly MAX_ATTENTION_TARGETS="${AEGIS_ATTENTION_SEED_MAX_TARGETS:-5}"
readonly GENERATED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

# =========================================================
# MISSING BUILDER PAYLOAD — fail-fast
# structural.builder is a required predecessor. If its payload
# is missing, attention_seed cannot derive attention deterministically.
# Emit success: false so validate_materialized_payload aborts before
# the LLM is called. This prevents degraded artifacts.
# =========================================================

if [[ ! -f "${BUILDER_PAYLOAD}" ]]; then
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
        target: "structural.builder"
      }
    }'
  exit 0
fi

# =========================================================
# DETERMINISTIC ATTENTION SELECTION
# Rule: explicit > hotspot > bridge > entrypoint > none
# =========================================================

# Layer 0 recognition priors (optional predecessor payload).
LAYER0_PAYLOAD_JSON="$(
  jq -c '.payload // {}' "${PAYLOAD_DIR}/runtime_layer0_facts.json" 2>/dev/null \
    || printf '{}'
)"

jq -n \
  --arg capability "runtime.attention_seed" \
  --arg classification "readonly" \
  --arg execution_id "${EXECUTION_ID}" \
  --arg generated_at "${GENERATED_AT}" \
  --arg target "${TARGET_PATH}" \
  --arg max_targets "${MAX_ATTENTION_TARGETS}" \
  --slurpfile builder "${BUILDER_PAYLOAD}" \
  --argjson layer0 "${LAYER0_PAYLOAD_JSON}" \
  '
    ($builder[0].payload // {}) as $bp
    | ($bp.observed_request_alignment // {}) as $ora
    | ($ora.resolved_paths // []) as $resolved
    | ($ora.path_resolutions // []) as $path_res
    | ($bp.topology_index // {}) as $ti
    | ($ti.hotspots // []) as $hotspots
    | ($ti.bridges // []) as $bridges
    | ($ti.entrypoints // []) as $entrypoints
    | ([($layer0.hot_files // [])[] | select(.resonance == 1)]) as $l0_resonant
    | ($layer0.entrypoints // []) as $l0_declared
    | ($max_targets | tonumber) as $max

    # --- determine if explicit paths are exact or ambiguous ---
    # path_resolutions carries match_type per requested path.
    # A path is only a confirmed target if match_type == "exact".
    # Ambiguous paths have resolved: null — they are NOT targets.
    | (
        [$path_res[] | select(.match_type == "exact" and .resolved != null) | .resolved] as $exact_targets
        | [$path_res[] | select(.match_type == "ambiguous")] as $ambiguous_resolutions
        | ($ambiguous_resolutions | length > 0) as $has_amb
        | [$ambiguous_resolutions[] | .candidates[]? | .path] as $amb_cands
        | {
            exact_targets: $exact_targets,
            has_ambiguous: $has_amb,
            ambiguous_candidates: ($amb_cands | unique)
          }
      ) as $path_analysis

    # --- deterministic selection ---
    # Rule: exact_explicit > hotspot > bridge > entrypoint > none
    # Ambiguous paths do NOT produce targets — they produce
    # attention_state: "ambiguous" with candidates for Forensics to resolve.
    | (
        if ($path_analysis.exact_targets | length) > 0 then
          {
            targets: $path_analysis.exact_targets,
            scope: "explicit_request",
            reason: "observed_request_alignment exact match",
            rule: "explicit_request",
            source: "observed_request_alignment",
            confidence: "high",
            state: "resolved"
          }
        elif ($l0_resonant | length) > 0 then
          {
            targets: ([$l0_resonant[] | .file] | unique),
            scope: "layer0:hot_files",
            reason: "git mutation sniffing: churn files resonant with investigation input",
            rule: "layer0_hot_files",
            source: "runtime.layer0_facts.hot_files",
            confidence: "high",
            state: "layer0"
          }
        elif $path_analysis.has_ambiguous then
          # Ambiguous path requested but no exact winner.
          # Fall through to topology, but mark attention as ambiguous.
          {
            targets: ([$hotspots[] | .file] | unique),
            scope: "topology:hotspot",
            reason: "explicit path ambiguous, falling back to topology",
            rule: "hotspot_fallback",
            source: "topology_index.hotspots",
            confidence: "medium",
            state: "ambiguous",
            ambiguous_candidates: $path_analysis.ambiguous_candidates
          }
        elif ($hotspots | length) > 0 then
          {
            targets: ([$hotspots[] | .file] | unique),
            scope: "topology:hotspot",
            reason: "highest degree nodes selected as attention seed",
            rule: "hotspot",
            source: "topology_index.hotspots",
            confidence: "medium",
            state: "topology"
          }
        elif ($bridges | length) > 0 then
          {
            targets: ([$bridges[] | .from, .to] | unique),
            scope: "topology:bridge",
            reason: "bridge endpoints selected as attention seed",
            rule: "bridge",
            source: "topology_index.bridges",
            confidence: "medium",
            state: "topology"
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
        elif ($entrypoints | length) > 0 then
          {
            targets: ([$entrypoints[] | .file] | unique),
            scope: "topology:entrypoint",
            reason: "entrypoints selected as attention seed",
            rule: "entrypoint",
            source: "topology_index.entrypoints",
            confidence: "low",
            state: "topology"
          }
        else
          {
            targets: [],
            scope: "none",
            reason: "no explicit or topology targets available",
            rule: "none",
            source: "none",
            confidence: "none",
            state: "none"
          }
        end
      ) as $sel

    | ($sel.targets[0:$max]) as $capped

    # --- investigation plan ---
    # primary_targets: canonical exact-match targets (highest confidence)
    # secondary_targets: topology-derived targets (hotspot/bridge/entrypoint)
    # excluded_targets: standalone surfaces with no observed relationships
    | (
        if $sel.rule == "explicit_request" then
          {
            primary: $path_analysis.exact_targets,
            secondary: ([$hotspots[] | .file] | unique)
          }
        elif $sel.state == "ambiguous" then
          {
            primary: [],
            secondary: $capped
          }
        else
          {
            primary: $capped,
            secondary: []
          }
        end
      ) as $plan_split

    # --- operational compression (deterministic, no model judgment) ---
    # These fields compress topology into the minimal context downstream
    # modes need. Derived purely from builder payload data.
    # Discovery copies them verbatim — no generation required.

    # investigation_scope: projection of request alignment + attention state
    | ({
        scope_type: ($sel.state | if . == "resolved" then "explicit_request"
                      elif . == "ambiguous" then "ambiguous"
                      elif . == "layer0" then "layer0"
                      elif . == "topology" then "topology"
                      else "none" end),
        scope_targets: $capped,
        scope_confidence: $sel.confidence
      }) as $investigation_scope

    # blocking_conditions: factual conditions that impede investigation
    | ([
        (if $path_analysis.has_ambiguous then "requested path resolves to multiple candidates" else empty end),
        (if ($bp.evidence.payload_status.consumed_payload_missing_count // 0) > 0 then "required evidence payload missing" else empty end),
        (if ($sel.state == "none") then "no topology targets available" else empty end)
      ]) as $blocking_conditions

    # attention_targets: hotspots in the investigation scope
    | ([$hotspots[] | select(.file | IN($capped[])) | .file] | unique) as $attention_targets

    # relevant_surfaces: surfaces containing attention or scope targets
    | ([($capped + $attention_targets) | unique | .[] | $ti.node_index[.] | .surface_ref // empty] | [.[] | select(. != null and startswith("surface_cluster_"))] | unique) as $relevant_surfaces

    # critical_relationships: bridges connecting relevant surfaces
    | ([$bridges[] | select(.surface_ref as $s | $relevant_surfaces | index($s)) | {type: "bridge", id: .id, from: .from, to: .to}]) as $critical_relationships

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
          ambiguous_candidates: ($sel.ambiguous_candidates // []),
          handover_attention: {
            next_attention_targets: $capped,
            attention_scope: $sel.scope,
            attention_reason: $sel.reason
          },
          investigation_plan: {
            primary_targets: ($plan_split.primary | unique),
            secondary_targets: ($plan_split.secondary[0:$max] | unique),
            excluded_targets: []
          },
          # --- operational compression (copy verbatim into Discovery output) ---
          investigation_scope: $investigation_scope,
          blocking_conditions: $blocking_conditions,
          attention_targets: $attention_targets,
          relevant_surfaces: $relevant_surfaces,
          critical_relationships: $critical_relationships
        },
        error: null
      }
  '

#!/usr/bin/env bash

# =========================================================
# AEGIS HARNESS — ARTIFACT PROTOCOL (source-only)
# =========================================================
#
# Contract validation, tribunal gates, and minimal cognitive
# artifact enrichment. Sourced by scripts/execute_mode.sh.
# Does not own orchestration or capability materialization.
#
# =========================================================

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "[AEGIS][FATAL] artifact_protocol_lib_not_invocable" >&2
  exit 1
fi

# Path regex and extract helpers live in common.sh (sourced first by execute_mode).
if [[ -z "${AEGIS_SOURCE_PATH_RE:-}" ]] \
  || ! declare -f aegis_extract_operator_named_paths_json >/dev/null 2>&1; then
  echo "[AEGIS][FATAL] artifact_protocol_requires_common_lib" >&2
  exit 1
fi

# =========================================================
# ARTIFACT VALIDATION
# =========================================================

# Shared jq diff normalizer — tolerates escaping/whitespace/hunk-header
# drift when comparing candidate diffs across mode boundaries.
readonly AEGIS_JQ_DIFF_NORM='def norm(s): s | gsub("\\\\r"; "") | gsub("\\r"; "") | gsub("\\\\n"; "") | gsub("\\n"; "") | gsub("\\\\\\\\"; "") | gsub("\\\\"; "") | gsub("[[:space:]]+"; "") | gsub("Nonewlineatendoffile"; "") | gsub("@@[^@]+@@[^\n]*"; "@@");'

# Shared jq projection of the topology targets a Discovery handover
# authorizes for Forensics repair candidates.
#
# Operator-named paths use the same pattern family as AEGIS_SOURCE_PATH_RE
# in common.sh (bash helper; this jq keeps explicit escapes). Placeholder
# model evidence (e.g. "<file>") cannot authorize garbage or net-new ghosts.
readonly AEGIS_JQ_AUTHORIZED_TARGETS='def is_real_repo_path:
  type == "string"
  and length > 0
  and (contains("<") | not)
  and (contains(">") | not)
  and (test("^[A-Za-z0-9_./-]+\\.(ts|tsx|js|jsx|mjs|cjs|sh|py)$"));

def operator_named_paths:
  ((.artifact_snapshot.investigation_input // "") | tostring) as $inv
  | [$inv | match("[A-Za-z0-9_./-]+\\.(ts|tsx|js|jsx|mjs|cjs|sh|py)"; "g") | .string]
  | map(sub("^\\./"; ""))
  | map(select(is_real_repo_path))
  | unique;

def authorized_targets:
  (
    [
      # Mechanical only: operator-named + attention. required_evidence is
      # already filtered at discovery enrich (named ∪ seed); still listed
      # so net-new operator paths requested as reads stay authorized.
      (operator_named_paths[]?),
      (.artifact_snapshot.operational_context.operator_named_paths[]?),
      (.artifact_snapshot.operational_context.required_evidence[]?
        | select(type == "string" and startswith("filesystem.read:"))
        | ltrimstr("filesystem.read:")),
      .epistemic_state.next_attention_targets[]?
    ]
    | map(select(is_real_repo_path))
    | unique
  );'

extract_substrate_artifact() {

  local output="${AEGIS_SUBSTRATE_OUTPUT}"

  [[ "${output}" == *"${AEGIS_ARTIFACT_BEGIN_MARKER}"* ]] || return 0
  [[ "${output}" == *"${AEGIS_ARTIFACT_END_MARKER}"* ]] || return 0

  output="${output#*"${AEGIS_ARTIFACT_BEGIN_MARKER}"}"
  printf '%s' "${output%%"${AEGIS_ARTIFACT_END_MARKER}"*}"
}

# Print a labelled mismatch dump: alternating description/JSON pairs.
dump_mismatch() {
  local label="$1"
  shift

  echo "[DEBUG] ${label} details:" >&2
  while [[ "$#" -gt 1 ]]; do
    echo "[DEBUG] $1:" >&2
    printf '%s\n' "$2" | jq -c '.' >&2 || printf '%s\n' "$2" >&2
    shift 2
  done
}

# Soft fixes for floor models before contract checks.
# Mutates the artifact string via nameref-compatible stdout.
normalize_weak_model_artifact_status() {
  local artifact="$1"

  case "${AEGIS_MODE}" in
    forensics)
      local status num_candidates
      status="$(echo "${artifact}" | jq -r '.status // empty')"
      if [[ "${status}" == *"|"* || -z "${status}" ]]; then
        num_candidates="$(echo "${artifact}" | jq '.repair_candidates | length')"
        if [[ "${num_candidates}" -gt 0 ]]; then
          artifact="$(echo "${artifact}" | jq '.status = "interpreted" | .handover_attention.next_attention_targets = [.repair_candidates[].id]')"
        else
          artifact="$(echo "${artifact}" | jq '.status = "inconclusive"')"
        fi
      fi
      ;;
    discovery)
      local next_targets_len
      next_targets_len="$(echo "${artifact}" | jq '.handover_attention.next_attention_targets | length')"
      if [[ "${next_targets_len}" -eq 0 ]]; then
        artifact="$(echo "${artifact}" | jq '
          .handover_attention.next_attention_targets = (.attention_targets // .investigation_scope.scope_targets // [])
        ')"
      fi
      ;;
    validation)
      # LLM residual path only: inject missing arrays so enrich can rewrite.
      artifact="$(echo "${artifact}" | jq '
        .findings = (if (.findings | type) == "array" then .findings else [] end)
        | .basis = (
            if (.basis | type) == "array" then .basis
            elif (.basis | type) == "string" and (.basis | length) > 0 then [.basis]
            else [] end
          )
        | .verdict = (
            if (.verdict == "accepted" or .verdict == "rejected") then .verdict
            else "rejected" end
          )
      ' 2>/dev/null || printf '%s' "${artifact}")"
      ;;
  esac

  printf '%s' "${artifact}"
}

assert_artifact_mode_matches() {
  local artifact="$1"
  local artifact_mode
  artifact_mode="$(echo "${artifact}" | jq -r '.mode // empty')"
  [[ "${artifact_mode}" == "${AEGIS_MODE}" ]] \
    || aegis_fatal "artifact_mode_mismatch"
}

# Shared contract fragments for adversarial/validation (embedded into jq -e).
readonly AEGIS_JQ_OPTIMIZE_CANDIDATE_OK='type == "object" and .source_mode == "optimize" and (.diff | type == "string" and length > 0) and (.files_changed | type == "array" and length > 0) and all(.files_changed[]; type == "string" and length > 0)'
readonly AEGIS_JQ_HANDOVER_ATTENTION_OK='(.handover_attention | type == "object") and (.handover_attention.next_attention_targets | type == "array") and (.handover_attention.attention_scope | type == "string" and length > 0) and (.handover_attention.attention_reason | type == "string" and length > 0)'

# Continuity gate: same source_mode + files_changed + normalized diff.
# field: candidate_result | validated_candidate
assert_candidate_continuity() {
  local artifact="$1"
  local field="$2"
  local previous_candidate="$3"
  local mismatch_fatal="$4"

  case "${field}" in
    candidate_result|validated_candidate) ;;
    *) aegis_fatal "assert_candidate_continuity_unknown_field" ;;
  esac

  if echo "${artifact}" \
    | jq -e \
      --argjson previous_candidate "${previous_candidate}" \
      --arg field "${field}" \
      "${AEGIS_JQ_DIFF_NORM}"'
        (.[$field]) as $cand
        | ($cand.source_mode == $previous_candidate.source_mode)
        and ($cand.files_changed == $previous_candidate.files_changed)
        and (norm($cand.diff) == norm($previous_candidate.diff))
      ' >/dev/null 2>&1; then
    return 0
  fi

  if [[ "${field}" == "candidate_result" ]]; then
    echo "[DEBUG] ${mismatch_fatal} details:" >&2
    echo "[DEBUG] Expected candidate:" >&2
    echo "${previous_candidate}" | jq -c '.' >&2
    echo "[DEBUG] Actual candidate received:" >&2
    echo "${artifact}" | jq -c --arg field "${field}" '.[$field]' >&2
  fi
  aegis_fatal "${mismatch_fatal}"
}

validate_forensics_artifact() {
  local artifact="$1"

  if ! echo "${artifact}" \
    | jq -e '
        (.status == "interpreted" or .status == "inconclusive")
        and (
          .repair_candidates
          | type == "array"
          and all(
            type == "object"
            and ((keys | sort) == ["evidence_refs", "id", "reason"])
            and (.id | type == "string" and length > 0)
            and (.reason | type == "string" and length > 0)
            and (.evidence_refs | type == "array" and length > 0)
            and all(.evidence_refs[]; type == "string" and length > 0)
          )
        )
        and (
          .handover_attention
          | type == "object"
          and (.next_attention_targets | type == "array")
          and (.attention_scope | type == "string" and length > 0)
          and (.attention_reason | type == "string" and length > 0)
        )
        and (
          .status == "inconclusive"
          or (
            [.repair_candidates[].id]
            == .handover_attention.next_attention_targets
          )
        )
      ' >/dev/null 2>&1; then
    dump_mismatch "invalid_forensics_artifact_contract" "Artifact" "${artifact}"
    aegis_fatal "invalid_forensics_artifact_contract"
  fi

  local previous_discovery
  previous_discovery="$(
    jq -c '.' "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT}"
  )"

  if ! echo "${artifact}" \
    | jq -e \
      --argjson previous_discovery "${previous_discovery}" \
      "${AEGIS_JQ_AUTHORIZED_TARGETS}"'
      ($previous_discovery.artifact_snapshot.mode == "discovery")
      and (
        $previous_discovery | authorized_targets
      ) as $authorized_targets
      | all(
          .repair_candidates[];
          . as $candidate
          | $authorized_targets
          | index($candidate.id) != null
        )
    ' >/dev/null 2>&1; then
    dump_mismatch "forensics_repair_candidate_outside_discovery_scope" \
      "Authorized targets" \
      "$(echo "${previous_discovery}" | jq -c "${AEGIS_JQ_AUTHORIZED_TARGETS} authorized_targets")" \
      "Forensics repair candidates" \
      "$(echo "${artifact}" | jq -c '.repair_candidates')"
    aegis_fatal "forensics_repair_candidate_outside_discovery_scope"
  fi
}

validate_adversarial_artifact() {
  local artifact="$1"

  if ! echo "${artifact}" \
    | jq -e \
      "(.status == \"challenged\" or .status == \"verified\" or .status == \"inconclusive\")
       and (.candidate_result | (${AEGIS_JQ_OPTIMIZE_CANDIDATE_OK}))
       and (.findings | type == \"array\")
       and (.evidence_refs | type == \"array\")
       and (${AEGIS_JQ_HANDOVER_ATTENTION_OK})" \
      >/dev/null 2>&1; then
    dump_mismatch "invalid_adversarial_artifact_contract" "Artifact" "${artifact}"
    aegis_fatal "invalid_adversarial_artifact_contract"
  fi

  local previous_optimized_candidate
  previous_optimized_candidate="$(
    jq -c '
      .artifact_snapshot
      | {
          source_mode: .mode,
          diff: .operational_context.candidate_result.diff,
          files_changed: .operational_context.candidate_result.files_changed
        }
    ' "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT}"
  )"

  assert_candidate_continuity \
    "${artifact}" \
    "candidate_result" \
    "${previous_optimized_candidate}" \
    "adversarial_candidate_mismatch"
}

validate_validation_artifact() {
  local artifact="$1"

  if ! echo "${artifact}" \
    | jq -e \
      "(.verdict == \"accepted\" or .verdict == \"rejected\" or .verdict == \"insufficient\")
       and (.findings | type == \"array\")
       and (.basis | type == \"array\")
       and (.validated_candidate | (${AEGIS_JQ_OPTIMIZE_CANDIDATE_OK}))
       and (${AEGIS_JQ_HANDOVER_ATTENTION_OK})" \
      >/dev/null 2>&1; then
    dump_mismatch "invalid_validation_artifact_contract" "Artifact" "${artifact}"
    aegis_fatal "invalid_validation_artifact_contract"
  fi

  # Full mutation: adversarial leaves candidate_result + findings.
  # mutation_lite: repair leaves diff/files_changed only — synthesize the
  # same envelope enrich uses (source_mode=optimize) so continuity holds.
  local previous_candidate
  previous_candidate="$(
    jq -c '
      .artifact_snapshot as $snap
      | (
          $snap.operational_context.candidate_result
          // $snap.candidate_result
          // (if ($snap.operational_context.diff | type == "string") then
               {
                 diff: $snap.operational_context.diff,
                 files_changed: ($snap.operational_context.files_changed // []),
                 intent_violations: (
                   $snap.operational_context.intent_violations
                   // $snap.intent_violations
                   // []
                 )
               }
             else null end)
        )
      | if . != null then
          .source_mode = "optimize"
          | .intent_violations = (
              .intent_violations
              // $snap.operational_context.intent_violations
              // $snap.intent_violations
              // []
            )
        else empty end
    ' "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT}"
  )"

  [[ -n "${previous_candidate}" ]] \
    || aegis_fatal "missing_adversarial_candidate_result"

  assert_candidate_continuity \
    "${artifact}" \
    "validated_candidate" \
    "${previous_candidate}" \
    "validation_candidate_mismatch"

  # mutation_lite has no adversarial pass — empty findings is valid.
  local previous_findings
  previous_findings="$(
    jq -c '
      .artifact_snapshot.operational_context.findings
      // .artifact_snapshot.findings
      // []
    ' "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT}"
  )"
  if [[ -z "${previous_findings}" ]]; then
    previous_findings='[]'
  fi

  # Core identity only: the runtime tribunal may downgrade
  # supported_by_evidence / severity when quotations contradict the
  # candidate diff or tools are mutation-clean. Type + description must
  # still match the adversarial set (model cannot invent new findings).
  if ! echo "${artifact}" \
    | jq -e \
      --argjson previous_findings "${previous_findings}" \
      '
        def core: map({type: (.type // null), description: (.description // null)});
        ((.findings // []) | core) == ($previous_findings | core)
      ' \
      >/dev/null 2>&1; then
    echo "[DEBUG] validation_findings_mismatch details:" >&2
    echo "[DEBUG] Expected findings:" >&2
    echo "${previous_findings}" | jq -c '.' >&2
    echo "[DEBUG] Actual findings received:" >&2
    echo "${artifact}" | jq -c '.findings' >&2
    aegis_fatal "validation_findings_mismatch"
  fi
}

validate_artifact() {

  local artifact

  artifact="$(extract_substrate_artifact)"

  [[ -n "${artifact}" ]] \
    || aegis_fatal "missing_artifact_payload"

  echo "${artifact}" \
    | jq empty \
      >/dev/null 2>&1 \
      || aegis_fatal "invalid_artifact_json"

  artifact="$(normalize_weak_model_artifact_status "${artifact}")"
  assert_artifact_mode_matches "${artifact}"

  case "${AEGIS_MODE}" in
    forensics)
      validate_forensics_artifact "${artifact}"
      ;;
    adversarial)
      validate_adversarial_artifact "${artifact}"
      ;;
    validation)
      validate_validation_artifact "${artifact}"
      ;;
    discovery)
      # Discovery contract is enforced by enrich + soft normalize above;
      # no additional structural gate beyond mode match / valid JSON.
      ;;
    *)
      # Other readonly modes (if any) share the base JSON + mode checks.
      ;;
  esac

  aegis_log "Payload validated successfully"
}


validate_mutation_artifact() {

  local artifact

  artifact="$(extract_substrate_artifact)"

  [[ -n "${artifact}" ]] \
    || aegis_fatal "missing_mutation_artifact_payload"

  echo "${artifact}" \
    | jq empty \
      >/dev/null 2>&1 \
      || aegis_fatal "invalid_mutation_artifact_json"

  local artifact_mode
  artifact_mode="$(
    echo "${artifact}" | jq -r '.mode // empty'
  )"

  [[ "${artifact_mode}" == "${AEGIS_MODE}" ]] \
    || aegis_fatal "mutation_artifact_mode_mismatch"

  # Accept either the raw mutation surface shape (diff/files_changed) or
  # the post-normalize candidate_result envelope used by optimize.
  echo "${artifact}" \
    | jq -e '
        (
          (.diff | type == "string" and length > 0 and . != "(no changes)")
          or (
            .candidate_result.diff
            | type == "string" and length > 0 and . != "(no changes)"
          )
        )
        and (
          ((.files_changed | type == "array" and length > 0)
            or (.candidate_result.files_changed | type == "array" and length > 0))
        )
      ' >/dev/null 2>&1 \
    || aegis_fatal "mutation_artifact_missing_diff_or_files_changed"

  aegis_log "Mutation artifact validated successfully"
}

# =========================================================
# OUTPUT
# =========================================================

# =========================================================
# TRIBUNAL GATES (deterministic, model-independent)
#
# Floor models invent logic_bug findings that contradict the candidate
# diff and treat baseline TS errors outside files_changed as candidate
# defects. The runtime owns the final blocking judgment:
#   1. quotations in finding descriptions must appear in the candidate
#      diff when the finding claims implementation content;
#   2. tool failures only block when they touch mutation files;
#   3. after sanitization, empty blocking set ⇒ verified/accepted.
# =========================================================

# Builds a JSON gate object from materialised capability payloads and the
# candidate files_changed list. Safe when payloads are absent.
build_tribunal_tools_gate() {
  local files_changed_json="${1:-[]}"
  local payload_dir="${AEGIS_CAPABILITY_PAYLOAD_DIR:-}"

  local ts_payload="${payload_dir}/typescript_check.json"
  local eslint_payload="${payload_dir}/eslint_check.json"
  local test_payload="${payload_dir}/test_run.json"

  local ts_json='{"payload":{"status":"skipped","errors":[]}}'
  local eslint_json='{"payload":{"status":"skipped"}}'
  local test_json='{"payload":{"status":"skipped"}}'

  [[ -f "${ts_payload}" ]] && ts_json="$(cat "${ts_payload}")"
  [[ -f "${eslint_payload}" ]] && eslint_json="$(cat "${eslint_payload}")"
  [[ -f "${test_payload}" ]] && test_json="$(cat "${test_payload}")"

  jq -n \
    --argjson files "${files_changed_json}" \
    --argjson ts "${ts_json}" \
    --argjson eslint "${eslint_json}" \
    --argjson test "${test_json}" \
    '
      def norm_path: gsub("^\\./"; "");
      def in_scope($f):
        ($f | norm_path) as $fp
        | any($files[]?; (. | norm_path) == $fp
              or ($fp | startswith((. | norm_path) + "/")));

      ($ts.payload.status // "skipped") as $ts_status
      | ($eslint.payload.status // "skipped") as $es_status
      | ($test.payload.status // "skipped") as $test_status
      | [($ts.payload.errors // [])[] | select(.file != null and in_scope(.file))] as $ts_in_scope
      | [($eslint.payload.errors // [])[] | select(.file != null and in_scope(.file))] as $es_in_scope
      | {
          typescript_status: $ts_status,
          eslint_status: $es_status,
          test_status: $test_status,
          typescript_errors_in_scope: $ts_in_scope,
          eslint_errors_in_scope: $es_in_scope,
          mutation_clean: (
            ($ts_status != "failed" or ($ts_in_scope | length) == 0)
            and ($es_status != "failed" or ($es_in_scope | length) == 0)
            and ($test_status != "failed")
          )
        }
    ' 2>/dev/null || printf '%s' '{"mutation_clean":true,"typescript_status":"skipped","eslint_status":"skipped","test_status":"skipped","typescript_errors_in_scope":[],"eslint_errors_in_scope":[]}'
}

# =========================================================
# MINIMAL COGNITIVE ARTIFACT ENRICHMENT
#
# Models emit minimal cognitive fields; runtime injects mode, evidence,
# candidates, attention (runtime-owned fields).
#
#   load_artifact_enrichment_context → enrich_cognitive_artifact (per-mode)
#   → rewrite_substrate_output_with_artifact → normalize_substrate_output
# =========================================================

# Shared jq defs for all mode enrichers (piped once per enrich call).
readonly AEGIS_JQ_ENRICH_LIB='
  def drop_empty:
    with_entries(select(
      (.value != null)
      and ((.value | type) != "array" or (.value | length) > 0)
    ));

  def sanitize_required_evidence:
    map(select(
      type == "string"
      and startswith("filesystem.read:")
      and (.[16:] | length > 0)
      and (.[16:] | contains("<") | not)
      and (.[16:] | contains(">") | not)
      and (.[16:] | test("^[A-Za-z0-9_./-]+\\.(ts|tsx|js|jsx|mjs|cjs|sh|py)$"))
    ));

  # Keep model required_evidence only when the path is mechanical:
  #   - operator-named in investigation input, or
  #   - Layer0/attention seed target ($anchors).
  # Do NOT admit arbitrary on-disk paths the model invents (e.g. fake_import).
  # Always union operator-named as filesystem.read: entries.
  # Bootstrap: when both named and anchors are empty, allow on-disk model
  # paths so a seed-less tree can still request first reads.
  def merge_operator_required_evidence($req; $named; $anchors; $existing):
    (($named + $anchors) | unique) as $mechanical
    | ($req
      | sanitize_required_evidence
      | map(select(
          (.[16:] as $p
            | if ($mechanical | length) > 0 then
                (($mechanical | index($p)) != null)
              else
                (($existing | index($p)) != null)
              end)
        )))
    + ($named | map("filesystem.read:" + .))
    | unique;

  # Collapse multi-candidate forensics when operator named 0–1 paths.
  # $seed (Layer0/attention) participates when named is empty/single.
  def prefer_alvo_unico($cands; $named; $seed):
    if ($named | length) >= 2 then $cands
    elif ($cands | length) <= 1 then $cands
    else
      (if ($named | length) == 1 then
        ($cands | map(select(.id == $named[0])) | .[0:1])
       elif ($seed | length) == 1 then
        ($cands | map(select(.id == $seed[0])) | .[0:1])
       else [] end) as $anchor_hit
      | if ($anchor_hit | length) > 0 then $anchor_hit
        else
          ($cands
            | map(select(.id | test("(^|/)index\\.(ts|tsx|js|jsx)$")))
            | .[0:1]) as $entry
          | if ($entry | length) > 0 then $entry else $cands[0:1] end
        end
    end;

  # Dense-token gate for forensics reasons (models invent "add power function").
  def reason_mentions_tokens($reason; $tokens):
    (($reason // "") | ascii_downcase) as $r
    | ($tokens | length) > 0
      and any($tokens[]; . as $t | ($t | length) >= 4 and ($r | contains($t)));

  def mechanical_demand_reason($tokens; $inv):
    if ($tokens | length) > 0 then
      "Demand: " + ($tokens | .[0:3] | join(" ")) + " (one new export)"
    else
      "Demand: apply investigation (one new export)"
    end;

  def bind_forensics_reasons($cands; $tokens; $inv):
    $cands
    | map(
        if reason_mentions_tokens(.reason; $tokens) then .
        else . + {reason: mechanical_demand_reason($tokens; $inv)}
        end
      );

  # When a single mechanical alvo exists (named or seed), force that id —
  # model path invent / stale reasons cannot expand or divert the target.
  def force_single_anchor_candidate($cands; $named; $seed; $tokens; $inv; $evidence_refs):
    (if ($named | length) == 1 then $named[0]
     elif ($named | length) == 0 and ($seed | length) == 1 then $seed[0]
     else null end) as $alvo
    | if $alvo == null then $cands
      else
        ([$cands[] | select(.id == $alvo)][0] // null) as $hit
        | [{
            id: $alvo,
            reason: (
              if $hit != null and reason_mentions_tokens($hit.reason; $tokens)
              then $hit.reason
              else mechanical_demand_reason($tokens; $inv)
              end
            ),
            evidence_refs: $evidence_refs
          }]
      end;

  # Drop invent-net-new candidates; remap empty set onto primary scope path.
  def clamp_forensics_scope($cands; $scope; $evidence_refs):
    ($cands | map(select(.id as $id | ($scope | index($id)) != null))) as $in
    | if ($in | length) > 0 then $in
      elif ($scope | length) > 0 and ($cands | length) > 0 then
        [{
          id: $scope[0],
          reason: ($cands[0].reason // "scoped to attention"),
          evidence_refs: $evidence_refs
        }]
      else $cands end;

  def added_export_names($diff):
    [($diff // "")
      | split("\n")[]
      | select(startswith("+") and (startswith("+++") | not))
      | .[1:]
      | select(test("^export\\s+(async\\s+)?function\\s+|^export\\s+const\\s+|^export\\s+class\\s+|^export\\s+\\{"))
      | capture("(?:function|const|class)\\s+(?<n>[A-Za-z_][A-Za-z0-9_]*)")?
      | .n
      | select(. != null)
    ] | unique;

  # +lines only; normalize "return X;" → "X" for quotation matching.
  def diff_added_exprs($diff):
    [($diff // "")
      | split("\n")[]
      | select(startswith("+") and (startswith("+++") | not))
      | .[1:]
      | gsub("^[[:space:]]+|[[:space:]]+$"; "")
      | sub("^return[[:space:]]+"; "")
      | sub(";[[:space:]]*$"; "")
      | gsub("[[:space:]]+"; " ")
    ];

  def backtick_quotes:
    [(.description // "") | match("`[^`]+`"; "g")
      | .string[1:-1]
      | gsub("[[:space:]]+"; " ")
      | sub("^return[[:space:]]+"; "")
      | sub(";[[:space:]]*$"; "")]
    | map(select(length >= 8));

  # $mode: "full" (adversarial: substring vs absent messages) | "soft" (validation).
  def gate_finding_quotes($added_exprs; $cand_diff; $mode):
    backtick_quotes as $quotes
    | if ($quotes | length) == 0 then .
      elif ($mode == "full")
           and any($quotes[]; . as $q
             | all($added_exprs[]; . != $q)
             and ($cand_diff | index($q)) != null) then
        .supported_by_evidence = false
        | .severity = "info"
        | .description = ((.description // "")
            + " [tribunal: quoted snippet is not a full candidate expression]")
      elif any($quotes[]; . as $q
             | all($added_exprs[]; . != $q)
             and (($mode != "full") or (($cand_diff | index($q)) == null))) then
        .supported_by_evidence = false
        | .severity = "info"
        | if $mode == "full" then
            .description = ((.description // "")
              + " [tribunal: quoted snippet absent from candidate diff]")
          else . end
      else . end;

  def is_blocking_finding:
    (.supported_by_evidence == true)
    and ((.severity == "high") or (.severity == "medium"))
    and (.type != "missing_evidence")
    and (.type != "style_issue");

  def blocking_findings_of:
    [.[]? | select(is_blocking_finding)];

  # Discovery prose hygiene: when no operator-named path exists in the
  # demand, rewrite false "operator named <path>" claims (models invent them).
  def scrub_false_operator_claim($s; $named):
    if ($named | length) > 0 then $s
    elif ($s | type) != "string" then $s
    elif ($s | test("operator[[:space:]]+named"; "i")) then
      # Match full path tokens (dots included) — do not stop at '.' in src/index.ts
      ($s
        | gsub("(?i)operator[[:space:]]+named[[:space:]]+[A-Za-z0-9_./-]+\\.(ts|tsx|js|jsx|mjs|cjs|sh|py)"; "attention seed targets")
        | gsub("(?i)operator[[:space:]]+named[[:space:]]+"; "attention seed: "))
    else $s end;

  def discovery_path_mentions:
    [match("[A-Za-z0-9_./-]+\\.(ts|tsx|js|jsx|mjs|cjs|sh|py)"; "g") | .string | sub("^\\./"; "")];

  # Keep observations that mention no path, or only paths in the mechanical set.
  def observation_paths_allowed($s; $allowed):
    ($s | discovery_path_mentions) as $paths
    | if ($paths | length) == 0 then true
      else
        ($paths
          | map(. as $p | ($allowed | index($p)) != null)
          | all)
      end;

  def filter_discovery_observations($arr; $named; $allowed):
    [
      ($arr // [])[]
      | scrub_false_operator_claim(.; $named)
      | select(type == "string" and length > 0)
      | select(observation_paths_allowed(.; $allowed))
    ][0:5];

  def scrub_observation_list($arr; $named):
    [($arr // [])[] | scrub_false_operator_claim(.; $named)];

  def mechanical_discovery_rationale($named; $seed; $seed_source; $tokens):
    (
      if ($named | length) > 0 then
        "Operator-named path(s): " + ($named | join(", "))
          + (if ($seed | length) > 0 then "; seed: " + ($seed | join(", ")) else "" end)
      elif ($seed | length) > 0 then
        "Attention seed (" + ($seed_source // "seed") + "): " + ($seed | join(", "))
      else
        "empty demand path anchors"
      end
    )
    + (if (($tokens // []) | length) > 0 then "; tokens: " + ($tokens | join(", ")) else "" end);
'

# Common bind + identity injection used by every mode program.
readonly AEGIS_JQ_ENRICH_HEAD='
  $ctx.evidence_refs as $evidence_refs
  | $ctx.observed_payloads as $observed_payloads
  | $ctx.prev_candidate as $prev_candidate
  | $ctx.prev_findings as $prev_findings
  | $ctx.seed_scope as $seed_scope
  | $ctx.seed_targets as $seed_targets
  | $ctx.seed_conditions as $seed_conditions
  | $ctx.operator_named_paths as $operator_named_paths
  | $ctx.existing_paths as $existing_paths
  | $ctx.tools_gate as $tools_gate
  | ($ctx.demand_anchors // {}) as $demand_anchors
  | ($ctx.alignment_gate // {aligned: true, violations: []}) as $alignment_gate
  | (($demand_anchors.dense_tokens // []) | map(ascii_downcase)) as $dense_tokens
  | .mode = $mode
  | .evidence_refs = $evidence_refs
  | .observed_payloads = (.observed_payloads // $observed_payloads)
  | if .status? == null then
      if .verdict? then . else .status = "interpreted" end
    else . end
'

readonly AEGIS_JQ_ENRICH_DISCOVERY='
  | (.operational_context // {}) as $oc
  | ((.required_evidence // $oc.required_evidence // [])) as $raw_req
  | (($seed_targets + $operator_named_paths) | unique) as $seed_att
  | (($demand_anchors.seed_source // "seed") ) as $seed_src
  | merge_operator_required_evidence(
      $raw_req; $operator_named_paths; $seed_targets; $existing_paths
    ) as $merged_req
  # Attention: seed + operator first. If Layer0 left attention empty,
  # promote existing on-disk required_evidence paths (not invent-net-new).
  | (
      if ($seed_att | length) > 0 then $seed_att
      else
        ($merged_req
          | map(select(startswith("filesystem.read:")) | .[16:])
          | map(select((. as $p | ($existing_paths | index($p)) != null)))
          | unique)
      end
    ) as $merged_attention
  | (
      if ($seed_att | length) > 0 then $seed_scope
      elif ($merged_attention | length) > 0 then
        {
          scope_type: "required_evidence",
          scope_targets: $merged_attention,
          scope_confidence: "medium"
        }
      else $seed_scope
      end
    ) as $eff_scope
  | filter_discovery_observations(
      (.observations // $oc.operational_observations // []);
      $operator_named_paths;
      $seed_att
    ) as $clean_obs
  # Prefer mechanical rationale whenever anchors exist (drops scrub garbage).
  | (
      if ($seed_att | length) > 0 then
        [mechanical_discovery_rationale($operator_named_paths; $seed_targets; $seed_src; $dense_tokens)]
      else
        (
          ((.rationale // $oc.rationale // []) | if type == "string" then [.] else . end)
          | scrub_observation_list(.; $operator_named_paths)
        ) as $r
        | if ($r | length) > 0 then $r else ["empty demand path anchors"] end
      end
    ) as $clean_rationale
  | .operational_context = ({
      status: ($oc.status // "interpreted"),
      summary: ($oc.summary // "discovery operational context"),
      observed_payloads: ($oc.observed_payloads // $observed_payloads),
      investigation_scope: $eff_scope,
      attention_targets: $merged_attention,
      blocking_conditions: (
        if ($merged_attention | length) > 0 then
          ($seed_conditions | map(select(. != "no layer0 targets available")))
        else $seed_conditions end
      ),
      required_evidence: $merged_req,
      operator_named_paths: $operator_named_paths,
      operational_observations: (
        if ($clean_obs | length) > 0 then $clean_obs
        elif ($seed_att | length) > 0 then
          [$seed_att[] | "Investigation needs content of \(.) before forensics can choose a mutation target."]
        else
          ["No mechanical path anchor (operator-named or Layer0/attention seed); forensics targeting will be weak."]
        end
      ),
      rationale: $clean_rationale,
      evidence_priorities: ($oc.evidence_priorities // [])
    } | drop_empty)
  | del(.observations, .rationale, .required_evidence)
  | .handover_attention = {
      next_attention_targets: $merged_attention,
      attention_scope: ($eff_scope.scope_type // "exploratory"),
      attention_reason: $attention_reason
    }
'

readonly AEGIS_JQ_ENRICH_FORENSICS='
  | (($operator_named_paths // [])
      + ($seed_targets // [])
      + ($existing_paths // [])
      | unique) as $forensics_scope
  | .repair_candidates = (
      (.repair_candidates // [])
      | map({
          id,
          reason: (.reason // "unspecified"),
          evidence_refs: $evidence_refs
        })
      | unique_by(.id)
      | clamp_forensics_scope(.; $forensics_scope; $evidence_refs)
      | prefer_alvo_unico(.; $operator_named_paths; $seed_targets)
      | force_single_anchor_candidate(
          .; $operator_named_paths; $seed_targets;
          $dense_tokens; $investigation_input; $evidence_refs
        )
      | bind_forensics_reasons(.; $dense_tokens; $investigation_input)
    )
  # Empty model output + mechanical alvo → still interpreted for repair.
  | if ((.repair_candidates | length) > 0)
         and ((.status == "inconclusive") or (.status == null))
    then .status = "interpreted"
    else . end
  | .handover_attention = {
      next_attention_targets: (
        if .status == "interpreted"
        then ([.repair_candidates[].id] | unique)
        else []
        end
      ),
      attention_scope: "evidence-backed interpretation",
      attention_reason: $attention_reason
    }
'

readonly AEGIS_JQ_ENRICH_OPTIMIZE='
  | (
      ($prev_candidate // {})
      | .source_mode = "optimize"
      | .intent_violations = (.intent_violations // [])
    ) as $cand
  | (($cand.files_changed // []) | map(select(type == "string" and length > 0))) as $allowed
  | (
      [
        (.improvements // [])[]?
        | select(type == "object")
        | . as $imp
        | (
            [($imp.target_files // [])[]?
              | select(type == "string" and length > 0)
              | select(. as $p | any($allowed[]; . == $p or ($p | startswith(. + "/")) or (. | startswith($p + "/"))))
            ]
          ) as $tf
        | select(($tf | length) > 0)
        | select((($imp.change // "") | type == "string"))
        | select((($imp.why_safe // "") | type == "string") and (($imp.why_safe // "") | length) > 0)
        # P1: reject vague / too-short change lines (Repair cannot act).
        | select((.change | length) >= 24)
        | select(.change | test("(?i)\\b(add|remove|delete|give|inline|collapse|replace|use|set|fix|strip|drop|type|explicit|return|export|unused|local|duplicate|rename|convert|extract)\\b"))
        | select((.change | test("(?i)^(improve|clean\\s*up|cleanup|refactor|consider|maybe|make it|prettier|more idiomatic|better)\\b")) | not)
        | {
            target_files: $tf,
            change: .change,
            why_safe: .why_safe
          }
      ][0:1]
    ) as $valid_imps
  | (
      (.status // "") as $raw_st
      | if ($raw_st == "can_improve") and (($valid_imps | length) > 0) then "can_improve"
        elif ($raw_st == "no_improvement_needed") or ($raw_st == "no_optimization_needed")
             or ($raw_st == "unoptimized") or ($raw_st == "optimized" and ($valid_imps | length) == 0)
        then "no_improvement_needed"
        elif ($valid_imps | length) > 0 then "can_improve"
        else "no_improvement_needed"
        end
    ) as $opt_status
  | .status = $opt_status
  | .basis = (
      if ((.basis // "") | type == "string" and length > 0) then .basis
      elif $opt_status == "can_improve" then "optimize: actionable improvements for repair"
      else "optimize: no safe improvement"
      end
    )
  | .improvements = (if $opt_status == "can_improve" then $valid_imps else [] end)
  | .candidate_result = $cand
  | .diff = ($cand.diff // "")
  | .files_changed = ($cand.files_changed // [])
  | .intent_violations = ($cand.intent_violations // [])
  | (
      if $opt_status == "can_improve" then
        .repair_feedback = {
          authorized_scopes: (
            [$valid_imps[].target_files[]?] | unique
          ),
          violations: [
            $valid_imps[]
            | {
                origin: "optimize_improve",
                severity: "low",
                target_files: .target_files,
                structural_reason: (
                  "OPTIMIZE: " + .change
                  + " (safe: " + .why_safe + ")"
                ),
                evidence_refs: ["optimize.improvements"]
              }
          ]
        }
      else del(.repair_feedback) end
    )
  | .handover_attention = {
      next_attention_targets: (
        if $opt_status == "can_improve" then
          ([.repair_feedback.authorized_scopes[]?] | unique)
        else (.candidate_result.files_changed // [])
        end
      ),
      attention_scope: (if $opt_status == "can_improve" then "optimize_feedback" else "mutation_applied" end),
      attention_reason: $attention_reason
    }
'

# Sole source of tool→finding maps for adversarial (mechanical emit is thin; enrich fills).
readonly AEGIS_JQ_ENRICH_ADVERSARIAL='
  | .status = (.status // "challenged")
  | .candidate_result = ($prev_candidate // .candidate_result)
  | (.candidate_result.diff // "") as $cand_diff
  | (.candidate_result.files_changed // []) as $cand_files
  | diff_added_exprs($cand_diff) as $added_exprs
  | (
      [
        ($tools_gate.typescript_errors_in_scope // [])[]
        | {
            type: "tool_failure",
            severity: "high",
            description: ("typescript " + (.file // "?") + ":" + ((.line // 0)|tostring) + ": " + (.message // tostring)),
            supported_by_evidence: true,
            evidence_refs: ["typescript.check"],
            target_files: ([.file] | map(select(type == "string" and length > 0))),
            fix: ("Fix TypeScript error in " + (.file // "mutation file") + ": " + (.message // "see typescript.check"))
          }
      ]
      + [
        ($tools_gate.eslint_errors_in_scope // [])[]
        | {
            type: "tool_failure",
            severity: "medium",
            description: ("eslint " + (.file // "?") + ": " + (.message // tostring)),
            supported_by_evidence: true,
            evidence_refs: ["eslint.check"],
            target_files: ([.file] | map(select(type == "string" and length > 0))),
            fix: ("Fix eslint issue in " + (.file // "mutation file") + ": " + (.message // "see eslint.check"))
          }
      ]
      + (
          if ($tools_gate.test_status // "") == "failed" then
            [{
              type: "tool_failure",
              severity: "high",
              description: "test.run failed on candidate surface",
              supported_by_evidence: true,
              evidence_refs: ["test.run"],
              target_files: $cand_files,
              fix: "Make test.run pass for the mutation files_changed"
            }]
          else [] end
        )
      + (
          if (($cand_diff // "")
              | split("\n")
              | map(select(startswith("+") and (startswith("+++") | not)))
              | map(select(test(":[[:space:]]*any\\b|as[[:space:]]+any\\b|@ts-ignore|@ts-expect-error")))
              | length) > 0
          then
            [{
              type: "contract_violation",
              severity: "medium",
              description: "candidate adds any / @ts-ignore / @ts-expect-error in +lines",
              supported_by_evidence: true,
              evidence_refs: ["candidate.diff"],
              target_files: $cand_files,
              fix: "Remove any / @ts-ignore / @ts-expect-error from the mutation; use explicit types"
            }]
          else [] end
        )
    ) as $mech_findings
  | .findings = (
      ($mech_findings + (.findings // []))
      | map(
          .supported_by_evidence = (.supported_by_evidence // false)
          | .evidence_refs = (.evidence_refs // $evidence_refs)
          | .target_files = (
              if ((.target_files // []) | length) > 0 then .target_files
              else $cand_files end
            )
          | .fix = (
              if ((.fix // null) | type == "string") then .fix else null end
            )
          | gate_finding_quotes($added_exprs; $cand_diff; "full")
          | if ($tools_gate.mutation_clean == true)
               and (.type == "logic_bug" or .type == "contract_violation")
               and ((.evidence_refs // []) | map(tostring) | any(test("typescript|eslint|test\\.run")))
               and (($tools_gate.typescript_errors_in_scope // []) | length) == 0
            then .supported_by_evidence = false | .severity = "info"
            else . end
        )
      | group_by(.description // "")
      | map(.[0])
    )
  | ((.findings | blocking_findings_of) | length) as $blocking
  | if ($tools_gate.mutation_clean == true) and ($blocking == 0) then
      .status = "verified"
    elif ($tools_gate.mutation_clean == false) then
      .status = "challenged"
    else . end
  | .handover_attention = {
      next_attention_targets: (.candidate_result.files_changed // []),
      attention_scope: "bounded falsification",
      attention_reason: $attention_reason
    }
'

# Validation tribunal — sole authority for verdict.
# Stable codes: demand_tokens|over_export|path_scope|done_when|empty_diff|
# empty_mutation_candidate|invalid_candidate_diff_shape|blocking_finding|accepted
# Tools re-check is intentionally omitted (adversarial stamps tool findings).
readonly AEGIS_JQ_ENRICH_VALIDATION='
  | .validated_candidate = ($prev_candidate // .validated_candidate)
  | (.validated_candidate.diff // "") as $cand_diff
  | diff_added_exprs($cand_diff) as $added_exprs
  | .findings = (
      ($prev_findings // .findings // [])
      | map(gate_finding_quotes($added_exprs; $cand_diff; "soft"))
    )
  | .basis = (.basis // [] | if type == "string" then [.] else . end)
  # Normalize intent stamps → stable origin codes (legacy demand_mismatch).
  # jq: chained `def` without `|` between definitions.
  | def intent_origin($v):
      if ($v | type) != "object" then
        (tostring | if test("^over_export") then "over_export"
          elif test("^demand_tokens") then "demand_tokens"
          else "demand_tokens" end)
      else
        ($v.origin // "") as $o
        | ($v.structural_reason // $v.description // "") as $r
        | if ($o == "demand_tokens" or $o == "over_export"
              or $o == "path_scope" or $o == "done_when"
              or $o == "empty_diff") then $o
          elif ($o == "demand_mismatch" or $o == "demand_alignment"
                or $o == "demand") then
            (if ($r | test("(?i)^over_export|over_export:")) then "over_export"
             elif ($r | test("(?i)^path_scope|path_scope:")) then "path_scope"
             elif ($r | test("(?i)^done_when|done_when:")) then "done_when"
             else "demand_tokens" end)
          elif ($r | test("(?i)^over_export|over_export:")) then "over_export"
          elif ($r | test("(?i)^demand_tokens|demand_tokens:")) then "demand_tokens"
          else "demand_tokens" end
      end;
    def align_origin($v):
      ($v.code // $v.origin // "demand_tokens") as $c
      | if ($c == "demand_alignment" or $c == "demand_mismatch") then "demand_tokens"
        elif ($c == "demand_tokens" or $c == "over_export"
              or $c == "path_scope" or $c == "done_when"
              or $c == "empty_diff") then $c
        else "demand_tokens" end;
    def tribunal_basis($codes):
      ([$codes[]? | select(type == "string" and length > 0)
        | if startswith("tribunal:") then . else "tribunal:" + . end]
       | unique);
    (if (
       (((.validated_candidate.diff // "") | gsub("[[:space:]]"; "")) | length) == 0
       or ((.validated_candidate.diff // "") == "(no changes)")
       or (((.validated_candidate.files_changed // []) | length) == 0)
     ) then
       .verdict = "rejected" | .basis = tribunal_basis(["empty_mutation_candidate"])
     elif (((.validated_candidate.diff // "") | test("(?m)^\\+\\+\\+ b/")) | not) then
       .verdict = "rejected" | .basis = tribunal_basis(["invalid_candidate_diff_shape"])
     else . end)
  | (.findings | blocking_findings_of) as $blocking_findings
  | [
      (.validated_candidate.intent_violations // [])[]?
      | intent_origin(.)
    ] as $intent_codes
  | (($intent_codes | length) > 0) as $intent_fail
  # Note: jq // treats false as missing — use == false explicitly.
  | ($alignment_gate.aligned == false) as $align_fail
  | [
      ($alignment_gate.violations // [])[]?
      | align_origin(.)
    ] as $align_codes
  | (if (
       ((.basis // []) | map(sub("^tribunal:"; ""))
         | (index("empty_mutation_candidate") != null
            or index("invalid_candidate_diff_shape") != null))
     ) then .
     elif $intent_fail then
       .verdict = "rejected"
       | .basis = tribunal_basis($intent_codes)
     elif $align_fail then
       .verdict = "rejected"
       | .basis = tribunal_basis(
           if ($align_codes | length) > 0 then $align_codes
           else ["demand_tokens"] end
         )
     elif ($blocking_findings | length) == 0 then
       .verdict = "accepted"
       | .basis = tribunal_basis(["accepted"])
     else
       .verdict = "rejected"
       | .basis = tribunal_basis(["blocking_finding"])
     end)
  | (if (.verdict // "") == "rejected" then
       ((.validated_candidate.files_changed // []) | map(select(type == "string"))) as $scopes
       | (
           [
             $blocking_findings[]
             | {
                 origin: (.type // "blocking_finding"),
                 severity: (.severity // "unspecified"),
                 target_files: (
                   if ((.target_files // []) | length) > 0 then .target_files
                   else $scopes end
                 ),
                 structural_reason: (
                   if ((.fix // "") | type == "string" and length > 0) then
                     "ADVERSARIAL: " + .fix
                     + (if ((.description // "") | length) > 0
                        then " | " + .description else "" end)
                   else (.description // "") end
                 ),
                 evidence_refs: (.evidence_refs // [])
               }
           ]
           + [
               (.validated_candidate.intent_violations // [])[]
               | if type == "object" then
                   {
                     origin: intent_origin(.),
                     severity: (.severity // "high"),
                     target_files: (
                       if ((.target_files // []) | length) > 0 then .target_files
                       else $scopes end
                     ),
                     structural_reason: (.structural_reason // .description // ""),
                     evidence_refs: (.evidence_refs // ["mutation.intent"])
                   }
                 else
                   {
                     origin: intent_origin(.),
                     severity: "high",
                     target_files: $scopes,
                     structural_reason: tostring,
                     evidence_refs: ["mutation.intent"]
                   }
                 end
             ]
           + (
               if $align_fail then
                 [
                   ($alignment_gate.violations // [])[]
                   | {
                       origin: align_origin(.),
                       severity: "high",
                       target_files: (
                         if ((.target_files // []) | length) > 0 then .target_files
                         else $scopes end
                       ),
                       structural_reason: (
                         "ALIGNMENT: " + ((.fix // .reason // .code // "align candidate with demand"))
                       ),
                       evidence_refs: ["validation.alignment"]
                     }
                 ]
               else [] end
             )
           | unique_by(
               (.origin // "") + "|" + (.structural_reason // "")
             )
         ) as $all_violations
       | .repair_feedback = {
           violations: $all_violations,
           authorized_scopes: $scopes
         }
     else del(.repair_feedback) end)
  | .alignment_gate = $alignment_gate
  | .handover_attention = {
      next_attention_targets: (.validated_candidate.files_changed // []),
      attention_scope: "validation_result",
      attention_reason: $attention_reason
    }
'

readonly AEGIS_JQ_ENRICH_DEFAULT='
  | .handover_attention = (
      .handover_attention // {
        next_attention_targets: [],
        attention_scope: "exploratory",
        attention_reason: $attention_reason
      }
    )
'

# Emit one JSON object with every runtime input the enricher needs.
load_artifact_enrichment_context() {
  local evidence_refs_json
  evidence_refs_json="$(
    jq -cn '$ARGS.positional' --args "${AEGIS_ACTIVE_EVIDENCE_ENTRIES[@]}"
  )"

  local -a observed_payloads_arr=()
  local entry
  for entry in "${AEGIS_ACTIVE_EVIDENCE_ENTRIES[@]:-}"; do
    [[ -n "${entry}" ]] || continue
    observed_payloads_arr+=("$(
      resolve_evidence_payload_file \
        "$(resolve_evidence_entry_capability "${entry}")" \
        "$(resolve_evidence_entry_alias "${entry}")"
    )")
  done
  local observed_payloads_json
  observed_payloads_json="$(jq -cn '$ARGS.positional' --args "${observed_payloads_arr[@]}")"

  local prev_candidate_json="null"
  local prev_findings_json="null"
  if [[ -f "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-}" ]]; then
    local handover_ctx=()
    mapfile -t handover_ctx < <(
      jq -c '
        .artifact_snapshot as $snap
        | ((
            $snap.operational_context.candidate_result
            // $snap.candidate_result
            // (if ($snap.operational_context.diff | type == "string") then
                 {
                   diff: $snap.operational_context.diff,
                   files_changed: ($snap.operational_context.files_changed // []),
                   intent_violations: (
                     $snap.operational_context.intent_violations
                     // $snap.intent_violations
                     // []
                   )
                 }
               else null end)
           )
           | if . != null then
               .source_mode = "optimize"
               | .intent_violations = (
                   .intent_violations
                   // $snap.operational_context.intent_violations
                   // $snap.intent_violations
                   // []
                 )
             else . end),
          ($snap.operational_context.findings // $snap.findings // null)
      ' "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT}" 2>/dev/null
    )
    prev_candidate_json="${handover_ctx[0]:-null}"
    prev_findings_json="${handover_ctx[1]:-null}"
  fi

  local seed_scope_json='{"scope_type":"none","scope_targets":[],"scope_confidence":"none"}'
  local seed_targets_json="[]"
  local seed_conditions_json="[]"
  local seed_path="${AEGIS_CAPABILITY_PAYLOAD_DIR}/runtime_attention_seed.json"
  if [[ -f "${seed_path}" ]]; then
    local seed_ctx=()
    mapfile -t seed_ctx < <(
      jq -c '
        (.payload.investigation_scope
          // {"scope_type":"none","scope_targets":[],"scope_confidence":"none"}),
        (.payload.attention_targets // []),
        (.payload.blocking_conditions // [])
      ' "${seed_path}" 2>/dev/null
    )
    seed_scope_json="${seed_ctx[0]:-${seed_scope_json}}"
    seed_targets_json="${seed_ctx[1]:-[]}"
    seed_conditions_json="${seed_ctx[2]:-[]}"
  fi

  local operator_named_paths_json
  operator_named_paths_json="$(
    aegis_extract_operator_named_paths_json "${AEGIS_INVESTIGATION_INPUT:-}"
  )"
  if ! printf '%s' "${operator_named_paths_json}" | jq -e 'type == "array"' >/dev/null 2>&1; then
    operator_named_paths_json="[]"
  fi

  local existing_paths_json="[]"
  existing_paths_json="$(
    {
      if [[ -n "${AEGIS_POCKET_MAP_FILE:-}" && -s "${AEGIS_POCKET_MAP_FILE}" ]]; then
        command grep -v '^#' "${AEGIS_POCKET_MAP_FILE}" 2>/dev/null || true
      else
        git ls-files 2>/dev/null || true
      fi
    } | command grep -E '\.(ts|tsx|js|jsx|mjs|cjs|sh|py)$' \
      | sort -u \
      | jq -R -s -c 'split("\n") | map(select(length > 0))' 2>/dev/null \
      || printf '[]'
  )"
  if ! printf '%s' "${existing_paths_json}" | jq -e 'type == "array"' >/dev/null 2>&1; then
    existing_paths_json="[]"
  fi

  # Mechanical demand anchors for forensics reason/alvo gates (and other modes).
  local demand_anchors_json="{}"
  local anchors_payload="${AEGIS_CAPABILITY_PAYLOAD_DIR:-}/runtime_demand_anchors.json"
  if [[ -f "${anchors_payload}" ]]; then
    demand_anchors_json="$(
      jq -c '.payload.demand_anchors // {}' "${anchors_payload}" 2>/dev/null || printf '{}'
    )"
  fi
  if ! printf '%s' "${demand_anchors_json}" | jq -e 'type == "object" and has("dense_tokens")' >/dev/null 2>&1; then
    if declare -f aegis_materialize_demand_anchors_json >/dev/null 2>&1; then
      demand_anchors_json="$(
        aegis_materialize_demand_anchors_json \
          "${AEGIS_INVESTIGATION_INPUT:-}" \
          "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT:-${AEGIS_EPISTEMIC_HANDOVER_FILE:-}}" \
          "${AEGIS_CAPABILITY_PAYLOAD_DIR:-}" \
          2>/dev/null || printf '{}'
      )"
    fi
  fi
  if ! printf '%s' "${demand_anchors_json}" | jq -e 'type == "object"' >/dev/null 2>&1; then
    demand_anchors_json="{}"
  fi
  # Prefer seed_targets already loaded from attention_seed when anchors lack them.
  if printf '%s' "${seed_targets_json}" | jq -e 'type == "array" and length > 0' >/dev/null 2>&1; then
    demand_anchors_json="$(
      printf '%s' "${demand_anchors_json}" | jq -c \
        --argjson seed "${seed_targets_json}" \
        'if ((.seed_targets // []) | length) == 0
         then .seed_targets = $seed | .seed_source = (.seed_source // "attention_seed")
         else . end'
    )"
  fi

  local tribunal_files_json="[]"
  tribunal_files_json="$(
    printf '%s' "${prev_candidate_json}" \
      | jq -c '.files_changed // []' 2>/dev/null \
      || printf '[]'
  )"
  local tools_gate_json
  tools_gate_json="$(build_tribunal_tools_gate "${tribunal_files_json}")"

  # Validation: minimal demand-alignment proof on the final candidate.
  local alignment_gate_json='{"aligned":true,"violations":[]}'
  if [[ "${AEGIS_MODE}" == "validation" ]] \
    && [[ "${AEGIS_ALIGNMENT_GATE:-true}" != "0" ]] \
    && [[ "${AEGIS_ALIGNMENT_GATE:-true}" != "false" ]] \
    && declare -f aegis_candidate_alignment_gate >/dev/null 2>&1; then
    local _align_diff
    _align_diff="$(
      printf '%s' "${prev_candidate_json}" \
        | jq -r '.diff // empty' 2>/dev/null || true
    )"
    alignment_gate_json="$(
      aegis_candidate_alignment_gate \
        "${_align_diff}" \
        "${tribunal_files_json}" \
        "${AEGIS_INVESTIGATION_INPUT:-}" \
        "${demand_anchors_json}" \
        2>/dev/null || printf '%s' '{"aligned":true,"violations":[]}'
    )"
    if ! printf '%s' "${alignment_gate_json}" | jq -e 'type == "object"' >/dev/null 2>&1; then
      alignment_gate_json='{"aligned":true,"violations":[]}'
    fi
    unset _align_diff
  fi

  jq -n \
    --argjson evidence_refs "${evidence_refs_json}" \
    --argjson observed_payloads "${observed_payloads_json}" \
    --argjson prev_candidate "${prev_candidate_json}" \
    --argjson prev_findings "${prev_findings_json}" \
    --argjson seed_scope "${seed_scope_json}" \
    --argjson seed_targets "${seed_targets_json}" \
    --argjson seed_conditions "${seed_conditions_json}" \
    --argjson operator_named_paths "${operator_named_paths_json}" \
    --argjson existing_paths "${existing_paths_json}" \
    --argjson tools_gate "${tools_gate_json}" \
    --argjson demand_anchors "${demand_anchors_json}" \
    --argjson alignment_gate "${alignment_gate_json}" \
    '{
      evidence_refs: $evidence_refs,
      observed_payloads: $observed_payloads,
      prev_candidate: $prev_candidate,
      prev_findings: $prev_findings,
      seed_scope: $seed_scope,
      seed_targets: $seed_targets,
      seed_conditions: $seed_conditions,
      operator_named_paths: $operator_named_paths,
      existing_paths: $existing_paths,
      tools_gate: $tools_gate,
      demand_anchors: $demand_anchors,
      alignment_gate: $alignment_gate
    }'
}

# Pure transformation: raw model artifact + enrichment context → full artifact.
enrich_cognitive_artifact() {
  local raw_artifact="$1"
  local ctx_json="$2"
  local mode_body

  case "${AEGIS_MODE}" in
    discovery)   mode_body="${AEGIS_JQ_ENRICH_DISCOVERY}" ;;
    forensics)   mode_body="${AEGIS_JQ_ENRICH_FORENSICS}" ;;
    optimize)    mode_body="${AEGIS_JQ_ENRICH_OPTIMIZE}" ;;
    adversarial) mode_body="${AEGIS_JQ_ENRICH_ADVERSARIAL}" ;;
    validation)  mode_body="${AEGIS_JQ_ENRICH_VALIDATION}" ;;
    *)           mode_body="${AEGIS_JQ_ENRICH_DEFAULT}" ;;
  esac

  printf '%s\n' "${raw_artifact}" | jq \
    --arg mode "${AEGIS_MODE}" \
    --arg attention_reason "ATTENTION_REASON_$(printf '%s' "${AEGIS_MODE}" | tr '[:lower:]' '[:upper:]')" \
    --arg investigation_input "${AEGIS_INVESTIGATION_INPUT:-}" \
    --argjson ctx "${ctx_json}" \
    "${AEGIS_JQ_ENRICH_LIB}${AEGIS_JQ_ENRICH_HEAD}${mode_body}"
}

# Splice the enriched artifact back between protocol markers.
rewrite_substrate_output_with_artifact() {
  local updated_artifact="$1"
  local prefix="${AEGIS_SUBSTRATE_OUTPUT%%"${AEGIS_ARTIFACT_BEGIN_MARKER}"*}"
  local suffix="${AEGIS_SUBSTRATE_OUTPUT#*"${AEGIS_ARTIFACT_END_MARKER}"}"

  AEGIS_SUBSTRATE_OUTPUT="$(
    printf '%s\n' "${prefix}"
    printf '%s\n' "${AEGIS_ARTIFACT_BEGIN_MARKER}"
    printf '%s\n' "${updated_artifact}"
    printf '%s\n' "${AEGIS_ARTIFACT_END_MARKER}"
    printf '%s\n' "${suffix}"
  )"
}

normalize_substrate_output() {
  local raw_artifact
  raw_artifact="$(extract_substrate_artifact)"

  if ! printf '%s\n' "${raw_artifact}" | jq empty >/dev/null 2>&1; then
    aegis_warn "substrate_artifact_not_normalizable"
    return 0
  fi

  local ctx_json updated_artifact
  ctx_json="$(load_artifact_enrichment_context)"
  updated_artifact="$(enrich_cognitive_artifact "${raw_artifact}" "${ctx_json}")"
  rewrite_substrate_output_with_artifact "${updated_artifact}"
}


emit_output() {
  echo "${AEGIS_SUBSTRATE_OUTPUT}"
}


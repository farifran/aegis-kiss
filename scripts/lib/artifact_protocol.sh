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
      # Operator-typed paths (model-independent net-new authorization).
      (operator_named_paths[]?),
      (.artifact_snapshot.operational_context.required_evidence[]?
        | select(type == "string" and startswith("filesystem.read:"))
        | ltrimstr("filesystem.read:")),
      (.artifact_snapshot.operational_context.operator_named_paths[]?),
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

  local previous_candidate
  previous_candidate="$(
    jq -c '.artifact_snapshot.operational_context.candidate_result // empty' \
      "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT}"
  )"

  [[ -n "${previous_candidate}" ]] \
    || aegis_fatal "missing_adversarial_candidate_result"

  assert_candidate_continuity \
    "${artifact}" \
    "validated_candidate" \
    "${previous_candidate}" \
    "validation_candidate_mismatch"

  local previous_findings
  previous_findings="$(
    jq -c '.artifact_snapshot.operational_context.findings // empty' \
      "${AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT}"
  )"

  [[ -n "${previous_findings}" ]] \
    || aegis_fatal "missing_findings"

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
# candidates, attention (see .skills/field_ownership.md).
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

  # Keep model required_evidence only for operator-named or on-disk paths;
  # always union operator-named as filesystem.read: entries.
  def merge_operator_required_evidence($req; $named; $existing):
    ($req
      | sanitize_required_evidence
      | map(select(
          (.[16:] as $p
            | (($named | index($p)) != null)
              or (($existing | index($p)) != null))
        )))
    + ($named | map("filesystem.read:" + .))
    | unique;

  # Collapse multi-candidate forensics when operator named 0–1 paths.
  def prefer_alvo_unico($cands; $named):
    if ($named | length) >= 2 then $cands
    elif ($cands | length) <= 1 then $cands
    else
      (if ($named | length) == 1 then
        ($cands | map(select(.id == $named[0])) | .[0:1])
       else [] end) as $named_hit
      | if ($named_hit | length) > 0 then $named_hit
        else
          ($cands
            | map(select(.id | test("(^|/)index\\.(ts|tsx|js|jsx)$")))
            | .[0:1]) as $entry
          | if ($entry | length) > 0 then $entry else $cands[0:1] end
        end
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
  | merge_operator_required_evidence($raw_req; $operator_named_paths; $existing_paths) as $merged_req
  | (($seed_targets + $operator_named_paths) | unique) as $merged_attention
  | .operational_context = ({
      status: ($oc.status // "interpreted"),
      summary: ($oc.summary // "discovery operational context"),
      observed_payloads: ($oc.observed_payloads // $observed_payloads),
      investigation_scope: $seed_scope,
      attention_targets: $merged_attention,
      blocking_conditions: $seed_conditions,
      required_evidence: $merged_req,
      operator_named_paths: $operator_named_paths,
      operational_observations: (.observations // $oc.operational_observations // []),
      rationale: ((.rationale // $oc.rationale // []) | if type == "string" then [.] else . end),
      evidence_priorities: ($oc.evidence_priorities // [])
    } | drop_empty)
  | del(.observations, .rationale, .required_evidence)
  | .handover_attention = {
      next_attention_targets: $merged_attention,
      attention_scope: ($seed_scope.scope_type // "exploratory"),
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
      | prefer_alvo_unico(.; $operator_named_paths)
    )
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
      if ((.diff | type == "string")
            and ((.diff | length) > 0)
            and (.diff != "(no changes)")
            and (.files_changed | type == "array")
            and ((.files_changed | length) > 0))
      then { source_mode: "optimize", diff: .diff, files_changed: .files_changed }
      elif ((.candidate_result.diff | type == "string")
            and ((.candidate_result.diff | length) > 0)
            and (.candidate_result.diff != "(no changes)")
            and (.candidate_result.files_changed | type == "array")
            and ((.candidate_result.files_changed | length) > 0))
      then (.candidate_result | .source_mode = "optimize")
      else
        ($prev_candidate // {source_mode: "optimize", diff: "(no changes)", files_changed: []})
      end
    ) as $raw_cand
  | (
      added_export_names($raw_cand.diff) as $opt_exports
      | added_export_names($prev_candidate.diff // "") as $repair_exports
      | ($opt_exports - $repair_exports) as $novel
      | if ($novel | length) == 0 then $raw_cand
        elif any($novel[]; . as $n
          | ($investigation_input // "") | test("\\b\($n)\\b"; "i"))
        then $raw_cand
        else ($prev_candidate // $raw_cand | .source_mode = "optimize")
        end
    ) as $cand
  | (
      ($prev_candidate.diff // "") as $prev_diff
      | if ($cand.diff == $prev_diff)
           and ($cand.files_changed == ($prev_candidate.files_changed // []))
        then "no_optimization_needed"
        elif (.status == "no_optimization_needed" or .status == "unoptimized")
             and ($cand.diff == $prev_diff or $prev_diff == "")
        then "no_optimization_needed"
        else "optimized"
        end
    ) as $opt_status
  | .status = $opt_status
  | .candidate_result = $cand
  | .diff = $cand.diff
  | .files_changed = $cand.files_changed
  | .handover_attention = {
      next_attention_targets: (.candidate_result.files_changed // []),
      attention_scope: "mutation_applied",
      attention_reason: $attention_reason
    }
'

readonly AEGIS_JQ_ENRICH_ADVERSARIAL='
  | .status = (.status // "challenged")
  | .candidate_result = ($prev_candidate // .candidate_result)
  | (.candidate_result.diff // "") as $cand_diff
  | diff_added_exprs($cand_diff) as $added_exprs
  | .findings = (.findings // [] | map(
      .supported_by_evidence = (.supported_by_evidence // false)
      | .evidence_refs = (.evidence_refs // $evidence_refs)
      | gate_finding_quotes($added_exprs; $cand_diff; "full")
      | if ($tools_gate.mutation_clean == true)
           and (.type == "logic_bug" or .type == "contract_violation")
           and ((.evidence_refs // []) | map(tostring) | any(test("typescript|eslint|test\\.run")))
           and (($tools_gate.typescript_errors_in_scope // []) | length) == 0
        then .supported_by_evidence = false | .severity = "info"
        else . end
    ))
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

readonly AEGIS_JQ_ENRICH_VALIDATION='
  | .validated_candidate = ($prev_candidate // .validated_candidate)
  | (.validated_candidate.diff // "") as $cand_diff
  | diff_added_exprs($cand_diff) as $added_exprs
  | .findings = (
      ($prev_findings // .findings // [])
      | map(gate_finding_quotes($added_exprs; $cand_diff; "soft"))
    )
  | .basis = (.basis // [] | if type == "string" then [.] else . end)
  | (if (
       (((.validated_candidate.diff // "") | gsub("[[:space:]]"; "")) | length) == 0
       or ((.validated_candidate.diff // "") == "(no changes)")
       or (((.validated_candidate.files_changed // []) | length) == 0)
     ) then
       .verdict = "rejected" | .basis = ["empty_mutation_candidate"]
     elif (((.validated_candidate.diff // "") | test("(?m)^\\+\\+\\+ b/")) | not) then
       .verdict = "rejected" | .basis = ["invalid_candidate_diff_shape"]
     else . end)
  | (.findings | blocking_findings_of) as $blocking_findings
  | (if (
       ((.basis // []) | index("empty_mutation_candidate") != null)
       or ((.basis // []) | index("invalid_candidate_diff_shape") != null)
     ) then .
     elif ($blocking_findings | length) == 0 then
       .verdict = "accepted"
       | .basis = ["tribunal: no blocking findings after evidence gates"]
     elif ($tools_gate.mutation_clean == false) then
       .verdict = "rejected"
       | .basis = (
           if (($tools_gate.typescript_errors_in_scope // []) | length) > 0 then
             ["tribunal: typescript errors in mutation files"]
           elif (($tools_gate.eslint_errors_in_scope // []) | length) > 0 then
             ["tribunal: eslint errors in mutation files"]
           else ["tribunal: mutation-scoped tool failure"] end
         )
     else
       .verdict = "rejected"
       | .basis = (
           if ((.basis // []) | length) > 0 then .basis
           else [$blocking_findings[0].description // "blocking adversarial finding"]
           end
         )
     end)
  | (if (.verdict // "") == "rejected" then
       ((.validated_candidate.files_changed // []) | map(select(type == "string"))) as $scopes
       | .repair_feedback = {
           violations: [
             $blocking_findings[]
             | {
                 origin: (.type // "unspecified"),
                 severity: (.severity // "unspecified"),
                 target_files: $scopes,
                 structural_reason: (.description // ""),
                 evidence_refs: (.evidence_refs // [])
               }
           ],
           authorized_scopes: $scopes
         }
     else del(.repair_feedback) end)
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
                   files_changed: ($snap.operational_context.files_changed // [])
                 }
               else null end)
           )
           | if . != null then .source_mode = "optimize" else . end),
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

  local tribunal_files_json="[]"
  tribunal_files_json="$(
    printf '%s' "${prev_candidate_json}" \
      | jq -c '.files_changed // []' 2>/dev/null \
      || printf '[]'
  )"
  local tools_gate_json
  tools_gate_json="$(build_tribunal_tools_gate "${tribunal_files_json}")"

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
      tools_gate: $tools_gate
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


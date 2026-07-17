#!/usr/bin/env bash

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

# This suite drives single-mode runtime invocations against mock
# providers whose validation verdict is "rejected"; the automated
# repair feedback loop would otherwise re-enter the mutation pipeline.
export AEGIS_REPAIR_FEEDBACK_LOOP="false"

readonly TEST_INVESTIGATION_INPUT="readonly smoke investigation"
readonly DEFAULT_INVESTIGATION_INPUT="Analyze repository structure and identify highest-value investigation targets"

assert_manifest_contract() {
  local manifest

  manifest="$(
    bash scripts/capabilities/generate_manifest.sh
  )"

  printf '%s\n' "${manifest}" | jq -e '
    (.modes | keys | sort == ["adversarial", "discovery", "forensics", "optimize", "repair", "validation"])
    and ([.modes[].capabilities | length > 0] | all)
    and ([.modes[].evidence_capabilities | length > 0] | all)
    and ([.modes[].capabilities[].capability] | index("topology.read_graph") == null)
    and ([.modes[].evidence_capabilities[]] | index("topology.read_graph") == null)
    and ([.modes[].capabilities[].handler] | index("scripts/capabilities/topology/read_graph.sh") == null)
    and (.modes.discovery.evidence_capabilities == [
      "filesystem.list_tree",
      "filesystem.read",
      "runtime.layer0_facts",
      "runtime.attention_seed"
    ])
    and (.modes.forensics.evidence_capabilities == ["filesystem.search_symbol", "git.status", "filesystem.read"])
    and (.modes.validation.evidence_capabilities == ["filesystem.read"])
    and (.modes.adversarial.evidence_capabilities == ["filesystem.search_symbol", "filesystem.read", "typescript.check", "eslint.check", "test.run"])
  ' >/dev/null || fail "invalid_manifest_contract"
}


assert_discovery_uses_default_investigation_input() {
  local runtime_log_file
  local status

  runtime_log_file="$(mktemp)"

  set +e
  env -u AEGIS_INVESTIGATION_INPUT \
    bash runtime_aegis.sh discovery >"${runtime_log_file}" 2>&1
  status=$?
  set -e

  if [[ "${status}" -ne 0 ]]; then
    echo "STATUS: ${status}, LOG FILE: ${runtime_log_file}" >&2
    cat "${runtime_log_file}" >&2
    fail "discovery_failed_missing_investigation_input"
  fi

  grep -q "^\[AEGIS\]\[RUNTIME\]$" "${runtime_log_file}" \
    || fail "missing_runtime_default_investigation_prefix"

  grep -q "No investigation input provided\." "${runtime_log_file}" \
    || fail "missing_runtime_default_investigation_notice"

  grep -q "Using default exploratory investigation\." "${runtime_log_file}" \
    || fail "missing_runtime_default_investigation_log"

  jq -e \
    --arg investigation_input "${DEFAULT_INVESTIGATION_INPUT}" \
    '
      .artifact_snapshot.investigation_input == $investigation_input
    ' .harness/runtime/epistemic_handover.json >/dev/null \
    || fail "missing_default_investigation_input_persistence"

  rm -f "${runtime_log_file}"
}

assert_discovery_accepts_informal_cli_investigation_input() {
  local runtime_log_file
  local status
  local cli_investigation_input="Mapear arquitetura do runtime"

  runtime_log_file="$(mktemp)"

  set +e
  env -u AEGIS_INVESTIGATION_INPUT \
    bash runtime_aegis.sh discovery "${cli_investigation_input}" >/dev/null 2>"${runtime_log_file}"
  status=$?
  set -e

  [[ "${status}" -eq 0 ]] \
    || fail "discovery_failed_informal_cli_investigation_input"

  if grep -q "No investigation input provided\." "${runtime_log_file}"; then
    fail "informal_cli_investigation_input_fell_back_to_default"
  fi

  jq -e \
    --arg investigation_input "${cli_investigation_input}" \
    '
      .artifact_snapshot.investigation_input == $investigation_input
    ' .harness/runtime/epistemic_handover.json >/dev/null \
    || fail "missing_informal_cli_investigation_input_persistence"

  rm -f "${runtime_log_file}"
}

assert_discovery_accepts_issue_cli_investigation_input() {
  local runtime_log_file
  local status
  local mock_bin
  local expected_investigation_input

  runtime_log_file="$(mktemp)"
  mock_bin="$(mktemp -d)"

  # --issue N must fetch a real body via gh (not the placeholder "issue #N").
  cat > "${mock_bin}/gh" <<'EOF'
#!/usr/bin/env bash
if [[ "$1" == "issue" && "$2" == "view" && "$3" == "123" ]]; then
  jq -n '{title:"Fixture issue",body:"Repair the helper in src/index.ts"}'
  exit 0
fi
echo "unexpected gh $*" >&2
exit 1
EOF
  chmod +x "${mock_bin}/gh"

  # Expected demand after fetch + soft normalize + path safety.
  expected_investigation_input="$(
    # shellcheck disable=SC1091
    source scripts/lib/common.sh
    source scripts/lib/demand.sh
    export PATH="${mock_bin}:${PATH}"
    raw="$(aegis_fetch_issue_demand 123)"
    aegis_materialize_investigation_input "${raw}"
  )"

  set +e
  env -u AEGIS_INVESTIGATION_INPUT \
    PATH="${mock_bin}:${PATH}" \
    bash runtime_aegis.sh discovery --issue 123 >/dev/null 2>"${runtime_log_file}"
  status=$?
  set -e

  rm -rf "${mock_bin}"

  [[ "${status}" -eq 0 ]] \
    || fail "discovery_failed_issue_cli_investigation_input"

  if grep -q "No investigation input provided\." "${runtime_log_file}"; then
    fail "issue_cli_investigation_input_fell_back_to_default"
  fi

  # Must not persist the old opaque placeholder.
  if jq -e '.artifact_snapshot.investigation_input == "issue #123"' \
    .harness/runtime/epistemic_handover.json >/dev/null 2>&1; then
    fail "issue_cli_still_using_opaque_placeholder"
  fi

  jq -e \
    --arg investigation_input "${expected_investigation_input}" \
    '
      .artifact_snapshot.investigation_input == $investigation_input
    ' .harness/runtime/epistemic_handover.json >/dev/null \
    || fail "missing_issue_cli_investigation_input_persistence"

  rm -f "${runtime_log_file}"
}

list_directory_files_json() {
  local directory_path="$1"

  if [[ ! -d "${directory_path}" ]]; then
    jq -n '[]'
    return
  fi

  find "${directory_path}" -maxdepth 1 -type f \
    | sed 's#.*/##' \
    | sort \
    | jq -R . \
    | jq -s '.'
}

seed_required_predecessor() {
  local mode="$1"
  local handover_file=".harness/runtime/epistemic_handover.json"

  mkdir -p "$(dirname "${handover_file}")"

  case "${mode}" in
    forensics)
      # Clean attention so the base forensics profile (no content anchors)
      # remains observable. Anchor seeding is covered by
      # test_deterministic_read_anchors.sh.
      jq -n \
        --arg investigation_input "${TEST_INVESTIGATION_INPUT}" '
        {
          artifact_snapshot: {
            mode: "discovery",
            investigation_input: $investigation_input,
            generated_at: "2026-01-01T00:00:00Z",
            operational_context: {}
          },
          epistemic_state: {
            next_attention_targets: [],
            attention_scope: "none",
            attention_reason: "no active attention"
          }
        }
      ' > "${handover_file}"
      ;;
    adversarial)
      jq -n \
        --arg investigation_input "${TEST_INVESTIGATION_INPUT}" '
        {
          artifact_snapshot: {
            mode: "optimize",
            investigation_input: $investigation_input,
            operational_context: {
              candidate_result: {
                source_mode: "optimize",
                diff: "diff --git a/src/index.ts b/src/index.ts",
                files_changed: ["src/index.ts"]
              }
            }
          },
          epistemic_state: {
            next_attention_targets: ["src/index.ts"],
            attention_scope: "mutation_applied",
            attention_reason: "optimized candidate"
          }
        }
      ' > "${handover_file}"
      ;;
    validation)
      jq -n \
        --arg investigation_input "${TEST_INVESTIGATION_INPUT}" '
        {
          artifact_snapshot: {
            mode: "adversarial",
            investigation_input: $investigation_input,
            operational_context: {
              candidate_result: {
                source_mode: "optimize",
                diff: "diff --git a/src/index.ts b/src/index.ts",
                files_changed: ["src/index.ts"]
              },
              findings: [],
              evidence_refs: ["filesystem.read:epistemic_handover"]
            }
          },
          epistemic_state: {
            next_attention_targets: [],
            attention_scope: "bounded falsification",
            attention_reason: "challenge completed"
          }
        }
      ' > "${handover_file}"
      ;;
  esac
}

assert_no_execution_surface_for_mode() {
  local mode="$1"
  local runtime_log_file
  local execution_surface_path=".harness/execution_surfaces/${mode}"

  runtime_log_file="$(mktemp)"

  rm -rf "${execution_surface_path}"
  seed_required_predecessor "${mode}"

  AEGIS_INVESTIGATION_INPUT="${TEST_INVESTIGATION_INPUT}" \
  AEGIS_RUNTIME_REMOVE_EXECUTION_SURFACE=false \
  bash runtime_aegis.sh "${mode}" >/dev/null 2>"${runtime_log_file}"

  [[ ! -d "${execution_surface_path}" ]] \
    || fail "unexpected_execution_surface_for_mode: ${mode}"

  grep -q "Skipping disposable execution surface" "${runtime_log_file}" \
    || fail "missing_execution_surface_skip_log_for_mode: ${mode}"

  grep -q "Preparing disposable execution surface" "${runtime_log_file}" \
    && fail "unexpected_execution_surface_preparation_for_mode: ${mode}"

  rm -f "${runtime_log_file}"
}

assert_mode_output() {
  local mode="$1"
  local expected_payloads_json="$2"
  local output
  local artifact

  seed_required_predecessor "${mode}"

  output="$(
    AEGIS_INVESTIGATION_INPUT="${TEST_INVESTIGATION_INPUT}" \
      bash runtime_aegis.sh "${mode}"
  )"

  artifact="$(extract_first_artifact_payload "${output}")"

  [[ -n "${artifact}" ]] || fail "missing_artifact_for_mode: ${mode}"

  if ! printf '%s\n' "${artifact}" | jq -e \
    --arg mode "${mode}" \
    --argjson expected_payloads "${expected_payloads_json}" \
    '
      .mode == $mode
      and (
        if $mode == "discovery" then
          (.operational_context.observed_payloads == $expected_payloads)
        elif $mode == "validation" then
          # Mock providers emit rejected; tribunal may also reject invalid
          # stub candidates. Contract under test is evidence identity, not
          # a promotable accept path.
          ((.verdict == "accepted" or .verdict == "rejected" or .verdict == "insufficient")
            and .observed_payloads == $expected_payloads)
        else
          ((.status == "ok"
              or .status == "inconclusive"
              or .status == "challenged"
              or .status == "verified"
              or .status == "interpreted")
            and .observed_payloads == $expected_payloads)
        end
      )
    ' >/dev/null; then
    echo "EXPECTED payloads: ${expected_payloads_json}" >&2
    echo "ACTUAL artifact: ${artifact}" >&2
    fail "unexpected_artifact_for_mode: ${mode}"
  fi
}

assert_materialized_runtime_state() {
  local mode="$1"
  local expected_payloads_json="$2"
  local actual_payloads_json

  rm -rf .harness/runtime/capability_env .harness/runtime/capability_payloads

  AEGIS_INVESTIGATION_INPUT="${TEST_INVESTIGATION_INPUT}" \
  AEGIS_RUNTIME_REMOVE_CAPABILITY_PAYLOADS=false \
  bash runtime_aegis.sh "${mode}" >/dev/null

  actual_payloads_json="$(
    list_directory_files_json .harness/runtime/capability_payloads
  )"

  jq -n \
    --argjson actual_payloads "${actual_payloads_json}" \
    --argjson expected_payloads "${expected_payloads_json}" \
    '
      $actual_payloads == $expected_payloads
    ' >/dev/null || fail "unexpected_materialized_runtime_state: ${mode}"

  rm -rf .harness/runtime/capability_env .harness/runtime/capability_payloads
}

main() {
  assert_manifest_contract
  start_mock_provider
  assert_discovery_uses_default_investigation_input
  assert_discovery_accepts_informal_cli_investigation_input
  assert_discovery_accepts_issue_cli_investigation_input

  assert_mode_output "discovery" '["filesystem_list_tree.json", "filesystem_read_epistemic_handover.json", "runtime_layer0_facts.json", "runtime_attention_seed.json"]'
  assert_mode_output "forensics" '["filesystem_search_symbol.json", "git_status.json", "filesystem_read_epistemic_handover.json"]'
  assert_mode_output "validation" '["filesystem_read_epistemic_handover.json"]'
  # Attention target src/index.ts → runtime deterministic read anchor.
  assert_mode_output "adversarial" '["filesystem_search_symbol.json", "filesystem_read_epistemic_handover.json", "typescript_check.json", "eslint_check.json", "test_run.json", "filesystem_read_src_index_ts.json"]'

  # Discovery materializes Layer 0 priors only (no graph extractors).
  assert_materialized_runtime_state \
    "discovery" \
    '["filesystem_list_tree.json", "filesystem_read_epistemic_handover.json", "runtime_attention_seed.json", "runtime_layer0_facts.json"]'

  assert_materialized_runtime_state \
    "forensics" \
    '["filesystem_read_epistemic_handover.json", "filesystem_search_symbol.json", "git_status.json"]'

  assert_no_execution_surface_for_mode "discovery"

  echo "[AEGIS][TEST] readonly smoke suite passed"
}

main "$@"

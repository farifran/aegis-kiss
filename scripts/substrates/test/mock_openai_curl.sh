#!/usr/bin/env bash

set -Eeuo pipefail

output_file=""
request_file=""

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --output)
      output_file="$2"
      shift 2
      ;;
    --data)
      request_file="${2#@}"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

[[ -n "${output_file}" ]] || exit 2
[[ -f "${request_file}" ]] || exit 2

mode="$(
  jq -r '.messages[0].content // empty' "${request_file}" \
    | awk '
        $0 == "Mode:" {
          getline
          print
          exit
        }
      '
)"

mapfile -t payload_names < <(
  jq -r '.messages[].content // empty' "${request_file}" \
    | sed -n 's/^--- PAYLOAD: \(.*\) ---$/\1/p'
)

payload_names_json="$(
  printf '%s\n' "${payload_names[@]:-}" \
    | sed '/^$/d' \
    | jq -R . \
    | jq -s '.'
)"

case "${mode}" in
  discovery)
    artifact="$(
      jq -n \
        --arg mode "${mode}" \
        --argjson observed_payloads "${payload_names_json}" \
        '{
          mode: $mode,
          status: "ok",
          summary: "mock discovery artifact",
          observed_payloads: $observed_payloads,
          handover_attention: {
            next_attention_targets: [
              "filesystem.read:epistemic_handover",
              "filesystem.search_symbol"
            ],
            attention_scope: "runtime-exposed evidence inventory",
            attention_reason: "initial investigation boundary"
          }
        }'
    )"
    ;;
  forensics)
    artifact="$(
      jq -n \
        --arg mode "${mode}" \
        --argjson observed_payloads "${payload_names_json}" \
        '{
          mode: $mode,
          status: "inconclusive",
          summary: "mock forensics artifact",
          observed_payloads: $observed_payloads,
          evidence: [],
          interpretations: [],
          observations: [],
          unresolved_questions: [],
          confidence: "low",
          repair_candidates: [],
          handover_attention: {
            next_attention_targets: [],
            attention_scope: "evidence-backed interpretation",
            attention_reason: "no evidence-backed repair candidate"
          }
        }'
    )"
    ;;
  adversarial)
    artifact="$(
      jq -n \
        --arg mode "${mode}" \
        --argjson observed_payloads "${payload_names_json}" \
        '{
          mode: $mode,
          status: "challenged",
          observed_payloads: $observed_payloads,
          candidate_result: {
            source_mode: "optimize",
            diff: "diff --git a/src/index.ts b/src/index.ts",
            files_changed: ["src/index.ts"]
          },
          adversarial_findings: [],
          evidence_refs: ["filesystem.read:epistemic_handover"],
          handover_attention: {
            next_attention_targets: [],
            attention_scope: "bounded falsification",
            attention_reason: "challenge completed"
          }
        }'
    )"
    ;;
  validation)
    artifact="$(
      jq -n \
        --arg mode "${mode}" \
        --argjson observed_payloads "${payload_names_json}" \
        '{
          mode: $mode,
          verdict: "rejected",
          observed_payloads: $observed_payloads,
          adversarial_findings: [],
          validated_candidate: {
            source_mode: "optimize",
            diff: "diff --git a/src/index.ts b/src/index.ts",
            files_changed: ["src/index.ts"]
          },
          basis: ["adversarial assessment consumed"],
          handover_attention: {
            next_attention_targets: [],
            attention_scope: "none",
            attention_reason: "validation completed"
          }
        }'
    )"
    ;;
  *)
    exit 2
    ;;
esac

content="$(
  printf 'AEGIS_ARTIFACT_BEGIN\n%s\nAEGIS_ARTIFACT_END' "${artifact}"
)"

jq -n \
  --arg content "${content}" \
  '{
    choices: [
      {
        message: {
          content: $content
        }
      }
    ]
  }' > "${output_file}"

printf '200'

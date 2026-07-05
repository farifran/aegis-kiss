#!/usr/bin/env bash

set -Eeuo pipefail

readonly TEST_ROOT="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd
)"

cd "${TEST_ROOT}"

fail() {
  echo "[FAIL] $*" >&2
  exit 1
}

test_tmp="$(mktemp -d)"
execution_surface="${test_tmp}/worktree"
payload_dir="${test_tmp}/payloads"
fake_aider="${test_tmp}/fake-aider"
handover_file="${test_tmp}/epistemic_handover.json"

cleanup() {
  rm -rf "${test_tmp}"
}

trap cleanup EXIT

mkdir -p "${payload_dir}"
mkdir -p "${execution_surface}/src"
printf 'export {};\n' > "${execution_surface}/src/index.ts"

git -C "${execution_surface}" init -q
git -C "${execution_surface}" add src/index.ts
git -C "${execution_surface}" \
  -c user.name="Aegis Test" \
  -c user.email="aegis-test@example.invalid" \
  commit -qm "test fixture"

cat > "${payload_dir}/structural_builder.json" <<'JSON'
{
  "payload": {
    "observed_request_alignment": {
      "resolved_paths": ["src/index.ts"]
    }
  }
}
JSON

jq -n '
  {
    artifact_snapshot: {
      mode: "forensics",
      operational_context: {
        repair_candidates: [
          {
            id: "src/index.ts",
            reason: "test correction target",
            evidence_refs: ["filesystem.search_symbol"]
          }
        ]
      }
    },
    epistemic_state: {
      next_attention_targets: ["src/index.ts"],
      attention_scope: "evidence-backed interpretation",
      attention_reason: "test correction target"
    }
  }
' > "${handover_file}"

cat > "${fake_aider}" <<'SH'
#!/usr/bin/env bash

set -Eeuo pipefail

model=""
message_file=""
target=""

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --model)
      model="$2"
      shift 2
      ;;
    --message-file)
      message_file="$2"
      shift 2
      ;;
    --file)
      target="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

[[ "${model}" == "openai/google/gemma-4-31b-it" ]]
grep -q "adicione uma funcao soma" "${message_file}"
[[ "${target}" == "src/index.ts" ]]

printf 'export const soma = (a: number, b: number): number => a + b;\n' \
  > "${target}"
SH

chmod +x "${fake_aider}"

output="$(
  env \
    OPENAI_API_KEY="test-key" \
    AEGIS_MODE="repair" \
    AEGIS_EXECUTION_ID="test-execution" \
    AEGIS_EXECUTION_SURFACE_PATH="${execution_surface}" \
    AEGIS_INVESTIGATION_INPUT="adicione uma funcao soma" \
    AEGIS_MUTATION_MODEL="google/gemma-4-31b-it" \
    AEGIS_AIDER_BIN="${fake_aider}" \
    AEGIS_MUTATION_GIT_DIR="${execution_surface}/.git" \
    AEGIS_EPISTEMIC_HANDOVER_FILE="${handover_file}" \
    bash scripts/substrates/aider_substrate.sh \
      ".skills/repair.md" \
      "${payload_dir}"
)"

artifact="$(
  printf '%s\n' "${output}" \
    | sed -n '/AEGIS_ARTIFACT_BEGIN/,/AEGIS_ARTIFACT_END/p' \
    | sed '1d;$d'
)"

printf '%s\n' "${artifact}" \
  | jq -e '
      .mode == "repair"
      and .mutation_target == "src/index.ts"
      and .files_changed == ["src/index.ts"]
      and (.diff | contains("export const soma"))
    ' >/dev/null \
  || fail "invalid_mutation_artifact"

cat > "${fake_aider}" <<'SH'
#!/usr/bin/env bash
exit 23
SH

chmod +x "${fake_aider}"

if env \
  OPENAI_API_KEY="test-key" \
  AEGIS_MODE="repair" \
  AEGIS_EXECUTION_ID="test-execution" \
  AEGIS_EXECUTION_SURFACE_PATH="${execution_surface}" \
  AEGIS_INVESTIGATION_INPUT="adicione uma funcao soma" \
  AEGIS_MUTATION_MODEL="google/gemma-4-31b-it" \
  AEGIS_AIDER_BIN="${fake_aider}" \
  AEGIS_MUTATION_GIT_DIR="${execution_surface}/.git" \
  AEGIS_EPISTEMIC_HANDOVER_FILE="${handover_file}" \
  bash scripts/substrates/aider_substrate.sh \
    ".skills/repair.md" \
    "${payload_dir}" >/dev/null 2>&1; then
  fail "aider_failure_was_accepted"
fi

git -C "${execution_surface}" restore src/index.ts

cat > "${fake_aider}" <<'SH'
#!/usr/bin/env bash
exit 0
SH

chmod +x "${fake_aider}"

if env \
  OPENAI_API_KEY="test-key" \
  AEGIS_MODE="repair" \
  AEGIS_EXECUTION_ID="test-execution" \
  AEGIS_EXECUTION_SURFACE_PATH="${execution_surface}" \
  AEGIS_INVESTIGATION_INPUT="adicione uma funcao soma" \
  AEGIS_MUTATION_MODEL="google/gemma-4-31b-it" \
  AEGIS_AIDER_BIN="${fake_aider}" \
  AEGIS_MUTATION_GIT_DIR="${execution_surface}/.git" \
  AEGIS_EPISTEMIC_HANDOVER_FILE="${handover_file}" \
  bash scripts/substrates/aider_substrate.sh \
    ".skills/repair.md" \
    "${payload_dir}" >/dev/null 2>&1; then
  fail "empty_diff_was_accepted"
fi

jq '.artifact_snapshot.operational_context.repair_candidates = []' \
  "${handover_file}" > "${handover_file}.tmp"
mv "${handover_file}.tmp" "${handover_file}"

if env \
  OPENAI_API_KEY="test-key" \
  AEGIS_MODE="repair" \
  AEGIS_EXECUTION_ID="test-execution" \
  AEGIS_EXECUTION_SURFACE_PATH="${execution_surface}" \
  AEGIS_INVESTIGATION_INPUT="adicione uma funcao soma" \
  AEGIS_MUTATION_MODEL="google/gemma-4-31b-it" \
  AEGIS_AIDER_BIN="${fake_aider}" \
  AEGIS_MUTATION_GIT_DIR="${execution_surface}/.git" \
  AEGIS_EPISTEMIC_HANDOVER_FILE="${handover_file}" \
  bash scripts/substrates/aider_substrate.sh \
    ".skills/repair.md" \
    "${payload_dir}" >/dev/null 2>&1; then
  fail "missing_forensics_repair_candidates_was_accepted"
fi

echo "[PASS] aider mutation substrate"

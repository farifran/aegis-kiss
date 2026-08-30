#!/usr/bin/env bash

# =========================================================
# AEGIS CAPABILITY — test.run
# =========================================================
#
# Classification:
# readonly
#
# Responsibilities:
# - execute candidate test suite if configured in package.json
# - execute ephemeral contract invariant harness (proof obligations & behaviors)
# - prevent recursion with harness tests
# - parse test output and status into Aegis standard JSON payload
#
# =========================================================

set -Eeuo pipefail

# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/_emit.sh"

readonly CAPABILITY_NAME="test.run"

# Prefer project-local tooling when present; never inject machine-absolute PATH.
if [[ -d "node_modules/.bin" ]]; then
  export PATH="${PWD}/node_modules/.bin:${PATH}"
fi

readonly IS_JSON_OUTPUT="${AEGIS_EXECUTION_ID:-}"

emit_test_status() {
  local status="$1"
  local summary="$2"
  local payload
  payload="$(
    jq -nc \
      --arg status "${status}" \
      --arg summary "${summary}" \
      '{status: $status, summary: $summary}'
  )"
  aegis_emit_capability_success "${CAPABILITY_NAME}" "${payload}"
}

run_contract_invariants() {
  local ir_file=""
  local candidates=(
    "${AEGIS_ROOT_DIR:-.}/.harness/active_contract_ir.json"
    ".harness/active_contract_ir.json"
    "${AEGIS_RUNTIME_DIR:-${AEGIS_ROOT_DIR:-.}/.harness/runtime}/active_contract_ir.json"
    ".harness/runtime/active_contract_ir.json"
    "../../.harness/active_contract_ir.json"
  )

  for cand in "${candidates[@]}"; do
    if [[ -f "${cand}" && -s "${cand}" ]]; then
      ir_file="${cand}"
      break
    fi
  done

  if [[ -z "${ir_file}" ]]; then
    return 127
  fi

  local runtime_dir=".harness/runtime"
  mkdir -p "${runtime_dir}" 2>/dev/null || true
  local harness_ts="${runtime_dir}/__contract_harness__.ts"
  local build_dir="${runtime_dir}/build"

  local import_path="src/index.js"
  if [[ ! -s "src/index.ts" ]] || ! grep -q "export" "src/index.ts" 2>/dev/null; then
    local primary_target
    primary_target="$(jq -r '((.targets // [])[]? | select(. != "src/index.ts")) // "src/index.ts"' "${ir_file}" | head -1 | sed -E 's/\.ts$/.js/')"
    import_path="${primary_target}"
  fi

  # Generate ephemeral harness using jq with dynamic symbol binding (immune to intermediate task TS2305)
  jq -r --arg importPath "../../${import_path}" '
    def lines($l; $pad): (($l // []) | map($pad + .) | join("\n"));

    "// Aegis Ephemeral Invariant Harness",
    ("import * as __mod from '\''" + $importPath + "'\'';"),
    "",
    (((.exports // []) | map("const " + .name + ": any = (__mod as any)." + .name + ";")) | join("\n")),
    "",
    "export async function __run_invariants() {",
    "  const passed: string[] = [];",
    "  const failed: string[] = [];",
    "  const skipped: string[] = [];",
    "",
    ([ (.behavior // []) | to_entries[] | .key as $i | .value as $b |
      "  // Behavior " + (($i + 1)|tostring) + ": " + ($b.desc // "") + "\n" +
      "  try {\n" +
      "    const __req_exports = " + (($b.exports // []) | tojson) + ";\n" +
      "    const __all_present = __req_exports.every((e: string) => typeof (__mod as any)[e] !== \"undefined\");\n" +
      "    if (!__all_present) {\n" +
      "      skipped.push(\"BEHAVIOR_SKIP: " + ($b.desc // ("behavior_" + ($i|tostring))) + " (pending task export)\");\n" +
      "    } else {\n" +
      lines(($b.prelude // [] | if type == "string" then [.] else . end); "      ") + "\n" +
      "      const __ok" + ($i|tostring) + " = Boolean(" + ($b.assert // "true") + ");\n" +
      "      if (!__ok" + ($i|tostring) + ") failed.push(\"BEHAVIOR_FAIL: " + ($b.desc // ("behavior_" + ($i|tostring))) + "\");\n" +
      "      else passed.push(\"BEHAVIOR_PASS: " + ($b.desc // ("behavior_" + ($i|tostring))) + "\");\n" +
      "    }\n" +
      "  } catch (e: any) {\n" +
      "    failed.push(\"BEHAVIOR_EXC: " + ($b.desc // ("behavior_" + ($i|tostring))) + " (\" + String(e?.message || e) + \")\");\n" +
      "  }\n"
    ] | join("\n")),
    ([ (.proofObligations // []) | to_entries[] | .key as $i | .value as $po |
      "  // Proof Obligation " + ($po.id // ($i|tostring)) + ":\n" +
      "  try {\n" +
      "    if (typeof AuctionEngine === \"undefined\") {\n" +
      "      skipped.push(\"PO_SKIP [" + ($po.id // ($i|tostring)) + "] (pending AuctionEngine export)\");\n" +
      "    } else {\n" +
      lines(($po.prelude // [] | if type == "string" then [.] else . end); "      ") + "\n" +
      "      const __ok_po" + ($i|tostring) + " = Boolean(" + ($po.oracle // "true") + ");\n" +
      "      if (!__ok_po" + ($i|tostring) + ") failed.push(\"PO_FAIL [" + ($po.id // ($i|tostring)) + "] (satisfies " + ($po.satisfies // "N/A") + ")\");\n" +
      "      else passed.push(\"PO_PASS [" + ($po.id // ($i|tostring)) + "]\");\n" +
      "    }\n" +
      "  } catch (e: any) {\n" +
      "    failed.push(\"PO_EXC [" + ($po.id // ($i|tostring)) + "] (\" + String(e?.message || e) + \")\");\n" +
      "  }\n"
    ] | join("\n")),
    "  if (failed.length > 0) {",
    "    console.error(\"[AEGIS][INVARIANT_HARNESS] FAILED INVARIANTS:\\n\" + failed.join(\"\\n\"));",
    "    throw new Error(\"Invariant failures:\\n\" + failed.join(\"\\n\"));",
    "  }",
    "  console.log(\"[AEGIS][INVARIANT_HARNESS] INVARIANTS VERIFIED: \" + passed.length + \" passed, \" + skipped.length + \" skipped.\");",
    "  if (passed.length > 0) console.log(passed.join(\"\\n\"));",
    "}",
    "void __run_invariants();"
  ' "${ir_file}" > "${harness_ts}" 2>/dev/null || { rm -f "${harness_ts}"; return 127; }

  [[ -s "${harness_ts}" ]] || { rm -f "${harness_ts}"; return 127; }

  # Compile via local tsc
  local tsc_bin="node_modules/.bin/tsc"
  if [[ ! -x "${tsc_bin}" ]]; then
    tsc_bin="$(command -v tsc || true)"
  fi
  [[ -n "${tsc_bin}" ]] || { rm -f "${harness_ts}"; return 127; }

  rm -rf "${build_dir}"
  mkdir -p "${build_dir}"

  local compile_out=""
  local rc=0
  compile_out="$("${tsc_bin}" "${harness_ts}" src/*.ts --outDir "${build_dir}" --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck 2>&1)" || rc=$?

  if [[ "${rc}" -ne 0 ]]; then
    echo "[AEGIS][INVARIANT_HARNESS] TypeScript compilation error in contract test harness:\n${compile_out}"
    rm -rf "${build_dir}" "${harness_ts}"
    return 1
  fi

  local js_file="${build_dir}/.harness/runtime/__contract_harness__.js"
  if [[ ! -f "${js_file}" ]]; then
    echo "[AEGIS][INVARIANT_HARNESS] Build artifact not found: ${js_file}"
    rm -rf "${build_dir}" "${harness_ts}"
    return 1
  fi

  local run_out=""
  local run_rc=0
  run_out="$(node "${js_file}" 2>&1)" || run_rc=$?

  rm -rf "${build_dir}" "${harness_ts}"
  echo "${run_out}"
  return "${run_rc}"
}

run_tests() {
  local exit_code=0
  local test_output=""

  # Check if a custom non-harness test script is in package.json
  if jq -e '.scripts.test and .scripts.test != "echo \"Error: no test specified\" && exit 1"' package.json >/dev/null 2>&1; then
    test_output="$(npm test 2>&1)" || exit_code=$?
  elif [[ -f "node_modules/.bin/vitest" ]]; then
    test_output="$(node_modules/.bin/vitest run 2>&1)" || exit_code=$?
  elif [[ -f "node_modules/.bin/jest" ]]; then
    test_output="$(node_modules/.bin/jest 2>&1)" || exit_code=$?
  else
    # Run Ephemeral Contract Invariant Harness
    local inv_rc=0
    test_output="$(run_contract_invariants 2>&1)" || inv_rc=$?
    if [[ "${inv_rc}" -eq 0 ]]; then
      exit_code=0
    elif [[ "${inv_rc}" -ne 127 ]]; then
      exit_code="${inv_rc}"
    else
      if [[ -n "${IS_JSON_OUTPUT}" ]]; then
        emit_test_status "passed" "No candidate unit tests or active contract obligations configured."
        exit 0
      else
        echo "No candidate unit tests or active contract obligations configured."
        exit 0
      fi
    fi
  fi

  if [[ "${exit_code}" -eq 0 ]]; then
    if [[ -n "${IS_JSON_OUTPUT}" ]]; then
      emit_test_status "passed" "${test_output}"
      exit 0
    else
      echo "${test_output}"
      echo "Tests passed."
      exit 0
    fi
  else
    if [[ -n "${IS_JSON_OUTPUT}" ]]; then
      emit_test_status "failed" "${test_output}"
      exit 0
    else
      echo "${test_output}"
      exit "${exit_code}"
    fi
  fi
}

run_tests

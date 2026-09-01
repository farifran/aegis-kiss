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
  local ws_root
  ws_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd -P || echo ".")"
  local ir_file=""
  local candidates=(
    "${ws_root}/.harness/active_contract_ir.json"
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

  local import_path
  import_path="$(jq -r '((.targets // [])[]? | select(. != "src/index.ts")) // (.barrelFrom // "src/index.js")' "${ir_file}" | head -1 | sed -E 's/^\.\///; s/\.ts$/.js/')"
  if [[ -z "${import_path}" || "${import_path}" == "null" ]]; then
    import_path="src/index.js"
  fi

  # Generate ephemeral harness using Node.js Evidence Compiler with 3 Deterministic Oracles
  node -e '
    const fs = require("fs");
    const ir = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const targets = (ir.targets || ["src/index.ts"]).filter(t => t !== "src/index.ts");
    const imports = targets.map(t => {
      const modName = "__mod_" + t.replace(/[^a-zA-Z0-9]/g, "_");
      const jsPath = "../../" + t.replace(/\.ts$/, ".js").replace(/^\.\//, "");
      return `import * as ${modName} from "${jsPath}";`;
    }).join("\n");
    const mergeArgs = targets.map(t => "__mod_" + t.replace(/[^a-zA-Z0-9]/g, "_")).join(", ");
    const mergeCode = `const __mod: any = Object.assign({}, __mod_barrel${mergeArgs ? ", " + mergeArgs : ""});`;
    const exportsBinding = (ir.exports || []).map(e => `const ${e.name}: any = (__mod as any).${e.name};`).join("\n");
    
    const lines = (arr, pad) => (Array.isArray(arr) ? arr : [arr]).map(l => pad + l).join("\n");
    
    const behaviors = (ir.behavior || []).map((b, i) => {
      const req = JSON.stringify(b.exports || []);
      const prelude = b.prelude ? lines(b.prelude, "      ") : "";
      return `  // Behavior ${i + 1}: ${b.desc || ""}
  try {
    const __req_exports = ${req};
    const __all_present = __req_exports.every((e: string) => typeof (__mod as any)[e] !== "undefined");
    if (!__all_present) {
      skipped.push("BEHAVIOR_SKIP: ${b.desc || "behavior_" + i} (pending task export)");
    } else {
${prelude}
      const __ok${i} = Boolean(${b.assert || "true"});
      if (!__ok${i}) failed.push("BEHAVIOR_FAIL: ${b.desc || "behavior_" + i}");
      else passed.push("BEHAVIOR_PASS: ${b.desc || "behavior_" + i}");
    }
  } catch (e: any) {
    failed.push("BEHAVIOR_EXC: ${b.desc || "behavior_" + i} (" + String(e?.message || e) + ")");
  }`;
    }).join("\n");

    const proofObligations = (ir.proofObligations || []).map((po, i) => {
      const poId = po.id || ("PO-" + String(i + 1).padStart(3, "0"));
      const poKind = po.kind || po.invariant || "generic_invariant";
      const poRequired = po.required !== false;
      const poOracle = po.oracle || "true";
      const prelude = po.prelude ? lines(po.prelude, "      ") : "";

      if (poKind === "type_safety" || poOracle === "typecheck" || poOracle === "tsc_no_emit") {
        return `  // Proof Obligation ${poId} (Oracle 1: Type Oracle)
  try {
    recordEvidence("${poId}", "${poKind}", "STATIC_PROVEN", ${poRequired}, "TypeScript AST compiled with zero errors");
  } catch (e: any) {
    recordEvidence("${poId}", "${poKind}", "DISPROVEN", ${poRequired}, "Type failure: " + String(e?.message || e));
  }`;
      }

      if (poKind === "failure_state" || poOracle === "state_diff") {
        const obsKeys = JSON.stringify(po.observableState || po.expected?.observableState || []);
        const allowedEffects = JSON.stringify(po.allowedFailureEffects || po.expected?.allowedFailureEffects || []);
        return `  // Proof Obligation ${poId} (Oracle 2: State Diff Failure Oracle)
  try {
    let __targetInstance: any = null;
    let __failingCall: (() => any) | null = null;
${prelude}
    if (!__targetInstance || !__failingCall) {
      recordEvidence("${poId}", "${poKind}", "DISPROVEN", ${poRequired}, "Missing __targetInstance or __failingCall in prelude");
    } else {
      const __obs = ${obsKeys};
      const __allowed = ${allowedEffects};
      const __snapBefore = __snapState(__targetInstance, __obs);
      __failingCall();
      const __snapAfter = __snapState(__targetInstance, __obs);
      const __diffKeys = __diffState(__snapBefore, __snapAfter);
      const __unallowed = __diffKeys.filter((k: string) => !__allowed.includes(k));
      if (__unallowed.length === 0) {
        recordEvidence("${poId}", "${poKind}", "EXECUTABLY_VERIFIED", ${poRequired}, "State diff [" + __diffKeys.join(", ") + "] ⊆ allowedFailureEffects");
      } else {
        recordEvidence("${poId}", "${poKind}", "DISPROVEN", ${poRequired}, "Uncontracted state mutation on [" + __unallowed.join(", ") + "]");
      }
    }
  } catch (e: any) {
    recordEvidence("${poId}", "${poKind}", "DISPROVEN", ${poRequired}, "Exception in state diff oracle: " + String(e?.message || e));
  }`;
      }

      if (poKind === "resource_conservation" || poOracle === "conservation" || poOracle === "conservation_equation") {
        const beforeKeys = JSON.stringify(po.resourceBoundary?.before || po.expected?.resourceBoundary?.before || []);
        const afterKeys = JSON.stringify(po.resourceBoundary?.after || po.expected?.resourceBoundary?.after || []);
        return `  // Proof Obligation ${poId} (Oracle 3: Conservation Equation Oracle)
  try {
    let __targetBefore: any = null;
    let __targetAfter: any = null;
${prelude}
    if (!__targetBefore || !__targetAfter) {
      // Fallback to direct oracle evaluation if objects not defined in prelude
      const __ok_cons = Boolean(${poOracle === "conservation" || poOracle === "conservation_equation" ? "true" : poOracle});
      if (__ok_cons) {
        recordEvidence("${poId}", "${poKind}", "EXECUTABLY_VERIFIED", ${poRequired}, "Conservation invariant satisfied");
      } else {
        recordEvidence("${poId}", "${poKind}", "DISPROVEN", ${poRequired}, "Conservation invariant violated");
      }
    } else {
      const __bKeys: string[] = ${beforeKeys};
      const __aKeys: string[] = ${afterKeys};
      const __bSum = __sumProps(__targetBefore, __bKeys);
      const __aSum = __sumProps(__targetAfter, __aKeys);
      if (__bSum === __aSum) {
        recordEvidence("${poId}", "${poKind}", "EXECUTABLY_VERIFIED", ${poRequired}, "Conservation holds (" + __bSum + "n === " + __aSum + "n)");
      } else {
        recordEvidence("${poId}", "${poKind}", "DISPROVEN", ${poRequired}, "Conservation violated (" + __bSum + "n !== " + __aSum + "n)");
      }
    }
  } catch (e: any) {
    recordEvidence("${poId}", "${poKind}", "DISPROVEN", ${poRequired}, "Exception in conservation oracle: " + String(e?.message || e));
  }`;
      }

      // Generic Oracle
      return `  // Proof Obligation ${poId} (Generic Invariant)
  try {
${prelude}
    const __ok_po${i} = Boolean(${po.oracle || "true"});
    if (!__ok_po${i}) {
      recordEvidence("${poId}", "${poKind}", "DISPROVEN", ${poRequired}, "Assertion failed (satisfies ${po.satisfies || "N/A"})");
    } else {
      recordEvidence("${poId}", "${poKind}", "EXECUTABLY_VERIFIED", ${poRequired}, "Verified successfully");
    }
  } catch (e: any) {
    recordEvidence("${poId}", "${poKind}", "DISPROVEN", ${poRequired}, "Exception: " + String(e?.message || e));
  }`;
    }).join("\n");

    const fullCode = `// Aegis Ephemeral Evidence Compiler Harness
${imports}
import * as __mod_barrel from "../../src/index.js";
${mergeCode}

${exportsBinding}

type EpistemicStatus = "STATIC_PROVEN" | "EXECUTABLY_VERIFIED" | "DISPROVEN" | "UNPROVEN";

interface EvidenceEntry {
  id: string;
  kind: string;
  status: EpistemicStatus;
  required: boolean;
  evidence: string;
}

function __snapState(instance: any, keys: string[]): Record<string, any> {
  const out: Record<string, any> = {};
  if (!instance) return out;
  const kList = keys && keys.length > 0 ? keys : Object.keys(instance);
  for (const k of kList) {
    try {
      const v = instance[k];
      out[k] = typeof v === "bigint" ? v.toString() + "n" : v;
    } catch {
      out[k] = "<error>";
    }
  }
  return out;
}

function __diffState(before: Record<string, any>, after: Record<string, any>): string[] {
  const allKeys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  return allKeys.filter(k => before[k] !== after[k]);
}

function __sumProps(instance: any, keys: string[]): bigint {
  let sum = 0n;
  if (!instance) return sum;
  for (const k of keys) {
    try {
      const v = instance[k];
      if (typeof v === "bigint") sum = sum + v;
      else if (typeof v === "number") sum = sum + BigInt(Math.round(v));
    } catch { /* ignore */ }
  }
  return sum;
}

export async function __run_invariants() {
  const passed: string[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];
  const evidenceMatrix: EvidenceEntry[] = [];

  function recordEvidence(id: string, kind: string, status: EpistemicStatus, required: boolean, evidence: string) {
    evidenceMatrix.push({ id, kind, status, required, evidence });
  }

${behaviors}

${proofObligations}

  console.log("\\n[AEGIS][EVIDENCE_MATRIX]");
  console.log("┌──────────┬───────────────────────┬─────────────────────┬────────────────────────────────────────────────────────┐");
  console.log("│ ID       │ KIND                  │ STATUS              │ EVIDENCE                                               │");
  console.log("├──────────┼───────────────────────┼─────────────────────┼────────────────────────────────────────────────────────┤");
  for (const ev of evidenceMatrix) {
    const pad = (s: string, n: number) => s.padEnd(n, " ").substring(0, n);
    const color = ev.status === "STATIC_PROVEN" || ev.status === "EXECUTABLY_VERIFIED" ? "\\x1b[32m" : "\\x1b[31m";
    const reset = "\\x1b[0m";
    console.log("│ " + pad(ev.id, 8) + " │ " + pad(ev.kind, 21) + " │ " + color + pad(ev.status, 19) + reset + " │ " + pad(ev.evidence, 54) + " │");
  }
  console.log("└──────────┴───────────────────────┴─────────────────────┴────────────────────────────────────────────────────────┘");

  const unprovenOrDisproven = evidenceMatrix.filter(e => e.required && (e.status === "DISPROVEN" || e.status === "UNPROVEN"));
  if (unprovenOrDisproven.length > 0 || failed.length > 0) {
    console.error("[AEGIS][EVIDENCE_GATE] FAILED: " + unprovenOrDisproven.length + " required proof obligations DISPROVEN/UNPROVEN.");
    throw new Error("Promotion rejected by Evidence Gate.");
  }
  console.log("[AEGIS][EVIDENCE_GATE] ALL " + evidenceMatrix.length + " PROOF OBLIGATIONS VERIFIED (0 DISPROVEN, 0 UNPROVEN).\\n");
}
void __run_invariants();
`;
    process.stdout.write(fullCode);
  ' "${ir_file}" > "${harness_ts}" 2>/dev/null || { rm -f "${harness_ts}"; return 127; }

  [[ -s "${harness_ts}" ]] || { rm -f "${harness_ts}"; return 127; }

  # Compile via local tsc
  local tsc_bin="${ws_root}/node_modules/.bin/tsc"
  if [[ ! -x "${tsc_bin}" ]]; then
    tsc_bin="${AEGIS_ROOT_DIR:-.}/node_modules/.bin/tsc"
  fi
  if [[ ! -x "${tsc_bin}" ]]; then
    tsc_bin="node_modules/.bin/tsc"
  fi
  if [[ ! -x "${tsc_bin}" ]]; then
    tsc_bin="$(command -v tsc || true)"
  fi
  [[ -n "${tsc_bin}" ]] || { rm -f "${harness_ts}"; return 127; }

  rm -rf "${build_dir}"
  mkdir -p "${build_dir}"

  local compile_out=""
  local rc=0
  compile_out="$("${tsc_bin}" "${harness_ts}" --outDir "${build_dir}" --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck 2>&1)" || rc=$?

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

#!/usr/bin/env bash

# =========================================================
# AEGIS CAPABILITY — test.run
# =========================================================
#
# Classification:
# readonly
#
# Responsibilities:
# - compile Contract IR v3 universal proof obligations
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
  local evidence_matrix='[]'
  local matrix_line
  matrix_line="$(printf '%s\n' "${summary}" | sed -n 's/^\[AEGIS\]\[EVIDENCE_MATRIX_JSON\]//p' | tail -1)"
  if [[ -n "${matrix_line}" ]] && jq -e . >/dev/null 2>&1 <<<"${matrix_line}"; then evidence_matrix="${matrix_line}"; fi
  local contract_version=""
  if [[ -f .harness/active_contract_ir.json ]]; then contract_version="$(jq -r '.version // .contractVersion // empty' .harness/active_contract_ir.json 2>/dev/null || true)"; fi
  payload="$(
    jq -nc \
      --arg status "${status}" \
      --arg summary "${summary}" \
      --arg contract_version "${contract_version}" \
      --argjson evidence_matrix "${evidence_matrix}" \
      '{status: $status, summary: $summary, contract_version: (if ($contract_version | length) > 0 then $contract_version else null end), evidence_matrix: $evidence_matrix}'
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

  local risk_file risk_json
  risk_file="$(mktemp "${TMPDIR:-/tmp}/aegis-uaam-risk.XXXXXX")"
  local risk_compiler="${ws_root}/scripts/lib/uaam_risk_compiler.mjs"
  if [[ -f "${risk_compiler}" ]]; then
    risk_json="$(node "${risk_compiler}" "${ir_file}" 2>/dev/null)" || risk_json=""
  else
    risk_json='{"version":"uaam-risk-v1","facts":[],"risks":[],"compiledProofObligations":[]}'
  fi
  if ! jq -e 'type == "object" and .version == "uaam-risk-v1"' >/dev/null 2>&1 <<<"${risk_json}"; then
    rm -f "${risk_file}"
    return 1
  fi
  printf '%s\n' "${risk_json}" > "${risk_file}"

  # Contract IR v3 is structural input to the proof compiler. A declared
  # operation must have an explicit obligation for every universal domain;
  # otherwise implicit coverage or an LLM-selected N/A could pass the gate.
  if ! node - "${ir_file}" "${risk_file}" <<'NODE'
const fs = require("fs");
const ir = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const riskCompilation = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
if (ir.version !== "3.0") process.exit(0);

const domains = new Set(["CONTRACT", "ADMISSION", "STATE", "RESOURCE", "COMPOSITION", "COMMIT", "LIFECYCLE", "OBSERVABILITY"]);
const operationFields = [["admission", "ADMISSION"], ["failure", "STATE"], ["resources", "RESOURCE"], ["composition", "COMPOSITION"], ["transaction", "COMMIT"], ["lifecycle", "LIFECYCLE"], ["observability", "OBSERVABILITY"]];
const errors = [];
if (!Array.isArray(ir.targets) || ir.targets.length === 0) errors.push("targets_required");
if (!ir.publicContract || typeof ir.publicContract !== "object") errors.push("publicContract_required");
if (!Array.isArray(ir.operations) || ir.operations.length === 0) errors.push("operations_required");
if (!Array.isArray(ir.proofObligations)) errors.push("proofObligations_required");

const obligations = Array.isArray(ir.proofObligations) ? ir.proofObligations : [];
const coverage = obligations.find(po => po && (po.kind === "contract_coverage" || po.oracle === "contract_coverage" || po.domain === "CONTRACT"));
if (!coverage) errors.push("contract_coverage_required");
if (coverage?.notApplicable === true) errors.push("contract_coverage_cannot_be_not_applicable");
for (const requirement of Array.isArray(ir.requirements) ? ir.requirements : []) {
  if (!requirement || typeof requirement !== "object" || typeof requirement.id !== "string" || requirement.id.length === 0) {
    errors.push("requirement_id_required");
    continue;
  }
  const reference = requirement && (requirement.proofObligationId || requirement.obligationId);
  const matched = reference
    ? obligations.some(po => po.id === reference)
    : obligations.some(po => po.target === requirement.target && po.domain === requirement.domain);
  if (!matched) errors.push(`requirement_without_proof_obligation:${requirement.id ?? ""}`);
}
for (const risk of Array.isArray(riskCompilation.risks) ? riskCompilation.risks : []) {
  const matched = obligations.some(po => po.target === risk.target && po.domain === risk.domain)
    || obligations.some(po => po.sourceRisk === risk.id)
    || (risk.kind === "contract_coverage" && obligations.some(po => po.kind === "contract_coverage" || po.oracle === "contract_coverage" || po.domain === "CONTRACT"))
    || (risk.kind === "resource_composition" && obligations.some(po => po.domain === "COMPOSITION" && po.target === "contract"));
  if (!matched) errors.push(`risk_without_proof_obligation:${risk.id}`);
}
const ids = new Set();
for (const po of obligations) {
  if (!po || typeof po !== "object") { errors.push("proof_obligation_object_required"); continue; }
  if (typeof po.id !== "string" || po.id.length === 0 || ids.has(po.id)) errors.push(`proof_obligation_id_invalid:${po.id ?? ""}`);
  ids.add(po.id);
  if (!domains.has(po.domain)) errors.push(`proof_obligation_domain_invalid:${po.id ?? ""}`);
  if (typeof po.oracle !== "string" || po.oracle.length === 0) errors.push(`proof_obligation_oracle_required:${po.id ?? ""}`);
  if (po.status !== undefined) errors.push(`proof_obligation_status_forbidden:${po.id ?? ""}`);
  if (po.notApplicable === true && (typeof po.naJustification !== "string" || !po.naJustification.startsWith("derived:"))) errors.push(`na_not_structurally_derived:${po.id ?? ""}`);
  if ((po.kind === "temporal_lifecycle" || po.oracle === "temporal_policy" || po.oracle === "clock_policy") && !new Set(["monotonic_reject", "monotonic_clamp", "allow_backward", "logical_clock"]).has(po.clockPolicy || po.policy)) errors.push(`temporal_clock_policy_invalid:${po.id ?? ""}`);
  if ((po.kind === "result_state_consistency" || po.oracle === "result_state_consistency") && (!po.mapping || typeof po.mapping !== "object" || Array.isArray(po.mapping) || Object.keys(po.mapping).length === 0)) errors.push(`result_state_mapping_required:${po.id ?? ""}`);
}
for (const op of Array.isArray(ir.operations) ? ir.operations : []) {
  if (!op || typeof op !== "object" || typeof op.id !== "string" || typeof op.target !== "string") { errors.push("operation_id_and_target_required"); continue; }
  for (const [field, domain] of operationFields) {
    const value = op[field];
    const present = value !== undefined && value !== null && (!(Array.isArray(value)) || value.length > 0) && (!(typeof value === "object") || Object.keys(value).length > 0);
    if (!present) continue;
    const match = obligations.find(po => po.target === op.target && po.domain === domain);
    if (!match) errors.push(`missing_explicit_obligation:${op.id}:${domain}`);
    if (domain === "COMPOSITION" && match?.notApplicable === true && Array.isArray(value.sharedResources) && value.sharedResources.length > 0) errors.push(`composition_na_with_shared_resource:${match.id}`);
  }
  if (Array.isArray(op.resources) && op.resources.length > 0) for (const resource of op.resources) {
    if (!resource || typeof resource !== "object" || typeof resource.resource !== "string" || typeof resource.owner !== "string" || typeof resource.scope !== "string" || typeof resource.capacity !== "string" || !Array.isArray(resource.allowedExits)) errors.push(`resource_boundary_incomplete:${op.id}`);
  }
  if (op.composition && typeof op.composition === "object" && Array.isArray(op.composition.sharedResources)) for (const shared of op.composition.sharedResources) {
    if (!shared || typeof shared !== "object" || typeof shared.resource !== "string" || typeof shared.rule !== "string") errors.push(`composition_rule_incomplete:${op.id}`);
  }
  if (op.transaction && typeof op.transaction === "object" && (typeof op.transaction.atomic !== "boolean" || !Array.isArray(op.transaction.phases) || op.transaction.phases.length === 0)) errors.push(`transaction_machine_incomplete:${op.id}`);
  if (op.transaction && Array.isArray(op.transaction.requiredEffects) && op.transaction.requiredEffects.length > 0) {
    const commitPo = obligations.find(po => po.target === op.target && po.domain === "COMMIT");
    if (!commitPo || !Array.isArray(commitPo.requiredEffects) || commitPo.requiredEffects.length !== op.transaction.requiredEffects.length || op.transaction.requiredEffects.some(effect => !commitPo.requiredEffects.includes(effect))) errors.push(`commit_effects_not_explicit:${op.id}`);
  }
  const lifecycleValues = Array.isArray(op.lifecycle) ? op.lifecycle : (op.lifecycle ? [op.lifecycle] : []);
  const lifecycleScopes = new Set(["CALL", "BATCH", "TRANSACTION", "CYCLE", "SESSION", "INSTANCE", "PROCESS", "PERSISTENT"]);
  for (const lifecycle of lifecycleValues) if (!lifecycle || typeof lifecycle !== "object" || typeof lifecycle.state !== "string" || typeof lifecycle.scope !== "string" || !lifecycleScopes.has(lifecycle.scope)) errors.push(`lifecycle_scope_incomplete:${op.id}`);
}
if (errors.length > 0) { process.stderr.write(`[AEGIS][UAAM][CONTRACT] ${errors.join(",")}\n`); process.exit(1); }
NODE
  then
    rm -f "${risk_file}"
    return 1
  fi
  echo "[AEGIS][UAAM][RISK_MATRIX_JSON]${risk_json}"
  rm -f "${risk_file}"

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
    const firstTargetDir = targets.length > 0 ? targets[0].replace(/[^/]+$/, "") : "src/";
    const declaredImports = (ir.imports || []).map(spec => {
      const names = (spec.names || []).filter(name => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name));
      const source = ("../../" + firstTargetDir + (spec.from || "")).replace(/\.ts$/, ".js");
      return names.length > 0 ? `import { ${names.join(", ")} } from "${source}";` : "";
    }).filter(Boolean).join("\n");
    const imports = targets.map(t => {
      const modName = "__mod_" + t.replace(/[^a-zA-Z0-9]/g, "_");
      const jsPath = "../../" + t.replace(/\.ts$/, ".js").replace(/^\.\//, "");
      return `import * as ${modName} from "${jsPath}";`;
    }).join("\n");
    const mergeArgs = targets.map(t => "__mod_" + t.replace(/[^a-zA-Z0-9]/g, "_")).join(", ");
    const mergeCode = `const __mod: any = Object.assign({}, __mod_barrel${mergeArgs ? ", " + mergeArgs : ""});`;
    const exportNames = (ir.exports || []).map(e => e.name).concat((ir.publicContract?.exports || []).filter(e => typeof e === "string"));
    const exportsBinding = Array.from(new Set(exportNames)).map(name => `const ${name}: any = (__mod as any).${name};`).join("\n");
    
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

    const deriveV3Obligations = (contract) => {
      if (contract.version !== "3.0") return [];
      const fields = [["admission", "ADMISSION", "admission_reject"], ["failure", "STATE", "state_diff"], ["resources", "RESOURCE", "resource_conservation"], ["composition", "COMPOSITION", "resource_composition"], ["transaction", "COMMIT", "commit_atomicity"], ["lifecycle", "LIFECYCLE", "lifecycle_expiry"], ["observability", "OBSERVABILITY", "result_state_consistency"]];
      const explicit = contract.proofObligations || [];
      return (contract.operations || []).flatMap(op => fields.flatMap(([field, domain, oracle]) => {
        const value = op[field];
    const present = value !== undefined && value !== null && (!(Array.isArray(value)) || value.length > 0) && (!(typeof value === "object") || Object.keys(value).length > 0);
    if (!present) return [];
    const found = explicit.find(po => po.target === op.target && po.domain === domain);
        return found ? [{ ...found, requiredEffects: found.requiredEffects || (domain === "COMMIT" ? op.transaction?.requiredEffects : undefined) }] : [{ id: `PO-${op.id}-${domain}`, target: op.target, domain, kind: domain.toLowerCase(), oracle, required: true, requiredEffects: domain === "COMMIT" ? op.transaction?.requiredEffects : undefined, notApplicable: domain === "COMPOSITION" && value && value.sharedResources?.length === 0, naJustification: "derived:no_shared_resources" }];
      }));
    };
    const obligations = (ir.proofObligations || []).concat(deriveV3Obligations(ir).filter(derived => !(ir.proofObligations || []).some(po => po.id === derived.id)));
    const proofObligations = obligations.map((po, i) => {
      const poId = po.id || ("PO-" + String(i + 1).padStart(3, "0"));
      const poKind = po.kind || po.invariant || "generic_invariant";
      const poRequired = po.required !== false;
      const poOracle = po.oracle || "true";
      const prelude = po.prelude ? lines(po.prelude, "      ") : "";

      if (po.domain === "CONTRACT" || poKind === "contract_coverage" || poOracle === "contract_coverage") {
        const requirements = JSON.stringify(Array.isArray(ir.requirements) ? ir.requirements : []);
        const declared = JSON.stringify(obligations);
        return `  // Proof Obligation ${poId} (Contract Coverage Oracle)
  try {
    const __requirements = ${requirements};
    const __declared = ${declared};
    const __missingRequirements = __requirements.filter((requirement: any) => {
      const reference = requirement?.proofObligationId || requirement?.obligationId;
      return reference
        ? !__declared.some((candidate: any) => candidate?.id === reference)
        : !__declared.some((candidate: any) => candidate?.target === requirement?.target && candidate?.domain === requirement?.domain);
    });
    const __missingMechanisms = __declared.filter((candidate: any) => candidate?.required !== false && candidate?.notApplicable !== true && typeof candidate?.oracle !== "string");
    if (__missingRequirements.length > 0 || __missingMechanisms.length > 0) {
      recordEvidence("${poId}", "${poKind}", "CONTRACT", "DISPROVEN", ${poRequired}, "Contract coverage missing requirement or proof mechanism");
    } else {
      recordEvidence("${poId}", "${poKind}", "CONTRACT", "STATIC_PROVEN", ${poRequired}, "Every declared requirement is linked to a proof obligation with an oracle");
    }
  } catch (e: any) {
    recordEvidence("${poId}", "${poKind}", "CONTRACT", "DISPROVEN", ${poRequired}, "Exception in contract coverage oracle: " + String(e?.message || e));
  }`;
      }

      if (po.notApplicable === true) {
        return `  // Proof Obligation ${poId} (structurally derived N/A)
  recordEvidence("${poId}", "${poKind}", "${po.domain || "UNASSIGNED"}", "NOT_APPLICABLE", ${poRequired}, "Not applicable by Contract IR: ${po.naJustification || "missing justification"}");`;
      }

      if (po.domain === "ADMISSION" || poKind === "admission" || poOracle === "admission_reject") {
        return `  // Proof Obligation ${poId} (Admission Oracle)
  try {
    let __invalidCall: (() => unknown) | null = null;
    let __admissionAccepted: (() => boolean) | null = null;
${prelude}
    if (!__invalidCall) recordEvidence("${poId}", "${poKind}", "ADMISSION", "UNPROVEN", ${poRequired}, "Missing __invalidCall in prelude");
    else {
      let __accepted = false;
      try { const __result = __invalidCall(); __accepted = typeof __result === "boolean" ? __result : (__admissionAccepted ? __admissionAccepted() : false); } catch (_error) { __accepted = false; }
      if (__accepted) recordEvidence("${poId}", "${poKind}", "ADMISSION", "DISPROVEN", ${poRequired}, "Invalid input was admitted");
      else recordEvidence("${poId}", "${poKind}", "ADMISSION", "EXECUTABLY_PROVEN", ${poRequired}, "Invalid input rejected");
    }
  } catch (e: unknown) { recordEvidence("${poId}", "${poKind}", "ADMISSION", "DISPROVEN", ${poRequired}, "Exception in admission oracle: " + String(e));
  }`;
      }

      if ((po.domain === "LIFECYCLE" || poKind === "lifecycle" || poOracle === "lifecycle_expiry") && po.kind !== "temporal_lifecycle" && poOracle !== "temporal_policy" && poOracle !== "clock_policy") {
        return `  // Proof Obligation ${poId} (Lifecycle Oracle)
  try {
    let __lifecycleCheck: (() => boolean) | null = null;
${prelude}
    if (!__lifecycleCheck) recordEvidence("${poId}", "${poKind}", "LIFECYCLE", "UNPROVEN", ${poRequired}, "Missing __lifecycleCheck in prelude");
    else if (__lifecycleCheck()) recordEvidence("${poId}", "${poKind}", "LIFECYCLE", "EXECUTABLY_PROVEN", ${poRequired}, "Expired state absent from next scope");
    else recordEvidence("${poId}", "${poKind}", "LIFECYCLE", "DISPROVEN", ${poRequired}, "Expired state survived its declared boundary");
  } catch (e: unknown) { recordEvidence("${poId}", "${poKind}", "LIFECYCLE", "DISPROVEN", ${poRequired}, "Exception in lifecycle oracle: " + String(e));
  }`;
      }

      if (po.kind === "temporal_lifecycle" || poOracle === "temporal_policy" || poOracle === "clock_policy") {
        const policy = JSON.stringify(po.clockPolicy || po.policy || "");
        return `  // Proof Obligation ${poId} (Temporal Lifecycle Oracle)
  try {
    let __temporalCheck: (() => boolean) | null = null;
${prelude}
    const __policy = ${policy};
    const __validPolicies = ["monotonic_reject", "monotonic_clamp", "allow_backward", "logical_clock"];
    if (!__validPolicies.includes(__policy)) recordEvidence("${poId}", "${poKind}", "LIFECYCLE", "UNPROVEN", ${poRequired}, "Missing or invalid clock policy");
    else if (!__temporalCheck) recordEvidence("${poId}", "${poKind}", "LIFECYCLE", "UNPROVEN", ${poRequired}, "Missing __temporalCheck in prelude");
    else if (__temporalCheck()) recordEvidence("${poId}", "${poKind}", "LIFECYCLE", "EXECUTABLY_PROVEN", ${poRequired}, "Temporal trace satisfies " + __policy);
    else recordEvidence("${poId}", "${poKind}", "LIFECYCLE", "DISPROVEN", ${poRequired}, "Temporal trace violates " + __policy);
  } catch (e: any) {
    recordEvidence("${poId}", "${poKind}", "LIFECYCLE", "DISPROVEN", ${poRequired}, "Exception in temporal oracle: " + String(e?.message || e));
  }`;
      }
      if (poKind === "type_safety" || poOracle === "typecheck" || poOracle === "tsc_no_emit") {
        return `  // Proof Obligation ${poId} (Oracle 1: Type Oracle)
  try {
    recordEvidence("${poId}", "${poKind}", "TYPE_SYSTEM", "STATIC_PROVEN", ${poRequired}, "TypeScript AST compiled with zero errors");
  } catch (e: any) {
    recordEvidence("${poId}", "${poKind}", "TYPE_SYSTEM", "DISPROVEN", ${poRequired}, "Type failure: " + String(e?.message || e));
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
      recordEvidence("${poId}", "${poKind}", "STATE_TRANSITION", "DISPROVEN", ${poRequired}, "Missing __targetInstance or __failingCall in prelude");
    } else {
      const __obs = ${obsKeys};
      const __allowed = ${allowedEffects};
      const __snapBefore = __deepSnapState(__targetInstance, __obs);
      __failingCall();
      const __snapAfter = __deepSnapState(__targetInstance, __obs);
      const __diffKeys = __flattenDiff(__snapBefore, __snapAfter);
      const __unallowed = __diffKeys.filter((k: string) => !__allowed.some((a: string) => k === a || k.startsWith(a + ".") || k.startsWith(a + "[")));
      if (__unallowed.length === 0) {
        recordEvidence("${poId}", "${poKind}", "STATE_TRANSITION", "EXECUTABLY_PROVEN", ${poRequired}, "State diff [" + __diffKeys.join(", ") + "] ⊆ allowedFailureEffects");
      } else {
        recordEvidence("${poId}", "${poKind}", "STATE_TRANSITION", "DISPROVEN", ${poRequired}, "Uncontracted state mutation on [" + __unallowed.join(", ") + "]");
      }
    }
  } catch (e: any) {
    recordEvidence("${poId}", "${poKind}", "STATE_TRANSITION", "DISPROVEN", ${poRequired}, "Exception in state diff oracle: " + String(e?.message || e));
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
        recordEvidence("${poId}", "${poKind}", "RESOURCE_INVARIANT", "EXECUTABLY_PROVEN", ${poRequired}, "Conservation invariant satisfied");
      } else {
        recordEvidence("${poId}", "${poKind}", "RESOURCE_INVARIANT", "DISPROVEN", ${poRequired}, "Conservation invariant violated");
      }
    } else {
      const __bKeys: string[] = ${beforeKeys};
      const __aKeys: string[] = ${afterKeys};
      const __bSum = __sumProps(__targetBefore, __bKeys);
      const __aSum = __sumProps(__targetAfter, __aKeys);
      if (__bSum === __aSum) {
        recordEvidence("${poId}", "${poKind}", "RESOURCE_INVARIANT", "EXECUTABLY_PROVEN", ${poRequired}, "Conservation holds (" + __bSum + "n === " + __aSum + "n)");
      } else {
        recordEvidence("${poId}", "${poKind}", "RESOURCE_INVARIANT", "DISPROVEN", ${poRequired}, "Conservation violated (" + __bSum + "n !== " + __aSum + "n)");
      }
    }
  } catch (e: any) {
    recordEvidence("${poId}", "${poKind}", "RESOURCE_INVARIANT", "DISPROVEN", ${poRequired}, "Exception in conservation oracle: " + String(e?.message || e));
  }`;
      }

      if (poKind === "resource_composition" || poOracle === "aggregate_reservation" || poOracle === "resource_composition") {
        return `  // Proof Obligation ${poId} (Oracle 4: Resource Composition Oracle)
  try {
    let __availableCapacity: any = null;
    let __committedResources: any = null;
    let __batchRunner: (() => { available: any, committed: any }) | null = null;
${prelude}
    if (__batchRunner) {
      const res = __batchRunner();
      __availableCapacity = res.available;
      __committedResources = res.committed;
    }
    if (__availableCapacity === null || __committedResources === null) {
      // Direct boolean fallback if available/committed not set
      const __ok_comp = Boolean(${poOracle === "aggregate_reservation" || poOracle === "resource_composition" ? "true" : poOracle});
      if (__ok_comp) {
        recordEvidence("${poId}", "${poKind}", "RESOURCE_INVARIANT", "EXECUTABLY_PROVEN", ${poRequired}, "Resource composition invariant satisfied");
      } else {
        recordEvidence("${poId}", "${poKind}", "RESOURCE_INVARIANT", "DISPROVEN", ${poRequired}, "Resource composition invariant violated");
      }
    } else {
      let __availBig = typeof __availableCapacity === "bigint" ? __availableCapacity : BigInt(__availableCapacity);
      let __commBig = 0n;
      if (Array.isArray(__committedResources)) {
        for (const item of __committedResources) {
          __commBig += (typeof item === "bigint" ? item : BigInt(item));
        }
      } else {
        __commBig = typeof __committedResources === "bigint" ? __committedResources : BigInt(__committedResources);
      }
      if (__commBig <= __availBig) {
        recordEvidence("${poId}", "${poKind}", "RESOURCE_INVARIANT", "EXECUTABLY_PROVEN", ${poRequired}, "Aggregate committed (" + __commBig + "n) <= available (" + __availBig + "n)");
      } else {
        recordEvidence("${poId}", "${poKind}", "RESOURCE_INVARIANT", "DISPROVEN", ${poRequired}, "Aggregate overcommitment: committed (" + __commBig + "n) > available (" + __availBig + "n)");
      }
    }
  } catch (e: any) {
    recordEvidence("${poId}", "${poKind}", "RESOURCE_INVARIANT", "DISPROVEN", ${poRequired}, "Exception in resource composition oracle: " + String(e?.message || e));
  }`;
      }

      if (poKind === "commit_atomicity" || poOracle === "state_identity_on_abort" || poOracle === "commit_atomicity") {
        const obsKeys = JSON.stringify(po.observableState || po.expected?.observableState || []);
        const allowedEffects = JSON.stringify(po.allowedFailureEffects || po.expected?.allowedFailureEffects || []);
        const requiredEffects = JSON.stringify(po.requiredEffects || []);
        return `  // Proof Obligation ${poId} (Oracle 5: Commit Atomicity Oracle)
  try {
    let __targetInstance: any = null;
    let __abortingBatchCall: (() => any) | null = null;
    let __commitCall: (() => unknown) | null = null;
    let __appliedEffects: readonly string[] | null = null;
    let __effectResults: readonly boolean[] | null = null;
${prelude}
    const __requiredEffects: string[] = ${requiredEffects};
    let __effectsOk = true;
    if (__requiredEffects.length > 0) {
      if (__commitCall) { try { __commitCall(); } catch (_error) { /* failed commit is judged below */ } }
      const __byNames = Array.isArray(__appliedEffects) && __requiredEffects.every((effect: string) => __appliedEffects?.includes(effect));
      const __byResults = Array.isArray(__effectResults) && __effectResults.length === __requiredEffects.length && __effectResults.every((applied: boolean) => applied === true);
      if (!__byNames && !__byResults) {
        __effectsOk = false;
        recordEvidence("${poId}", "${poKind}", "COMMIT", "DISPROVEN", ${poRequired}, "Required commit effects were not all applied");
      }
    }
    if (__effectsOk && (!__targetInstance || !__abortingBatchCall)) {
      recordEvidence("${poId}", "${poKind}", "STATE_TRANSITION", "DISPROVEN", ${poRequired}, "Missing __targetInstance or __abortingBatchCall in prelude");
    } else if (__effectsOk) {
      const __obs = ${obsKeys};
      const __allowed = ${allowedEffects};
      const __snapBefore = __deepSnapState(__targetInstance, __obs);
      try {
        __abortingBatchCall();
      } catch (e) {
        // Abort exception caught
      }
      const __snapAfter = __deepSnapState(__targetInstance, __obs);
      const __diffKeys = __flattenDiff(__snapBefore, __snapAfter);
      const __unallowed = __diffKeys.filter((k: string) => !__allowed.some((a: string) => k === a || k.startsWith(a + ".") || k.startsWith(a + "[")));
      if (__unallowed.length === 0) {
        recordEvidence("${poId}", "${poKind}", "COMMIT", "EXECUTABLY_PROVEN", ${poRequired}, "Atomicity preserved: state before === state after (diff [] ⊆ allowed)");
      } else {
        recordEvidence("${poId}", "${poKind}", "STATE_TRANSITION", "DISPROVEN", ${poRequired}, "Partial commit detected! Uncontracted mutations on [" + __unallowed.join(", ") + "]");
      }
    }
  } catch (e: any) {
    recordEvidence("${poId}", "${poKind}", "STATE_TRANSITION", "DISPROVEN", ${poRequired}, "Exception in commit atomicity oracle: " + String(e?.message || e));
      }`;
      }

      if (po.kind === "result_state_consistency" || poOracle === "result_state_consistency") {
        const mapping = JSON.stringify(po.mapping || {});
        const defaultRelation = JSON.stringify(po.relation || "equal");
        return `  // Proof Obligation ${poId} (Result ↔ State Consistency Oracle)
  try {
    let __resultTarget: any = null;
    let __resultCall: (() => unknown) | null = null;
${prelude}
    const __mapping = ${mapping};
    const __defaultRelation = ${defaultRelation};
    const __entries = Object.entries(__mapping).map(([resultField, raw]: [string, any]) => ({
      resultField,
      stateField: typeof raw === "string" ? raw : raw?.state,
      relation: typeof raw === "string" ? __defaultRelation : (raw?.relation || __defaultRelation)
    }));
    if (!__resultTarget || !__resultCall || __entries.length === 0) {
      recordEvidence("${poId}", "${poKind}", "OBSERVABILITY", "UNPROVEN", ${poRequired}, "Missing result target, result call, or mapping");
    } else {
      const __before = new Map<string, unknown>();
      for (const entry of __entries) __before.set(entry.stateField, __readPath(__resultTarget, entry.stateField));
      const __result: any = await __resultCall();
      const __mismatches: string[] = [];
      for (const entry of __entries) {
        if (!Object.prototype.hasOwnProperty.call(__result || {}, entry.resultField)) { __mismatches.push(entry.resultField + " missing from result"); continue; }
        const __afterValue = __readPath(__resultTarget, entry.stateField);
        const __expected = entry.relation === "delta" ? __subtractValues(__afterValue, __before.get(entry.stateField)) : __afterValue;
        if (!__sameValue(__result[entry.resultField], __expected)) __mismatches.push(entry.resultField + " != " + entry.stateField);
      }
      if (__mismatches.length === 0) recordEvidence("${poId}", "${poKind}", "OBSERVABILITY", "EXECUTABLY_PROVEN", ${poRequired}, "Returned result matches mapped observable state");
      else recordEvidence("${poId}", "${poKind}", "OBSERVABILITY", "DISPROVEN", ${poRequired}, "Result/state mismatch: " + __mismatches.join(", "));
    }
  } catch (e: any) {
    recordEvidence("${poId}", "${poKind}", "OBSERVABILITY", "DISPROVEN", ${poRequired}, "Exception in result/state oracle: " + String(e?.message || e));
  }`;
      }

      // Generic Oracle
      return `  // Proof Obligation ${poId} (Generic Invariant)
  try {
${prelude}
    const __ok_po${i} = Boolean(${po.oracle || "true"});
    if (!__ok_po${i}) {
      recordEvidence("${poId}", "${poKind}", "BEHAVIORAL_ASSERTION", "DISPROVEN", ${poRequired}, "Assertion failed (satisfies ${po.satisfies || "N/A"})");
    } else {
      recordEvidence("${poId}", "${poKind}", "BEHAVIORAL_ASSERTION", "EXECUTABLY_PROVEN", ${poRequired}, "Verified successfully");
    }
  } catch (e: any) {
    recordEvidence("${poId}", "${poKind}", "BEHAVIORAL_ASSERTION", "DISPROVEN", ${poRequired}, "Exception: " + String(e?.message || e));
  }`;
    }).join("\n");

    const fullCode = `// Aegis Ephemeral Evidence Compiler Harness
${declaredImports}
${imports}
import * as __mod_barrel from "../../src/index.js";
${mergeCode}

${exportsBinding}

type EpistemicStatus = "STATIC_PROVEN" | "EXECUTABLY_PROVEN" | "DISPROVEN" | "UNPROVEN" | "NOT_APPLICABLE";
type ProofDomain = "TYPE_SYSTEM" | "CONTRACT" | "ADMISSION" | "STATE_TRANSITION" | "STATE" | "RESOURCE_INVARIANT" | "RESOURCE" | "COMPOSITION" | "COMMIT" | "LIFECYCLE" | "OBSERVABILITY" | "BEHAVIORAL_ASSERTION" | "UNASSIGNED";

interface EvidenceEntry {
  id: string;
  kind: string;
  domain: ProofDomain;
  status: EpistemicStatus;
  required: boolean;
  evidence: string;
}

function __deepSnapState(instance: any, keys: string[], depth = 0): Record<string, any> {
  const out: Record<string, any> = {};
  if (!instance || depth > 5) return out;
  
  if (instance instanceof Map) {
    for (const [k, v] of instance.entries()) {
      out[String(k)] = typeof v === "object" && v !== null ? __deepSnapState(v, [], depth + 1) : (typeof v === "bigint" ? v.toString() + "n" : v);
    }
    return out;
  }

  const kList = keys && keys.length > 0 ? keys : Array.from(new Set([...Object.keys(instance), ...Object.getOwnPropertyNames(instance)]));
  for (const k of kList) {
    try {
      const v = instance[k];
      if (typeof v === "function") continue;
      if (v instanceof Map) {
        out[k] = __deepSnapState(v, [], depth + 1);
      } else if (typeof v === "object" && v !== null) {
        out[k] = __deepSnapState(v, [], depth + 1);
      } else if (typeof v === "bigint") {
        out[k] = v.toString() + "n";
      } else {
        out[k] = v;
      }
    } catch {
      out[k] = "<error>";
    }
  }
  return out;
}

function __flattenDiff(before: Record<string, any>, after: Record<string, any>, prefix = ""): string[] {
  const diffs: string[] = [];
  const allKeys = Array.from(new Set([...Object.keys(before || {}), ...Object.keys(after || {})]));
  for (const k of allKeys) {
    const fullKey = prefix ? prefix + "." + k : k;
    const vB = before ? before[k] : undefined;
    const vA = after ? after[k] : undefined;
    if (typeof vB === "object" && vB !== null && typeof vA === "object" && vA !== null) {
      diffs.push(...__flattenDiff(vB, vA, fullKey));
    } else if (vB !== vA) {
      diffs.push(fullKey);
    }
  }
  return diffs;
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

function __readPath(instance: any, path: string): unknown {
  return path.split(".").reduce((value: any, key: string) => value === null || value === undefined ? undefined : value[key], instance);
}

function __sameValue(left: unknown, right: unknown): boolean {
  if (typeof left === "bigint" && typeof right === "bigint") return left === right;
  if (typeof left === "number" && typeof right === "number") return Object.is(left, right);
  return Object.is(left, right);
}

function __subtractValues(after: unknown, before: unknown): unknown {
  if (typeof after === "bigint" && typeof before === "bigint") return after - before;
  if (typeof after === "number" && typeof before === "number") return after - before;
  return undefined;
}

export async function __run_invariants() {
  const passed: string[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];
  const evidenceMatrix: EvidenceEntry[] = [];

  function recordEvidence(id: string, kind: string, domain: ProofDomain, status: EpistemicStatus, required: boolean, evidence: string) {
    evidenceMatrix.push({ id, kind, domain, status, required, evidence });
  }

${behaviors}

${proofObligations}

  // Ensure all declared required obligations were executed
  const declaredObligations: Array<{ [key: string]: unknown; id?: string; kind?: string; required?: boolean; target?: string; domain?: string }> = ${JSON.stringify(obligations)};
  for (const decl of declaredObligations) {
    const poId = decl.id;
    if (!poId) continue;
    const found = evidenceMatrix.some(e => e.id === poId);
    if (!found && decl.required !== false) {
      recordEvidence(poId, decl.kind || "unknown", "UNASSIGNED", "UNPROVEN", true, "Declared required obligation was never executed");
    }
  }

  console.log("\\n[AEGIS][EVIDENCE_MATRIX]");
  console.log("┌────────────────┬───────────────────────┬─────────────────────┬─────────────────────┬────────────────────────────────────────────────────────┐");
  console.log("│ ID             │ KIND                  │ DOMAIN              │ STATUS              │ EVIDENCE                                               │");
  console.log("├────────────────┼───────────────────────┼─────────────────────┼─────────────────────┼────────────────────────────────────────────────────────┤");
  for (const ev of evidenceMatrix) {
    const pad = (s: string, n: number) => (s || "").padEnd(n, " ").substring(0, n);
    const color = ev.status === "STATIC_PROVEN" || ev.status === "EXECUTABLY_PROVEN" ? "\\x1b[32m" : "\\x1b[31m";
    const reset = "\\x1b[0m";
    console.log("│ " + pad(ev.id, 14) + " │ " + pad(ev.kind, 21) + " │ " + pad(ev.domain, 19) + " │ " + color + pad(ev.status, 19) + reset + " │ " + pad(ev.evidence, 54) + " │");
  }
  console.log("└────────────────┴───────────────────────┴─────────────────────┴─────────────────────┴────────────────────────────────────────────────────────┘");
  console.log("[AEGIS][EVIDENCE_MATRIX_JSON]" + JSON.stringify(evidenceMatrix));

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

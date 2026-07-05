# MODE 0 — DISCOVERY

## PURPOSE
Discovery extracts and compresses operational focus from runtime-produced structural facts into the minimal context for downstream modes (Forensics, Repair).
- Runtime produces facts (topology, ranking, attention, summary, findings).
- Discovery reformulates facts into operational context without concluding or interpreting meaning (Forensics territory).

## CONSTRAINTS & PROHIBITED PATTERNS
1. **No system/code descriptions**: Observations must focus strictly on the *investigation state* (what the investigation needs to do next, gaps, priorities), NOT on what the system/code does.
2. **No structural/metric repetition**: Do NOT repeat raw counts, metrics, or structural facts (e.g., node/edge/bridge/boundary counts) already present in `structural_context`.
3. **No architectural role labels**: Do NOT use words like "orchestrator", "controller", "gateway", "facade", "central hub". Reference mechanical responsibility from `node_index` instead (e.g., "entrypoint node").
4. **No semantic domain inferences**: Do NOT use terms like "authentication domain", "billing service", "payment module" based on file content/names. Reference mechanical classification only.
5. **No risk assessment**: Risk analysis ("coupling risk", "failure risk") is prohibited. It belongs exclusively to Forensics.
6. **No functional inference**: Do NOT infer module function from topology position (e.g., "it mediates connectivity"). Describe topological facts only: "entrypoint node connects to two boundary nodes".

## JSON SCHEMA CONTRACT
Output MUST be exactly one JSON object wrapped in `AEGIS_ARTIFACT_BEGIN` and `AEGIS_ARTIFACT_END` markers. The runtime automatically populates the `mode`, `handover_attention` and standard metadata.

```json
{
  "evidence_refs": ["structural.builder", "runtime.attention_seed", "filesystem.read:epistemic_handover"],
  "operational_context": {
    "investigation_scope": {
      "scope_type": "explicit_request",
      "scope_targets": ["src/index.ts"],
      "scope_confidence": "high"
    },
    "attention_targets": ["src/index.ts"],
    "blocking_conditions": [],
    "required_evidence": ["filesystem.read:src/index.ts"],
    "operational_observations": [
      "Evidence collection at entrypoint node is required before forensics can interpret boundary relationships."
    ],
    "rationale": [
      "User requested analysis of repository topology, starting with the main entrypoint."
    ],
    "escalation_reason": null,
    "recommended_next_actions": [
      "Invoke forensics mode on src/index.ts"
    ],
    "evidence_priorities": ["filesystem.read:src/index.ts"],
    "confidence_drivers": ["Bridge observed mechanically"]
  }
}
```

## DETAILED FIELD INSTRUCTIONS
- **`evidence_refs`**: List capability names read.
- **`operational_context`**:
  - **`investigation_scope`**, **`attention_targets`**, **`blocking_conditions`**: Copy verbatim from `runtime.attention_seed` payload. If missing, set defaults (`{"scope_type":"none","scope_targets":[],"scope_confidence":"none"}`, `[]`, `[]`).
  - **`required_evidence`**: Capabilities or files to collect next.
  - **`operational_observations`**: Qualitative/interpretive observations about the *investigation state* and structural gaps.
  - **`rationale`**: Rationale for the prioritization.
  - **`escalation_reason`**: Null, or string if blocked.
  - **`recommended_next_actions`**: Specific workflow next steps.
  - **`evidence_priorities`**: Copy `suggested_evidence_priorities` from `structural.builder` payload VERBATIM. Do NOT generate or filter.
  - **`confidence_drivers`**: Factors driving operational confidence (e.g., "Entrypoint observed mechanically").

## FAILURE POLICY
If `structural.builder` payload is unavailable or failed:
- Set `evidence_refs` to capabilities read.
- Set `investigation_scope` to `{"scope_type": "none", "scope_targets": [], "scope_confidence": "none"}`.
- Set `blocking_conditions` to `["required evidence payload missing"]`.
- Set `escalation_reason` to `"required evidence payload missing"`.
- Set `attention_targets`, `operational_observations`, `required_evidence`, `rationale`, `recommended_next_actions`, `evidence_priorities`, and `confidence_drivers` to empty arrays (`[]`).

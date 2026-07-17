# MODE 0 — DISCOVERY

## PURPOSE
Discovery compresses runtime-produced Layer 0 facts into the minimal operational focus for downstream modes (Forensics, Repair).
- Runtime produces facts (list_tree, layer0_facts, attention_seed, handover).
- Discovery reformulates the *investigation state* (gaps, priorities, next evidence) without concluding code meaning (Forensics territory).

## LAYER 0 BASELINE TRUST
The runtime injects deterministic Layer 0 facts (`runtime.layer0_facts`: declared entrypoints from project manifests, `import_gravity` centrality scores, git-churn `hot_files` with lexical resonance). These are authoritative anchors:
- Do NOT guess or broadly map baseline entrypoints — the declared entrypoints ARE the baseline. Never re-derive them from filenames alone.
- Do NOT re-rank file importance where `import_gravity` already ranks it.
- Semantic discipline is retained for TENSION ONLY: when the investigation input demands something Layer 0 cannot anchor (unmapped path, declared-but-missing gap), report that specific gap in `observations` and request the exact evidence to close it.

## NET-NEW FILE CREATION INTENTS (MANDATORY CAPTURE)
If the investigation input explicitly demands creation of a net-new file (e.g., "create `src/feature/widget.ts`"), capture it even though it is absent from Layer 0 and the pocket map:
- Include the exact repository-relative path as a `filesystem.read:<path>` entry in `required_evidence` — absence on disk is expected and is itself evidence of the creation gap.
- State the creation demand in `observations`.
- **Do NOT invent net-new paths.** Only capture paths the operator named in the investigation input. Never copy example paths from this skill.
- Runtime-owned fields (`investigation_scope`, `attention_targets`, `handover_attention`) are runtime-injected — do NOT emit them.

## CONSTRAINTS & PROHIBITED PATTERNS
1. **No system/code descriptions**: Observations focus on the *investigation* (gaps, priorities), not on what the code does.
2. **No metric/fact dump**: Do NOT restate Layer 0 scores, tree listings, or payload dumps already injected.
3. **No architectural role labels**: Do NOT invent roles like "orchestrator", "controller", "gateway", "facade". Prefer plain path references.
4. **No semantic domain inferences**: Do NOT invent domains ("auth service", "billing module") from filenames.
5. **No risk assessment**: Risk analysis belongs to later modes.
6. **No invented topology**: Do not invent import graphs, edge/bridge metrics, or node indices — they are not in the product evidence path.

## JSON SCHEMA CONTRACT — MINIMAL COGNITIVE ARTIFACT
Output MUST be exactly one JSON object wrapped in `AEGIS_ARTIFACT_BEGIN` and `AEGIS_ARTIFACT_END` markers, containing EXCLUSIVELY the properties below. The runtime injects `mode`, `evidence_refs`, `investigation_scope`, `attention_targets`, and `handover_attention`. Emitting any of those is a contract violation.

```json
{
  "observations": [
    "Investigation needs content of src/index.ts before forensics can choose a mutation target."
  ],
  "rationale": "Operator named src/index.ts; Layer 0 lists it as an entrypoint.",
  "required_evidence": ["filesystem.read:src/index.ts"]
}
```

## DETAILED FIELD INSTRUCTIONS
- **`observations`**: High-density statements about the investigation state. One fact per entry. Every entry must change what a downstream mode does.
- **`rationale`**: One dense string — the deciding prioritization fact, not a narrative.
- **`required_evidence`**: Extra capabilities or files to collect next (`filesystem.read:<path>`). Prefer paths that Layer 0 / operator demand already anchor.

## EVIDENCE DEPTH
Product path is **Layer 0 + fine only**: `list_tree`, handover, `runtime.layer0_facts`, `runtime.attention_seed`. Do not request or invent deep graph extractors. Additional file content is requested via `required_evidence` (and the runtime also seeds operator-named / attention reads for forensics+).

## FAILURE POLICY
If `runtime.layer0_facts` is unavailable or failed, state the gap in `observations`, keep `required_evidence` at `[]` unless the operator already named paths, and explain in `rationale` why collection is blocked.

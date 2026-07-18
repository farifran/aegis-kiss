# Field ownership — model vs runtime

Models emit only the minimal cognitive fields for the active skill **when the LLM substrate runs**.  
The runtime injects identity, evidence, candidates, and attention. Do not re-emit runtime-owned fields.

**Discovery is always mechanical** (no LLM, **no** `.skills/discovery.md`). **Forensics** is mechanical by default; LLM only on multi-seed probe tie / force. Other skill `.md` files are contracts (and LLM prompts only where a model still runs).

| Mode | Who produces the body (default) | Model emits (if any) | Runtime injects / owns |
|---|---|---|---|
| discovery | Runtime only (`observations`, `rationale`, `required_evidence`) | — (no LLM path) | `mode`, evidence identity, `investigation_scope`, `attention_targets`, `handover_attention`; path clamp + mechanical rationale |
| forensics | Runtime mechanical | `status`, `repair_candidates[{id,reason}]` only on ambiguity / force | `mode`, `evidence_refs`, `handover_attention`, read anchors, demand-anchor gates; search only on LLM path |
| repair | Model (Aider edits) | file edits only (aider format) | mutation artifact: `mode`, `diff`, `files_changed`, attention, optional `intent_violations`; MUTATION BRIEF / REPAIR FEEDBACK (validation or optimize) |
| optimize | Model (raw JSON, **no edits**) | `status`, `basis`, `improvements[{target_files,change,why_safe}]` | always `candidate_result` from Repair; valid `can_improve` → `repair_feedback` for re-entry; else passthrough |
| adversarial | Model | `status`, `findings[]` | `mode`, `candidate_result`, `handover_attention`, tribunal gates |
| validation | Model + tribunal | `verdict`, `basis` | `mode`, `validated_candidate`, `findings`, `handover_attention`, `repair_feedback` (incl. `demand_mismatch`) |

**Demand:** investigation input is runtime-materialized (`scripts/lib/demand.sh`). Modes never rewrite demand. Runtime projects **`demand_anchors`** into prompts, capability, and handover.

**Net-new paths:** only paths the operator named in the investigation input. Skill examples are not targets.

**required_evidence clamp:** discovery enrich keeps `filesystem.read:<path>` only when operator-named **or** in Layer0/attention seed (bootstrap exception when both empty).

**Evidence:** capability payloads are evidence, not memory. Epistemic handover is incomplete attention, not truth.

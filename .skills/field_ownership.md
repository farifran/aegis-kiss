# Field ownership — model vs runtime

Models emit only the minimal cognitive fields for the active skill **when the LLM substrate runs**.  
The runtime injects identity, evidence, candidates, and attention. Do not re-emit runtime-owned fields.

**Discovery and forensics default paths are mechanical:** the runtime emits the body; the skill `.md` is **not** loaded. Skills still exist as contracts for LLM residual paths, audits, and humans.

| Mode | Who produces the body (default) | Model emits (LLM path only) | Runtime injects / owns |
|---|---|---|---|
| discovery | Runtime mechanical | `observations`, `rationale`, `required_evidence` (`AEGIS_DISCOVERY_LLM=1`) | `mode`, evidence identity, `investigation_scope`, `attention_targets`, `handover_attention`; path clamp + mechanical rationale |
| forensics | Runtime mechanical | `status`, `repair_candidates[{id,reason}]` (ambiguity / force) | `mode`, `evidence_refs`, `handover_attention`, read anchors, demand-anchor gates (alvo + reason); search only on LLM path |
| repair / optimize | Model (Aider edits) | file edits only (aider format) | mutation artifact: `mode`, `diff`, `files_changed`, attention, optional `intent_violations`; MUTATION BRIEF / REPAIR FEEDBACK |
| adversarial | Model | `status`, `findings[]` | `mode`, `candidate_result`, `handover_attention`, tribunal gates |
| validation | Model + tribunal | `verdict`, `basis` | `mode`, `validated_candidate`, `findings`, `handover_attention`, `repair_feedback` (incl. `demand_mismatch`) |

**Demand:** investigation input is runtime-materialized (`scripts/lib/demand.sh`). Modes never rewrite demand. Runtime projects **`demand_anchors`** into prompts, capability, and handover.

**Net-new paths:** only paths the operator named in the investigation input. Skill examples are not targets.

**required_evidence clamp:** discovery enrich keeps `filesystem.read:<path>` only when operator-named **or** in Layer0/attention seed (bootstrap exception when both empty).

**Evidence:** capability payloads are evidence, not memory. Epistemic handover is incomplete attention, not truth.

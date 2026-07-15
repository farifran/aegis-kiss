# Field ownership — model vs runtime

Models emit only the minimal cognitive fields for the active skill. The runtime injects identity, evidence, candidates, and attention. Do not re-emit runtime-owned fields.

| Mode | Model emits | Runtime injects / owns |
|---|---|---|
| discovery | `observations`, `rationale`, `required_evidence` | `mode`, evidence identity, `investigation_scope`, `attention_targets`, handover routing |
| forensics | `status`, `repair_candidates[{id,reason}]` | `mode`, `evidence_refs` on candidates, `handover_attention` |
| repair / optimize | file edits only (aider format) | mutation artifact: `mode`, `diff`, `files_changed`, attention |
| adversarial | `status`, `findings[]` | `mode`, `candidate_result` (from optimize), `handover_attention`, tribunal gates |
| validation | `verdict`, `basis` | `mode`, `validated_candidate`, `findings` (from adversarial), `handover_attention`, tribunal / `repair_feedback` |

**Net-new paths:** only paths the operator named in the investigation input (or explicit `required_evidence`) authorize creation. Skill examples are not targets.

**Evidence:** capability payloads are evidence, not memory. Epistemic handover is incomplete attention, not truth.

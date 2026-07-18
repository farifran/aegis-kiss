# Field ownership — model vs runtime

Models emit only the minimal cognitive fields for the active skill. The runtime injects identity, evidence, candidates, and attention. Do not re-emit runtime-owned fields.

| Mode | Model emits | Runtime injects / owns |
|---|---|---|
| discovery | `observations`, `rationale`, `required_evidence` (mechanical by default; LLM only if `AEGIS_DISCOVERY_LLM=1`) | `mode`, evidence identity, `investigation_scope`, `attention_targets`, handover routing; path clamp + mechanical rationale |
| forensics | `status`, `repair_candidates[{id,reason}]` | `mode`, `evidence_refs` on candidates, `handover_attention`, **deterministic `filesystem.read` anchors**, **demand-anchor gates** (single seed/named alvo; rewrite reason if it ignores dense tokens) |
| repair / optimize | file edits only (aider format) | mutation artifact: `mode`, `diff`, `files_changed`, attention; same read anchors as forensics |
| adversarial | `status`, `findings[]` | `mode`, `candidate_result` (from optimize), `handover_attention`, tribunal gates, read anchors |
| validation | `verdict`, `basis` | `mode`, `validated_candidate`, `findings` (from adversarial), `handover_attention`, tribunal / `repair_feedback` |

**Demand:** investigation input is runtime-materialized (`scripts/lib/demand.sh`): real GitHub issue body when `--issue N`, optional structured-header compact head, mechanical path safety. Modes never rewrite demand. Runtime projects **`demand_anchors`** (paths, dense tokens, search, seed, optional goal/targets/done_when) into prompts (human-readable), capability, and handover; scrubs false operator-named prose in discovery; binds forensics reasons/alvo; exposes forensics handoff to repair; soft token-in-diff preflight on repair.

**Net-new paths:** only paths the operator named in the investigation input authorize creation. Skill examples are not targets.

**required_evidence clamp:** at discovery enrich, model-requested `filesystem.read:<path>` is kept only when the path is operator-named **or** present in Layer0 attention seed. Arbitrary on-disk paths the model invents are dropped (bootstrap exception when both named and seed are empty).

**Evidence:** capability payloads are evidence, not memory. Epistemic handover is incomplete attention, not truth. Content reads for forensics+ are runtime-seeded from mechanical anchors — Discovery is not the sole gatekeeper of `filesystem.read`.

# MODE 0 — DISCOVERY

## PURPOSE

Discovery is the operational focus extraction layer of the Aegis Harness.

The runtime produces complete structural reality via `structural.builder`
and `runtime.attention_seed`. Discovery compresses that reality into the
minimal operational context that downstream modes (Forensics, Repair)
need to act.

Discovery does NOT discover reality — the runtime already did that.
Discovery does NOT interpret reality — Forensics does that.
Discovery selects what matters from what exists.

### Division of responsibility

```
Runtime     = produces facts (topology, ranking, attention, summary, findings)
Discovery   = compresses facts into operational context
Forensics   = interprets facts (meaning, causality, hypotheses)
Repair      = mutates facts
```

### Rule of thumb

- If it can be computed by bash/jq → Runtime
- If it reformulates facts without concluding → Discovery
- If it adds meaning, causality, or judgment → Forensics

Discovery exists to:
- copy runtime-owned fields verbatim (topology, ranking, attention, gaps, provenance,
  operational compression, summary, findings);
- emit `observations` — the ONLY field Discovery generates, neutral factual statements
  derived from topology data;
- declare `evidence_refs` — the runtime capabilities that produced the evidence consumed.

Discovery's cognitive responsibility is minimal: generate `observations` only.
Everything else is copied verbatim from runtime capabilities.

Discovery is not:
- an inferrer of structure;
- an interpreter of topology meaning;
- a selector of attention targets;
- a generator of attention routing;
- a judge of architectural relevance.

Discovery does not:
- apply adjectives to topology elements (highly connected, critical, important, central);
- decide which surface or target matters;
- copy file names or paths into its output;
- describe why a gap is significant;
- calculate gap counts or derive topology structure.

---

## AUTHORITY

Discovery consumes only readonly runtime-exposed capability payloads and one
runtime-provided `investigation_input`.

`investigation_input` is scope context only — it is not evidence, not authority,
not validation input.

---

## EVIDENCE

### Primary evidence — structural.builder payload

The `structural.builder` payload is the sole evidence source for topology.
The `runtime.attention_seed` payload is the sole source for attention routing.

Discovery reads the following fields and nothing else:

| Field | Source capability | What it is |
|---|---|---|
| `topology_summary` | `structural.builder` | Graph-derived topology counts (nodes, edges, surfaces, bridges, boundaries, hotspots, entrypoints). Copy directly into output. |
| `evidence` | `structural.builder` | Observed coverage and payload health. Contains `coverage` and `payload_status` sub-objects. Copy directly into output. |
| `runtime_summary` | `structural.builder` | Deterministic one-line topology summary. Copy directly into output as `summary`. |
| `runtime_findings` | `structural.builder` | Deterministic structural findings derived from topology data. Copy directly into output as `findings`. |
| `ranked_targets` | `structural.builder` | Precomputed deterministic targets with score and ranking_reason. Copy directly into output. |
| `gap_counts` | `structural.builder` | Precomputed deterministic gap counts. Copy directly into output. |
| `topology_index` | `structural.builder` | Topology ID resolution table (surfaces, bridges, boundaries, hotspots, entrypoints, node_index with relation_visibility). Copy directly into output. |
| `unresolved_references` | `structural.builder` | References found by the extractor that could not be resolved to a node. Copy directly into output. |
| `observed_request_alignment` | `structural.builder` | Runtime-resolved explicit paths from investigation_input. Copy directly into output. |
| `handover_attention` | `runtime.attention_seed` | Deterministic attention seed (explicit > hotspot > bridge > entrypoint). Copy directly into output. |
| `investigation_scope` | `runtime.attention_seed` | Operational scope derived from request alignment + attention state. Copy directly into output. |
| `blocking_conditions` | `runtime.attention_seed` | Factual conditions impeding investigation. Copy directly into output. |
| `attention_targets` | `runtime.attention_seed` | Hotspots in the investigation scope. Copy directly into output. |
| `relevant_surfaces` | `runtime.attention_seed` | Surfaces containing attention/scope targets. Copy directly into output. |
| `critical_relationships` | `runtime.attention_seed` | Bridges connecting relevant surfaces. Copy directly into output. |

### Provenance declaration

Discovery must declare `evidence_refs` — a list of the runtime capability names that produced the evidence it consumed. This is provenance, not interpretation.

```json
"evidence_refs": [
  "structural.builder",
  "filesystem.read:epistemic_handover"
]
```

`evidence_refs` must list every capability whose payload was read to produce the output. If `structural.builder` was the sole source, list only `["structural.builder"]`. If the epistemic handover file was also read, include `"filesystem.read:epistemic_handover"`.

### Supporting evidence (when builder payload is unavailable)

- `filesystem.list_tree` — filesystem structure
- `filesystem.read:epistemic_handover` — prior session attention state

### Evidence hierarchy

1. `structural.builder` topology payload — preferred
2. `filesystem.read:epistemic_handover` — fallback for scope context
3. `filesystem.list_tree` — fallback for structural visibility

Lower-priority evidence must not override higher-priority evidence.

---

## READING & EMISSION RULES

### topology_summary

Copy `topology_summary` verbatim into the output.
Do not edit, supplement, or interpret any field.

### evidence

Copy `evidence` verbatim into the output.
Do not edit, supplement, or interpret any field.
`evidence` is separate from `topology_summary`: topology describes the graph,
evidence describes what was observed about coverage and payload health.

### ranked_targets

Copy `ranked_targets` verbatim into the output.
Do not filter, reorder, or alter any target object.
`ranked_targets` entries with `type: "explicit_request"` appear first (injected by the runtime).
Do not reorder them behind topology entries.
Each entry includes a `score` field — a deterministic numeric priority computed by the runtime.
Discovery does not interpret the score. It copies it.

### gap_counts

Copy `gap_counts` verbatim into the output.
Do not calculate new counts or explain them.

### observed_request_alignment

Copy `observed_request_alignment` verbatim into the output.
Do not modify `requested_paths`, `resolved_paths`, or `resolution_confidence`.
If `observed_request_alignment` is absent from the builder payload, omit the field from output.

### unresolved_references

Copy `unresolved_references` verbatim into the output.
Do not interpret, filter, or alter any entry.
`unresolved_references` is evidence collected by the extractor: references
found in source (import/source/require/bash) whose target could not be
resolved to a node. Discovery does not diagnose why a reference is unresolved.
If `unresolved_references` is absent from the builder payload, omit the field from output.

### evidence_refs

Emit `evidence_refs` as a list of runtime capability names that produced the evidence consumed.
This is provenance declaration, not interpretation.
List every capability whose payload was read. Do not list capabilities that were not consumed.

### topology_index

Copy `topology_index` verbatim into the output.
Do not interpret, filter, or alter any entry.
`topology_index` is reference data for downstream resolution — it maps
topology IDs to file paths so that Forensics, Repair, Optimize, and
Validation can resolve structural IDs without recalculating topology.
Discovery does not interpret `topology_index`. It copies it.
If `topology_index` is absent from the builder payload, omit the field from output.

### handover_attention

Copy `handover_attention` verbatim from the `runtime.attention_seed` capability payload.

The runtime produces this field deterministically using the rule:
- if `observed_request_alignment.resolved_paths` is non-empty → explicit request targets;
- else if hotspots exist → hotspot files;
- else if bridges exist → bridge endpoint files;
- else if entrypoints exist → entrypoint files;
- else → empty targets.

Discovery does NOT generate `handover_attention`. It copies the runtime-produced value.
Do not edit `next_attention_targets`, `attention_scope`, or `attention_reason`.

If `runtime.attention_seed` payload is unavailable:
- Set `next_attention_targets` = `[]`, `attention_scope` = `"none"`, `attention_reason` = `"runtime.attention_seed payload unavailable"`.

This field is consumed by the runtime for epistemic handover. It is NOT copied into the artifact_snapshot — the runtime removes it before storage.

---

## OUTPUT

Discovery emits exactly one JSON object.
No prose outside JSON.
No markdown outside JSON.
No acknowledgements.
No explanations.

---

## REQUIRED JSON SHAPE

```json
{
  "mode": "discovery",

  "observed_request_alignment": {
    "requested_paths": ["src/index.ts"],
    "resolved_paths": ["src/index.ts"],
    "resolution_confidence": "high"
  },

  "unresolved_references": [
    {
      "from": "runtime_aegis.sh",
      "target": ".harness/config.sh",
      "type": "source"
    }
  ],

  "evidence_refs": [
    "structural.builder",
    "filesystem.read:epistemic_handover"
  ],

  "topology_summary": {
    "total_nodes": 0,
    "total_edges": 0,
    "surface_count": 0,
    "boundary_count": 0,
    "bridge_count": 0,
    "hotspot_count": 0,
    "isolated_node_count": 0,
    "entrypoint_count": 0
  },

  "evidence": {
    "coverage": {
      "test_covered_file_count": 0,
      "config_file_count": 0,
      "uncovered_hotspot_count": 0
    },
    "payload_status": {
      "consumed_payload_ok_count": 0,
      "consumed_payload_missing_count": 0,
      "consumed_payload_failed_count": 0
    }
  },

  "ranked_targets": [
    {
      "id": "explicit_target_001",
      "type": "explicit_request",
      "file": "src/index.ts",
      "surface_ref": "surface_cluster_001",
      "score": 100,
      "reason": "observed_request_alignment:direct_match"
    },
    {
      "id": "bridge_001",
      "type": "bridge",
      "surface_ref": "surface_cluster_001",
      "score": 4,
      "reason": "highest_bridge_count_surface:bridge"
    }
  ],

  "gap_counts": {
    "visibility_gap_count": 0,
    "coverage_gap_count": 0,
    "relationship_gap_count": 0,
    "scope_gap_count": 0
  },

  "topology_index": {
    "surfaces": [
      {
        "id": "surface_cluster_001",
        "member_count": 5,
        "dominant_node": "src/index.ts",
        "bridge_count": 2,
        "boundary_count": 1,
        "hotspot_count": 1,
        "entrypoint_count": 1
      }
    ],
    "bridges": [
      {
        "id": "bridge_001",
        "from": "src/index.ts",
        "to": "src/db.ts",
        "surface_ref": "surface_cluster_001"
      }
    ],
    "boundaries": [
      {
        "id": "boundary_001",
        "file": "src/db.ts",
        "in_degree": 3,
        "out_degree": 0,
        "surface_ref": "surface_cluster_001"
      }
    ],
    "hotspots": [
      {
        "id": "hotspot_001",
        "file": "src/index.ts",
        "in_degree": 2,
        "out_degree": 2,
        "total_degree": 4,
        "surface_ref": "surface_cluster_001"
      }
    ],
    "entrypoints": [
      {
        "id": "entrypoint_001",
        "file": "src/main.ts",
        "surface_ref": "surface_cluster_001"
      }
    ]
  },

  "handover_attention": {
    "next_attention_targets": ["src/index.ts"],
    "attention_scope": "explicit_request",
    "attention_reason": "observed_request_alignment direct match"
  },

  "summary": "81 nodes, 12 edges, 5 surfaces. Largest surface has 8 members and 7 bridges. 64 nodes are isolated.",

  "observations": [
    "surface_cluster_001 has 8 members and 7 bridges",
    "64 of 81 nodes have no observed relationships (relation_visibility: none_observed)",
    "11 nodes have relation_visibility: observation_limited"
  ],

  "findings": [
    {
      "finding": "64 isolated nodes suggest the extractor may be missing relationships",
      "evidence_refs": ["structural.builder", "unresolved_references"],
      "topology_refs": ["isolated_node_count: 64"]
    }
  ],

  "investigation_scope": {
    "scope_type": "explicit_request",
    "scope_targets": ["src/index.ts"],
    "scope_confidence": "high"
  },

  "blocking_conditions": [
    "requested path resolves to multiple candidates"
  ],

  "attention_targets": [
    "runtime_aegis.sh",
    "scripts/execute_mode.sh"
  ],

  "relevant_surfaces": [
    "surface_cluster_001"
  ],

  "critical_relationships": [
    {"type": "bridge", "id": "bridge_001", "from": "runtime_aegis.sh", "to": "scripts/execute_mode.sh"}
  ]
}
```

---

## OPERATIONAL COMPRESSION — runtime-owned, copied verbatim

The following fields are produced deterministically by `runtime.attention_seed`.
Discovery copies them verbatim into the output. Discovery does NOT generate,
derive, filter, or alter any of them.

### investigation_scope

Copy `investigation_scope` from the `runtime.attention_seed` payload verbatim.
Contains `scope_type`, `scope_targets`, `scope_confidence`.

If absent, set to `{"scope_type": "none", "scope_targets": [], "scope_confidence": "none"}`.

### blocking_conditions

Copy `blocking_conditions` from the `runtime.attention_seed` payload verbatim.
Array of strings describing factual conditions that impede investigation.

If absent, set to `[]`.

### attention_targets

Copy `attention_targets` from the `runtime.attention_seed` payload verbatim.
Subset of hotspots relevant to the current investigation scope.

If absent, set to `[]`.

### relevant_surfaces

Copy `relevant_surfaces` from the `runtime.attention_seed` payload verbatim.
Surfaces containing attention or scope targets.

If absent, set to `[]`.

### critical_relationships

Copy `critical_relationships` from the `runtime.attention_seed` payload verbatim.
Bridges connecting relevant surfaces.

If absent, set to `[]`.

### summary

Copy `runtime_summary` from the `structural.builder` payload verbatim into `summary`.
Do not edit, rewrite, or supplement.

If `runtime_summary` is absent, omit the `summary` field.

### findings

Copy `runtime_findings` from the `structural.builder` payload verbatim into `findings`.
Do not edit, filter, or add findings.

If `runtime_findings` is absent, set `findings` to `[]`.

### observations

The ONLY field Discovery generates from its own reading of the topology.
Short factual statements referencing specific topology IDs or counts.
No inference. No causality. No hypotheses.

Examples:
- `"surface_cluster_001 has 8 members and 7 bridges"`
- `"64 of 81 nodes have no observed relationships (relation_visibility: none_observed)"`
- `"requested path resolved ambiguously to 3 candidates"`
- `"22 unresolved references detected"`

### What Discovery does NOT do

- Does NOT generate `investigation_scope` — copies from runtime
- Does NOT generate `blocking_conditions` — copies from runtime
- Does NOT generate `attention_targets` — copies from runtime
- Does NOT generate `relevant_surfaces` — copies from runtime
- Does NOT generate `critical_relationships` — copies from runtime
- Does NOT generate `summary` — copies from runtime
- Does NOT generate `findings` — copies from runtime
- Does NOT emit `interpretations` — belongs to Forensics
- Does NOT emit `hypotheses` — belongs to Forensics

---

## FAILURE POLICY

If `structural.builder` payload is unavailable or failed:
- Set `topology_summary` to all-zero values.
- Set `evidence` to all-zero values (both `coverage` and `payload_status`).
- Set `ranked_targets` to `[]`.
- Set `gap_counts` to all-zero values (or count visibility gap from missing payloads).
- Set `unresolved_references` to `[]`.
- Set `evidence_refs` to the capabilities actually read (e.g. `["filesystem.read:epistemic_handover"]` if only the handover was available).
- Set `investigation_scope` to `{"scope_type": "none", "scope_targets": [], "scope_confidence": "none"}`.
- Set `blocking_conditions` to `["required evidence payload missing"]`.
- Set `attention_targets` to `[]`.
- Set `relevant_surfaces` to `[]`.
- Set `critical_relationships` to `[]`.
- Omit `topology_index` entirely.

Do not infer topology.
Do not describe why topology is absent.

---

## PROHIBITED OUTPUT PATTERNS

The following patterns are prohibited in any Discovery output:

| Prohibited | Permitted |
|---|---|
| `"This surface is highly connected"` (as adjective on runtime data) | Neutral observation: `"surface_cluster_001 has 8 members and 7 bridges"` |
| File paths invented by the model | Runtime-observed paths in `observed_request_alignment` or `explicit_request` entries |
| `"attention_reason": "dense cluster"` (custom attention) | Runtime-produced `attention_reason` copied verbatim from `runtime.attention_seed` |
| Invented topology ids | Builder-assigned ids only |
| Renamed topology elements | Original builder ids only |
| Altering runtime-owned fields based on observation | Observational fields are separate from runtime-owned fields |
| Recommendations or action items | Observations only — action belongs to Forensics/Repair |
| Interpretations or hypotheses | Discovery does NOT interpret. Interpretation belongs to Forensics. |

File paths are permitted **only** in:
- `observed_request_alignment.requested_paths`
- `observed_request_alignment.resolved_paths`
- `ranked_targets` entries where `type == "explicit_request"`
- `observations`, `findings` may reference file paths **only** when they appear in runtime-owned fields

---

## OPERATIONAL IDENTITY

Discovery reads runtime-owned topology data.
Discovery copies runtime-owned topology data verbatim.
Discovery does not select, prioritize, or route attention — that is runtime-owned.
Discovery observes and reports what the topology shows.

Structure, selection, counts, and attention routing are computed by runtime capabilities
(`structural.builder`, `runtime.attention_seed`).
Discovery reads and copies them.

Interpretive description of topology belongs to Discovery.
Hypothesis construction and investigation prioritization belong to Forensics.
Correction belongs to Repair.
Simplification belongs to Optimize.
Challenge belongs to Adversarial.
Final verdict belongs to Validation.

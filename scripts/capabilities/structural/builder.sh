#!/usr/bin/env bash

# =========================================================
# AEGIS CAPABILITY — structural.builder
# =========================================================
#
# Classification:
# readonly
#
# Layer: Second-order composition
#
# Responsibilities:
#
# - consume first-order graph payloads already materialized
#   by extract_import_graph, extract_reference_graph,
#   extract_symbols, extract_entrypoints,
#   extract_test_relationships, extract_configuration_structure
# - derive structural topology deterministically:
#     surfaces   — weakly connected components (clusters)
#     boundaries — high in-degree, low out-degree nodes
#     bridges    — edges whose removal disconnects the graph
#     hotspots   — nodes with highest total degree
# - precompute selection_candidates for deterministic handover
#   (removes model judgment from downstream Discovery mode)
# - emit condensed topology artifact — no member lists,
#   no raw graph echoes, bridges capped at BRIDGE_EMIT_LIMIT
#
# This capability intentionally:
#
# - performs no filesystem reads of source code
# - performs no LLM calls or semantic inference
# - derives topology from graph mathematics only
# - emits condensed payloads (target: <40 KB)
# - is invoked last in the Discovery evidence profile
#   so all predecessor payloads are already materialized
#
# =========================================================

set -Eeuo pipefail

# =========================================================
# INPUTS
# =========================================================

readonly TARGET_PATH="${1:-.}"

# =========================================================
# CONFIGURATION
# =========================================================

[[ -f ".harness/config.sh" ]] || {
  echo "[AEGIS][CAPABILITY][FATAL] missing_config" >&2
  exit 1
}

# shellcheck disable=SC1091
source ".harness/config.sh"

# =========================================================
# HELPERS
# =========================================================

fail() {
  local error_type="$1"
  local target="${2:-}"

  jq -n \
    --arg capability "structural.builder" \
    --arg classification "readonly" \
    --arg execution_id "${AEGIS_EXECUTION_ID:-unknown}" \
    --arg generated_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    --arg error_type "${error_type}" \
    --arg target "${target}" \
    '{
      success: false,
      capability: $capability,
      classification: $classification,
      execution_id: $execution_id,
      generated_at: $generated_at,
      payload: null,
      error: {
        type: $error_type,
        target: $target
      }
    }'
}

# =========================================================
# VALIDATION
# =========================================================

declare -p AEGIS_CAPABILITY_PAYLOAD_DIR >/dev/null 2>&1 || {
  fail "missing_capability_payload_dir"
  exit 1
}

[[ -d "${AEGIS_CAPABILITY_PAYLOAD_DIR}" ]] || {
  fail "missing_payload_directory" "${AEGIS_CAPABILITY_PAYLOAD_DIR}"
  exit 1
}

command -v python3 >/dev/null 2>&1 || {
  fail "missing_python3"
  exit 1
}

# =========================================================
# MATERIALIZE GRAPH DEPENDENCIES
# =========================================================

required_dependency_capabilities=(
  "filesystem.extract_import_graph"
  "filesystem.extract_reference_graph"
  "filesystem.extract_symbols"
  "filesystem.extract_entrypoints"
  "filesystem.extract_test_relationships"
  "filesystem.extract_configuration_structure"
  "filesystem.extract_responsibilities"
)

for cap in "${required_dependency_capabilities[@]}"; do

  handler="${AEGIS_CAPABILITY_HANDLERS[$cap]:-}"
  arg="${TARGET_PATH}"
  payload_file="$(echo "${cap}" | tr '.' '_').json"
  payload_path="${AEGIS_CAPABILITY_PAYLOAD_DIR}/${payload_file}"

  if [[ ! -f "${payload_path}" ]]; then
    bash "${handler}" "${arg}" > "${payload_path}"
  fi
done

# =========================================================
# TOPOLOGY DERIVATION
# =========================================================

TOPOLOGY_JSON="$(python3 - "${TARGET_PATH}" "${AEGIS_CAPABILITY_PAYLOAD_DIR}" <<'PY'
import json
import os
import sys

target_path  = sys.argv[1] if len(sys.argv) > 1 else '.'
payload_dir  = sys.argv[2] if len(sys.argv) > 2 else '.'

# =========================================================
# PAYLOAD LOADER
# =========================================================

def load_payload(filename):
    path = os.path.join(payload_dir, filename)
    if not os.path.isfile(path):
        return None, 'missing'
    try:
        with open(path, 'r', encoding='utf-8') as fh:
            data = json.load(fh)
        if not data.get('success'):
            return None, 'failed'
        return data.get('payload'), 'ok'
    except Exception as exc:
        return None, f'parse_error'

import_graph_payload,  st_ig = load_payload('filesystem_extract_import_graph.json')
ref_graph_payload,     st_rg = load_payload('filesystem_extract_reference_graph.json')
symbols_payload,       st_sy = load_payload('filesystem_extract_symbols.json')
entrypoints_payload,   st_ep = load_payload('filesystem_extract_entrypoints.json')
test_rel_payload,      st_tr = load_payload('filesystem_extract_test_relationships.json')
config_struct_payload, st_cs = load_payload('filesystem_extract_configuration_structure.json')
responsibilities_payload, st_rp = load_payload('filesystem_extract_responsibilities.json')

consumed_payloads = [
    {'file': 'filesystem_extract_import_graph.json',           'status': st_ig},
    {'file': 'filesystem_extract_reference_graph.json',        'status': st_rg},
    {'file': 'filesystem_extract_symbols.json',                'status': st_sy},
    {'file': 'filesystem_extract_entrypoints.json',            'status': st_ep},
    {'file': 'filesystem_extract_test_relationships.json',     'status': st_tr},
    {'file': 'filesystem_extract_configuration_structure.json','status': st_cs},
    {'file': 'filesystem_extract_responsibilities.json',       'status': st_rp},
]

# =========================================================
# GRAPH CONSTRUCTION
# =========================================================

import_graph = (import_graph_payload or {}).get('import_graph', [])
ref_graph    = (ref_graph_payload or {}).get('ref_graph', {})

nodes = ref_graph.get('nodes', [])
if not nodes:
    # Fallback: derive nodes from import_graph source files only.
    # Resolved targets that exist as files would also be nodes, but
    # without ref_graph we cannot verify file existence — so we use
    # only the source files we know are real.
    node_set = set()
    for entry in import_graph:
        node_set.add(entry['file'])
    nodes = sorted(node_set)

# Establish the node set from ref_graph nodes (authoritative) or fallback.
node_set = set(nodes)

# Two edge layers:
#   adj_out / adj_in           — ALL observed edges (resolved + unresolved).
#                                Feeds degree, fanout, hotspot, boundary.
#   adj_out_resolved / adj_in_resolved — RESOLVED edges only (target is a
#                                real node). Feeds surfaces, bridges, WCC.
# Unresolved targets are tracked as edge endpoints for degree but are
# NEVER added to `nodes` — no synthetic nodes.
adj_out          = {n: set() for n in nodes}
adj_in           = {n: set() for n in nodes}
adj_out_resolved = {n: set() for n in nodes}
adj_in_resolved  = {n: set() for n in nodes}

# Track unresolved dependency count per source file (for node_index)
unresolved_dep_count = {}

for entry in import_graph:
    src = entry['file']
    adj_out.setdefault(src, set())
    adj_in.setdefault(src, set())
    adj_out_resolved.setdefault(src, set())
    adj_in_resolved.setdefault(src, set())
    for imp in entry.get('imports', []):
        if isinstance(imp, dict):
            tgt = imp['target']
            is_resolved = imp.get('resolved', True)
        else:
            # Legacy string format — assume resolved (backward compat)
            tgt = imp
            is_resolved = True

        # All edges feed degree/fanout. The target may not be a node
        # (unresolved) — that's fine, we record the edge direction
        # without materializing the target as a graph entity.
        adj_out[src].add(tgt)
        adj_in.setdefault(tgt, set()).add(src)

        if is_resolved and tgt in node_set:
            adj_out_resolved[src].add(tgt)
            adj_in_resolved.setdefault(tgt, set()).add(src)
        elif not is_resolved:
            unresolved_dep_count[src] = unresolved_dep_count.get(src, 0) + 1

in_degree  = {n: len(adj_in.get(n, set()))  for n in nodes}
out_degree = {n: len(adj_out.get(n, set())) for n in nodes}

# Undirected adjacency for WCC/bridges uses RESOLVED edges only.
# Unresolved edges do not form clusters — a pruned target common to
# many files must NOT merge them into an artificial surface.
adj_und = {}
for src, targets in adj_out_resolved.items():
    adj_und.setdefault(src, set())
    for tgt in targets:
        adj_und[src].add(tgt)
        adj_und.setdefault(tgt, set()).add(src)
for n in nodes:
    adj_und.setdefault(n, set())

# =========================================================
# SURFACES — Weakly Connected Components (size >= 2)
# =========================================================

def find_wcc(all_nodes, adj_undirected):
    visited = set()
    components = []
    for start in all_nodes:
        if start in visited:
            continue
        component = []
        stack = [start]
        while stack:
            n = stack.pop()
            if n in visited:
                continue
            visited.add(n)
            component.append(n)
            for neighbor in adj_undirected.get(n, set()):
                if neighbor not in visited:
                    stack.append(neighbor)
        if len(component) >= 2:
            components.append(sorted(component))
    components.sort(key=lambda c: (-len(c), c[0]))
    return components

surfaces_raw = find_wcc(nodes, adj_und)

# =========================================================
# BOUNDARIES — entry/exit points between surfaces
# =========================================================
# A boundary is a node that is referenced externally (has incoming
# edges) but has few outgoing edges — it is a point of arrival, not
# an orchestrator. Boundaries mark where a surface interfaces with
# the rest of the graph.
#
# Heuristic:
#   in_degree >= 1  (at least one external reference — not isolated)
#   out_degree <= 1 (few outgoing deps — not an orchestrator)
#   must belong to a cluster surface (standalone nodes are not
#   boundaries — they have no surface to be a boundary OF)
#
# The previous threshold (in_degree >= 2) was too restrictive for
# small graphs where files are rarely imported by 2+ others.
# =========================================================

BOUNDARY_IN_MIN  = 1
BOUNDARY_OUT_MAX = 1

boundaries_raw = sorted(
    [n for n in nodes
     if in_degree.get(n, 0) >= BOUNDARY_IN_MIN
     and out_degree.get(n, 0) <= BOUNDARY_OUT_MAX
     and n in {m for s in surfaces_raw for m in s}],
    key=lambda n: (-in_degree.get(n, 0), n)
)

# =========================================================
# BRIDGES — Tarjan's iterative bridge-finding
# =========================================================

def find_bridges(all_nodes, adj_undirected):
    disc    = {}
    low     = {}
    timer   = [0]
    bridges = []
    nbrs    = {n: sorted(adj_undirected.get(n, set())) for n in all_nodes}

    for start in all_nodes:
        if start in disc:
            continue
        disc[start] = low[start] = timer[0]
        timer[0] += 1
        stack = [(start, None, 0)]

        while stack:
            u, par, ci = stack[-1]
            children   = nbrs[u]

            if ci < len(children):
                stack[-1] = (u, par, ci + 1)
                v = children[ci]
                if v == par:
                    continue
                if v in disc:
                    if disc[v] < low[u]:
                        low[u] = disc[v]
                else:
                    disc[v] = low[v] = timer[0]
                    timer[0] += 1
                    stack.append((v, u, 0))
            else:
                stack.pop()
                if par is not None:
                    if low[u] < low[par]:
                        low[par] = low[u]
                    if low[u] > disc[par]:
                        bridges.append((par, u))

    return bridges

bridges_raw = find_bridges(nodes, adj_und)

# =========================================================
# TEST COVERAGE
# =========================================================

test_relationships = (test_rel_payload or {}).get('test_relationships', [])
covered_files = set()
for rel in test_relationships:
    for t in rel.get('targets', []):
        covered_files.add(t)

# =========================================================
# ENTRYPOINTS
# =========================================================

entrypoints_list = (entrypoints_payload or {}).get('entrypoints', [])

# =========================================================
# HOTSPOTS — structural anomaly, not mere existence
# =========================================================
# A hotspot identifies concentration, orchestration, coupling,
# or risk — NOT simply being a file in the repository.
#
# Formula (purely topological, no coverage):
#   hotspot_score = (degree * 2)
#                 + bridge_participation
#                 + boundary_participation
#                 + entrypoint_with_dependencies
#
# Rules:
#   - degree is the dominant signal (multiplied by 2)
#   - bridge participation: node connects two surfaces
#   - boundary participation: node is a boundary (external entry)
#   - entrypoint_with_dependencies: node is an entrypoint AND has
#     degree > 0 (entrypoint with no dependencies is NOT a hotspot)
#   - isolated nodes (degree 0) are NEVER hotspots
#   - coverage_gap is a SEPARATE metric, not part of hotspot
#   - HOTSPOT_THRESHOLD=4 ensures hotspots are rare exceptions
# =========================================================

HOTSPOT_TOP_N = 15
HOTSPOT_THRESHOLD = 6
BRIDGE_BONUS = 2
BOUNDARY_BONUS = 1
ENTRYPOINT_WITH_DEPS_BONUS = 1

degree_total = {n: in_degree.get(n, 0) + out_degree.get(n, 0) for n in nodes}

# Build lookup sets for structural participation
_entrypoint_files = set(e['file'] for e in entrypoints_list)
_bridge_files = set()
for u, v in bridges_raw:
    _bridge_files.add(u)
    _bridge_files.add(v)
_boundary_files = set(boundaries_raw) if boundaries_raw else set()

# Compute hotspot score per node — purely topological
hotspot_scores = {}
for n in nodes:
    deg = degree_total[n]
    # Isolated nodes are never hotspots
    if deg == 0:
        hotspot_scores[n] = 0
        continue
    score = deg * 2
    if n in _bridge_files:
        score += BRIDGE_BONUS
    if n in _boundary_files:
        score += BOUNDARY_BONUS
    # entrypoint_with_dependencies: entrypoint AND has degree > 0
    if n in _entrypoint_files and deg > 0:
        score += ENTRYPOINT_WITH_DEPS_BONUS
    hotspot_scores[n] = score

hotspots_raw = sorted(
    [n for n in nodes if hotspot_scores[n] >= HOTSPOT_THRESHOLD],
    key=lambda n: (-hotspot_scores[n], -degree_total[n], n)
)[:HOTSPOT_TOP_N]

# =========================================================
# SURFACE MEMBERSHIP INDEX
# Members are computed internally; member lists are NOT emitted.
# =========================================================

surface_of = {}
for s in surfaces_raw:
    sid = f'surface_cluster_{surfaces_raw.index(s)+1:03d}'
    for m in s:
        surface_of[m] = sid

# Standalone surfaces — every node that does not belong to a cluster
# gets its own standalone surface. This eliminates surface_ref: null
# and ensures every node belongs to exactly one surface.
# Standalone surfaces are typed as 'standalone' (isolated node, no edges).
_standalone_counter = 0
for _n in nodes:
    if _n not in surface_of:
        _standalone_counter += 1
        _sid = f'surface_standalone_{_standalone_counter:03d}'
        surface_of[_n] = _sid

# =========================================================
# PER-SURFACE AGGREGATES
# =========================================================

surfaces_out = []
for i, members in enumerate(surfaces_raw, 1):
    sid       = f'surface_cluster_{i:03d}'
    members_s = set(members)

    s_bridges    = [(u, v) for u, v in bridges_raw if surface_of.get(u) == sid]
    s_boundaries = [f for f in boundaries_raw if surface_of.get(f) == sid]
    s_hotspots   = [f for f in hotspots_raw   if surface_of.get(f) == sid]
    s_entries    = [e['file'] for e in entrypoints_list if surface_of.get(e['file']) == sid]
    dominant     = max(members, key=lambda n: (in_degree.get(n, 0), -out_degree.get(n, 0)))

    surfaces_out.append({
        'id':               sid,
        'surface_kind':     'cluster',
        'member_count':     len(members),
        'members':          sorted(members),
        'dominant_node':    dominant,
        'bridge_count':     len(s_bridges),
        'boundary_count':   len(s_boundaries),
        'hotspot_count':    len(s_hotspots),
        'entrypoint_count': len(s_entries),
    })

# Add standalone surfaces to surfaces_out — but condensed to avoid
# payload explosion. Each standalone surface is a single isolated node.
# Instead of emitting 65 individual entries, we emit a summary count
# and let node_index carry the surface_ref per node.
_standalone_nodes = [n for n in nodes if surface_of.get(n, '').startswith('surface_standalone_')]
if _standalone_nodes:
    surfaces_out.append({
        'id':               'surface_standalone_summary',
        'surface_kind':     'standalone',
        'member_count':     len(_standalone_nodes),
        'members':          [],  # omitted — see node_index for per-node surface_ref
        'dominant_node':    None,
        'bridge_count':     0,
        'boundary_count':   0,
        'hotspot_count':    0,
        'entrypoint_count': sum(1 for n in _standalone_nodes if any(e['file'] == n for e in entrypoints_list)),
    })

# =========================================================
# BOUNDARIES — condensed (with surface_ref)
# =========================================================

boundaries_out = [
    {
        'id':          f'boundary_{i:03d}',
        'file':        f,
        'in_degree':   in_degree.get(f, 0),
        'out_degree':  out_degree.get(f, 0),
        'surface_ref': surface_of.get(f, None),
    }
    for i, f in enumerate(boundaries_raw, 1)
]

# =========================================================
# BRIDGES — condensed, capped (with surface_ref)
# =========================================================

BRIDGE_EMIT_LIMIT = 20

bridges_out = [
    {
        'id':          f'bridge_{i:03d}',
        'from':        u,
        'to':          v,
        'surface_ref': surface_of.get(u, surface_of.get(v, None)),
    }
    for i, (u, v) in enumerate(bridges_raw[:BRIDGE_EMIT_LIMIT], 1)
]

# =========================================================
# HOTSPOTS — condensed (with surface_ref, test_covered)
# =========================================================

hotspots_out = [
    {
        'id':           f'hotspot_{i:03d}',
        'file':         f,
        'hotspot_score': hotspot_scores[f],
        'in_degree':    in_degree.get(f, 0),
        'out_degree':   out_degree.get(f, 0),
        'total_degree': degree_total[f],
        'is_bridge_endpoint': f in _bridge_files,
        'is_boundary': f in _boundary_files,
        'test_covered': f in covered_files,
        'surface_ref':  surface_of.get(f, None),
    }
    for i, f in enumerate(hotspots_raw, 1)
]

# =========================================================
# ENTRYPOINTS — condensed (with surface_ref)
# =========================================================

entrypoints_out = [
    {
        'id':          f'entrypoint_{i:03d}',
        'file':        e['file'],
        'surface_ref': surface_of.get(e['file'], None),
    }
    for i, e in enumerate(entrypoints_list, 1)
]

# =========================================================
# NODE INDEX — reverse lookup (file -> topology facts)
# Forward lookup (id -> file) lives in the per-type lists above.
# Reverse lookup (file -> {surface_ref, is_entrypoint, is_hotspot,
# is_boundary, degrees, test_covered, ids}) lives here.
# Forensics uses this to answer "given a file, what is it?"
# without scanning every per-type list.
# =========================================================

# Unresolved references observed by the extractor: references found
# in source (source/import/require/bash) whose target could not be
# resolved to a node (e.g. pruned path, non-existent, out of scope).
# Used to classify relation_visibility below. This is evidence
# collected by the extractor, not inference by the builder.
unresolved_refs_raw = ref_graph.get('unresolved_references', [])
_nodes_with_unresolved = set()
for _ur in unresolved_refs_raw:
    _nodes_with_unresolved.add(_ur.get('from', ''))

# Extensions that the extractors support for reference extraction.
# Files with these extensions were analyzed by the extractor.
# If such a file has no edges and no unresolved references, the
# extractor looked and found nothing — that is evidence of absence,
# not absence of evidence. Files with unsupported extensions were
# not analyzed, so their isolation is none_observed.
_EXTRACTOR_SUPPORTED_EXTS = {'.py', '.ts', '.tsx', '.js', '.jsx', '.sh', '.bash'}

resp_map = {}
for item in (responsibilities_payload or {}).get('responsibilities', []):
    resp_map[item['file']] = {
        'responsibility': item.get('responsibility', 'module'),
        'responsibility_signals': item.get('signals', []),
        'responsibility_confidence': item.get('confidence', 'low')
    }

node_index = {}
for _n in nodes:
    _surf = surface_of.get(_n)
    _is_cluster = _surf is not None and not _surf.startswith('surface_standalone_')
    if _is_cluster:
        _rv = 'has_observed_relationships'
    elif _n in _nodes_with_unresolved:
        _rv = 'observation_limited'
    else:
        _ext = os.path.splitext(_n)[1].lower()
        if _ext in _EXTRACTOR_SUPPORTED_EXTS:
            # Extractor analyzed this file and found no references.
            # This is evidence of absence, not absence of evidence.
            _rv = 'structurally_confirmed_isolated'
        else:
            # Unsupported extension — extractor did not analyze.
            _rv = 'none_observed'
    node_index[_n] = {
        'surface_ref':         _surf,
        'surface_kind':        'cluster' if _is_cluster else 'standalone',
        'relation_visibility': _rv,
        'is_entrypoint':       False,
        'is_hotspot':          False,
        'is_boundary':         False,
        'in_degree':           in_degree.get(_n, 0),
        'out_degree':          out_degree.get(_n, 0),
        'total_degree':        in_degree.get(_n, 0) + out_degree.get(_n, 0),
        'unresolved_dependency_count': unresolved_dep_count.get(_n, 0),
        'test_covered':        _n in covered_files,
        'responsibility':      resp_map.get(_n, {}).get('responsibility', 'module'),
        'responsibility_signals': resp_map.get(_n, {}).get('responsibility_signals', []),
        'responsibility_confidence': resp_map.get(_n, {}).get('responsibility_confidence', 'low'),
    }

for _e in entrypoints_out:
    _f = _e['file']
    if _f in node_index:
        node_index[_f]['is_entrypoint']  = True
        node_index[_f]['entrypoint_id']  = _e['id']
        # Classify entrypoint surface status:
        #   surface_member      — belongs to a surface (has observed relationships)
        #   standalone          — no surface, no observed relationships, no unresolved refs
        #                         (legitimate isolated utility)
        #   relationship_missing — no surface BUT has degree > 0 or observation_limited
        #                          (entrypoint should be in a surface but isn't — possible
        #                          extractor gap or orphaned structural element)
        _ni = node_index[_f]
        if _ni['surface_ref'] is not None:
            _ni['surface_status'] = 'surface_member'
        elif _ni['total_degree'] > 0 or _ni['relation_visibility'] == 'observation_limited':
            _ni['surface_status'] = 'relationship_missing'
        else:
            _ni['surface_status'] = 'standalone'
for _h in hotspots_out:
    _f = _h['file']
    if _f in node_index:
        node_index[_f]['is_hotspot'] = True
        node_index[_f]['hotspot_id'] = _h['id']
for _b in boundaries_out:
    _f = _b['file']
    if _f in node_index:
        node_index[_f]['is_boundary'] = True
        node_index[_f]['boundary_id'] = _b['id']

# =========================================================
# SELECTION & RANKING
# Deterministic prioritization based on graph topology.
# =========================================================

investigation_input = os.environ.get('AEGIS_INVESTIGATION_INPUT', '')

import re

matched_surface_id = None
terms = re.findall(r'\b[a-zA-Z0-9_-]+\b', investigation_input)
for term in terms:
    for s in surfaces_out:
        if s['id'] == term:
            matched_surface_id = s['id']
            break
    if matched_surface_id:
        break

selected_surface_id = None
selection_rule = "no_topology"
if matched_surface_id:
    selected_surface_id = matched_surface_id
    selection_rule = "investigation_input_match"
elif surfaces_out:
    # Get highest bridge count surface
    highest_bridge_s = max(surfaces_out, key=lambda s: s['bridge_count'])
    if highest_bridge_s['bridge_count'] > 0:
        selected_surface_id = highest_bridge_s['id']
        selection_rule = "highest_bridge_count_surface"
    else:
        selected_surface_id = surfaces_out[0]['id']
        selection_rule = "largest_surface"

ranked_targets = []

# Deterministic scoring weights — runtime-owned, not model judgment.
# score = type_weight + degree_bonus
# bridge:    4  (connects surfaces, removal disconnects)
# hotspot:   3  + total_degree (concentration of dependencies)
# boundary:  2  + in_degree    (external entry, high fan-in)
# entrypoint: 1  (starting point, low risk)
# explicit_request targets get score 100 (injected after, below).
BRIDGE_WEIGHT = 4
HOTSPOT_WEIGHT = 3
BOUNDARY_WEIGHT = 2
ENTRYPOINT_WEIGHT = 1

if selected_surface_id:
    s_bridges = [b for b in bridges_out if b['surface_ref'] == selected_surface_id]
    s_boundaries = [b for b in boundaries_out if b['surface_ref'] == selected_surface_id]
    s_hotspots = [h for h in hotspots_out if h['surface_ref'] == selected_surface_id]
    s_entries = [e for e in entrypoints_out if e['surface_ref'] == selected_surface_id]

    s_bridges.sort(key=lambda x: x['id'])
    s_boundaries.sort(key=lambda x: (-x['in_degree'], x['id']))
    s_hotspots.sort(key=lambda x: (-x['total_degree'], x['id']))
    s_entries.sort(key=lambda x: x['id'])

    for b in s_bridges:
        ranked_targets.append({
            'id': b['id'],
            'type': 'bridge',
            'surface_ref': selected_surface_id,
            'score': BRIDGE_WEIGHT,
            'ranking_reason': f'bridge_weight({BRIDGE_WEIGHT})',
            'reason': f'{selection_rule}:bridge'
        })
    for b in s_boundaries:
        ranked_targets.append({
            'id': b['id'],
            'type': 'boundary',
            'surface_ref': selected_surface_id,
            'score': BOUNDARY_WEIGHT + b['in_degree'],
            'ranking_reason': f'boundary_weight({BOUNDARY_WEIGHT})+in_degree({b["in_degree"]})',
            'reason': f'{selection_rule}:boundary'
        })
    for h in s_hotspots:
        ranked_targets.append({
            'id': h['id'],
            'type': 'hotspot',
            'surface_ref': selected_surface_id,
            'score': HOTSPOT_WEIGHT + h['total_degree'],
            'ranking_reason': f'hotspot_weight({HOTSPOT_WEIGHT})+total_degree({h["total_degree"]})',
            'reason': f'{selection_rule}:hotspot'
        })
    for e in s_entries:
        ranked_targets.append({
            'id': e['id'],
            'type': 'entrypoint',
            'surface_ref': selected_surface_id,
            'score': ENTRYPOINT_WEIGHT,
            'ranking_reason': f'entrypoint_weight({ENTRYPOINT_WEIGHT})',
            'reason': f'{selection_rule}:entrypoint'
        })
else:
    for b in sorted(bridges_out, key=lambda x: x['id']):
        ranked_targets.append({
            'id': b['id'],
            'type': 'bridge',
            'surface_ref': b['surface_ref'],
            'score': BRIDGE_WEIGHT,
            'ranking_reason': f'bridge_weight({BRIDGE_WEIGHT})',
            'reason': 'no_selected_surface:bridge'
        })
    for b in sorted(boundaries_out, key=lambda x: (-x['in_degree'], x['id'])):
        ranked_targets.append({
            'id': b['id'],
            'type': 'boundary',
            'surface_ref': b['surface_ref'],
            'score': BOUNDARY_WEIGHT + b['in_degree'],
            'ranking_reason': f'boundary_weight({BOUNDARY_WEIGHT})+in_degree({b["in_degree"]})',
            'reason': 'no_selected_surface:boundary'
        })
    for h in sorted(hotspots_out, key=lambda x: (-x['total_degree'], x['id'])):
        ranked_targets.append({
            'id': h['id'],
            'type': 'hotspot',
            'surface_ref': h['surface_ref'],
            'score': HOTSPOT_WEIGHT + h['total_degree'],
            'ranking_reason': f'hotspot_weight({HOTSPOT_WEIGHT})+total_degree({h["total_degree"]})',
            'reason': 'no_selected_surface:hotspot'
        })
    for e in sorted(entrypoints_out, key=lambda x: x['id']):
        ranked_targets.append({
            'id': e['id'],
            'type': 'entrypoint',
            'surface_ref': e['surface_ref'],
            'score': ENTRYPOINT_WEIGHT,
            'ranking_reason': f'entrypoint_weight({ENTRYPOINT_WEIGHT})',
            'reason': 'no_selected_surface:entrypoint'
        })

# Sort by score descending, then by id for determinism
ranked_targets.sort(key=lambda x: (-x['score'], x['id']))

# =========================================================
# OBSERVED REQUEST ALIGNMENT
# Resolve explicit file paths from investigation_input against
# the known node set. Explicit targets take priority over
# topology-based targets in ranked_targets.
# =========================================================

_node_set = set(nodes)
_node_by_basename = {}
_node_by_stem = {}
for _n in nodes:
    _bn = os.path.basename(_n)
    _node_by_basename.setdefault(_bn, []).append(_n)
    _stem_key = os.path.splitext(_bn)[0]
    _node_by_stem.setdefault(_stem_key, []).append(_n)

# Extract path-like tokens from the investigation input
_path_re = re.compile(
    r'(?:[a-zA-Z0-9_\-\.]+/)+[a-zA-Z0-9_\-\.]+\.[a-zA-Z0-9]+'  # relative path: foo/bar.ts
    r'|'
    r'\b[a-zA-Z0-9_\-]+\.[a-zA-Z]{1,5}\b'                        # filename: index.ts
)

_requested_paths = []
for _m in _path_re.finditer(investigation_input):
    _cand = _m.group(0).replace('\\', '/')
    if _cand not in _requested_paths:
        _requested_paths.append(_cand)

# Canonical path resolution — deterministic scoring algorithm.
# Each requested path is matched against the node set with a score:
#   exact     (100) — requested path exists literally in the node set
#   prefix    (80)  — requested path is a prefix of a node path
#   relative  (60)  — node path ends with the requested path
#   basename  (40)  — basename of requested matches basename of a node
#   stem      (20)  — stem (without extension) matches a node stem
# The highest-scoring candidate is the canonical match.
# This prevents downstream modes from treating ambiguous matches as
# confirmed identities. Reality first, interpretation later.
EXACT_SCORE = 100
PREFIX_SCORE = 80
RELATIVE_SCORE = 60
BASENAME_SCORE = 40
STEM_SCORE = 20

_resolved_paths = []
_path_resolutions = []  # per-requested-path resolution records
for _req in _requested_paths:
    _candidates = []  # list of (path, score, match_type)

    # exact
    if _req in _node_set:
        _candidates.append((_req, EXACT_SCORE, 'exact'))

    # prefix and relative — scan node set
    _req_norm = _req.replace('\\', '/').lstrip('./')
    for _n in nodes:
        if _n == _req:
            continue  # already handled by exact
        if _n.startswith(_req_norm + '/') or _n.startswith(_req + '/'):
            _candidates.append((_n, PREFIX_SCORE, 'prefix'))
        elif _n.endswith('/' + _req_norm) or _n.endswith('/' + _req):
            _candidates.append((_n, RELATIVE_SCORE, 'relative'))

    # basename
    _bn = os.path.basename(_req)
    for _c in _node_by_basename.get(_bn, []):
        if _c not in [x[0] for x in _candidates]:
            _candidates.append((_c, BASENAME_SCORE, 'basename'))

    # stem
    _stem_key = os.path.splitext(_bn)[0]
    for _c in _node_by_stem.get(_stem_key, []):
        if _c not in [x[0] for x in _candidates]:
            _candidates.append((_c, STEM_SCORE, 'stem'))

    if _candidates:
        # Sort by score descending, then by path for determinism
        _candidates.sort(key=lambda x: (-x[1], x[0]))

        # Determine canonical winner: only if the top candidate has a
        # strictly higher score than the second. If two or more candidates
        # share the top score, the resolution is ambiguous — the runtime
        # does NOT pick one arbitrarily. resolved stays null.
        _best = _candidates[0]
        _best_score = _best[1]
        _best_type = _best[2]
        _has_tie = len(_candidates) > 1 and _candidates[1][1] == _best_score

        if _has_tie:
            _canonical_path = None
            _match_type = 'ambiguous'
        elif _best_type == 'exact':
            _canonical_path = _best[0]
            _match_type = 'exact'
        else:
            _canonical_path = _best[0]
            _match_type = _best_type

        # Only add canonical to resolved_paths if unambiguous
        if _canonical_path is not None and _canonical_path not in _resolved_paths:
            _resolved_paths.append(_canonical_path)

        # For ambiguous: add all tied candidates so attention_seed can
        # see them, but mark them as ambiguous (not canonical)
        if _has_tie:
            _seen = set(_resolved_paths)
            for _cand_path, _cand_score, _cand_type in _candidates:
                if _cand_score == _best_score and _cand_path not in _seen:
                    _resolved_paths.append(_cand_path)
                    _seen.add(_cand_path)

        _path_resolutions.append({
            'requested': _req,
            'resolved': _canonical_path,
            'match_type': _match_type,
            'canonical_score': _best_score if not _has_tie else None,
            'candidates': [
                {'path': p, 'score': s, 'match_type': t}
                for p, s, t in _candidates
            ],
        })
    else:
        _path_resolutions.append({
            'requested': _req,
            'resolved': None,
            'match_type': 'unresolved',
        })

if _resolved_paths:
    _exact = [r for r in _path_resolutions if r['match_type'] == 'exact']
    _ambiguous = [r for r in _path_resolutions if r['match_type'] == 'ambiguous']
    _alignment_confidence = 'high' if _exact and not _ambiguous else ('partial' if _resolved_paths else 'none')
else:
    _alignment_confidence = 'none'

observed_request_alignment = {
    'requested_paths':       _requested_paths,
    'resolved_paths':        _resolved_paths,
    'path_resolutions':      _path_resolutions,
    'resolution_confidence': _alignment_confidence,
}

# Inject explicit targets at the front; topology fills remaining slots
# Explicit request targets get the highest score (100) — runtime-owned
# priority, not model judgment.
EXPLICIT_REQUEST_WEIGHT = 100
_explicit_targets = [
    {
        'id':            f'explicit_target_{_i:03d}',
        'type':          'explicit_request',
        'file':          _rp,
        'surface_ref':   surface_of.get(_rp, None),
        'score':         EXPLICIT_REQUEST_WEIGHT,
        'ranking_reason': f'explicit_request_weight({EXPLICIT_REQUEST_WEIGHT})',
        'reason':        'observed_request_alignment:direct_match'
                         if _rp in _requested_paths
                         else 'observed_request_alignment:basename_match',
    }
    for _i, _rp in enumerate(_resolved_paths, 1)
]

_total_slots     = 10
_explicit_count  = min(len(_explicit_targets), _total_slots)
_topology_slots  = _total_slots - _explicit_count
ranked_targets   = _explicit_targets[:_explicit_count] + ranked_targets[:_topology_slots]

# =========================================================
# SUGGESTED EVIDENCE PRIORITIES — deterministic evidence
# priorities derived from ranked_targets.
# =========================================================
_ep_seen = set()
suggested_evidence_priorities = []
for _t in ranked_targets:
    _ttype = _t['type']
    _file = None
    if _ttype == 'explicit_request':
        _file = _t.get('file')
    elif _ttype == 'hotspot':
        _match = next((h for h in hotspots_out if h['id'] == _t['id']), None)
        if _match:
            _file = _match.get('file')
    elif _ttype == 'boundary':
        _match = next((b for b in boundaries_out if b['id'] == _t['id']), None)
        if _match:
            _file = _match.get('file')
    elif _ttype == 'entrypoint':
        _match = next((e for e in entrypoints_out if e['id'] == _t['id']), None)
        if _match:
            _file = _match.get('file')
    elif _ttype == 'bridge':
        # bridge has from/to — prioritize 'from' (source of dependency)
        _bridge = next((b for b in bridges_out if b['id'] == _t['id']), None)
        if _bridge:
            _file = _bridge['from']
    if _file and _file not in _ep_seen:
        suggested_evidence_priorities.append(f'filesystem.read:{_file}')
        _ep_seen.add(_file)

# =========================================================
# TOPOLOGY SUMMARY & GAP COUNTS — deterministic counts
# =========================================================

total_undirected_edges = sum(len(v) for v in adj_und.values()) // 2 if adj_und else 0
# connected_node_count = nodes in cluster surfaces (have edges).
# Standalone surfaces are isolated nodes — they belong to a surface
# but are NOT connected by edges.
connected_node_count   = sum(s['member_count'] for s in surfaces_out if s.get('surface_kind') == 'cluster')

# Edge counts by resolution status.
#   resolved_edge_count   — edges where the target is a real node
#                           (feeds surfaces, bridges, WCC)
#   unresolved_edge_count — edges observed in source but whose target
#                           is pruned/missing/out-of-scope. These feed
#                           degree/fanout/hotspot/boundary but do NOT
#                           form clusters. No synthetic nodes are created.
resolved_edge_count   = sum(len(v) for v in adj_out_resolved.values())
unresolved_edge_count = sum(unresolved_dep_count.values())

# topology_summary — graph-derived topology ONLY.
# Counts of nodes, edges, and derived structural features.
# Coverage and payload-health live in `evidence` below so that
# topology (what the graph IS) is not conflated with evidence
# (what was observed about coverage and payload success).
_cluster_surface_count = sum(1 for s in surfaces_out if s.get('surface_kind') == 'cluster')
_standalone_surface_count = sum(1 for s in surfaces_out if s.get('surface_kind') == 'standalone')

topology_summary = {
    'total_nodes':             len(nodes),
    'total_edges':             total_undirected_edges,
    'resolved_edge_count':     resolved_edge_count,
    'unresolved_edge_count':   unresolved_edge_count,
    'connected_node_count':    connected_node_count,
    'isolated_node_count':     len(nodes) - connected_node_count,
    'cluster_surface_count':   _cluster_surface_count,
    'standalone_surface_count': _standalone_surface_count,
    'total_surface_count':     len(surfaces_out),
    'boundary_count':          len(boundaries_out),
    'bridge_count':            len(bridges_raw),
    'bridge_emit_count':       len(bridges_out),
    'bridge_truncated':        len(bridges_raw) > BRIDGE_EMIT_LIMIT,
    'hotspot_count':           len(hotspots_out),
    'entrypoint_count':        len(entrypoints_out),
}

# evidence — observed coverage and payload health.
# Distinct from topology: these describe what was observed about
# test coverage and whether upstream payloads materialized, not the
# shape of the graph itself.
evidence = {
    'coverage': {
        'test_covered_file_count': len(covered_files),
        'config_file_count':       len((config_struct_payload or {}).get('config_structures', [])),
        'uncovered_hotspot_count': sum(1 for h in hotspots_out if not h['test_covered']),
    },
    'payload_status': {
        'consumed_payload_ok_count':
            sum(1 for p in consumed_payloads if p['status'] == 'ok'),
        'consumed_payload_missing_count':
            sum(1 for p in consumed_payloads if p['status'] == 'missing'),
        'consumed_payload_failed_count':
            sum(1 for p in consumed_payloads if p['status'] not in ('ok', 'missing')),
    },
}

visibility_gap_count = sum(1 for p in consumed_payloads if p['status'] != 'ok')
coverage_gap_count = sum(1 for h in hotspots_out if not h['test_covered'])
relationship_gap_count = len(nodes) - connected_node_count

# Unresolved references as operational signal — references the extractor
# found but could not resolve to a node. High counts indicate the graph
# may be missing edges (pruned targets, unsupported patterns, broken refs).
unresolved_reference_count = len(unresolved_refs_raw)
observation_limited_node_count = sum(
    1 for _n in nodes
    if node_index.get(_n, {}).get('relation_visibility') == 'observation_limited'
)
ambiguous_path_count = sum(
    1 for _pr in (observed_request_alignment.get('path_resolutions') or [])
    if _pr.get('match_type') == 'ambiguous'
)

topology_ids = set()
for s in surfaces_out: topology_ids.add(s['id'])
for b in boundaries_out: topology_ids.add(b['id'])
for br in bridges_out: topology_ids.add(br['id'])
for h in hotspots_out: topology_ids.add(h['id'])
for e in entrypoints_out: topology_ids.add(e['id'])

potential_ids = [t for t in terms if re.match(r'^(surface_cluster_\d+|boundary_\d+|bridge_\d+|hotspot_\d+|entrypoint_\d+)$', t)]
scope_gap_count = sum(1 for pid in potential_ids if pid not in topology_ids)

gap_counts = {
    'visibility_gap_count':          visibility_gap_count,
    'coverage_gap_count':            coverage_gap_count,
    'relationship_gap_count':        relationship_gap_count,
    'scope_gap_count':               scope_gap_count,
    'unresolved_reference_count':    unresolved_reference_count,
    'observation_limited_node_count': observation_limited_node_count,
    'ambiguous_path_count':          ambiguous_path_count,
}

# =========================================================
# RUNTIME SUMMARY & FINDINGS — deterministic, no model judgment
# These are derived from topology data only. Discovery copies
# them verbatim instead of generating its own. This reduces
# the model's cognitive responsibility to near zero.
# =========================================================

runtime_summary = (
    f"{topology_summary['total_nodes']} nodes, {topology_summary['total_edges']} edges, "
    f"{topology_summary['cluster_surface_count']} cluster surfaces, "
    f"{topology_summary['standalone_surface_count']} standalone surfaces. "
    f"{topology_summary['connected_node_count']} connected, "
    f"{topology_summary['isolated_node_count']} isolated. "
    f"{topology_summary['bridge_count']} bridges, "
    f"{topology_summary['hotspot_count']} hotspots, "
    f"{topology_summary['entrypoint_count']} entrypoints."
)

runtime_findings = []

# Finding: high isolation ratio
if topology_summary['total_nodes'] > 0:
    _iso_ratio = topology_summary['isolated_node_count'] / topology_summary['total_nodes']
    if _iso_ratio > 0.5:
        runtime_findings.append({
            'finding': f"{topology_summary['isolated_node_count']} of {topology_summary['total_nodes']} nodes are isolated ({int(_iso_ratio * 100)}%)",
            'topology_refs': [f"isolated_node_count: {topology_summary['isolated_node_count']}"],
        })

# Finding: unresolved references
if unresolved_reference_count > 0:
    runtime_findings.append({
        'finding': f"{unresolved_reference_count} unresolved references detected — extractor found references it could not resolve",
        'topology_refs': [f"unresolved_reference_count: {unresolved_reference_count}"],
    })

# Finding: observation limited nodes
if observation_limited_node_count > 0:
    runtime_findings.append({
        'finding': f"{observation_limited_node_count} nodes have relation_visibility: observation_limited — references exist but targets are pruned or out of scope",
        'topology_refs': [f"observation_limited_node_count: {observation_limited_node_count}"],
    })

# Finding: uncovered hotspots
_coverage_gap = sum(1 for h in hotspots_out if not h['test_covered'])
if _coverage_gap > 0:
    runtime_findings.append({
        'finding': f"{_coverage_gap} hotspots are not covered by tests",
        'topology_refs': [f"coverage_gap_count: {_coverage_gap}"],
    })

# Finding: ambiguous path resolution
if ambiguous_path_count > 0:
    runtime_findings.append({
        'finding': f"{ambiguous_path_count} requested path(s) resolved ambiguously — no canonical winner",
        'topology_refs': [f"ambiguous_path_count: {ambiguous_path_count}"],
    })

# =========================================================
# OUTPUT — condensed topology artifact
# =========================================================

result = {
    'topology_summary':          topology_summary,
    'evidence':                  evidence,
    'runtime_summary':           runtime_summary,
    'runtime_findings':          runtime_findings,
    'ranked_targets':            ranked_targets,
    'suggested_evidence_priorities': suggested_evidence_priorities,
    'gap_counts':                gap_counts,
    'topology_index': {
        'surfaces':              surfaces_out,
        'bridges':               bridges_out,
        'boundaries':            boundaries_out,
        'hotspots':              hotspots_out,
        'entrypoints':           entrypoints_out,
        'node_index':            node_index,
    },
    'unresolved_references':     unresolved_refs_raw,
    'consumed_payloads':         consumed_payloads,
    'observed_request_alignment': observed_request_alignment,
}

print(json.dumps(result))
PY
)"

# =========================================================
# JSON EMISSION
# =========================================================

_TMPFILE="$(mktemp)"
printf '%s' "${TOPOLOGY_JSON}" > "${_TMPFILE}"

jq -n \
  --arg capability "structural.builder" \
  --arg classification "readonly" \
  --arg execution_id "${AEGIS_EXECUTION_ID:-unknown}" \
  --arg generated_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  --arg target "${TARGET_PATH}" \
  --slurpfile result "${_TMPFILE}" \
  '{
    success: true,
    capability: $capability,
    classification: $classification,
    execution_id: $execution_id,
    generated_at: $generated_at,
    payload: {
      target: $target,
      topology_summary:            $result[0].topology_summary,
      evidence:                    $result[0].evidence,
      runtime_summary:             $result[0].runtime_summary,
      runtime_findings:            $result[0].runtime_findings,
      ranked_targets:              $result[0].ranked_targets,
      suggested_evidence_priorities: $result[0].suggested_evidence_priorities,
      gap_counts:                  $result[0].gap_counts,
      topology_index:              $result[0].topology_index,
      unresolved_references:       $result[0].unresolved_references,
      consumed_payloads:           $result[0].consumed_payloads,
      observed_request_alignment:  $result[0].observed_request_alignment
    },
    error: null
  }'

rm -f "${_TMPFILE}"

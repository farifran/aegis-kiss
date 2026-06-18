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

consumed_payloads = [
    {'file': 'filesystem_extract_import_graph.json',           'status': st_ig},
    {'file': 'filesystem_extract_reference_graph.json',        'status': st_rg},
    {'file': 'filesystem_extract_symbols.json',                'status': st_sy},
    {'file': 'filesystem_extract_entrypoints.json',            'status': st_ep},
    {'file': 'filesystem_extract_test_relationships.json',     'status': st_tr},
    {'file': 'filesystem_extract_configuration_structure.json','status': st_cs},
]

# =========================================================
# GRAPH CONSTRUCTION
# =========================================================

import_graph = (import_graph_payload or {}).get('import_graph', [])
ref_graph    = (ref_graph_payload or {}).get('ref_graph', {})

nodes = ref_graph.get('nodes', [])
if not nodes:
    node_set = set()
    for entry in import_graph:
        node_set.add(entry['file'])
        for imp in entry.get('imports', []):
            node_set.add(imp)
    nodes = sorted(node_set)

adj_out = {n: set() for n in nodes}
adj_in  = {n: set() for n in nodes}

for entry in import_graph:
    src = entry['file']
    adj_out.setdefault(src, set())
    adj_in.setdefault(src, set())
    for tgt in entry.get('imports', []):
        adj_out[src].add(tgt)
        adj_in.setdefault(tgt, set()).add(src)

in_degree  = {n: len(adj_in.get(n, set()))  for n in nodes}
out_degree = {n: len(adj_out.get(n, set())) for n in nodes}

adj_und = {}
for src, targets in adj_out.items():
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
# BOUNDARIES
# =========================================================

BOUNDARY_IN_MIN  = 2
BOUNDARY_OUT_MAX = 1

boundaries_raw = sorted(
    [n for n in nodes
     if in_degree.get(n, 0) >= BOUNDARY_IN_MIN
     and out_degree.get(n, 0) <= BOUNDARY_OUT_MAX],
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
# HOTSPOTS
# =========================================================

HOTSPOT_MIN_DEGREE = 2
HOTSPOT_TOP_N      = 15

degree_total  = {n: in_degree.get(n, 0) + out_degree.get(n, 0) for n in nodes}
hotspots_raw  = sorted(
    [n for n in nodes if degree_total[n] >= HOTSPOT_MIN_DEGREE],
    key=lambda n: (-degree_total[n], -in_degree.get(n, 0), n)
)[:HOTSPOT_TOP_N]

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
# SURFACE MEMBERSHIP INDEX
# Members are computed internally; member lists are NOT emitted.
# =========================================================

surface_of = {}
for s in surfaces_raw:
    sid = f'surface_cluster_{surfaces_raw.index(s)+1:03d}'
    for m in s:
        surface_of[m] = sid

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
        'member_count':     len(members),
        'members':          sorted(members),
        'dominant_node':    dominant,
        'bridge_count':     len(s_bridges),
        'boundary_count':   len(s_boundaries),
        'hotspot_count':    len(s_hotspots),
        'entrypoint_count': len(s_entries),
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
        'in_degree':    in_degree.get(f, 0),
        'out_degree':   out_degree.get(f, 0),
        'total_degree': degree_total[f],
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
            'reason': f'{selection_rule}:bridge'
        })
    for b in s_boundaries:
        ranked_targets.append({
            'id': b['id'],
            'type': 'boundary',
            'surface_ref': selected_surface_id,
            'reason': f'{selection_rule}:boundary'
        })
    for h in s_hotspots:
        ranked_targets.append({
            'id': h['id'],
            'type': 'hotspot',
            'surface_ref': selected_surface_id,
            'reason': f'{selection_rule}:hotspot'
        })
    for e in s_entries:
        ranked_targets.append({
            'id': e['id'],
            'type': 'entrypoint',
            'surface_ref': selected_surface_id,
            'reason': f'{selection_rule}:entrypoint'
        })
else:
    for b in sorted(bridges_out, key=lambda x: x['id']):
        ranked_targets.append({
            'id': b['id'],
            'type': 'bridge',
            'surface_ref': b['surface_ref'],
            'reason': 'no_selected_surface:bridge'
        })
    for b in sorted(boundaries_out, key=lambda x: (-x['in_degree'], x['id'])):
        ranked_targets.append({
            'id': b['id'],
            'type': 'boundary',
            'surface_ref': b['surface_ref'],
            'reason': 'no_selected_surface:boundary'
        })
    for h in sorted(hotspots_out, key=lambda x: (-x['total_degree'], x['id'])):
        ranked_targets.append({
            'id': h['id'],
            'type': 'hotspot',
            'surface_ref': h['surface_ref'],
            'reason': 'no_selected_surface:hotspot'
        })
    for e in sorted(entrypoints_out, key=lambda x: x['id']):
        ranked_targets.append({
            'id': e['id'],
            'type': 'entrypoint',
            'surface_ref': e['surface_ref'],
            'reason': 'no_selected_surface:entrypoint'
        })

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

_resolved_paths = []
for _req in _requested_paths:
    if _req in _node_set:
        if _req not in _resolved_paths:
            _resolved_paths.append(_req)
    else:
        _bn = os.path.basename(_req)
        if _bn in _node_by_basename:
            for _cand in _node_by_basename[_bn]:
                if _cand not in _resolved_paths:
                    _resolved_paths.append(_cand)
        else:
            _stem_key = os.path.splitext(_bn)[0]
            for _cand in _node_by_stem.get(_stem_key, []):
                if _cand not in _resolved_paths:
                    _resolved_paths.append(_cand)

if _resolved_paths:
    _direct = [p for p in _resolved_paths if p in _requested_paths]
    _alignment_confidence = 'high' if _direct else 'partial'
else:
    _alignment_confidence = 'none'

observed_request_alignment = {
    'requested_paths':       _requested_paths,
    'resolved_paths':        _resolved_paths,
    'resolution_confidence': _alignment_confidence,
}

# Inject explicit targets at the front; topology fills remaining slots
_explicit_targets = [
    {
        'id':          f'explicit_target_{_i:03d}',
        'type':        'explicit_request',
        'file':        _rp,
        'surface_ref': surface_of.get(_rp, None),
        'reason':      'observed_request_alignment:direct_match'
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
# TOPOLOGY SUMMARY & GAP COUNTS — deterministic counts
# =========================================================

total_undirected_edges = sum(len(v) for v in adj_und.values()) // 2 if adj_und else 0
connected_node_count   = sum(s['member_count'] for s in surfaces_out)

topology_summary = {
    'total_nodes':             len(nodes),
    'total_edges':             total_undirected_edges,
    'connected_node_count':    connected_node_count,
    'isolated_node_count':     len(nodes) - connected_node_count,
    'surface_count':           len(surfaces_out),
    'boundary_count':          len(boundaries_out),
    'bridge_count':            len(bridges_raw),
    'bridge_emit_count':       len(bridges_out),
    'bridge_truncated':        len(bridges_raw) > BRIDGE_EMIT_LIMIT,
    'hotspot_count':           len(hotspots_out),
    'entrypoint_count':        len(entrypoints_out),
    'uncovered_hotspot_count': sum(1 for h in hotspots_out if not h['test_covered']),
    'test_covered_file_count': len(covered_files),
    'config_file_count':       len((config_struct_payload or {}).get('config_structures', [])),
    'consumed_payload_ok_count':
        sum(1 for p in consumed_payloads if p['status'] == 'ok'),
    'consumed_payload_missing_count':
        sum(1 for p in consumed_payloads if p['status'] == 'missing'),
    'consumed_payload_failed_count':
        sum(1 for p in consumed_payloads if p['status'] not in ('ok', 'missing')),
}

visibility_gap_count = sum(1 for p in consumed_payloads if p['status'] != 'ok')
coverage_gap_count = sum(1 for h in hotspots_out if not h['test_covered'])
relationship_gap_count = len(nodes) - connected_node_count

topology_ids = set()
for s in surfaces_out: topology_ids.add(s['id'])
for b in boundaries_out: topology_ids.add(b['id'])
for br in bridges_out: topology_ids.add(br['id'])
for h in hotspots_out: topology_ids.add(h['id'])
for e in entrypoints_out: topology_ids.add(e['id'])

potential_ids = [t for t in terms if re.match(r'^(surface_cluster_\d+|boundary_\d+|bridge_\d+|hotspot_\d+|entrypoint_\d+)$', t)]
scope_gap_count = sum(1 for pid in potential_ids if pid not in topology_ids)

gap_counts = {
    'visibility_gap_count': visibility_gap_count,
    'coverage_gap_count': coverage_gap_count,
    'relationship_gap_count': relationship_gap_count,
    'scope_gap_count': scope_gap_count,
}

# =========================================================
# OUTPUT — condensed topology artifact
# =========================================================

result = {
    'topology_summary':          topology_summary,
    'ranked_targets':            ranked_targets,
    'gap_counts':                gap_counts,
    'topology_index': {
        'surfaces':              surfaces_out,
        'bridges':               bridges_out,
        'boundaries':            boundaries_out,
        'hotspots':              hotspots_out,
        'entrypoints':           entrypoints_out,
    },
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
      ranked_targets:              $result[0].ranked_targets,
      gap_counts:                  $result[0].gap_counts,
      topology_index:              $result[0].topology_index,
      consumed_payloads:           $result[0].consumed_payloads,
      observed_request_alignment:  $result[0].observed_request_alignment
    },
    error: null
  }'

rm -f "${_TMPFILE}"

#!/usr/bin/env bash

# =========================================================
# AEGIS CAPABILITY — filesystem.extract_reference_graph
# =========================================================
#
# Classification:
# readonly
#
# Responsibilities:
#
# - generate unified node-link graph of file dependencies
# - emit JSON object of {nodes, edges}
#
# =========================================================

set -Eeuo pipefail

# =========================================================
# INPUTS
# =========================================================

readonly TARGET_PATH="${1:-.}"

# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/_shared_utils.sh"
aegis_capability_init "filesystem.extract_reference_graph"

require_directory_target "${TARGET_PATH}"
require_prune_policy

# =========================================================
# EXTRACTION
# =========================================================

REF_GRAPH_JSON="$(run_python_extractor "${TARGET_PATH}" <<'PY'
nodes = sorted(all_files)
edges = []
unresolved_refs = []

for f in nodes:
    f_abs = f
    if not os.path.isfile(f_abs):
        continue
    try:
        with open(f_abs, 'r', encoding='utf-8', errors='ignore') as fh:
            content = fh.read()
    except Exception:
        continue

    ext = os.path.splitext(f)[1].lower()
    resolved = []

    if ext == '.py':
        targets = re.findall(r'^\s*from\s+([a-zA-Z0-9_\.]+)', content, re.MULTILINE)
        for m in re.findall(r'^\s*import\s+([a-zA-Z0-9_\.,\s]+)', content, re.MULTILINE):
            for part in m.split(','):
                part = part.strip().split()[0] if part.strip() else ''
                if part:
                    targets.append(part)
        seen_targets = set()
        for t in targets:
            if t in seen_targets:
                continue
            seen_targets.add(t)
            t_path = t.replace('.', '/')
            found = False
            for cand in [t_path + '.py', t_path + '/__init__.py']:
                if cand in nodes:
                    resolved.append(cand)
                    found = True
                    break
            if not found:
                f_dir = os.path.dirname(f)
                cand = os.path.normpath(os.path.join(f_dir, t_path + '.py')).replace('\\', '/')
                if cand in nodes:
                    resolved.append(cand)
                else:
                    unresolved_refs.append({"from": f, "target": t, "type": "import"})

    elif ext in ['.js', '.jsx', '.ts', '.tsx']:
        targets = re.findall(r'import\s+.*?\s+from\s+[\'"]([^\'"]+)[\'"]', content)
        targets += re.findall(r'require\([\'"]([^\'"]+)[\'"]\)', content)
        seen_targets = set()
        for t in targets:
            if t in seen_targets:
                continue
            seen_targets.add(t)
            if t.startswith('.'):
                f_dir = os.path.dirname(f)
                base = os.path.normpath(os.path.join(f_dir, t)).replace('\\', '/')
                found = False
                for cand in [base + ext2 for ext2 in ['.js', '.jsx', '.ts', '.tsx', '/index.js', '/index.ts']]:
                    if cand in nodes:
                        resolved.append(cand)
                        found = True
                        break
                if not found:
                    unresolved_refs.append({"from": f, "target": t, "type": "import"})
            elif t in nodes:
                resolved.append(t)
            else:
                unresolved_refs.append({"from": f, "target": t, "type": "import"})

    elif ext in ['.sh', '.bash', ''] and os.path.isfile(f_abs):
        raw = re.findall(r'^\s*source\s+([^\s\n#]+)', content, re.MULTILINE)
        raw += re.findall(r'^\s*\.\s+([^\s\n#]+)', content, re.MULTILINE)
        raw += re.findall(r'^\s*(?:bash|sh)\s+([^\s\n#]+)', content, re.MULTILINE)
        for t in [m.strip('\'"').rstrip('\\') for m in raw
                  if '$' not in m and not m.startswith('-')]:
            if t in nodes:
                resolved.append(t)
            else:
                f_dir = os.path.dirname(f)
                cand = os.path.normpath(os.path.join(f_dir, t)).replace('\\', '/')
                if cand in nodes:
                    resolved.append(cand)
                else:
                    unresolved_refs.append({"from": f, "target": t, "type": "source"})

    seen = set()
    for tgt in sorted(set(resolved)):
        key = (f, tgt)
        if key not in seen:
            seen.add(key)
            edges.append({"from": f, "to": tgt, "type": "import"})

edges = sorted(edges, key=lambda x: (x['from'], x['to']))
unresolved_refs = sorted(unresolved_refs, key=lambda x: (x['from'], x['target']))
print(json.dumps({"nodes": nodes, "edges": edges, "unresolved_references": unresolved_refs}))
PY
)"

# =========================================================
# JSON EMISSION
# =========================================================

emit_extraction_result "ref_graph" "${TARGET_PATH}" "${REF_GRAPH_JSON}"

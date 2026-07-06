#!/usr/bin/env bash

# =========================================================
# AEGIS CAPABILITY — filesystem.extract_import_graph
# =========================================================
#
# Classification:
# readonly
#
# Responsibilities:
#
# - resolve import graphs recursively in target repo
# - supported languages: Python, JS/TS, Bash
# - emit JSON array of {file, imports}
#
# =========================================================

set -Eeuo pipefail

# =========================================================
# INPUTS
# =========================================================

readonly TARGET_PATH="${1:-.}"

# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/_shared_utils.sh"
aegis_capability_init "filesystem.extract_import_graph"

require_directory_target "${TARGET_PATH}"
require_prune_policy

# =========================================================
# EXTRACTION
# =========================================================

IMPORT_GRAPH_JSON="$(run_python_extractor "${TARGET_PATH}" <<'PY'
import_graph = []

def resolve_existing(candidates):
    for cand in candidates:
        if cand in all_files:
            return cand

    for cand in candidates:
        matches = [f for f in all_files if f.endswith('/' + cand)]
        if len(matches) == 1:
            return matches[0]

    return None

for f in all_files:
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
    unresolved = []   # observed targets that could not be resolved to a file
                      # (pruned path, missing file, out-of-scope). Preserved as
                      # structural evidence without materializing a synthetic node.

    if ext == '.py':
        targets = re.findall(r'^\s*from\s+([a-zA-Z0-9_\.]+)', content, re.MULTILINE)
        for m in re.findall(r'^\s*import\s+([a-zA-Z0-9_\.,\s]+)', content, re.MULTILINE):
            for part in m.split(','):
                part = part.strip().split()[0] if part.strip() else ''
                if part:
                    targets.append(part)
        for t in targets:
            t_path = t.replace('.', '/')
            f_dir = os.path.dirname(f)
            cand = resolve_existing([
                t_path + '.py',
                t_path + '/__init__.py',
                os.path.normpath(os.path.join(f_dir, t_path + '.py')).replace('\\', '/'),
            ])
            if cand:
                resolved.append(cand)
            else:
                unresolved.append(t)

    elif ext in ['.js', '.jsx', '.ts', '.tsx']:
        targets = re.findall(r'import\s+.*?\s+from\s+[\'"]([^\'"]+)[\'"]', content)
        targets += re.findall(r'^\s*import\s+[\'"]([^\'"]+)[\'"]', content, re.MULTILINE)
        targets += re.findall(r'require\([\'"]([^\'"]+)[\'"]\)', content)
        for t in targets:
            if t.startswith('.'):
                f_dir = os.path.dirname(f)
                base = os.path.normpath(os.path.join(f_dir, t)).replace('\\', '/')
                cand = resolve_existing([base + ext2 for ext2 in ['.js', '.jsx', '.ts', '.tsx', '/index.js', '/index.ts']])
                if cand:
                    resolved.append(cand)
                else:
                    unresolved.append(t)
            elif t in all_files:
                resolved.append(t)
            else:
                unresolved.append(t)

    elif ext in ['.sh', '.bash', ''] and os.path.isfile(f_abs):
        raw_sources = re.findall(r'^\s*source\s+([^\s\n#]+)', content, re.MULTILINE)
        raw_sources += re.findall(r'^\s*\.\s+([^\s\n#]+)', content, re.MULTILINE)
        raw_sources += re.findall(r'^\s*(?:bash|sh)\s+([^\s\n#]+)', content, re.MULTILINE)
        for t in [m.strip('\'"').rstrip('\\') for m in raw_sources
                  if '$' not in m and not m.startswith('-')]:
            f_dir = os.path.dirname(f)
            cand = resolve_existing([
                t,
                os.path.normpath(os.path.join(f_dir, t)).replace('\\', '/'),
            ])
            if cand:
                resolved.append(cand)
            else:
                unresolved.append(t)

    # Build imports list with resolution metadata.
    # Every observed reference is emitted — resolved or not — so that the
    # structural reality (a file references X) is preserved even when the
    # target is pruned or missing. Unresolved targets do NOT become graph
    # nodes downstream; they feed degree/fanout only.
    imports = [{'target': t, 'resolved': True}  for t in sorted(set(resolved))]
    imports += [{'target': t, 'resolved': False} for t in sorted(set(unresolved))]

    # Always emit the entry. A file that references only pruned targets
    # still has observed structural dependencies — omitting it would erase
    # that evidence and falsely mark the file as having no relationships.
    import_graph.append({"file": f, "imports": imports})

print(json.dumps(import_graph))
PY
)"

# =========================================================
# JSON EMISSION
# =========================================================

emit_extraction_result "import_graph" "${TARGET_PATH}" "${IMPORT_GRAPH_JSON}"

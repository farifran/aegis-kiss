#!/usr/bin/env bash

# =========================================================
# AEGIS CAPABILITY — filesystem.extract_entrypoints
# =========================================================
#
# Classification:
# readonly
#
# Responsibilities:
#
# - detect candidate execution entrypoints mechanically
# - supported languages: Python, JS/TS, Bash, Go
# - emit JSON array of {file, kind}
#
# =========================================================

set -Eeuo pipefail

# =========================================================
# INPUTS
# =========================================================

readonly TARGET_PATH="${1:-.}"

# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/_shared_utils.sh"
aegis_capability_init "filesystem.extract_entrypoints"

require_directory_target "${TARGET_PATH}"
require_prune_policy

# =========================================================
# EXTRACTION
# =========================================================

ENTRYPOINTS_JSON="$(python3 - "${TARGET_PATH}" <<'PY'
import os
import re
import sys
import json

root = sys.argv[1] if len(sys.argv) > 1 else '.'
prune_paths = os.environ.get('PRUNE_PATHS', '').split()

all_files = []
for dirpath, dirnames, filenames in os.walk(root):
    try:
        rel_dir = os.path.relpath(dirpath, '.')
    except ValueError:
        rel_dir = ''
    if rel_dir == '.':
        rel_dir = ''

    i = len(dirnames) - 1
    while i >= 0:
        d = dirnames[i]
        d_rel = os.path.join(rel_dir, d) if rel_dir else d
        d_rel_norm = d_rel.replace('\\', '/')
        is_pruned = any(
            d_rel_norm == p or d_rel_norm.startswith(p + '/')
            for p in prune_paths
        )
        if is_pruned:
            del dirnames[i]
        i -= 1

    for f in filenames:
        f_rel = os.path.join(rel_dir, f) if rel_dir else f
        f_rel_norm = f_rel.replace('\\', '/')
        is_pruned = any(
            f_rel_norm == p or f_rel_norm.startswith(p + '/')
            for p in prune_paths
        )
        if not is_pruned:
            all_files.append(f_rel_norm)

# Collect package.json declared mains and bins
package_json_mains = set()
for f in all_files:
    if os.path.basename(f) != 'package.json':
        continue
    pj_abs = f
    if os.path.isfile(pj_abs):
        try:
            with open(pj_abs, 'r', encoding='utf-8') as fh:
                data = json.load(fh)
                pj_dir = os.path.dirname(f)
                for field in ['main']:
                    if field in data and isinstance(data[field], str):
                        mp = os.path.normpath(os.path.join(pj_dir, data[field])).replace('\\', '/')
                        package_json_mains.add(mp)
                        for ext2 in ['.js', '.ts']:
                            package_json_mains.add(mp + ext2)
                bins = data.get('bin', {})
                if isinstance(bins, str):
                    bp = os.path.normpath(os.path.join(pj_dir, bins)).replace('\\', '/')
                    package_json_mains.add(bp)
                elif isinstance(bins, dict):
                    for v in bins.values():
                        if isinstance(v, str):
                            bp = os.path.normpath(os.path.join(pj_dir, v)).replace('\\', '/')
                            package_json_mains.add(bp)
        except Exception:
            pass

entrypoints = []

for f in all_files:
    f_abs = f
    if not os.path.isfile(f_abs):
        continue

    basename = os.path.basename(f)
    ext = os.path.splitext(f)[1].lower()
    is_entry = f in package_json_mains

    if not is_entry:
        if ext == '.py':
            if basename in ['main.py', 'app.py', 'wsgi.py', 'manage.py', 'run.py']:
                is_entry = True
            else:
                try:
                    with open(f_abs, 'r', encoding='utf-8', errors='ignore') as fh:
                        if re.search(r'__name__\s*==\s*[\'"]__main__[\'"]', fh.read()):
                            is_entry = True
                except Exception:
                    pass

        elif ext in ['.js', '.jsx', '.ts', '.tsx']:
            if basename in ['index.js', 'index.ts', 'app.js', 'app.ts',
                            'server.js', 'server.ts', 'main.js', 'main.ts']:
                is_entry = True

        elif ext in ['.sh', '.bash', '']:
            if basename in ['run.sh', 'main.sh']:
                is_entry = True
            else:
                try:
                    with open(f_abs, 'r', encoding='utf-8', errors='ignore') as fh:
                        if fh.readline().startswith('#!'):
                            is_entry = True
                except Exception:
                    pass

        elif ext == '.go':
            if basename == 'main.go':
                is_entry = True
            else:
                try:
                    with open(f_abs, 'r', encoding='utf-8', errors='ignore') as fh:
                        content = fh.read()
                        if 'package main' in content and 'func main(' in content:
                            is_entry = True
                except Exception:
                    pass

    if is_entry:
        entrypoints.append({"file": f, "kind": "entrypoint"})

entrypoints = sorted(entrypoints, key=lambda x: x['file'])
print(json.dumps(entrypoints))
PY
)"

# =========================================================
# JSON EMISSION
# =========================================================

emit_extraction_result "entrypoints" "${TARGET_PATH}" "${ENTRYPOINTS_JSON}"

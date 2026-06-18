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
    --arg capability "filesystem.extract_import_graph" \
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

if [[ ! -d "${TARGET_PATH}" ]]; then
  fail "missing_directory" "${TARGET_PATH}"
  exit 1
fi

declare -p AEGIS_FILESYSTEM_PRUNE_PATHS >/dev/null 2>&1 || {
  fail "missing_prune_policy"
  exit 1
}

# =========================================================
# EXTRACTION
# =========================================================

export PRUNE_PATHS="${AEGIS_FILESYSTEM_PRUNE_PATHS[*]}"

IMPORT_GRAPH_JSON="$(python3 - "${TARGET_PATH}" <<'PY'
import os
import re
import sys
import json

root = sys.argv[1] if len(sys.argv) > 1 else '.'
prune_paths = os.environ.get('PRUNE_PATHS', '').split()

all_files = []
for dirpath, dirnames, filenames in os.walk(root):
    try:
        rel_dir = os.path.relpath(dirpath, root)
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
    f_abs = os.path.join(root, f)
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
            elif t in all_files:
                resolved.append(t)

    elif ext in ['.sh', '.bash', ''] and os.path.isfile(f_abs):
        raw_sources = re.findall(r'^\s*source\s+([^\s\n#]+)', content, re.MULTILINE)
        raw_sources += re.findall(r'^\s*\.\s+([^\s\n#]+)', content, re.MULTILINE)
        for t in [m.strip('\'"') for m in raw_sources]:
            f_dir = os.path.dirname(f)
            cand = resolve_existing([
                t,
                os.path.normpath(os.path.join(f_dir, t)).replace('\\', '/'),
            ])
            if cand:
                resolved.append(cand)

    unique = sorted(set(resolved))
    if unique:
        import_graph.append({"file": f, "imports": unique})

print(json.dumps(import_graph))
PY
)"

# =========================================================
# JSON EMISSION
# =========================================================

_TMPFILE="$(mktemp)"
printf '%s' "${IMPORT_GRAPH_JSON}" > "${_TMPFILE}"

jq -n \
  --arg capability "filesystem.extract_import_graph" \
  --arg classification "readonly" \
  --arg execution_id "${AEGIS_EXECUTION_ID:-unknown}" \
  --arg generated_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  --arg target "${TARGET_PATH}" \
  --slurpfile import_graph "${_TMPFILE}" \
  '{
    success: true,
    capability: $capability,
    classification: $classification,
    execution_id: $execution_id,
    generated_at: $generated_at,
    payload: {
      target: $target,
      import_graph: $import_graph[0]
    },
    error: null
  }'

rm -f "${_TMPFILE}"

#!/usr/bin/env bash

# =========================================================
# AEGIS CAPABILITY — filesystem.extract_symbols
# =========================================================
#
# Classification:
# readonly
#
# Responsibilities:
#
# - scan target source files for function/class symbols
# - filter and group symbols deterministically
# - emit JSON payload of {file, symbols} per file
# - supported languages: Python, JS/TS, Bash
#
# =========================================================

set -Eeuo pipefail

# =========================================================
# INPUTS
# =========================================================

readonly TARGET_PATH="${1:-.}"

# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/_shared_utils.sh"
aegis_capability_init "filesystem.extract_symbols"

require_directory_target "${TARGET_PATH}"
require_prune_policy

# =========================================================
# EXTRACTION
# =========================================================

SYMBOLS_JSON="$(python3 - "${TARGET_PATH}" <<'PY'
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

symbol_extractions = []

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
    symbols = []

    if ext == '.py':
        symbols = re.findall(r'^\s*(?:def|class)\s+([a-zA-Z0-9_]+)', content, re.MULTILINE)

    elif ext in ['.js', '.jsx', '.ts', '.tsx']:
        symbols += re.findall(r'^\s*(?:function|class)\s+([a-zA-Z0-9_]+)', content, re.MULTILINE)
        symbols += re.findall(r'^\s*(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*(?:\([^)]*\)|[a-zA-Z0-9_]+)?\s*=>', content, re.MULTILINE)

    elif ext in ['.sh', '.bash', ''] and os.path.isfile(f_abs):
        symbols += re.findall(r'^\s*([a-zA-Z0-9_-]+)\s*\(\s*\)\s*\{', content, re.MULTILINE)
        symbols += re.findall(r'^\s*function\s+([a-zA-Z0-9_-]+)', content, re.MULTILINE)

    seen = set()
    unique = []
    for s in symbols:
        if s not in seen:
            seen.add(s)
            unique.append(s)

    if unique:
        symbol_extractions.append({"file": f, "symbols": unique})

print(json.dumps(symbol_extractions))
PY
)"

# =========================================================
# JSON EMISSION
# =========================================================

emit_extraction_result "symbol_extractions" "${TARGET_PATH}" "${SYMBOLS_JSON}"

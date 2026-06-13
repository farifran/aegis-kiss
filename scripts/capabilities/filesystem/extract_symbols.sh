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
    --arg capability "filesystem.extract_symbols" \
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

symbol_extractions = []

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

jq -n \
  --arg capability "filesystem.extract_symbols" \
  --arg classification "readonly" \
  --arg execution_id "${AEGIS_EXECUTION_ID:-unknown}" \
  --arg generated_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  --arg target "${TARGET_PATH}" \
  --argjson symbol_extractions "${SYMBOLS_JSON}" \
  '{
    success: true,
    capability: $capability,
    classification: $classification,
    execution_id: $execution_id,
    generated_at: $generated_at,
    payload: {
      target: $target,
      symbol_extractions: $symbol_extractions
    },
    error: null
  }'

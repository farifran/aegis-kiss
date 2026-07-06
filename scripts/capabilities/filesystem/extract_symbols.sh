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

SYMBOLS_JSON="$(run_python_extractor "${TARGET_PATH}" <<'PY'
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

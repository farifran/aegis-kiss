#!/usr/bin/env bash

# =========================================================
# AEGIS CAPABILITY — filesystem.extract_configuration_structure
# =========================================================
#
# Classification:
# readonly
#
# Responsibilities:
#
# - extract structure/keys from config files without exposing values
# - supported extensions: .yml, .yaml, .json, .properties, .env, .ini, .conf
# - emit JSON array of {config, keys}
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
    --arg capability "filesystem.extract_configuration_structure" \
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

CONFIG_JSON="$(python3 - "${TARGET_PATH}" <<'PY'
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

def get_dict_keys(d, prefix=''):
    keys = []
    if isinstance(d, dict):
        for k, v in d.items():
            curr = f"{prefix}.{k}" if prefix else str(k)
            keys.append(curr)
            keys.extend(get_dict_keys(v, curr))
    elif isinstance(d, list):
        for item in d:
            keys.extend(get_dict_keys(item, f"{prefix}[]"))
    return keys

config_structures = []

for f in all_files:
    basename = os.path.basename(f)
    ext = os.path.splitext(f)[1].lower()

    is_config = ext in ['.yml', '.yaml', '.json', '.properties', '.env', '.ini', '.conf']
    if not is_config and not basename.startswith('.env'):
        continue

    f_abs = os.path.join(root, f)
    if not os.path.isfile(f_abs):
        continue

    try:
        with open(f_abs, 'r', encoding='utf-8', errors='ignore') as fh:
            content = fh.read()
    except Exception:
        continue

    keys = []

    if ext == '.json':
        try:
            data = json.loads(content)
            keys = get_dict_keys(data)
        except Exception:
            pass

    elif ext in ['.yml', '.yaml']:
        try:
            import yaml
            data = yaml.safe_load(content)
            keys = get_dict_keys(data)
        except Exception:
            # Fallback: regex-based YAML key extraction
            stack = []
            for line in content.splitlines():
                stripped = line.strip()
                if not stripped or stripped.startswith('#'):
                    continue
                m = re.match(r'^(\s*)([a-zA-Z0-9_\-\[\]\.]+)\s*:', line)
                if m:
                    indent = len(m.group(1))
                    key = m.group(2)
                    while stack and stack[-1][0] >= indent:
                        stack.pop()
                    stack.append((indent, key))
                    keys.append('.'.join(item[1] for item in stack))

    else:
        # .properties, .env, .ini, .conf — key=value and [section] style
        curr_section = ''
        for line in content.splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith('#') or stripped.startswith(';'):
                continue
            sect_m = re.match(r'^\[([^\]]+)\]', stripped)
            if sect_m:
                curr_section = sect_m.group(1)
                continue
            kv_m = re.match(r'^([a-zA-Z0-9_\-\.]+)\s*[=:]', stripped)
            if kv_m:
                key = kv_m.group(1)
                keys.append(f"{curr_section}.{key}" if curr_section else key)

    unique_keys = sorted(set(keys))
    if unique_keys:
        config_structures.append({"config": f, "keys": unique_keys})

config_structures = sorted(config_structures, key=lambda x: x['config'])
print(json.dumps(config_structures))
PY
)"

# =========================================================
# JSON EMISSION
# =========================================================

jq -n \
  --arg capability "filesystem.extract_configuration_structure" \
  --arg classification "readonly" \
  --arg execution_id "${AEGIS_EXECUTION_ID:-unknown}" \
  --arg generated_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  --arg target "${TARGET_PATH}" \
  --argjson config_structures "${CONFIG_JSON}" \
  '{
    success: true,
    capability: $capability,
    classification: $classification,
    execution_id: $execution_id,
    generated_at: $generated_at,
    payload: {
      target: $target,
      config_structures: $config_structures
    },
    error: null
  }'

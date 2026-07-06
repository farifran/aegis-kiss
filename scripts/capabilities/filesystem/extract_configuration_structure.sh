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

# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/_shared_utils.sh"
aegis_capability_init "filesystem.extract_configuration_structure"

require_directory_target "${TARGET_PATH}"
require_prune_policy

# =========================================================
# EXTRACTION
# =========================================================

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

def get_dict_keys(d, prefix='', depth=0, max_depth=2):
    """Extract config keys up to max_depth to keep payload bounded.
    Deeper nesting is collapsed into a count marker instead of
    expanding every leaf key path."""
    keys = []
    if depth >= max_depth:
        if isinstance(d, dict) and d:
            keys.append(f"{prefix}.*({len(d)} keys)")
        elif isinstance(d, list) and d:
            keys.append(f"{prefix}[]({len(d)} items)")
        return keys
    if isinstance(d, dict):
        for k, v in d.items():
            curr = f"{prefix}.{k}" if prefix else str(k)
            if isinstance(v, (dict, list)) and v:
                keys.append(curr)
                keys.extend(get_dict_keys(v, curr, depth + 1, max_depth))
            else:
                keys.append(curr)
    elif isinstance(d, list):
        for item in d:
            keys.extend(get_dict_keys(item, f"{prefix}[]", depth + 1, max_depth))
    return keys

config_structures = []

for f in all_files:
    basename = os.path.basename(f)
    ext = os.path.splitext(f)[1].lower()

    is_config = ext in ['.yml', '.yaml', '.json', '.properties', '.env', '.ini', '.conf']
    if not is_config and not basename.startswith('.env'):
        continue

    f_abs = f
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
        # Cap keys per file to keep payload bounded. Large config files
        # (e.g. package-lock.json) can have thousands of keys.
        MAX_KEYS_PER_FILE = 50
        if len(unique_keys) > MAX_KEYS_PER_FILE:
            truncated_count = len(unique_keys) - MAX_KEYS_PER_FILE
            unique_keys = unique_keys[:MAX_KEYS_PER_FILE]
            unique_keys.append(f"...({truncated_count} more keys truncated)")
        config_structures.append({"config": f, "keys": unique_keys})

config_structures = sorted(config_structures, key=lambda x: x['config'])
print(json.dumps(config_structures))
PY
)"

# =========================================================
# JSON EMISSION
# =========================================================

emit_extraction_result "config_structures" "${TARGET_PATH}" "${CONFIG_JSON}"

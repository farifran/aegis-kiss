#!/usr/bin/env bash

# =========================================================
# AEGIS CAPABILITY — filesystem.extract_test_relationships
# =========================================================
#
# Classification:
# readonly
#
# Responsibilities:
#
# - detect test files and map them to target code files
# - resolve links using naming similarity and import analysis
# - emit JSON array of {test, targets}
#
# =========================================================

set -Eeuo pipefail

# =========================================================
# INPUTS
# =========================================================

readonly TARGET_PATH="${1:-.}"

# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/_shared_utils.sh"
aegis_capability_init "filesystem.extract_test_relationships"

require_directory_target "${TARGET_PATH}"
require_prune_policy

# =========================================================
# EXTRACTION
# =========================================================

TEST_REL_JSON="$(run_python_extractor "${TARGET_PATH}" <<'PY'
def is_test_file(f):
    parts = f.lower().split('/')
    if 'test' in parts or 'tests' in parts or '__tests__' in parts:
        return True
    name, _ = os.path.splitext(os.path.basename(f).lower())
    return (name.startswith('test_') or name.endswith('_test')
            or name.endswith('.test') or name.endswith('.spec'))

test_files = [f for f in all_files if is_test_file(f)]
code_files  = [f for f in all_files if not is_test_file(f)]
code_set    = set(code_files)

# Build name→file index for code files (by stem, lowercased)
code_by_stem = {}
for cf in code_files:
    stem = os.path.splitext(os.path.basename(cf))[0].lower()
    code_by_stem.setdefault(stem, []).append(cf)

test_relationships = []

for tf in test_files:
    tf_abs = tf
    matched_targets = set()

    # 1. Name similarity: strip test/spec prefixes and suffixes from stem
    tname = os.path.splitext(os.path.basename(tf))[0].lower()
    for prefix in ['test_', 'spec_']:
        if tname.startswith(prefix):
            tname = tname[len(prefix):]
    for suffix in ['_test', '_spec', '.test', '.spec']:
        if tname.endswith(suffix):
            tname = tname[:-len(suffix)]
    for candidate in code_by_stem.get(tname, []):
        matched_targets.add(candidate)

    # 2. Import analysis
    if os.path.isfile(tf_abs):
        try:
            with open(tf_abs, 'r', encoding='utf-8', errors='ignore') as fh:
                content = fh.read()
        except Exception:
            content = ''

        ext = os.path.splitext(tf)[1].lower()

        if ext == '.py':
            targets = re.findall(r'^\s*from\s+([a-zA-Z0-9_\.]+)', content, re.MULTILINE)
            for m in re.findall(r'^\s*import\s+([a-zA-Z0-9_\.,\s]+)', content, re.MULTILINE):
                for part in m.split(','):
                    part = part.strip().split()[0] if part.strip() else ''
                    if part:
                        targets.append(part)
            for t in targets:
                t_path = t.replace('.', '/')
                for cand in [t_path + '.py', t_path + '/__init__.py']:
                    if cand in code_set:
                        matched_targets.add(cand)
                        break
                else:
                    tf_dir = os.path.dirname(tf)
                    cand = os.path.normpath(os.path.join(tf_dir, t_path + '.py')).replace('\\', '/')
                    if cand in code_set:
                        matched_targets.add(cand)

        elif ext in ['.js', '.jsx', '.ts', '.tsx']:
            imports = re.findall(r'import\s+.*?\s+from\s+[\'"]([^\'"]+)[\'"]', content)
            imports += re.findall(r'require\([\'"]([^\'"]+)[\'"]\)', content)
            for t in imports:
                if t.startswith('.'):
                    tf_dir = os.path.dirname(tf)
                    base = os.path.normpath(os.path.join(tf_dir, t)).replace('\\', '/')
                    for cand in [base + e for e in ['.js', '.jsx', '.ts', '.tsx', '/index.js', '/index.ts']]:
                        if cand in code_set:
                            matched_targets.add(cand)
                            break
                elif t in code_set:
                    matched_targets.add(t)

    targets_list = sorted(matched_targets)
    if targets_list:
        test_relationships.append({"test": tf, "targets": targets_list})

test_relationships = sorted(test_relationships, key=lambda x: x['test'])
print(json.dumps(test_relationships))
PY
)"

# =========================================================
# JSON EMISSION
# =========================================================

emit_extraction_result "test_relationships" "${TARGET_PATH}" "${TEST_REL_JSON}"

#!/usr/bin/env bash
# =========================================================
# CAPABILITY: filesystem.extract_responsibilities
# CLASSIFICATION: readonly
# =========================================================
# Mechanically classifies each file by its architectural
# responsibility using deterministic signals only:
#   - directory path segments (controllers/, models/, tests/, etc.)
#   - file basename (main.py, *_controller.py, test_*, etc.)
#   - file extension (.yml, .html, .go, etc.)
#   - file content patterns (shebang, __main__, package X, decorators)
#
# No LLM. No interpretation. Pure signal extraction.
#
# Output: { responsibilities: [{file, responsibility, signals, confidence}] }
# =========================================================

set -euo pipefail

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "${REPOSITORY_ROOT}"

# shellcheck disable=SC1091
source "${REPOSITORY_ROOT}/scripts/capabilities/filesystem/_shared_utils.sh"
aegis_capability_init "filesystem.extract_responsibilities"

TARGET_PATH="${1:-.}"
EXECUTION_ID="${AEGIS_EXECUTION_ID:-unknown}"
GENERATED_AT="$(aegis_now)"

emit_failure() {
  local err="$1"
  jq -n \
    --arg eid "${EXECUTION_ID}" \
    --arg err "${err}" \
    --arg ts "${GENERATED_AT}" \
    '{
      success: false,
      capability: "filesystem.extract_responsibilities",
      classification: "readonly",
      execution_id: $eid,
      generated_at: $ts,
      error: $err,
      payload: { responsibilities: [] }
    }'
  exit 0
}

if [[ ! -d "${TARGET_PATH}" ]]; then
  emit_failure "target_path_not_found: ${TARGET_PATH}"
fi

export PRUNE_PATHS="${AEGIS_FILESYSTEM_PRUNE_PATHS[*]}"

run_python_extractor "$TARGET_PATH" "${GENERATED_AT}" "${EXECUTION_ID}" <<'PY'
from collections import Counter

generated_at = sys.argv[2]
execution_id = sys.argv[3]

# =========================================================
# RESPONSIBILITY DETECTION
# =========================================================

STRONG = "high"
MEDIUM = "medium"

def detect(f):
    """Classify a file by mechanical signals. Returns (responsibility, signals, confidence)."""
    f_norm = f.replace('\\', '/')
    f_lower = f_norm.lower()
    basename = os.path.basename(f_norm)
    stem = os.path.splitext(basename)[0]
    stem_lower = stem.lower()
    ext = os.path.splitext(f_norm)[1].lower()
    path_segments = [s.lower() for s in f_norm.split('/') if s]

    signals = []

    # ---- TEST (highest priority) ----
    if ('test' in path_segments or 'tests' in path_segments or '__tests__' in path_segments
            or stem_lower.startswith('test_') or stem_lower.startswith('spec_')
            or stem_lower.endswith('_test') or stem_lower.endswith('.test')
            or stem_lower.endswith('.spec') or stem_lower.endswith('_spec')):
        signals.append('path_or_name:test_pattern')
        return 'test', signals, STRONG

    # ---- CONFIG ----
    config_exts = {'.yml', '.yaml', '.json', '.properties', '.env', '.ini', '.conf', '.toml'}
    if ext in config_exts:
        signals.append(f'ext:{ext}')
        return 'config', signals, STRONG
    if 'config' in path_segments or stem_lower.startswith('.env'):
        signals.append('path_or_name:config')
        return 'config', signals, STRONG
    if basename in ('package.json', 'tsconfig.json', 'package-lock.json',
                    'pyproject.toml', 'setup.cfg', '.eslintrc.json', 'eslint.config.js'):
        signals.append(f'basename:{basename}')
        return 'config', signals, STRONG

    # ---- VIEW ----
    if ext in {'.html', '.ejs', '.hbs', '.pug'}:
        signals.append(f'ext:{ext}')
        return 'view', signals, STRONG
    view_dirs = {'views', 'templates', 'pages', 'components', 'public', 'static', 'assets'}
    view_exts = {'.html', '.ejs', '.hbs', '.pug', '.vue', '.svelte', '.jsx', '.tsx'}
    if any(d in view_dirs for d in path_segments) and ext in view_exts:
        signals.append(f'dir:{[d for d in path_segments if d in view_dirs][0]}')
        return 'view', signals, STRONG
    if stem_lower in ('ui', 'view', 'page', 'layout'):
        signals.append(f'name:{stem_lower}')
        return 'view', signals, MEDIUM

    # ---- ENTRYPOINT ----
    entry_basenames = {'main.py', 'app.py', 'wsgi.py', 'manage.py', 'run.py',
                       'index.js', 'index.ts', 'app.js', 'app.ts',
                       'server.js', 'server.ts', 'main.js', 'main.ts',
                       'main.go', 'run.sh', 'main.sh'}
    if basename.lower() in entry_basenames:
        signals.append(f'basename:{basename.lower()}')
        return 'entrypoint', signals, STRONG
    if 'bin' in path_segments:
        signals.append('dir:bin/')
        return 'entrypoint', signals, STRONG
    f_abs = f_norm
    if os.path.isfile(f_abs):
        try:
            with open(f_abs, 'r', encoding='utf-8', errors='ignore') as fh:
                content = fh.read()
                first_line = content.split('\n')[0] if content else ''
                if first_line.startswith('#!'):
                    signals.append('content:shebang')
                    return 'entrypoint', signals, STRONG
                if '__name__' in content and '__main__' in content:
                    signals.append('content:__main__')
                    return 'entrypoint', signals, STRONG
                if 'package main' in content and 'func main(' in content:
                    signals.append('content:package_main_func_main')
                    return 'entrypoint', signals, STRONG
        except Exception:
            pass

    # ---- CONTROLLER ----
    controller_dirs = {'controllers', 'api', 'routes', 'handlers', 'endpoints', 'resources'}
    if any(d in controller_dirs for d in path_segments):
        signals.append(f'dir:{[d for d in path_segments if d in controller_dirs][0]}')
        return 'controller', signals, STRONG
    if stem_lower.endswith('_controller') or stem_lower.endswith('_handler'):
        signals.append(f'suffix:{stem_lower.rsplit("_", 1)[-1]}')
        return 'controller', signals, STRONG
    if stem_lower in ('api', 'router', 'routes'):
        signals.append(f'name:{stem_lower}')
        return 'controller', signals, MEDIUM
    f_abs = f_norm
    if os.path.isfile(f_abs) and ext == '.py':
        try:
            with open(f_abs, 'r', encoding='utf-8', errors='ignore') as fh:
                content = fh.read()
                if re.search(r'@(app|router|bp|blueprint)\.(get|post|put|delete|route|patch)\b', content):
                    signals.append('content:route_decorator')
                    return 'controller', signals, STRONG
        except Exception:
            pass

    # ---- MODEL ----
    model_dirs = {'models', 'entities', 'schemas', 'domain'}
    if any(d in model_dirs for d in path_segments):
        signals.append(f'dir:{[d for d in path_segments if d in model_dirs][0]}')
        return 'model', signals, STRONG
    if stem_lower.endswith('_model') or stem_lower.endswith('_entity'):
        signals.append(f'suffix:{stem_lower.rsplit("_", 1)[-1]}')
        return 'model', signals, STRONG
    if stem_lower in ('db', 'database', 'schema', 'entity'):
        signals.append(f'name:{stem_lower}')
        return 'model', signals, MEDIUM
    f_abs = f_norm
    if os.path.isfile(f_abs) and ext == '.py':
        try:
            with open(f_abs, 'r', encoding='utf-8', errors='ignore') as fh:
                content = fh.read()
                if re.search(r'class\s+\w+.*(?:models\.Model|db\.Model|Base|Document)\b', content):
                    signals.append('content:orm_model_class')
                    return 'model', signals, STRONG
        except Exception:
            pass

    # ---- SERVICE ----
    service_dirs = {'services', 'service'}
    service_dir_matches = [d for d in path_segments
                           if d in service_dirs or d.startswith('service_')]
    if service_dir_matches:
        signals.append(f'dir:{service_dir_matches[0]}')
        return 'service', signals, STRONG
    if stem_lower.endswith('_service'):
        signals.append('suffix:_service')
        return 'service', signals, STRONG
    if stem_lower in ('auth', 'billing', 'payment', 'notification', 'email',
                      'user', 'order', 'core'):
        signals.append(f'name:{stem_lower}')
        return 'service', signals, MEDIUM

    # ---- UTILITY ----
    utility_dirs = {'lib', 'utils', 'helpers', 'common', 'shared', 'util'}
    if any(d in utility_dirs for d in path_segments):
        signals.append(f'dir:{[d for d in path_segments if d in utility_dirs][0]}')
        return 'utility', signals, STRONG
    if stem_lower in ('utils', 'core', 'common', 'shared', 'helpers', 'helper', 'util'):
        signals.append(f'name:{stem_lower}')
        return 'utility', signals, MEDIUM

    # ---- MODULE (fallback) ----
    return 'module', [], 'low'


# =========================================================
# CLASSIFY ALL FILES
# =========================================================

responsibilities = []
for f in sorted(all_files):
    resp, sigs, conf = detect(f)
    responsibilities.append({
        'file': f,
        'responsibility': resp,
        'signals': sigs,
        'confidence': conf
    })

# =========================================================
# OUTPUT
# =========================================================

counts = Counter(r['responsibility'] for r in responsibilities)

output = {
    'success': True,
    'capability': 'filesystem.extract_responsibilities',
    'classification': 'readonly',
    'execution_id': execution_id,
    'generated_at': generated_at,
    'payload': {
        'responsibilities': responsibilities,
        'summary': {
            'total_files': len(responsibilities),
            'by_responsibility': dict(counts)
        }
    }
}

print(json.dumps(output, indent=2, sort_keys=True))
PY

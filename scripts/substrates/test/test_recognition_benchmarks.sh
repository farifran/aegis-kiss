#!/usr/bin/env bash
#
# test_recognition_benchmarks.sh — Layer 0 recognition calibration harness.
#
# Materializes three transient, git-backed mock repository topologies and
# runs the deterministic Layer 0 routines (layer0_entrypoints,
# layer0_import_gravity, layer0_hot_files) against them, asserting the
# recognition engine reaches 100% precision and recall versus each
# scenario's ground truth.
#
#   Scenario A — Monorepo Node:   nested package.json manifests.
#   Scenario B — Legacy Polyglot: CommonJS require + shell source with
#                                 complex relative paths.
#   Scenario C — Noise Pollution: dead files, build artifacts, and fake
#                                 shebang scripts posing as entrypoints.
#
# Diagnostic-only: modifies no production recognition parameters.
#

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

readonly LAYER0_SCRIPT="${AEGIS_TEST_ROOT}/scripts/capabilities/runtime/layer0_facts.sh"

BENCH_ROOT="$(mktemp -d)"

test_cleanup_extra() {
  rm -rf "${BENCH_ROOT}"
}

# ---------------------------------------------------------------------
# Scenario materialization helpers
# ---------------------------------------------------------------------

seed_git_repo() {
  local repo="$1"
  git -C "${repo}" init -q
  git -C "${repo}" config user.name "Aegis Bench"
  git -C "${repo}" config user.email "bench@aegis.invalid"
}

commit_all() {
  local repo="$1"
  local msg="$2"
  git -C "${repo}" add -A
  git -C "${repo}" commit -qm "${msg}"
}

# Run one Layer 0 routine against a scenario repo, in a fresh bash that
# sources the real capability in source-only mode (defines routines
# without executing recognition). The census is the repo's tracked files
# unless a pocket map is supplied.
#   run_routine <repo> <routine> [investigation_input] [pocket_map]
run_routine() {
  local repo="$1"
  local routine="$2"
  local input="${3:-}"
  local pocket="${4:-}"

  AEGIS_LAYER0_SOURCE_ONLY=1 \
  AEGIS_INVESTIGATION_INPUT="${input}" \
  AEGIS_POCKET_MAP_FILE="${pocket}" \
  BENCH_REPO="${repo}" \
  BENCH_ROUTINE="${routine}" \
  BENCH_LAYER0="${LAYER0_SCRIPT}" \
  bash -c '
    set -Eeuo pipefail
    # shellcheck disable=SC1090
    source "${BENCH_LAYER0}"
    cd "${BENCH_REPO}" || exit 1
    [[ -n "${AEGIS_POCKET_MAP_FILE}" ]] || unset AEGIS_POCKET_MAP_FILE
    build_layer0_census
    "${BENCH_ROUTINE}"
  '
}

run_routine_pocket() {
  run_routine "$1" "$2" "${4:-}" "$3"
}

# Assert two newline lists are set-equal (precision == recall == 1).
assert_set_equal() {
  local label="$1"
  local expected="$2"
  local actual="$3"

  local exp_sorted act_sorted
  exp_sorted="$(printf '%s\n' "${expected}" | sed '/^$/d' | sort -u)"
  act_sorted="$(printf '%s\n' "${actual}"   | sed '/^$/d' | sort -u)"

  if [[ "${exp_sorted}" != "${act_sorted}" ]]; then
    echo "[BENCH][FAIL] ${label}" >&2
    echo "  expected:" >&2; printf '    %s\n' ${exp_sorted:-<none>} >&2
    echo "  actual:"   >&2; printf '    %s\n' ${act_sorted:-<none>} >&2
    fail "recognition_mismatch: ${label}"
  fi
  echo "[BENCH][PASS] ${label} (P=R=1.0, $(printf '%s\n' "${exp_sorted}" | sed '/^$/d' | wc -l | tr -d ' ') items)"
}

# =====================================================================
# SCENARIO A — Monorepo Node (nested package.json manifests)
# =====================================================================

scenario_a() {
  local repo="${BENCH_ROOT}/monorepo"
  mkdir -p "${repo}/services/api" "${repo}/services/auth"
  seed_git_repo "${repo}"

  cat > "${repo}/package.json" <<'JSON'
{ "name": "root", "main": "index.js", "workspaces": ["services/*"] }
JSON
  printf 'module.exports = {};\n' > "${repo}/index.js"

  cat > "${repo}/services/api/package.json" <<'JSON'
{ "name": "api", "main": "server.js", "bin": { "api": "cli.js" } }
JSON
  printf 'module.exports = {};\n' > "${repo}/services/api/server.js"
  printf '#!/usr/bin/env node\n' > "${repo}/services/api/cli.js"

  cat > "${repo}/services/auth/package.json" <<'JSON'
{ "name": "auth", "main": "app.js" }
JSON
  printf 'module.exports = {};\n' > "${repo}/services/auth/app.js"

  commit_all "${repo}" "monorepo fixture"

  # Ground truth: every declared main/bin across the nested manifests,
  # resolved relative to each manifest's own directory.
  local expected_entrypoints
  expected_entrypoints="$(cat <<'EOF'
index.js
services/api/server.js
services/api/cli.js
services/auth/app.js
EOF
)"

  local ep_json actual_entrypoints
  ep_json="$(run_routine "${repo}" layer0_entrypoints)"
  actual_entrypoints="$(jq -r '.entrypoints[].file' <<< "${ep_json}")"

  assert_set_equal "A: monorepo declared entrypoints" \
    "${expected_entrypoints}" "${actual_entrypoints}"

  # No spurious gaps: every declaration resolved.
  jq -e '.gaps | length == 0' <<< "${ep_json}" >/dev/null \
    || fail "A: unexpected entrypoint gaps: $(jq -c '.gaps' <<< "${ep_json}")"
  echo "[BENCH][PASS] A: no false gaps"
}

# =====================================================================
# SCENARIO B — Legacy Polyglot (require + source, complex relatives)
# =====================================================================

scenario_b() {
  local repo="${BENCH_ROOT}/polyglot"
  mkdir -p "${repo}/lib" "${repo}/a/b" "${repo}/scripts"
  seed_git_repo "${repo}"

  printf 'module.exports = {};\n' > "${repo}/lib/core.js"
  printf 'export {};\n'           > "${repo}/lib/env.sh"

  # Three importers of lib/core at different depths — must aggregate.
  printf "const c = require('./lib/core');\n"     > "${repo}/three.js"
  printf "const c = require('../lib/core');\n"    > "${repo}/a/one.js"
  printf "const c = require('../../lib/core');\n" > "${repo}/a/b/two.js"

  # Two shell scripts sourcing the same env file (quoted relative paths).
  printf '#!/usr/bin/env bash\nsource "../lib/env.sh"\n' > "${repo}/scripts/run.sh"
  printf '#!/usr/bin/env bash\nsource "../lib/env.sh"\n' > "${repo}/scripts/deploy.sh"

  commit_all "${repo}" "polyglot fixture"

  local grav_json
  grav_json="$(run_routine "${repo}" layer0_import_gravity)"

  # Ground truth: lib/core in-degree 3 (top), lib/env.sh in-degree 2.
  local top_file top_gravity core_gravity env_gravity
  top_file="$(jq -r '.[0].file' <<< "${grav_json}")"
  top_gravity="$(jq -r '.[0].gravity' <<< "${grav_json}")"
  core_gravity="$(jq -r '.[] | select(.file == "lib/core") | .gravity' <<< "${grav_json}")"
  env_gravity="$(jq -r '.[] | select(.file == "lib/env.sh") | .gravity' <<< "${grav_json}")"

  [[ "${top_file}" == "lib/core" ]] \
    || fail "B: expected lib/core ranked #1, got '${top_file}'"
  [[ "${top_gravity}" == "3" ]] \
    || fail "B: expected lib/core gravity 3 (depth-aggregated), got '${top_gravity}'"
  [[ "${core_gravity}" == "3" ]] \
    || fail "B: lib/core in-degree not aggregated across depths: '${core_gravity}'"
  [[ "${env_gravity}" == "2" ]] \
    || fail "B: expected lib/env.sh gravity 2, got '${env_gravity}'"

  # Precision: only the two real targets carry gravity — no fragmented
  # per-depth phantom nodes (../lib/core, ../../lib/core).
  local gravity_files
  gravity_files="$(jq -r '.[].file' <<< "${grav_json}")"
  assert_set_equal "B: gravity node set (no depth fragmentation)" \
    "$(printf 'lib/core\nlib/env.sh\n')" "${gravity_files}"
}

# =====================================================================
# SCENARIO C — Noise Pollution (dead files, artifacts, fake entrypoints)
# =====================================================================

scenario_c() {
  local repo="${BENCH_ROOT}/noise"
  mkdir -p "${repo}/src" "${repo}/dist" "${repo}/tools"
  seed_git_repo "${repo}"

  cat > "${repo}/package.json" <<'JSON'
{ "name": "noisy", "main": "src/main.js" }
JSON
  printf "const u = require('./util');\nmodule.exports = {};\n" > "${repo}/src/main.js"
  printf 'module.exports = {};\n' > "${repo}/src/util.js"

  # Build artifact: committed but must be pruned from recognition.
  printf "const u = require('./util');\n" > "${repo}/dist/bundle.js"

  # Dead files: imported by nothing, declared nowhere.
  printf 'module.exports = {};\n' > "${repo}/dead1.js"
  printf 'module.exports = {};\n' > "${repo}/dead2.js"

  # Fake shebang scripts posing as entrypoints — NOT declared anywhere,
  # so Layer 0 must never promote them to entrypoints.
  printf '#!/usr/bin/env bash\necho fake\n' > "${repo}/tools/fake_a.sh"
  printf '#!/usr/bin/env bash\necho fake\n' > "${repo}/tools/fake_b.sh"

  commit_all "${repo}" "noise fixture"

  # Pocket map (census) prunes the build directory, mirroring production.
  local pocket="${BENCH_ROOT}/noise_pocket.txt"
  git -C "${repo}" ls-files | grep -v '^dist/' > "${pocket}"

  # --- Entrypoints: exactly the one declared main, nothing else. ---
  local ep_json actual_entrypoints
  ep_json="$(run_routine_pocket "${repo}" layer0_entrypoints "${pocket}")"
  actual_entrypoints="$(jq -r '.entrypoints[].file' <<< "${ep_json}")"

  assert_set_equal "C: declared entrypoints (fakes/dead excluded)" \
    "src/main.js" "${actual_entrypoints}"

  # Fake shebang scripts and dead files must be absent.
  if jq -e '[.entrypoints[].file] | any(. == "tools/fake_a.sh" or . == "tools/fake_b.sh" or . == "dead1.js" or . == "dead2.js")' <<< "${ep_json}" >/dev/null; then
    fail "C: noise leaked into entrypoints: $(jq -c '.entrypoints' <<< "${ep_json}")"
  fi
  echo "[BENCH][PASS] C: shebang/dead noise excluded from entrypoints"

  # --- Gravity: build artifact must not inflate centrality. ---
  local grav_json gravity_files
  grav_json="$(run_routine_pocket "${repo}" layer0_import_gravity "${pocket}")"
  gravity_files="$(jq -r '.[].file' <<< "${grav_json}")"

  # src/util is imported by src/main (in census). dist/bundle.js is
  # pruned, so its import of util does not count — util gravity is 1.
  assert_set_equal "C: gravity nodes (build artifacts pruned)" \
    "src/util" "${gravity_files}"

  if jq -e '[.[].file] | any(startswith("dist/"))' <<< "${grav_json}" >/dev/null; then
    fail "C: build artifact appeared in gravity: $(jq -c '.' <<< "${grav_json}")"
  fi
  echo "[BENCH][PASS] C: build artifacts pruned from gravity"

  # --- Hot files: churn a specific file, prompt resonates with it. ---
  # Add commits touching src/util.js so it dominates churn, with a
  # prompt token ("util") resonant to its basename.
  printf 'module.exports = { a: 1 };\n' > "${repo}/src/util.js"
  commit_all "${repo}" "touch util 1"
  printf 'module.exports = { a: 2 };\n' > "${repo}/src/util.js"
  commit_all "${repo}" "touch util 2"

  local hot_json top_hot top_resonance
  hot_json="$(run_routine_pocket "${repo}" layer0_hot_files "${pocket}" "investigate the util helper regression")"
  top_hot="$(jq -r '.[0].file' <<< "${hot_json}")"
  top_resonance="$(jq -r '.[0].resonance' <<< "${hot_json}")"

  [[ "${top_hot}" == "src/util.js" ]] \
    || fail "C: expected src/util.js as #1 hot file, got '${top_hot}'"
  [[ "${top_resonance}" == "1" ]] \
    || fail "C: expected resonance flag on src/util.js, got '${top_resonance}'"

  # Pruned build artifacts must never surface as hot files.
  if jq -e '[.[].file] | any(startswith("dist/"))' <<< "${hot_json}" >/dev/null; then
    fail "C: build artifact appeared in hot files: $(jq -c '.' <<< "${hot_json}")"
  fi
  echo "[BENCH][PASS] C: churn⊕resonance ranks src/util.js #1, artifacts pruned"
}

# =====================================================================
# RUN
# =====================================================================

scenario_a
scenario_b
scenario_c

echo "[PASS] recognition benchmarks (Layer 0: 100% precision/recall across A/B/C)"

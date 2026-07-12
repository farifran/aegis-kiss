#!/usr/bin/env bash

# =========================================================
# Context pruning — pocket map focuses when attention is set
# =========================================================

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

test_tmp="$(mktemp -d)"
handover_file="${test_tmp}/epistemic_handover.json"
cap_env="${test_tmp}/capability_env"

test_cleanup_extra() {
  rm -rf "${test_tmp}"
}

mkdir -p "${cap_env}"
mkdir -p "${test_tmp}/repo/src"
cd "${test_tmp}/repo"

# Disposable git repo so the full-census branch has something to list.
git init -q
printf 'export {};\n' > src/a.ts
printf 'export {};\n' > src/b.ts
printf 'export {};\n' > src/c.ts
git add src
git -c user.name="Aegis Test" -c user.email="aegis-test@example.invalid" \
  commit -qm "fixture"

# Load only the pocket-map / attention helpers from the executor.
aegis_log() { :; }
aegis_warn() { :; }

# shellcheck disable=SC1091
source <(
  awk '
    /^: "\$\{AEGIS_POCKET_MAP_MAX_LINES/ {keep=1}
    keep {print}
    /^# RUNTIME-OWNED MANIFEST/ {exit}
  ' "${AEGIS_TEST_ROOT}/scripts/execute_mode.sh" \
    | sed '$d'
)

export AEGIS_CAPABILITY_ENV_DIR="${cap_env}"
# AEGIS_FILESYSTEM_PRUNE_PATHS is readonly from config.sh — leave as-is.

# --- Full census when no attention (discovery) ---
export AEGIS_MODE="discovery"
unset AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT
export AEGIS_POCKET_MAP_FILE=""

generate_pocket_map

[[ -f "${AEGIS_POCKET_MAP_FILE}" ]] \
  || fail "pocket_map_missing_for_discovery"

if head -n 1 "${AEGIS_POCKET_MAP_FILE}" | grep -q '^# attention-focused'; then
  fail "discovery_pocket_map_was_incorrectly_focused"
fi

map_lines="$(grep -cv '^#' "${AEGIS_POCKET_MAP_FILE}" || true)"
[[ "${map_lines}" -ge 3 ]] \
  || fail "discovery_pocket_map_too_small: ${map_lines}"

# --- Focused map when attention targets exist (forensics) ---
jq -n '{
  epistemic_state: {
    next_attention_targets: ["src/a.ts", "src/c.ts"],
    attention_scope: "test",
    attention_reason: "test focus"
  },
  artifact_snapshot: { mode: "discovery" }
}' > "${handover_file}"

export AEGIS_MODE="forensics"
export AEGIS_EPISTEMIC_HANDOVER_FILE_INPUT="${handover_file}"
export AEGIS_POCKET_MAP_FILE=""

generate_pocket_map

[[ -f "${AEGIS_POCKET_MAP_FILE}" ]] \
  || fail "pocket_map_missing_for_forensics"

head -n 1 "${AEGIS_POCKET_MAP_FILE}" \
  | grep -q '^# attention-focused' \
  || fail "forensics_pocket_map_missing_focus_marker"

# Exactly the two targets (plus marker); full census must not leak.
map_body="$(grep -v '^#' "${AEGIS_POCKET_MAP_FILE}" | sort | tr '\n' ' ')"
[[ "${map_body}" == "src/a.ts src/c.ts " ]] \
  || fail "forensics_pocket_map_unexpected_body: '${map_body}'"

grep -q 'src/b.ts' "${AEGIS_POCKET_MAP_FILE}" \
  && fail "forensics_pocket_map_leaked_non_attention_path"

# --- Empty attention on advanced mode falls back to full census ---
jq -n '{
  epistemic_state: {
    next_attention_targets: [],
    attention_scope: "none",
    attention_reason: "empty"
  },
  artifact_snapshot: { mode: "discovery" }
}' > "${handover_file}"

export AEGIS_MODE="validation"
export AEGIS_POCKET_MAP_FILE=""

generate_pocket_map

if head -n 1 "${AEGIS_POCKET_MAP_FILE}" | grep -q '^# attention-focused'; then
  fail "empty_attention_should_not_focus_pocket_map"
fi

map_lines="$(grep -cv '^#' "${AEGIS_POCKET_MAP_FILE}" || true)"
[[ "${map_lines}" -ge 3 ]] \
  || fail "empty_attention_census_too_small: ${map_lines}"

echo "[PASS] context pruning (attention-focused pocket map)"

#!/usr/bin/env bash
#
# test_model_boundary_idempotency.sh — Fail-powered proof that a model
# injected across a stripped process boundary survives a config re-source
# byte-identically, and can never be clobbered back to a default.
#
# Why this test exists:
#   The cognition substrates (aider_substrate.sh) run under `env -i`, which
#   strips the raw model inputs (OPENAI_MODEL_READONLY_COGNITION,
#   OPENAI_MODEL_ANALYSIS) but injects the already-resolved AEGIS_AIDER_MODEL.
#   A prior bug had config.sh unconditionally recompute AEGIS_AIDER_MODEL from
#   the (now-stripped, thus defaulted) inputs, silently clobbering the injected
#   frontier model back to the gemma default — invisible to every mock-based
#   suite because they never exercised the stripped-boundary re-source.
#
#   This test reproduces that exact boundary and asserts:
#     (A) the injected model survives the real config.sh re-source unchanged;
#     (B) a synthetic clobbering config is DETECTED — negative power, proving
#         the assertion would go red if the clobber bug were reintroduced.
#

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

readonly REAL_CONFIG=".harness/config.sh"
readonly SENTINEL_MODEL="openai/aegis-sentinel-frontier-model-xyz"

test_tmp="$(mktemp -d)"

test_cleanup_extra() {
  rm -rf "${test_tmp}"
}

[[ -f "${REAL_CONFIG}" ]] \
  || fail "missing_real_config: ${REAL_CONFIG}"

# ---------------------------------------------------------------------
# Boundary reproduction: source <config> under a maximally stripped
# env -i profile carrying ONLY the injected AEGIS_AIDER_MODEL (exactly
# what the executor's aider whitelist delivers), then echo the effective
# model that survived. All raw model inputs are absent, mimicking the
# stripped substrate boundary.
# ---------------------------------------------------------------------
resolve_injected_model_across_boundary() {
  local config_file="$1"

  env -i \
    PATH="${PATH}" \
    HOME="${HOME:-}" \
    AEGIS_AIDER_MODEL="${SENTINEL_MODEL}" \
    bash -c '
      source "'"${config_file}"'" >/dev/null 2>&1
      printf "%s" "${AEGIS_AIDER_MODEL:-<empty>}"
    '
}

# ---------------------------------------------------------------------
# (A) POSITIVE: the REAL config must preserve the injected model exactly.
# ---------------------------------------------------------------------
real_resolved="$(resolve_injected_model_across_boundary "${REAL_CONFIG}")"

[[ "${real_resolved}" == "${SENTINEL_MODEL}" ]] \
  || fail "injected_model_clobbered_across_boundary: expected '${SENTINEL_MODEL}', got '${real_resolved}'"

# ---------------------------------------------------------------------
# (B) NEGATIVE POWER: a config that clobbers the injected model MUST be
# caught by the exact same assertion. This reproduces the original bug
# pattern (unconditional recompute from stripped/defaulted inputs) and
# proves this test would go red if that regression were reintroduced.
# ---------------------------------------------------------------------
buggy_config="${test_tmp}/config_clobber.sh"
cat > "${buggy_config}" <<'BUGGY'
#!/usr/bin/env bash
# Faithful reproduction of the clobber bug: recompute unconditionally
# from the (stripped, thus defaulted) input, ignoring any injected value.
: "${OPENAI_MODEL_READONLY_COGNITION:=google/gemma-4-31b-it}"
export AEGIS_AIDER_MODEL="openai/${OPENAI_MODEL_READONLY_COGNITION}"
BUGGY

buggy_resolved="$(resolve_injected_model_across_boundary "${buggy_config}")"

# The clobbering config MUST NOT preserve the sentinel — if it somehow
# did, this test has no negative power and must fail loudly.
[[ "${buggy_resolved}" != "${SENTINEL_MODEL}" ]] \
  || fail "negative_power_absent: clobbering config preserved the sentinel"

# And it must land on exactly the known-bad default, confirming the
# reproduction actually exercised the clobber path.
[[ "${buggy_resolved}" == "openai/google/gemma-4-31b-it" ]] \
  || fail "negative_control_did_not_clobber_as_expected: got '${buggy_resolved}'"

# ---------------------------------------------------------------------
# (C) Model-requiring context with NO model in any form must fatal —
# proving the gemma default is truly gone and misconfiguration fails loud.
# ---------------------------------------------------------------------
if env -i PATH="${PATH}" HOME="${HOME:-}" AEGIS_REQUIRE_MODEL=1 \
    bash -c 'source "'"${REAL_CONFIG}"'"' >/dev/null 2>&1; then
  fail "missing_model_did_not_fatal_under_require_model"
fi

echo "[PASS] model boundary idempotency (injected model survives; clobber detected; no silent default)"

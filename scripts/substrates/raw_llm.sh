#!/usr/bin/env bash

# =========================================================
# AEGIS HARNESS — RAW COGNITION SUBSTRATE
# =========================================================
#
# Readonly cognition: isolated workspace, bounded prompt from
# capability payloads, provider call, framed JSON artifact.
# Does not own orchestration or handover (runtime / execute_mode).
#
# Implementation under scripts/substrates/raw/:
#   workspace.sh  prompt.sh  provider.sh  artifact.sh
#
# =========================================================

set -Eeuo pipefail

readonly AEGIS_SUBSTRATE_ROOT="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd
)"

cd "${AEGIS_SUBSTRATE_ROOT}"

[[ -f ".harness/config.sh" ]] || {
  echo "[AEGIS][RAW][FATAL] missing_config" >&2
  exit 1
}

# Allow config to load .harness/local.env once (never in env -i children).
export AEGIS_LOAD_LOCAL_ENV=1
source ".harness/config.sh"

readonly MODEL="${1:-}"
readonly SKILL_FILE_INPUT="${2:-}"
readonly CAPABILITY_MANIFEST="${3:-}"
readonly CAPABILITY_PAYLOAD_DIR_INPUT="${4:-}"

SKILL_FILE=""
CAPABILITY_PAYLOAD_DIR=""
AEGIS_SUBSTRATE_WORKSPACE=""

# shellcheck disable=SC1091
source "scripts/lib/common.sh"
# shellcheck disable=SC1091
source "scripts/lib/demand.sh"
AEGIS_LOG_TAG="RAW"

# shellcheck disable=SC1091
source "scripts/substrates/raw/workspace.sh"
# shellcheck disable=SC1091
source "scripts/substrates/raw/prompt.sh"
# shellcheck disable=SC1091
source "scripts/substrates/raw/provider.sh"
# shellcheck disable=SC1091
source "scripts/substrates/raw/artifact.sh"

main() {
  validate_raw_substrate_inputs
  prepare_isolated_substrate_workspace

  local start_assembly end_assembly
  start_assembly=$(date +%s)
  assemble_system_prompt
  assemble_bounded_manifest
  assemble_bounded_capability_context
  assemble_provider_request
  end_assembly=$(date +%s)
  echo "[AEGIS][TIMING] prompt_assembly: $((end_assembly - start_assembly))s" >&2

  execute_provider_request

  local start_extract end_extract
  start_extract=$(date +%s)
  extract_artifact_payload
  end_extract=$(date +%s)
  echo "[AEGIS][TIMING] artifact_extract: $((end_extract - start_extract))s" >&2
}

main "$@"

#!/usr/bin/env bash

# =========================================================
# AEGIS CAPABILITY — filesystem.list_tree
# =========================================================
#
# Classification:
# readonly
#
# Responsibilities:
#
# - bounded filesystem topology inspection
# - deterministic tree generation
#
# =========================================================

set -Eeuo pipefail

readonly TARGET_PATH="${1:-.}"
readonly MAX_DEPTH="${AEGIS_LIST_TREE_MAX_DEPTH:-4}"

# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/_shared_utils.sh"
aegis_capability_init "filesystem.list_tree"

build_prune_expression() {
  local expr=()
  local prune_path

  for prune_path in "${AEGIS_FILESYSTEM_PRUNE_PATHS[@]}"; do
    expr+=( -path "*/${prune_path}" -o )
  done

  # Remove trailing -o
  unset 'expr[${#expr[@]}-1]'

  printf '%s\0' "${expr[@]}"
}

require_directory_target "${TARGET_PATH}"
require_prune_policy

# =========================================================
# TREE GENERATION
# =========================================================

TMP_TREE_FILE="$(aegis_mktemp)"

mapfile -d '' PRUNE_EXPR < <(build_prune_expression)

# Use a grouped prune expression to avoid descending into noisy directories.
# The tree output remains deterministic via sorting.
find "${TARGET_PATH}" \
  -maxdepth "${MAX_DEPTH}" \
  \( "${PRUNE_EXPR[@]}" \) \
  -prune \
  -o \
  -print \
  | sort \
  > "${TMP_TREE_FILE}"

# =========================================================
# JSON EMISSION
# =========================================================

TMP_PAYLOAD_FILE="$(aegis_mktemp)"

jq -n \
  --arg target "${TARGET_PATH}" \
  --argjson max_depth "${MAX_DEPTH}" \
  --rawfile tree "${TMP_TREE_FILE}" \
  '{
    target: $target,
    max_depth: $max_depth,
    tree: $tree
  }' > "${TMP_PAYLOAD_FILE}"

emit_success_payload_file "${TMP_PAYLOAD_FILE}"

#!/usr/bin/env bash
# =========================================================
# Source this file to point the *current shell* at local MLX.
# Does not overwrite .harness/local.env (cloud credentials stay safe).
#
#   source scripts/use_local_mlx.sh
#   ./run_aegis.sh readonly "list files under src"
# =========================================================

_SRC="${BASH_SOURCE[0]:-$0}"
ROOT="$(cd "$(dirname "${_SRC}")/.." && pwd)"
MLX_ENV="${ROOT}/.harness/local.env.mlx"
EXAMPLE="${ROOT}/.harness/local.env.mlx.example"
unset _SRC

if [[ ! -f "${MLX_ENV}" ]]; then
  if [[ -f "${EXAMPLE}" ]]; then
    cp "${EXAMPLE}" "${MLX_ENV}"
    echo "[use_local_mlx] created ${MLX_ENV} from example — edit model id if needed" >&2
  else
    echo "[use_local_mlx] missing ${MLX_ENV} and example" >&2
    return 1 2>/dev/null || exit 1
  fi
fi

# shellcheck disable=SC1090
source "${MLX_ENV}"

# Prevent runtime_aegis.sh from re-sourcing .harness/local.env (cloud) on top.
export AEGIS_SKIP_LOCAL_ENV=1

echo "[use_local_mlx] OPENAI_API_BASE=${OPENAI_API_BASE}" >&2
echo "[use_local_mlx] OPENAI_MODEL_READONLY_COGNITION=${OPENAI_MODEL_READONLY_COGNITION}" >&2
echo "[use_local_mlx] AEGIS_AIDER_MODEL=${AEGIS_AIDER_MODEL:-}" >&2
echo "[use_local_mlx] AEGIS_SKIP_LOCAL_ENV=1 (cloud local.env will not clobber)" >&2
echo "[use_local_mlx] smoke: curl -s \"\${OPENAI_API_BASE}/models\" | jq ." >&2
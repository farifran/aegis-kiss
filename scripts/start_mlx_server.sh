#!/usr/bin/env bash
# =========================================================
# Start a local OpenAI-compatible MLX server for Aegis.
# =========================================================
# Usage:
#   bash scripts/start_mlx_server.sh
#   bash scripts/start_mlx_server.sh --model prism-ml/Bonsai-27B-mlx-1bit --port 8080
#
# Then point Aegis at it:
#   source .harness/local.env.mlx   # from the example
#   ./run_aegis.sh readonly "ping"
# =========================================================

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="${ROOT}/.venv-mlx"
# Default: small 4bit model that works with stock mlx-lm on ~8GB Macs.
# Bonsai 1bit (prism-ml/Bonsai-27B-mlx-1bit) needs MLX with 1-bit kernels
# (PrismML fork); stock pip mlx only quantizes 2–8 bit.
MODEL="${AEGIS_MLX_MODEL:-mlx-community/Qwen2.5-1.5B-Instruct-4bit}"
PORT="${AEGIS_MLX_PORT:-8080}"
HOST="${AEGIS_MLX_HOST:-127.0.0.1}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --model) MODEL="${2:-}"; shift 2 ;;
    --port)  PORT="${2:-}"; shift 2 ;;
    --host)  HOST="${2:-}"; shift 2 ;;
    -h|--help)
      sed -n '2,14p' "$0"
      exit 0
      ;;
    *)
      echo "[mlx-server] unknown arg: $1" >&2
      exit 1
      ;;
  esac
done

if [[ ! -x "${VENV}/bin/python" ]]; then
  echo "[mlx-server] missing ${VENV}" >&2
  echo "[mlx-server] create it with:" >&2
  echo "  python3.12 -m venv .venv-mlx && .venv-mlx/bin/pip install -U pip mlx-lm" >&2
  exit 1
fi

if ! "${VENV}/bin/python" -c "import mlx_lm" 2>/dev/null; then
  echo "[mlx-server] mlx_lm not installed in .venv-mlx" >&2
  echo "  .venv-mlx/bin/pip install mlx-lm" >&2
  exit 1
fi

echo "[mlx-server] model=${MODEL}"
echo "[mlx-server] listen=http://${HOST}:${PORT}/v1"
echo "[mlx-server] first run may download weights from Hugging Face"
echo "[mlx-server] smoke: curl -s http://${HOST}:${PORT}/v1/models | jq ."
echo "[mlx-server] then:  source scripts/use_local_mlx.sh"
echo

# OpenAI-compatible /v1/chat/completions (mlx-lm ≥0.31 entrypoint)
exec "${VENV}/bin/python" -m mlx_lm server \
  --model "${MODEL}" \
  --host "${HOST}" \
  --port "${PORT}"
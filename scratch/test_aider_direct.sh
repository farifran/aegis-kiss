#!/usr/bin/env bash
set -e
source .harness/local.env
export OPENAI_API_BASE="https://integrate.api.nvidia.com/v1"
export OPENAI_API_KEY="${NVIDIA_API_KEY}"

echo "Testing Aider call..."
aider \
  --model "openai/nvidia/nemotron-3.5-lightning-30b-a3b" \
  --openai-api-base "${OPENAI_API_BASE}" \
  --message "Implement export class ClearingHouse {} in src/clearingHouse.ts" \
  --no-git \
  --yes \
  --yes-always \
  --edit-format whole \
  --no-stream \
  --exit \
  src/clearingHouse.ts

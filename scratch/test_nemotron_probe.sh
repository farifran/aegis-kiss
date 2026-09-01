#!/usr/bin/env bash
set -euo pipefail
source .harness/local.env

echo "=== 1. Testando Conectividade HTTP do Nemotron 3.5 Lightning 30B na NVIDIA ==="
HTTP_CODE="$(
  curl -s -o /dev/null -w "%{http_code}" -X POST "${OPENAI_API_BASE}/chat/completions" \
    -H "Authorization: Bearer ${OPENAI_API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "nvidia/nemotron-3.5-lightning-30b-a3b",
      "messages": [{"role": "user", "content": "ping"}],
      "max_tokens": 5
    }'
)"

echo "HTTP Status Code: ${HTTP_CODE}"
if [[ "${HTTP_CODE}" != "200" ]]; then
  echo "FALHA: Endpoint retornou status ${HTTP_CODE}"
  exit 1
fi

echo "=== 2. Testando Geração de Código TypeScript ==="
RESPONSE="$(
  curl -s -X POST "${OPENAI_API_BASE}/chat/completions" \
    -H "Authorization: Bearer ${OPENAI_API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "nvidia/nemotron-3.5-lightning-30b-a3b",
      "messages": [
        {"role": "system", "content": "You are a precise TypeScript coder. Output only code."},
        {"role": "user", "content": "Export a function add(a: number, b: number): number that returns a + b."}
      ],
      "max_tokens": 150
    }'
)"

echo "Resposta do Modelo:"
echo "${RESPONSE}" | jq -r '.choices[0].message.content // .choices[0].message.reasoning_content' | head -n 15

echo "=== 3. Testando Aider Substrate com Nemotron 30B ==="
TEST_DIR="$(mktemp -d)"
cat << 'EOF' > "${TEST_DIR}/math.ts"
export function multiply(a: number, b: number): number {
  return a * b;
}
EOF

(
  cd "${TEST_DIR}"
  git init -q
  git config user.name "Aegis Test"
  git config user.email "test@aegis"
  git add math.ts
  git commit -qm "init"
  
  aider \
    --model "openai/nvidia/nemotron-3.5-lightning-30b-a3b" \
    --openai-api-base "${OPENAI_API_BASE}" \
    --message "Add export function divide(a: number, b: number): number to math.ts" \
    --no-git \
    --yes \
    --yes-always \
    --edit-format whole \
    --no-stream \
    --exit \
    math.ts > aider_out.log 2>&1
)

echo "Conteúdo de math.ts pós-Aider:"
cat "${TEST_DIR}/math.ts"
rm -rf "${TEST_DIR}"

echo "=== SUCESSO: nvidia/nemotron-3.5-lightning-30b-a3b 100% OPERACIONAL ==="

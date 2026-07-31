#!/usr/bin/env bash
# Test: Can the 8B model expand a vague prose demand into a structured Aegis issue?
# Usage: bash test_supervisor_expand.sh "prose demand"
set -euo pipefail

PROSE="${1:-adicione funçao converter Kilobits em Pentabytes}"

API_BASE="https://integrate.api.nvidia.com/v1"
API_KEY="${OPENAI_API_KEY:-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}"
MODEL="meta/llama-3.1-8b-instruct"

TEMPLATE='You convert a vague user demand into a structured Aegis issue JSON.

Rules:
- "targets": list of files mentioned or infer src/index.ts if unclear.
- "acceptance": ONLY exported TypeScript names (PascalCase classes or camelCase functions). NEVER parameter names or types.
- "goal": one sentence, imperative, names the file and the export.
- "briefing": pseudocode for each exported item. Format: "export function foo(x: type): type { return expr }". For classes, list private fields then each method as one line.
- "out_of_scope": always ["unrelated files", "e2e tests", "drive-by refactors"].
- "constraints": always include "no any", "NodeNext .js imports". Add "BigInt is global" if bigint used.

Output ONLY valid JSON, no markdown, no explanation.

Example input: "adicionar converterMegabitsEmTerabits a src/index.ts"
Example output:
{
  "goal": "Adicionar converterMegabitsEmTerabits a src/index.ts.",
  "targets": ["src/index.ts"],
  "acceptance": ["converterMegabitsEmTerabits"],
  "briefing": "export function converterMegabitsEmTerabits(mb: bigint): bigint { return mb / 1000000n }",
  "out_of_scope": ["unrelated files", "e2e tests", "drive-by refactors"],
  "constraints": ["no any", "NodeNext .js imports", "BigInt is global"]
}'

PAYLOAD="$(jq -nc \
  --arg model "${MODEL}" \
  --arg system "${TEMPLATE}" \
  --arg user "${PROSE}" \
  '{
    model: $model,
    messages: [
      {role: "system", content: $system},
      {role: "user", content: $user}
    ],
    temperature: 0,
    max_tokens: 512
  }'
)"

echo "=== INPUT ==="
echo "${PROSE}"
echo ""
echo "=== CALLING 8B ==="

RESPONSE="$(curl -s \
  "${API_BASE}/chat/completions" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "${PAYLOAD}"
)"

CONTENT="$(printf '%s' "${RESPONSE}" | jq -r '.choices[0].message.content // "ERROR: no content"')"

echo "=== RAW OUTPUT ==="
echo "${CONTENT}"
echo ""

# Try to parse as JSON
if printf '%s' "${CONTENT}" | jq . >/dev/null 2>&1; then
  echo "=== PARSED ISSUE ==="
  printf '%s' "${CONTENT}" | jq '{
    goal: .goal,
    targets: .targets,
    acceptance: .acceptance,
    briefing_length: (.briefing | length),
    constraints: .constraints
  }'
else
  echo "=== WARN: output is not valid JSON ==="
fi

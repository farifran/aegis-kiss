#!/usr/bin/env bash
# =========================================================
# AEGIS PROGRESSIVE COMPLEXITY STRESS-TEST SUITE
# =========================================================
# Pushes higher and higher algorithmic & architectural complexity
# Stops ONLY when Aegis fails or completes all extreme levels!
# =========================================================

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "${ROOT}"

if [[ -f ".harness/local.env" ]]; then
  source ".harness/local.env"
fi

REPORT_FILE="${ROOT}/stress_test_results.md"
STRESS_LOG="${ROOT}/stress_test_raw.jsonl"
rm -f "${STRESS_LOG}"

echo "================================================="
echo "AEGIS PROGRESSIVE COMPLEXITY STRESS-TEST"
echo "Model: ${OPENAI_MODEL_MUTATION:-meta/llama-3.1-8b-instruct}"
echo "Rule: Runs progressively higher levels until failure!"
echo "================================================="

STRESS_TASKS=(
  "L4.1:Crie classe MinHeap em src/minHeap.ts com metodos push, pop e peek e re-exporte no src/index.ts"
  "L4.2:Crie classe TokenBucket em src/tokenBucket.ts com refil por timestamp e re-exporte no src/index.ts"
  "L4.3:Crie classe LRUCache em src/lruCache.ts com get e set O(1) e re-exporte no src/index.ts"
  "L4.4:Crie classe Trie em src/trie.ts com insert, search e startsWith e re-exporte no src/index.ts"
  "L4.5:Crie classe WorkerPool em src/workerPool.ts com limite de concorrencia e re-exporte no src/index.ts"
  "L4.6:Crie classe CircularBuffer em src/circularBuffer.ts com capacidade fixa e re-exporte no src/index.ts"
  "L4.7:Crie classe UnionFind em src/unionFind.ts com path compression e re-exporte no src/index.ts"
  "L4.8:Crie classe DAGSorter em src/dagSort.ts com ordenacao topologica e detecao de ciclos e re-exporte no src/index.ts"
  "L4.9:Crie classe AVLTree em src/avlTree.ts com rotacoes de balanceamento e re-exporte no src/index.ts"
  "L5.0:Crie classe EventEmitter em src/eventEmitter.ts com suporte a wildcards e re-exporte no src/index.ts"
)

SUCCESS_COUNT=0
FAILURE_COUNT=0

for item in "${STRESS_TASKS[@]}"; do
  tag="${item%%:*}"
  demand="${item#*:}"

  echo ""
  echo "-------------------------------------------------"
  echo "STRESS LEVEL: ${tag} — \"${demand}\""
  echo "-------------------------------------------------"

  start_time=$(date +%s)
  set +e
  out="$(bash run_aegis.sh --fresh "${demand}" 2>&1)"
  status=$?
  set -e
  end_time=$(date +%s)
  duration=$((end_time - start_time))

  if [[ ${status} -eq 0 ]]; then
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    echo "   ✓ [PASS] Aegis completed ${tag} in ${duration}s"

    git add src/ 2>/dev/null || true
    if ! git diff --cached --quiet; then
      git commit -m "stress(${tag}): ${demand}" --quiet || true
      echo "   ✓ Git Auto-Commit performed"
    fi

    jq -n \
      --arg tag "${tag}" \
      --arg demand "${demand}" \
      --argjson sec "${duration}" \
      --arg status "PASSED" \
      '{tag: $tag, demand: $demand, sec: $sec, status: $status}' \
      >> "${STRESS_LOG}"
  else
    FAILURE_COUNT=$((FAILURE_COUNT + 1))
    echo "   ✗ [FAIL] Aegis reached boundary limit at ${tag} after ${duration}s"

    jq -n \
      --arg tag "${tag}" \
      --arg demand "${demand}" \
      --argjson sec "${duration}" \
      --arg status "FAILED" \
      '{tag: $tag, demand: $demand, sec: $sec, status: $status}' \
      >> "${STRESS_LOG}"

    echo ""
    echo "================================================="
    echo "STRESS TEST HALTED: Limit reached at level ${tag}"
    echo "================================================="
    break
  fi
done

cat > "${REPORT_FILE}" <<EOF
# Relatório de Estresse de Complexidade Progressiva (Aegis 8B)

Estudo de limite de complexidade onde o Aegis é submetido a tarefas progressivamente mais difíceis (níveis L4.1 a L5.0) até atingir a fronteira de falha do modelo.

---

## 📊 1. Resumo do Estresse

| Métrica | Resultado Medido |
| :--- | :--- |
| **Níveis Concluídos com Sucesso** | **${SUCCESS_COUNT} níveis aprovados** |
| **Ponto de Falha / Limite Atingido** | **${FAILURE_COUNT} falha** |
| **Modelo Testado** | `${OPENAI_MODEL_MUTATION:-meta/llama-3.1-8b-instruct}` |

---

## 🔬 2. Mapeamento das Tarefas Progressivas

EOF

jq -r '
  "### [\( .tag )] \( .demand )\n" +
  "- **Status**: \( .status )\n" +
  "- **Tempo**: \( .sec )s\n"
' "${STRESS_LOG}" >> "${REPORT_FILE}"

echo "Stress report generated at: file://${REPORT_FILE}"

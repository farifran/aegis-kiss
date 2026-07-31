#!/usr/bin/env bash
# Comprehensive supervisor benchmark: 8B vs GLM 5.2, L1-L9
# Usage: bash test_supervisor_benchmark.sh
set -euo pipefail

source .harness/local.env 2>/dev/null || true
API_BASE="https://integrate.api.nvidia.com/v1"
API_KEY="${OPENAI_API_KEY:-}"

TEMPLATE='You convert a user demand into a structured Aegis issue JSON.

Rules:
- "targets": files mentioned or infer src/index.ts if not specified.
- "acceptance": ONLY exported TypeScript names (PascalCase class/interface or camelCase function). NEVER include parameter names, field names, or built-in types.
- "goal": one imperative sentence naming the file and the export.
- "briefing": STRING of pseudocode. Format each export as one item:
  - For functions: "export function name(param: type): returnType { pseudocode }"
  - For classes: list private fields on one line, then each method as one pseudocode line
  - Keep briefing as a FLAT STRING, not a nested object.
- "out_of_scope": always ["unrelated files", "e2e tests", "drive-by refactors"]
- "constraints": always include "no any", "NodeNext .js imports". Add "BigInt is global" if bigint used.
- IMPORTANT: Use the SAME language and naming convention as the demand. Portuguese demand → Portuguese function names (converterXEmY pattern).

Output ONLY valid JSON. No markdown fences, no explanation.'

declare -A DEMANDS
# L1: trivial 1-line function
DEMANDS[L1]="adicionar converterGigabitsEmMegabits a src/index.ts"
# L2: 1 function with guard/validation
DEMANDS[L2]="adicionar converterBytesEmGigabytes com validação que retorna null se o valor for negativo"
# L3: multiple return paths + arithmetic
DEMANDS[L3]="adicionar calcularBandwidthEfetivo que recebe taxaBruta: bigint e overhead: number (0-1) e retorna a taxa efetiva em bits por segundo desconsiderando o overhead"
# L4: simple class, 2 methods
DEMANDS[L4]="criar classe Counter em src/counter.ts com increment(), decrement() e get value()"
# L5: class with state + exported utility function
DEMANDS[L5]="criar RateLimiter em src/rateLimiter.ts: aceita maxRequests: number e windowMs: number, método tryAcquire(): boolean que devolve true se dentro do limite, e função exportada obterTaxaOcupacao(limiter: RateLimiter): number que retorna percentagem usada"
# L6: generic class
DEMANDS[L6]="criar Stack<T> genérica em src/stack.ts com push(item: T), pop(): T | undefined, peek(): T | undefined, get size(): number e isEmpty(): boolean"
# L7: complex class + bigint + bitmask (TokenBucket reprise)
DEMANDS[L7]="Crie src/tokenBucket.ts com a classe TokenBucket. Use bigint com BigInt(Date.now()). Construtor aceita (maxBytes: bigint, mbps: number) e converte para rateBitsPerMs (mbps*8000). Em update(), acumule timeDiff*rateBitsPerMs limitando ao maxTokens. Em consume(bits: bigint), atualize e deduza saldo. Exporte a função obterEstadoBitmask(bucket: TokenBucket): number com bit 0 se tokens==0n e bit 1 se refil ativo. Re-exporte no src/index.ts."
# L8: typed event emitter with generics + WeakSet + fluent API
DEMANDS[L8]="criar TypedEventEmitter<T extends Record<string, unknown[]>> em src/eventEmitter.ts com: on<K>(event, fn), once<K>(event, fn), off<K>(event, fn), emit<K>(event, ...args): boolean que remove automaticamente listeners once após disparo, listenerCount<K>(event): number. Exportar função obterEstatisticas(emitter): {totalEmits: number}"
# L9: priority queue + scheduler com callbacks
DEMANDS[L9]="criar PriorityScheduler em src/scheduler.ts: internamente usa min-heap por prioridade (número menor = maior prioridade). Método schedule(task: ()=>void, priority: number, delayMs: number): string retorna um id único. Método cancel(id: string): boolean. Método tick(): number executa todas as tarefas prontas e retorna quantas executou. Exportar função obterFilaSnapshot(scheduler: PriorityScheduler): Array<{id: string, priority: number, readyAt: number}>"

run_model_test() {
  local model="$1" label="$2" prose="$3"
  local payload response content valid_json acceptance_count briefing_len

  payload="$(jq -nc \
    --arg model "${model}" \
    --arg system "${TEMPLATE}" \
    --arg user "${prose}" \
    '{model:$model,messages:[{role:"system",content:$system},{role:"user",content:$user}],temperature:0,max_tokens:1536}')"

  response="$(curl -s --max-time 60 \
    "${API_BASE}/chat/completions" \
    -H "Authorization: Bearer ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d "${payload}" 2>/dev/null || echo '{"error":"curl_failed"}')"

  content="$(printf '%s' "${response}" | jq -r '.choices[0].message.content // "ERROR"' 2>/dev/null || echo "PARSE_ERROR")"

  # Strip markdown fences if model wraps output
  content="$(printf '%s' "${content}" | sed -E 's/^```(json)?//;s/```$//'| tr -d '\000')"

  if printf '%s' "${content}" | jq . >/dev/null 2>&1; then
    valid_json="YES"
    acceptance_count="$(printf '%s' "${content}" | jq '.acceptance | length' 2>/dev/null || echo 0)"
    briefing_len="$(printf '%s' "${content}" | jq -r '(.briefing | if type=="string" then length else ("OBJECT:"+([to_entries[]|.key]|join(","))) end)' 2>/dev/null || echo "?")"
    acceptance_tokens="$(printf '%s' "${content}" | jq -r '.acceptance // [] | join(", ")' 2>/dev/null || echo "?")"
  else
    valid_json="NO"
    acceptance_count="?"
    briefing_len="?"
    acceptance_tokens="INVALID"
  fi

  printf "| %-8s | %-30s | %-6s | %-40s | %-12s |\n" \
    "${label}" "${model:0:30}" "${valid_json}" "${acceptance_tokens:0:40}" "${briefing_len}"
}

echo ""
echo "╔══════════════════════════════════════════════════════════════════════════════════════════════╗"
echo "║           SUPERVISOR BENCHMARK: 8B (Llama) vs GLM 5.2 — L1 to L9                          ║"
echo "╚══════════════════════════════════════════════════════════════════════════════════════════════╝"
echo ""
printf "| %-8s | %-30s | %-6s | %-40s | %-12s |\n" \
  "Level" "Model" "JSON?" "Acceptance tokens" "Briefing len"
printf "|%s|%s|%s|%s|%s|\n" \
  "----------" "--------------------------------" "--------" "------------------------------------------" "--------------"

for level in L1 L2 L3 L4 L5 L6 L7 L8 L9; do
  prose="${DEMANDS[${level}]}"
  run_model_test "meta/llama-3.1-8b-instruct" "${level} (8B)" "${prose}"
  run_model_test "z-ai/glm-5.2"               "${level} (GLM)" "${prose}"
  printf "|%s|%s|%s|%s|%s|\n" \
    "----------" "--------------------------------" "--------" "------------------------------------------" "--------------"
done

echo ""
echo "Done."

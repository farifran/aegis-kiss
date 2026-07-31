#!/usr/bin/env bash
# Benchmark v2: few-shot + json_object mode + mechanical post-processor
# Usage: bash test_supervisor_benchmark_v2.sh
set -euo pipefail

source .harness/local.env 2>/dev/null || true
API_BASE="https://integrate.api.nvidia.com/v1"
API_KEY="${OPENAI_API_KEY:-}"

# ─── Improved template with few-shot negative examples ───────────────────────
TEMPLATE='You convert a user demand into a structured Aegis issue JSON.

Rules:
- "targets": files mentioned or infer src/index.ts if not specified.
- "acceptance": ONLY names that appear as TOP-LEVEL exports: export class X, export function Y, export const Z.
  Class methods (increment, push, on, emit, update, consume, tryAcquire) are NEVER in acceptance even if the demand mentions them.
  Parameter names (maxBytes, mbps, bits) are NEVER in acceptance.
- "goal": one imperative sentence naming the file and the export.
- "briefing": FLAT STRING of pseudocode. Each export as one item:
  Functions: "export function name(param: type): returnType { pseudocode }"
  Classes: "private fields: ...\nconstructor(...){...}\nmethod(...){...}"
  Keep briefing as a FLAT STRING, never a nested object.
- "out_of_scope": always ["unrelated files","e2e tests","drive-by refactors"]
- "constraints": always ["no any","NodeNext .js imports"]. Add "BigInt is global" if bigint used.
- Use the SAME language/naming convention as the demand (Portuguese demand → Portuguese names).

EXAMPLE 1 — simple function:
Input: "adicionar converterGigabitsEmMegabits a src/index.ts"
Output: {"goal":"Adicionar converterGigabitsEmMegabits a src/index.ts.","targets":["src/index.ts"],"acceptance":["converterGigabitsEmMegabits"],"briefing":"export function converterGigabitsEmMegabits(gb: bigint): bigint { return gb * 1000n }","out_of_scope":["unrelated files","e2e tests","drive-by refactors"],"constraints":["no any","NodeNext .js imports","BigInt is global"]}

EXAMPLE 2 — class with methods (acceptance = class name ONLY, never methods):
Input: "criar Counter com increment(), decrement() e getValue()"
Output: {"goal":"Criar Counter em src/counter.ts.","targets":["src/counter.ts"],"acceptance":["Counter"],"briefing":"export class Counter { private _value: number = 0\nincrement(): void { this._value++ }\ndecrement(): void { this._value-- }\nget value(): number { return this._value } }","out_of_scope":["unrelated files","e2e tests","drive-by refactors"],"constraints":["no any","NodeNext .js imports"]}

EXAMPLE 3 — class + separate exported function (both in acceptance):
Input: "criar RateLimiter com tryAcquire() e exportar obterTaxaOcupacao(limiter)"
Output: {"goal":"Criar RateLimiter e obterTaxaOcupacao em src/rateLimiter.ts.","targets":["src/rateLimiter.ts"],"acceptance":["RateLimiter","obterTaxaOcupacao"],"briefing":"export class RateLimiter { private _requests: number = 0; private _max: number; private _windowMs: number\nconstructor(maxRequests: number, windowMs: number) { this._max = maxRequests; this._windowMs = windowMs }\ntryAcquire(): boolean { if (this._requests < this._max) { this._requests++; return true } return false } }\nexport function obterTaxaOcupacao(limiter: RateLimiter): number { return limiter.requests / limiter.max }","out_of_scope":["unrelated files","e2e tests","drive-by refactors"],"constraints":["no any","NodeNext .js imports"]}

Output ONLY valid JSON. No markdown, no explanation.'

# ─── Mechanical post-processor: strips non-top-level-export tokens ────────────
post_process() {
  local json="$1"
  local briefing acceptance_raw filtered

  if ! printf '%s' "${json}" | jq . >/dev/null 2>&1; then
    printf '%s' "${json}"
    return
  fi

  briefing="$(printf '%s' "${json}" | jq -r '.briefing // ""')"
  acceptance_raw="$(printf '%s' "${json}" | jq -r '.acceptance // [] | .[]' 2>/dev/null)"

  filtered=""
  while IFS= read -r tok; do
    [[ -z "${tok}" ]] && continue
    # Keep if token is PascalCase (class/interface)
    if [[ "${tok}" =~ ^[A-Z][a-zA-Z0-9]+$ ]]; then
      filtered="${filtered}\"${tok}\","
      continue
    fi
    # Keep if token appears as top-level export in briefing
    if printf '%s' "${briefing}" | grep -qE "export (class|function|const|let|var) ${tok}[^a-zA-Z]"; then
      filtered="${filtered}\"${tok}\","
      continue
    fi
    # Discard: it's a method or parameter name
  done <<< "${acceptance_raw}"

  filtered="[${filtered%,}]"
  printf '%s' "${json}" | jq --argjson acc "${filtered}" '.acceptance = $acc'
}

declare -A DEMANDS
DEMANDS[L1]="adicionar converterGigabitsEmMegabits a src/index.ts"
DEMANDS[L2]="adicionar converterBytesEmGigabytes com validação que retorna null se o valor for negativo"
DEMANDS[L3]="adicionar calcularBandwidthEfetivo que recebe taxaBruta: bigint e overhead: number (0-1) e retorna a taxa efetiva em bits por segundo desconsiderando o overhead"
DEMANDS[L4]="criar classe Counter em src/counter.ts com increment(), decrement() e get value()"
DEMANDS[L5]="criar RateLimiter em src/rateLimiter.ts: aceita maxRequests: number e windowMs: number, método tryAcquire(): boolean que devolve true se dentro do limite, e função exportada obterTaxaOcupacao(limiter: RateLimiter): number que retorna percentagem usada"
DEMANDS[L6]="criar Stack<T> genérica em src/stack.ts com push(item: T), pop(): T | undefined, peek(): T | undefined, get size(): number e isEmpty(): boolean"
DEMANDS[L7]="Crie src/tokenBucket.ts com a classe TokenBucket. Use bigint com BigInt(Date.now()). Construtor aceita (maxBytes: bigint, mbps: number) e converte para rateBitsPerMs (mbps*8000). Em update(), acumule timeDiff*rateBitsPerMs limitando ao maxTokens. Em consume(bits: bigint), atualize e deduza saldo. Exporte a função obterEstadoBitmask(bucket: TokenBucket): number com bit 0 se tokens==0n e bit 1 se refil ativo. Re-exporte no src/index.ts."
DEMANDS[L8]="criar TypedEventEmitter<T extends Record<string, unknown[]>> em src/eventEmitter.ts com: on<K>(event, fn), once<K>(event, fn), off<K>(event, fn), emit<K>(event, ...args): boolean que remove automaticamente listeners once após disparo, listenerCount<K>(event): number. Exportar função obterEstatisticas(emitter): {totalEmits: number}"
DEMANDS[L9]="criar PriorityScheduler em src/scheduler.ts: internamente usa min-heap por prioridade (número menor = maior prioridade). Método schedule(task: ()=>void, priority: number, delayMs: number): string retorna um id único. Método cancel(id: string): boolean. Método tick(): number executa todas as tarefas prontas e retorna quantas executou. Exportar função obterFilaSnapshot(scheduler: PriorityScheduler): Array<{id: string, priority: number, readyAt: number}>"

run_test() {
  local model="$1" label="$2" prose="$3"
  local payload response content processed

  # json_object mode forces valid JSON output
  payload="$(jq -nc \
    --arg model "${model}" \
    --arg system "${TEMPLATE}" \
    --arg user "${prose}" \
    '{
      model: $model,
      messages: [{role:"system",content:$system},{role:"user",content:$user}],
      temperature: 0,
      max_tokens: 1536,
      response_format: {type: "json_object"}
    }')"

  response="$(curl -s --max-time 60 \
    "${API_BASE}/chat/completions" \
    -H "Authorization: Bearer ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d "${payload}" 2>/dev/null || echo '{"error":"curl_failed"}')"

  content="$(printf '%s' "${response}" | jq -r '.choices[0].message.content // "ERROR"' 2>/dev/null || echo "PARSE_ERROR")"
  content="$(printf '%s' "${content}" | sed -E 's/^```(json)?[[:space:]]*//;s/[[:space:]]*```$//')"

  # Apply mechanical post-processor
  if printf '%s' "${content}" | jq . >/dev/null 2>&1; then
    processed="$(post_process "${content}")"
  else
    processed="${content}"
  fi

  local valid_json acceptance_before acceptance_after stripped
  if printf '%s' "${processed}" | jq . >/dev/null 2>&1; then
    valid_json="YES"
    acceptance_before="$(printf '%s' "${content}" | jq -r '.acceptance // [] | join(", ")' 2>/dev/null)"
    acceptance_after="$(printf '%s' "${processed}" | jq -r '.acceptance // [] | join(", ")' 2>/dev/null)"
    # Count stripped tokens
    before_count="$(printf '%s' "${content}" | jq '.acceptance | length' 2>/dev/null || echo 0)"
    after_count="$(printf '%s' "${processed}" | jq '.acceptance | length' 2>/dev/null || echo 0)"
    stripped=$(( before_count - after_count ))
    [[ "${stripped}" -gt 0 ]] && strip_note="(-${stripped})" || strip_note="(ok)"
  else
    valid_json="NO"
    acceptance_after="INVALID"
    strip_note="!"
  fi

  printf "| %-9s | %-8s | %-6s | %-4s | %-42s |\n" \
    "${label}" "${model##*/}" "${valid_json}" "${strip_note}" "${acceptance_after:0:42}"
}

echo ""
echo "╔═══════════════════════════════════════════════════════════════════════════════════╗"
echo "║   BENCHMARK v2: few-shot + json_object + post-processor — 8B vs GLM 5.2         ║"
echo "╚═══════════════════════════════════════════════════════════════════════════════════╝"
echo ""
printf "| %-9s | %-8s | %-6s | %-4s | %-42s |\n" \
  "Level" "Model" "JSON?" "Fix" "Acceptance (after post-processor)"
printf "|%-11s|%-10s|%-8s|%-6s|%-44s|\n" \
  "-----------" "----------" "--------" "------" "--------------------------------------------"

for level in L1 L2 L3 L4 L5 L6 L7 L8 L9; do
  prose="${DEMANDS[${level}]}"
  run_test "meta/llama-3.1-8b-instruct" "${level} (8B)"  "${prose}"
  run_test "z-ai/glm-5.2"               "${level} (GLM)" "${prose}"
  printf "|%-11s|%-10s|%-8s|%-6s|%-44s|\n" \
    "-----------" "----------" "--------" "------" "--------------------------------------------"
done

echo ""
echo "Fix column: (-N) = N method tokens stripped by post-processor | (ok) = acceptance already clean"

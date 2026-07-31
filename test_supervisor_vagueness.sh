#!/usr/bin/env bash
# 8B-only test: L1-L9 with deliberately vague demands mixed in
# Goal: evaluate how the 8B handles ambiguity and what the post-processor saves
set -euo pipefail

source .harness/local.env 2>/dev/null || true
API_BASE="https://integrate.api.nvidia.com/v1"
API_KEY="${OPENAI_API_KEY:-}"
MODEL="meta/llama-3.1-8b-instruct"

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
- If the demand is vague (no explicit function name), INFER a clear camelCase name from the context.

EXAMPLE 1 — simple function:
Input: "adicionar converterGigabitsEmMegabits a src/index.ts"
Output: {"goal":"Adicionar converterGigabitsEmMegabits a src/index.ts.","targets":["src/index.ts"],"acceptance":["converterGigabitsEmMegabits"],"briefing":"export function converterGigabitsEmMegabits(gb: bigint): bigint { return gb * 1000n }","out_of_scope":["unrelated files","e2e tests","drive-by refactors"],"constraints":["no any","NodeNext .js imports","BigInt is global"]}

EXAMPLE 2 — class with methods (acceptance = class name ONLY, never methods):
Input: "criar Counter com increment(), decrement() e getValue()"
Output: {"goal":"Criar Counter em src/counter.ts.","targets":["src/counter.ts"],"acceptance":["Counter"],"briefing":"export class Counter { private _value: number = 0\nincrement(): void { this._value++ }\ndecrement(): void { this._value-- }\nget value(): number { return this._value } }","out_of_scope":["unrelated files","e2e tests","drive-by refactors"],"constraints":["no any","NodeNext .js imports"]}

EXAMPLE 3 — class + separate exported function (both in acceptance):
Input: "criar RateLimiter com tryAcquire() e exportar obterTaxaOcupacao(limiter)"
Output: {"goal":"Criar RateLimiter e obterTaxaOcupacao em src/rateLimiter.ts.","targets":["src/rateLimiter.ts"],"acceptance":["RateLimiter","obterTaxaOcupacao"],"briefing":"export class RateLimiter { private _requests: number = 0; private _max: number\nconstructor(max: number) { this._max = max }\ntryAcquire(): boolean { if (this._requests < this._max) { this._requests++; return true } return false } }\nexport function obterTaxaOcupacao(limiter: RateLimiter): number { return limiter.requests / limiter.max }","out_of_scope":["unrelated files","e2e tests","drive-by refactors"],"constraints":["no any","NodeNext .js imports"]}

Output ONLY valid JSON. No markdown, no explanation.'

# ─── Post-processor ────────────────────────────────────────────────────────────
post_process() {
  local json="$1"
  local briefing filtered before_count after_count

  [[ -z "${json}" ]] && return
  printf '%s' "${json}" | jq . >/dev/null 2>&1 || { printf '%s' "${json}"; return; }

  briefing="$(printf '%s' "${json}" | jq -r '.briefing // ""')"
  before_count="$(printf '%s' "${json}" | jq '.acceptance | length' 2>/dev/null || echo 0)"

  filtered="$(printf '%s' "${json}" | jq -r '.acceptance // [] | .[]' | while IFS= read -r tok; do
    [[ -z "${tok}" ]] && continue
    [[ "${tok}" =~ ^[A-Z][a-zA-Z0-9]+$ ]] && { printf '"%s"\n' "${tok}"; continue; }
    printf '%s' "${briefing}" | grep -qE "export (class|function|const|let|var) ${tok}[^a-zA-Z]" \
      && printf '"%s"\n' "${tok}"
  done | paste -sd ',' - | sed 's/^/[/;s/$/]/')"

  [[ -z "${filtered}" ]] && filtered="[]"
  after_count="$(printf '%s' "${filtered}" | jq 'length' 2>/dev/null || echo 0)"
  STRIPPED=$(( before_count - after_count ))

  printf '%s' "${json}" | jq --argjson acc "${filtered}" '.acceptance = $acc'
}

# ─── Demands: mix of clear and deliberately vague ─────────────────────────────
declare -A DEMANDS
declare -A VAGUE

# L1 — clear
DEMANDS[L1]="adicionar converterGigabitsEmMegabits a src/index.ts"
VAGUE[L1]="no"

# L2 — vague: no camelCase, no target file
DEMANDS[L2]="converte bytes para gigabytes"
VAGUE[L2]="yes (no camelCase, no target)"

# L3 — vague: no types, no explicit name
DEMANDS[L3]="calcula bandwidth efetivo descontando overhead percentual"
VAGUE[L3]="yes (no function name, no types)"

# L4 — clear class
DEMANDS[L4]="criar classe Counter em src/counter.ts com increment(), decrement() e get value()"
VAGUE[L4]="no"

# L5 — vague: abstract description, no function names
DEMANDS[L5]="criar um limitador de taxa de requisições por janela de tempo"
VAGUE[L5]="yes (no class name, no method names, no target)"

# L6 — semi-vague: mentions generics but no file
DEMANDS[L6]="fazer uma pilha genérica com push pop e peek"
VAGUE[L6]="semi (no file, no types)"

# L7 — detailed prose (TokenBucket) — complex but explicit
DEMANDS[L7]="Crie src/tokenBucket.ts com a classe TokenBucket. Construtor aceita (maxBytes: bigint, mbps: number) e converte para rateBitsPerMs (mbps*8000). Em update(), acumule timeDiff*rateBitsPerMs limitando ao maxTokens. Em consume(bits: bigint), atualize e deduza saldo. Exporte obterEstadoBitmask(bucket: TokenBucket): number com bit 0 se tokens==0n e bit 1 se refil ativo."
VAGUE[L7]="no (detailed prose)"

# L8 — vague: no generics syntax, no method signatures
DEMANDS[L8]="criar sistema de eventos tipados onde posso ouvir emitir e cancelar eventos uma vez"
VAGUE[L8]="yes (no class name, no generics, no method signatures)"

# L9 — very vague: just a concept
DEMANDS[L9]="criar agendador de tarefas com prioridades e controle de tempo"
VAGUE[L9]="yes (very abstract, no names, no signatures)"

STRIPPED=0

run_test() {
  local level="$1" prose="$2" vague_note="$3"
  STRIPPED=0

  local payload response content processed

  payload="$(jq -nc \
    --arg model "${MODEL}" \
    --arg system "${TEMPLATE}" \
    --arg user "${prose}" \
    '{model:$model,messages:[{role:"system",content:$system},{role:"user",content:$user}],temperature:0,max_tokens:1536,response_format:{type:"json_object"}}')"

  response="$(curl -s --max-time 60 \
    "${API_BASE}/chat/completions" \
    -H "Authorization: Bearer ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d "${payload}" 2>/dev/null || echo '{"error":"curl_failed"}')"

  content="$(printf '%s' "${response}" | jq -r '.choices[0].message.content // "ERROR"' 2>/dev/null)"
  content="$(printf '%s' "${content}" | sed -E 's/^```(json)?[[:space:]]*//;s/[[:space:]]*```$//')"

  if printf '%s' "${content}" | jq . >/dev/null 2>&1; then
    processed="$(post_process "${content}")"
  else
    processed="${content}"
    STRIPPED=-1
  fi

  local valid acceptance goal briefing_preview fix
  if printf '%s' "${processed}" | jq . >/dev/null 2>&1; then
    valid="✅"
    acceptance="$(printf '%s' "${processed}" | jq -r '.acceptance | join(", ")')"
    goal="$(printf '%s' "${processed}" | jq -r '.goal')"
    briefing_preview="$(printf '%s' "${processed}" | jq -r '.briefing' | head -c 120)"
  else
    valid="❌"
    acceptance="PARSE_ERROR"
    goal="—"
    briefing_preview="—"
  fi

  [[ "${STRIPPED}" -gt 0 ]] && fix="🔧 stripped ${STRIPPED}" || fix="✅ clean"

  printf '\n━━━ %s │ Vague: %s\n' "${level}" "${vague_note}"
  printf 'Input:    %s\n' "${prose:0:90}"
  printf 'JSON:     %s │ Post-proc: %s\n' "${valid}" "${fix}"
  printf 'Goal:     %s\n' "${goal:0:90}"
  printf 'Accept:   %s\n' "${acceptance}"
  printf 'Briefing: %s…\n' "${briefing_preview}"
}

echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║  8B Vagueness Test: L1-L9 with clear + deliberately vague input ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo "Model: ${MODEL}"

for level in L1 L2 L3 L4 L5 L6 L7 L8 L9; do
  run_test "${level}" "${DEMANDS[${level}]}" "${VAGUE[${level}]}"
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

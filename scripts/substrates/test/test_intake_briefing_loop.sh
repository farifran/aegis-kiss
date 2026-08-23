#!/usr/bin/env bash
# ==============================================================================
# AEGIS INTAKE & BRIEFING OPTIMIZATION BENCHMARK LOOP (Passos 1 e 2)
# ==============================================================================
# Testa e afere de ponta a ponta:
#   1. Pre-Intake Discovery & Forensics (Passo 1): Snapshot factual e topologia.
#   2. Intake & Supervisor de Briefing (Passo 2): Expansão em RAM, tsc typecheck,
#      e execução de testes comportamentais.
#
# Classifica as demandas por 4 níveis de complexidade:
#   - Nível 1: Micro / Funções In-Place (ex: conversões em src/index.ts)
#   - Nível 2: Estruturas de Dados O(1) & Classes com Estado (ex: TokenBucket, LRU)
#   - Nível 3: Multi-Entidades em Módulos Separados + Barrels (ex: SeatMap + Ledger)
#   - Nível 4: Parsers e Algoritmos com Casos de Borda (ex: Semver, CSV)
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
cd "${ROOT_DIR}"

export AEGIS_LOAD_LOCAL_ENV="${AEGIS_LOAD_LOCAL_ENV:-1}"
source .harness/config.sh 2>/dev/null || true
source scripts/lib/common.sh 2>/dev/null || true
source scripts/lib/demand.sh
source scripts/lib/briefing.sh

export AEGIS_BRIEFING_TIMEOUT_SEC="${AEGIS_BRIEFING_TIMEOUT_SEC:-35}"
export AEGIS_BRIEFING_MAX_ATTEMPTS="${AEGIS_BRIEFING_MAX_ATTEMPTS:-2}"

REPORT_FILE="${AEGIS_RUNTIME_DIR:-.harness/runtime}/intake_briefing_benchmark.jsonl"
mkdir -p "$(dirname "${REPORT_FILE}")"
: > "${REPORT_FILE}"

echo "========================================================================"
echo "🎯 AEGIS INTAKE & BRIEFING BENCHMARK LOOP (Passos 1 & 2)"
echo "   Modelo Supervisor: $(aegis_briefing_model 2>/dev/null || echo 'default')"
echo "   Timeout: ${AEGIS_BRIEFING_TIMEOUT_SEC}s | Max Tentativas: ${AEGIS_BRIEFING_MAX_ATTEMPTS}"
echo "========================================================================"

# Matriz de Demandas de Teste por Nível de Complexidade (Níveis 1 a 10)
declare -a BENCHMARK_CASES=(
  # Nível 1: Micro In-Place
  '{"lvl":1, "id":"unit_converter", "targets":"src/index.ts", "demand":"Adicionar uma funcao converterGigabitsEmKilobytes que recebe valor em gigabits (bigint ou number) e retorna o total em kilobytes (bigint)."}'
  
  # Nível 2: Classes com Estado O(1)
  '{"lvl":2, "id":"token_bucket", "targets":"src/tokenBucket.ts, src/index.ts", "demand":"Criar classe TokenBucket com capacidade maxima maxBytes: bigint e taxa rate: number. Metodo consume(bits: bigint): boolean, getters maxBytes e tokens, e funcao obterEstadoBitmask(bucket: TokenBucket): number reexportada no index.ts."}'
  
  # Nível 3: Limitador com Janela Temporal
  '{"lvl":3, "id":"sliding_window", "targets":"src/slidingWindowLimiter.ts, src/index.ts", "demand":"Criar classe SlidingWindowLimiter com limite maximo limit: number e janela windowMs: number. Metodo tryAcquire(): boolean e getter remaining: number."}'
  
  # Nível 4: Multi-Entidade + Barrel
  '{"lvl":4, "id":"seat_reservation", "targets":"src/seatMap.ts, src/reservationLedger.ts, src/index.ts", "demand":"Criar SeatMap com rows: number e seatsPerRow: number (metodos occupy, release, availableSeats) e ReservationLedger com registro de reservas por cliente. Reexportar ambos no barrel src/index.ts."}'
  
  # Nível 5: Algoritmos / Parsing Semver
  '{"lvl":5, "id":"semver_compare", "targets":"src/semverCompare.ts, src/index.ts", "demand":"Criar funcao semverCompare(v1: string, v2: string): number que compara versoes semanticas ordenando por major, minor, patch numericamente."}'

  # Nível 6: Máquina de Estados Finita
  '{"lvl":6, "id":"order_state_machine", "targets":"src/orderStateMachine.ts, src/index.ts", "demand":"Criar classe OrderStateMachine com os estados draft, confirmed, paid, shipped, delivered, cancelled. Metodo transitionTo(state: string): boolean que valida transicoes de ciclo de vida, getter currentState: string e getter isTerminal: boolean. Reexportar no index.ts."}'
  
  # Nível 7: Manipulação Bitwise com BigInt
  '{"lvl":7, "id":"bitset_bigint", "targets":"src/bitSet.ts, src/index.ts", "demand":"Criar classe BitSet com capacity: number recebido no construtor e dados em bigint. Metodos setBit(index: number): void, clearBit(index: number): void, testBit(index: number): boolean, getters size: number e countOnes: number, e metodo union(other: BitSet): BitSet. Reexportar no index.ts."}'
  
  # Nível 8: URL Path Router com Segmentos Dinâmicos
  '{"lvl":8, "id":"path_router", "targets":"src/pathRouter.ts, src/index.ts", "demand":"Criar classe PathRouter que registra rotas com parametros dinamicos como /users/:id. Metodo addRoute(pattern: string, name: string): void, metodo resolve(path: string): string | null que retorna o nome da rota, e getter totalRoutes: number. Reexportar no index.ts."}'
  
  # Nível 9: Estrutura de Dados LRU Cache O(1)
  '{"lvl":9, "id":"lru_cache", "targets":"src/lruCache.ts, src/index.ts", "demand":"Criar classe LruCache com capacity: number. Metodos get(key: string): number | undefined, set(key: string, value: number): void, getters size: number, hits: number, misses: number. Eviccao O(1) do menos recentemente usado. Reexportar no index.ts."}'
  
  # Nível 10: Parser CSV com Aspas Escapadas & Quebras de Linha
  '{"lvl":10, "id":"csv_parser", "targets":"src/csvParser.ts, src/index.ts", "demand":"Criar funcao parseCsv(text: string, delimiter: string): string[][] que transforma texto CSV em matriz de strings tratando aspas duplas escapadas e quebras de linha. Reexportar no index.ts."}'
)

total_cases=${#BENCHMARK_CASES[@]}
p1_success=0
p2_success=0
total_p1_ms=0
total_p2_ms=0

printf "\n%-3s %-6s %-18s %-10s %-10s %-16s\n" "Nº" "Nível" "Demanda ID" "Passo 1" "Passo 2" "Status"
printf "%-3s %-6s %-18s %-10s %-10s %-16s\n" "---" "------" "------------------" "----------" "----------" "----------------"

idx=0
for case_json in "${BENCHMARK_CASES[@]}"; do
  idx=$((idx + 1))
  lvl="$(jq -r '.lvl' <<< "${case_json}")"
  id="$(jq -r '.id' <<< "${case_json}")"
  targets="$(jq -r '.targets' <<< "${case_json}")"
  demand="$(jq -r '.demand' <<< "${case_json}")"

  # --------------------------------------------------------------------------
  # 1. Execução do Passo 1: Pre-Intake Discovery & Forensics
  # --------------------------------------------------------------------------
  p1_start="$(node -e 'console.log(Date.now())' 2>/dev/null || date +%s000)"
  evidence="$(aegis_intake_discover_context "${targets}" 2>/dev/null || printf '{}')"
  p1_end="$(node -e 'console.log(Date.now())' 2>/dev/null || date +%s000)"
  p1_ms=$((p1_end - p1_start))
  total_p1_ms=$((total_p1_ms + p1_ms))

  p1_ok=false
  if jq -e '.topology and .targets' <<< "${evidence}" >/dev/null 2>&1; then
    p1_ok=true
    p1_success=$((p1_success + 1))
    p1_badge="${p1_ms}ms"
  else
    p1_badge="FAIL"
  fi

  # --------------------------------------------------------------------------
  # 2. Execução do Passo 2: Intake & Supervisor de Briefing
  # --------------------------------------------------------------------------
  p2_start="$(node -e 'console.log(Date.now())' 2>/dev/null || date +%s000)"
  err_file="$(mktemp)"
  schema_raw="$(aegis_briefing_expand_json "${demand}" "${targets}" "${evidence}" 2>"${err_file}" || printf '')"
  p2_err="$(cat "${err_file}" 2>/dev/null || true)"
  rm -f "${err_file}"
  p2_end="$(node -e 'console.log(Date.now())' 2>/dev/null || date +%s000)"
  p2_ms=$((p2_end - p2_start))
  total_p2_ms=$((total_p2_ms + p2_ms))
  p2_sec="$(awk "BEGIN {printf \"%.1fs\", ${p2_ms}/1000}")"

  p2_ok=false
  status_badge="FAIL"
  if [[ -n "${schema_raw}" ]] && aegis_briefing_validate_json "${schema_raw}" >/dev/null 2>&1; then
    if aegis_briefing_typecheck_json "${schema_raw}" >/dev/null 2>&1; then
      rendered_md="$(aegis_briefing_render "${schema_raw}" 2>/dev/null || printf '')"
      if [[ -n "${rendered_md}" ]] && grep -q '## Goal' <<< "${rendered_md}" && grep -q '## Acceptance' <<< "${rendered_md}"; then
        p2_ok=true
        p2_success=$((p2_success + 1))
        status_badge="PASS (100%)"
      else
        status_badge="RENDER_FAIL"
      fi
    else
      status_badge="TSC_FAIL"
    fi
  elif [[ -n "${p2_err}" ]]; then
    status_badge="ERR:$(tail -n 1 <<< "${p2_err}" | head -c 20)"
  fi

  printf "[%02d] Lvl %-2d %-18s %-10s %-10s %-16s\n" \
    "${idx}" "${lvl}" "${id}" "${p1_badge}" "${p2_sec}" "${status_badge}"

  # Registra no log de métricas
  jq -cn \
    --arg id "${id}" \
    --argjson lvl "${lvl}" \
    --argjson p1_ok "${p1_ok}" \
    --argjson p1_ms "${p1_ms}" \
    --argjson p2_ok "${p2_ok}" \
    --argjson p2_ms "${p2_ms}" \
    --arg status "${status_badge}" \
    '{id: $id, level: $lvl, p1_pass: $p1_ok, p1_latency_ms: $p1_ms, p2_pass: $p2_ok, p2_latency_ms: $p2_ms, status: $status}' \
    >> "${REPORT_FILE}"
done

avg_p1_ms=$((total_p1_ms / total_cases))
avg_p2_s="$(awk "BEGIN {printf \"%.2fs\", ${total_p2_ms}/(${total_cases} * 1000)}")"

echo "------------------------------------------------------------------------"
echo "📊 RESUMO DO BENCHMARK:"
echo "   - Total de Demandas Avaliadas: ${total_cases}"
echo "   - Passo 1 (Discovery & Forensics): ${p1_success}/${total_cases} aprovados (Média: ${avg_p1_ms}ms)"
echo "   - Passo 2 (Supervisor Briefing & Typecheck): ${p2_success}/${total_cases} aprovados (Média: ${avg_p2_s})"
echo "   - Relatório JSONL gerado em: ${REPORT_FILE}"
echo "========================================================================"

if [[ "${p1_success}" -eq "${total_cases}" ]] && [[ "${p2_success}" -eq "${total_cases}" ]]; then
  echo "🎉 TODOS OS TESTES DOS PASSOS 1 E 2 PASSARAM COM 100% DE EFICIÊNCIA!"
  exit 0
else
  echo "⚠️ Algumas demandas apresentaram inconsistência. Verifique ${REPORT_FILE}."
  exit 1
fi

#!/usr/bin/env bash

# =========================================================
# AEGIS TEST — BRIEFING IMPROVEMENT LOOP (prose demands in, defects out)
# =========================================================
#
# test_briefing_prepass.sh proves the GATE (hand-written JSON in, accept or
# reject out). This loop proves the PROMPT: real prose demands go to the
# supervisor, and every answer is reviewed by demand-independent rules.
#
#   demand (prose) -> aegis_briefing_expand_json -> review -> finding codes
#                                                 \-> tsc  -> tsc:TSxxxx
#
# A finding is never "wrong formula for THIS demand" — that is the Briefing
# layer and no universal rule can judge it. A finding is a defect that would
# be a defect for ANY demand: an uninitialized private field (TS2564), a type
# nothing exports (TS2304), an assert reading `_private`, a barrel pointing at
# a file the schema never creates. That is what makes the taxonomy at the end
# actionable: each code maps to one line to fix in .skills/briefing.md, and
# the fix holds for the next ten demands too.
#
# One attempt per demand on purpose (AEGIS_BRIEFING_MAX_ATTEMPTS=1): retries
# measure provider luck, first shots measure the prompt.
#
# Network test — NOT part of npm run aegis:test. Skips cleanly without a key.
#
# Two lots live in probes/: briefing_demands.jsonl (algorithms, data
# structures, one frontend, one multi-entity) and briefing_demands_b.jsonl
# (frontend-heavy, async, error contracts, English, index-heavy). Point the
# loop at one with AEGIS_BRIEFING_LOOP_DEMANDS; a rule that only fixes one lot
# was never universal.
#
# Env:
#   AEGIS_BRIEFING_LOOP_DEMANDS   jsonl {id, demand, targets} (default probes/)
#   AEGIS_BRIEFING_LOOP_REPORT    jsonl output (default .harness/runtime/)
#   AEGIS_BRIEFING_LOOP_MIN_CLEAN percent of answers that must be clean (70)
#
# =========================================================

export AEGIS_LOAD_LOCAL_ENV="${AEGIS_LOAD_LOCAL_ENV:-1}"

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

# shellcheck disable=SC1091
source "${AEGIS_TEST_ROOT}/scripts/lib/briefing.sh"

DEMANDS_FILE="${AEGIS_BRIEFING_LOOP_DEMANDS:-${AEGIS_TEST_ROOT}/scripts/substrates/test/probes/briefing_demands.jsonl}"
REPORT_FILE="${AEGIS_BRIEFING_LOOP_REPORT:-${AEGIS_RUNTIME_DIR}/briefing_loop_report.jsonl}"

[[ -f "${DEMANDS_FILE}" ]] || fail "missing_demands_file: ${DEMANDS_FILE}"

# One attempt by default; override to measure what the production retry buys.
export AEGIS_BRIEFING_MAX_ATTEMPTS="${AEGIS_BRIEFING_MAX_ATTEMPTS:-1}"

# ---------------------------------------------------------
# Universal review — one finding code per line, empty = clean
# ---------------------------------------------------------
aegis_briefing_review() {
  printf '%s' "${1-}" | jq -r '
    def strs: map(select(type == "string"));
    def has($l): . as $x | ($l | index($x)) != null;
    def dups: group_by(.) | map(select(length > 1) | .[0]);
    def prelude_of: (.prelude // []) | if type == "string" then [.] else . end;
    def bodies:
      [.exports[]?
        | (.ctorBody//[])[]?,
          ((.methods//[])[]? | (.body//[])[]?),
          ((.getters//[])[]? | .body),
          (.body//[])[]?] | strs;
    def all_types:
      [.exports[]?
        | (.privateFields//[])[]?.type, (.ctorParams//[])[]?.type, (.params//[])[]?.type,
          ((.methods//[])[]? | (.params//[])[]?.type, .returns),
          ((.getters//[])[]? | .returns), .returns] | strs;
    def units:
      [.exports[]?
        | {n: .name,
           b: ([(.ctorBody//[])[]?, ((.methods//[])[]? | (.body//[])[]?), (.body//[])[]?] | strs)}];

    ([.exports[]?.name] | strs) as $names
    | (([.exports[]? | select(.kind == "class") | .name] + [.types[]?.name]) | strs) as $classes
    | (["bigint","number","string","boolean","void","unknown","never","null","undefined",
        "Map","Set","Array","ReadonlyArray","Record","Partial","Promise","Date","Error",
        "RegExp","Iterable","Iterator","ArrayBuffer","DataView","Uint8Array","Int32Array",
        "Float64Array","Buffer","this"]) as $builtin
    | [
      # --- barrel wiring: the barrel is a target, and it points at one ---
      ((.barrelFile//"") as $bf
        | if ($bf|length) == 0 then "barrel_file_missing"
          elif ([.targets[]?] | index($bf)) == null then "barrel_not_in_targets"
          else empty end),
      (((.barrelFrom//"") | sub("^\\./";"") | sub("\\.js$";"")) as $b
        | if ($b|length) > 0 and ([.targets[]?] | any(. == "src/" + $b + ".ts") | not)
            then "barrel_from_orphan:\($b)" else empty end),
      (.targets[]? | select(test("^(src/[A-Za-z0-9_/-]+\\.ts|index\\.html)$") | not)
        | "nonstandard_target:\(.)"),

      # --- identifiers that collide on barrel re-export (TS2308/TS2440) ---
      ($names[] | select(has(["State","Config","Props","Result","Data","Item","Options",
                              "Context","Event","Value","Node","Entry","Manager","Handler"]))
        | "generic_export_name:\(.)"),
      ($names | dups | .[]? | "duplicate_export:\(.)"),
      (.exports[]? | [(.methods//[])[]?.name] | dups | .[]? | "duplicate_method:\(.)"),

      # --- fields: declared but never assigned is TS2564 under strict ---
      (.exports[]? | select(.kind == "class")
        | ((.ctorBody//[]) | join("\n")) as $ctor
        | (.privateFields//[])[]?.name
        | . as $f | select($ctor | test("this\\." + $f + "\\b") | not)
        | "field_never_initialized:\($f)"),
      # `this._x` must resolve to a declared field OR a declared member: an
      # underscore method is legal, an undeclared private helper is TS2339
      (.exports[]? | select(.kind == "class")
        | [(.privateFields//[])[]?.name, (.methods//[])[]?.name, (.getters//[])[]?.name] as $decl
        | ([(.ctorBody//[])[]?, ((.methods//[])[]? | (.body//[])[]?), ((.getters//[])[]? | .body)]
           | strs | map(capture("this\\.(?<f>_[A-Za-z0-9_]+)"; "g").f) | unique)
        | .[]? | select(has($decl) | not) | "field_undeclared:\(.)"),

      # --- bodies the coder cannot compile from ---
      (units[]? | select((.b | length) == 0) | "empty_body:\(.n)"),
      (units[]? | select((.b | length) > 0 and (.b | all(test("^\\s*(//|/\\*)"))))
        | "body_only_comments:\(.n)"),
      (bodies[]? | select(test("TODO|FIXME|implement here|\\.\\.\\.$")) | "body_placeholder"),
      ((bodies + all_types)[]? | select(test("\\bany\\b|@ts-ignore|as unknown as"))
        | "ts_escape_hatch"),

      # --- Invariant 1: src/*.ts must import cleanly under Node ---
      (bodies[]?
        | select(test("\\b(window|document|localStorage|sessionStorage|navigator|alert|AudioContext|requestAnimationFrame)\\b"))
        | "browser_global_in_src"),

      # --- a type nothing declares and TS does not ship is TS2304. Only a
      #     class export is a type; a function export is not ---
      (all_types[]? | [scan("[A-Za-z_][A-Za-z0-9_]*")][]?
        | select(test("^[A-Z]")) | select(has($builtin) | not) | select(has($classes) | not)
        | "undefined_type:\(.)"),
      (.exports[]? | (.methods//[])[]? | select(((.returns//"") | length) == 0)
        | "method_without_returns:\(.name)"),

      # --- Acceptance is derived from exports; a goal naming internals leaks
      #     constructor params into the promotion contract (issue #65) ---
      ((.goal//"") as $g
        | [.exports[]? | (.privateFields//[])[]?.name, (.ctorParams//[])[]?.name] | strs | unique
        | .[]? | select(test("^_") or test("[a-z][A-Z]"))
        | . as $i | select($g | test("\\b" + $i + "\\b")) | "goal_leaks_internal:\($i)"),

      # --- behavior: the only executable part of the contract ---
      (if ((.behavior//[]) | length) == 0 then "behavior_missing"
       elif ((.behavior//[]) | length) < 2 or ((.behavior//[]) | length) > 4
         then "behavior_count:\((.behavior|length))" else empty end),
      (.behavior[]? | ([prelude_of[]?, .assert] | strs)
        | select(any(test("\\._[A-Za-z0-9_]+"))) | "behavior_reads_private"),
      (.behavior[]? | (.exports//[])[]? | select(has($names) | not)
        | "behavior_unknown_export:\(.)"),
      # the oracle runs each assert once, headless: a sleep or a wall clock
      # makes the promotion contract flaky. `await` is NOT in this list — the
      # oracle materializes each assert in an ESM module, and banning it made
      # the supervisor assert `p instanceof Promise` instead of the value.
      (.behavior[]? | ([prelude_of[]?, .assert] | strs)
        | select(any(test("setTimeout|Math\\.random|Date\\.now|performance\\.now")))
        | "behavior_timing_dependent"),
      (.behavior[]? | (.assert // "") | select(test("instanceof Promise"))
        | "behavior_asserts_promise_not_value"),
      (.behavior[]?
        | ((prelude_of | strs
            | map(capture("(?:const|let|var)\\s+(?<v>[A-Za-z_][A-Za-z0-9_]*)"; "g").v)) as $locals
           | select((.assert//"") | test("\\b(" + (($names + $locals) | join("|")) + ")\\b") | not))
        | "behavior_assert_unbound")
    ] | unique | .[]
  ' 2>/dev/null || printf 'review_crashed\n'
}

# ---------------------------------------------------------
# Ground truth — the same tsc gate the pipeline now runs, kept visible here
# ---------------------------------------------------------
#
# aegis_briefing_typecheck_json lives in scripts/lib/briefing.sh because the
# gate and this loop must judge a briefing identically. Fatal codes are now
# rejected upstream by aegis_briefing_expand_json, so what usually surfaces
# here is the advisory tsc-strictnull: line — plus anything the gate lets
# through when the loop runs with AEGIS_BRIEFING_TYPECHECK=0.
TSC_DIR="${TMPDIR:-/tmp}/aegis_briefing_tsc"

aegis_briefing_typecheck() {
  mkdir -p "${TSC_DIR}"
  aegis_briefing_typecheck_json "${1-}" "${TSC_DIR}/failed_${2-unit}" || true
  return 0
}

# ---------------------------------------------------------
# Loop
# ---------------------------------------------------------
aegis_briefing_enabled || {
  echo "[SKIP] briefing loop — no OPENAI_API_KEY / jq / curl"
  exit 0
}

mkdir -p "$(dirname "${REPORT_FILE}")"
: > "${REPORT_FILE}"

printf '[AEGIS][LOOP] model=%s demands=%s\n\n' \
  "$(aegis_briefing_model)" "${DEMANDS_FILE}"

total=0
clean=0
skipped=0
n=0

while IFS= read -r row; do
  [[ -n "${row}" ]] || continue
  n=$((n + 1))
  id="$(printf '%s' "${row}" | jq -r '.id')"
  demand="$(printf '%s' "${row}" | jq -r '.demand')"
  targets="$(printf '%s' "${row}" | jq -r '.targets // "src/<name>.ts, src/index.ts"')"

  err_file="$(mktemp)"
  json="$(aegis_briefing_expand_json "${demand}" "${targets}" "" 2>"${err_file}")" || json=""
  reason="$(grep -v '^\[AEGIS\]' "${err_file}" | tail -n 1 || true)"
  rm -f "${err_file}"

  if [[ -z "${json}" ]]; then
    case "${reason}" in
      # Provider noise, not prompt quality: a truncated or malformed decode is
      # what the production retry (AEGIS_BRIEFING_MAX_ATTEMPTS) exists for.
      http_*|empty_response|provider_error*|missing_api_key|invalid_briefing:invalid_json)
        skipped=$((skipped + 1))
        printf '[%02d] %-22s SKIP   %s\n' "${n}" "${id}" "${reason}"
        continue
        ;;
    esac
    findings="gate_rejected:${reason}"
  else
    findings="$(aegis_briefing_review "${json}")"
    aegis_briefing_render "${json}" 2>/dev/null | grep -q '^## Briefing$' \
      || findings="${findings}${findings:+$'\n'}render_incomplete"
    tsc_findings="$(aegis_briefing_typecheck "${json}" "${id}")"
    [[ -z "${tsc_findings}" ]] \
      || findings="${findings}${findings:+$'\n'}${tsc_findings}"
  fi

  total=$((total + 1))
  count="$(printf '%s' "${findings}" | grep -v '^tsc-strictnull:' | grep -c . || true)"
  if [[ "${count}" -eq 0 ]] && [[ -n "${findings}" ]]; then
    printf '[%02d] %-22s OK    (advisory: %s)\n' \
      "${n}" "${id}" "$(printf '%s' "${findings}" | paste -sd', ' -)"
    clean=$((clean + 1))
  elif [[ "${count}" -eq 0 ]]; then
    clean=$((clean + 1))
    printf '[%02d] %-22s OK\n' "${n}" "${id}"
  else
    printf '[%02d] %-22s %s finding(s): %s\n' \
      "${n}" "${id}" "${count}" "$(printf '%s' "${findings}" | paste -sd', ' -)"
  fi

  jq -cn --arg id "${id}" --arg findings "${findings}" --argjson json "${json:-null}" \
    '{id: $id, findings: ($findings | split("\n") | map(select(length > 0))), schema: $json}' \
    >> "${REPORT_FILE}"
done < "${DEMANDS_FILE}"

echo
echo "--- finding taxonomy (universal defects, most frequent first) ---"
jq -r '.findings[]' "${REPORT_FILE}" 2>/dev/null \
  | sed -E 's/^(tsc(-strictnull)?:TS[0-9]+).*/\1/' \
  | sed -E '/^tsc(-strictnull)?:TS[0-9]+$/! s/:.*$//' \
  | sort | uniq -c | sort -rn \
  || true

printf '\n[AEGIS][LOOP] answered=%s clean=%s skipped=%s report=%s\n' \
  "${total}" "${clean}" "${skipped}" "${REPORT_FILE}"
[[ -z "$(ls "${TSC_DIR}"/failed_*.ts 2>/dev/null)" ]] \
  || printf '[AEGIS][LOOP] typecheck failures materialized in %s\n' "${TSC_DIR}"

[[ "${total}" -gt 0 ]] || fail "no_demand_answered — provider unavailable"

# Not 100%: the supervisor's own variance is real and measured — across eight
# runs of two lots the same frozen prompt scored between 6/9 and 8/10, with
# degenerate answers (empty exports, placeholder bodies) appearing and
# vanishing between runs. The floor sits just under that observed range: it
# catches a real regression without firing on the weather. Every finding is
# printed either way.
min_clean="${AEGIS_BRIEFING_LOOP_MIN_CLEAN:-70}"
pct=$(( clean * 100 / total ))
printf '[AEGIS][LOOP] clean=%s%% threshold=%s%%\n' "${pct}" "${min_clean}"
[[ "${pct}" -ge "${min_clean}" ]] \
  || fail "briefing_loop_regression: ${clean}/${total} clean (${pct}% < ${min_clean}%) — fix .skills/briefing.md universally"

echo "[PASS] briefing loop"

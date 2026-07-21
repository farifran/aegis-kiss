#!/usr/bin/env bash
# Calibration for optimize/adversarial skills + mechanical surface scanners.
# Default: mechanical only (no API). Optional: --llm probes skill JSON status.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FIX_ROOT="$(cd "$(dirname "$0")/fixtures" && pwd)"
SKILL_OPT="${ROOT}/.skills/optimize.md"
SKILL_ADV="${ROOT}/.skills/adversarial.md"
RUN_LLM=0
FAIL=0
PASS=0

usage() {
  cat <<'EOF'
Usage: .skills/calibration/run.sh [--llm]

  mechanical  Surface/export scanners + skill keyword contract (default)
  --llm       Also call OPENAI_* with skill prompts (needs .harness/local.env)
EOF
}

for arg in "$@"; do
  case "${arg}" in
    --llm) RUN_LLM=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: ${arg}" >&2; usage; exit 2 ;;
  esac
done

# shellcheck source=/dev/null
source "${ROOT}/scripts/lib/demand.sh"

ok() { printf '  PASS  %s\n' "$1"; PASS=$((PASS + 1)); }
bad() { printf '  FAIL  %s\n' "$1"; FAIL=$((FAIL + 1)); }

# --- skill contract (audit-friendly keywords) ---
echo "== skill contract =="
for pair in \
  "${SKILL_OPT}|can_improve" \
  "${SKILL_OPT}|no_improvement_needed" \
  "${SKILL_OPT}|improvements" \
  "${SKILL_OPT}|observation" \
  "${SKILL_OPT}|Abstain" \
  "${SKILL_ADV}|findings" \
  "${SKILL_ADV}|diff" \
  "${SKILL_ADV}|files_changed" \
  "${SKILL_ADV}|observation" \
  "${SKILL_ADV}|scenarios_run" \
  "${SKILL_ADV}|Abstain"
do
  f="${pair%%|*}"
  k="${pair##*|}"
  if grep -Fq "${k}" "${f}"; then
    ok "skill $(basename "${f}") declares ${k}"
  else
    bad "skill $(basename "${f}") missing ${k}"
  fi
done

# --- mechanical fixtures ---
echo "== mechanical fixtures =="
for dir in "${FIX_ROOT}"/*/; do
  [[ -d "${dir}" ]] || continue
  id="$(basename "${dir}")"
  demand="$(cat "${dir}/demand.md")"
  body="$(cat "${dir}/body.ts")"
  expect="$(cat "${dir}/expect.json")"

  exp_surf="$(printf '%s' "${expect}" | jq -r '.mechanical.surface_improve')"
  exp_n="$(printf '%s' "${expect}" | jq -r '.mechanical.export_count')"
  exp_lim="$(printf '%s' "${expect}" | jq -r '.mechanical.demand_limits_one_export')"

  n="$(aegis_count_top_level_exports "${body}" | tr -d '[:space:]')"
  if [[ "${n}" == "${exp_n}" ]]; then
    ok "${id}: export_count=${n}"
  else
    bad "${id}: export_count got ${n} want ${exp_n}"
  fi

  if aegis_demand_limits_one_export "${demand}"; then
    lim=true
  else
    lim=false
  fi
  if [[ "${lim}" == "${exp_lim}" ]]; then
    ok "${id}: demand_limits_one_export=${lim}"
  else
    bad "${id}: demand_limits_one_export got ${lim} want ${exp_lim}"
  fi

  imp="$(
    aegis_mechanical_surface_first_improve \
      "${demand}" "${body}" '["src/fixture.ts"]' "" 2>/dev/null || true
  )"
  if [[ -n "${imp}" ]] \
    && printf '%s' "${imp}" | jq -e 'type=="object" and (.change|type=="string")' >/dev/null 2>&1; then
    got_surf=true
  else
    got_surf=false
  fi
  if [[ "${got_surf}" == "${exp_surf}" ]]; then
    ok "${id}: surface_improve=${got_surf}"
  else
    bad "${id}: surface_improve got ${got_surf} want ${exp_surf}"
    [[ -n "${imp}" ]] && printf '         imp=%s\n' "$(printf '%s' "${imp}" | jq -c '.')"
  fi

  # reverse heuristic note (not yet a hard gate — documents expected LLM residual)
  if printf '%s' "${expect}" | jq -e '.mechanical.has_reverse_div_heuristic == true' >/dev/null 2>&1; then
    if printf '%s' "${body}" | grep -Eq '/[[:space:]]*8000\b' \
      && printf '%s' "${demand}" | grep -Eiq 'multiply|→|to kilobits|megabytes →'; then
      ok "${id}: reverse_div pattern present (LLM residual target)"
    else
      bad "${id}: expected reverse_div pattern in body/demand"
    fi
  fi
done

# --- optional LLM probe ---
if [[ "${RUN_LLM}" -eq 1 ]]; then
  echo "== llm skill probe =="
  if [[ -f "${ROOT}/.harness/local.env" ]]; then
    set -a
    # shellcheck source=/dev/null
    source "${ROOT}/.harness/local.env"
    set +a
  fi
  if [[ -z "${OPENAI_API_BASE:-}" || -z "${OPENAI_API_KEY:-}" ]]; then
    bad "OPENAI_API_BASE/KEY missing — skip llm"
  else
    MODEL="${OPENAI_MODEL_MUTATION:-${OPENAI_MODEL:-grok-4.5}}"
    API="${OPENAI_API_BASE%/}/chat/completions"
    opt_skill="$(cat "${SKILL_OPT}")"
    adv_skill="$(cat "${SKILL_ADV}")"

    chat_json() {
      local system_or_user="$1"
      local content="$2"
      local max_tok="${3:-1024}"
      python3 - "$API" "$OPENAI_API_KEY" "$MODEL" "$content" "$max_tok" <<'PY'
import json, os, sys, urllib.request
api, key, model, content, max_tok = sys.argv[1:6]
body = json.dumps({
  "model": model,
  "messages": [{"role": "user", "content": content}],
  "temperature": 0,
  "max_tokens": int(max_tok),
}).encode()
req = urllib.request.Request(
  api, data=body,
  headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
)
with urllib.request.urlopen(req, timeout=120) as r:
  resp = json.loads(r.read().decode())
print(resp["choices"][0]["message"].get("content") or "")
PY
    }

    extract_status() {
      local text="$1"
      local kind="$2"
      printf '%s' "${text}" | python3 -c '
import re,sys
t=sys.stdin.read()
# strip fences
t=re.sub(r"```(?:json)?","",t)
if sys.argv[1]=="opt":
  m=re.search(r"\"status\"\s*:\s*\"(no_improvement_needed|can_improve)\"", t)
else:
  m=re.search(r"\"status\"\s*:\s*\"(challenged|verified)\"", t)
print(m.group(1) if m else "unknown")
' "${kind}"
    }

    for dir in "${FIX_ROOT}"/*/; do
      id="$(basename "${dir}")"
      demand="$(cat "${dir}/demand.md")"
      body="$(cat "${dir}/body.ts")"
      exp_opt="$(jq -r '.skill_expect.optimize_status' "${dir}/expect.json")"
      exp_adv="$(jq -r '.skill_expect.adversarial_status' "${dir}/expect.json")"
      # Path must match demand Targets (else models invent path-scope challenges).
      target_path="$(
        printf '%s' "${demand}" \
          | grep -Eo 'src/[A-Za-z0-9_./-]+\.ts' \
          | head -1
      )"
      [[ -n "${target_path}" ]] || target_path="src/${id}.ts"
      # Build a minimal +diff so quote tribunal patterns have a surface.
      synth_diff="$(
        printf 'diff --git a/%s b/%s\n--- a/%s\n+++ b/%s\n@@ -0,0 +1,%s @@\n' \
          "${target_path}" "${target_path}" "${target_path}" "${target_path}" \
          "$(printf '%s\n' "${body}" | wc -l | tr -d ' ')"
        printf '%s\n' "${body}" | sed 's/^/+/'
      )"

      opt_prompt="${opt_skill}

# Investigation
${demand}

# REPAIR RESULT
files_changed: [\"${target_path}\"]
diff:
${synth_diff}

# POST-REPAIR BODY (${target_path})
${body}

Emit JSON only."
      adv_prompt="${adv_skill}

# Investigation
${demand}

# CANDIDATE RESULT
files_changed: [\"${target_path}\"]
diff:
${synth_diff}

# CANDIDATE BODY (${target_path})
${body}

TOOLS mutation_clean=true. Emit JSON only."

      opt_out="$(chat_json user "${opt_prompt}" 1024 || true)"
      adv_out="$(chat_json user "${adv_prompt}" 1024 || true)"
      got_opt="$(extract_status "${opt_out}" opt)"
      got_adv="$(extract_status "${adv_out}" adv)"

      if [[ "${got_opt}" == "${exp_opt}" ]]; then
        ok "${id}: llm optimize=${got_opt}"
      else
        bad "${id}: llm optimize got ${got_opt} want ${exp_opt}"
        printf '%s\n' "${opt_out}" | head -c 500; echo
      fi
      if [[ "${got_adv}" == "${exp_adv}" ]]; then
        ok "${id}: llm adversarial=${got_adv}"
      else
        bad "${id}: llm adversarial got ${got_adv} want ${exp_adv}"
        printf '%s\n' "${adv_out}" | head -c 500; echo
      fi
    done
  fi
fi

echo
echo "PASS=${PASS} FAIL=${FAIL}"
if [[ "${FAIL}" -gt 0 ]]; then
  exit 1
fi
exit 0

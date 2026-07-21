#!/usr/bin/env bash
# Run demand #14 only with 8B under each repair skill variant; score fidelity.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "${ROOT}"
EXP="${ROOT}/.skills/experiments"
VAR="${EXP}/variants"
OUT_ROOT="/tmp/aegis-skill-matrix"
DEMAND="/tmp/aegis-timed/demand14.md"

bash "${EXP}/build_variants.sh"

# Ensure demand file
if [[ ! -s "${DEMAND}" ]]; then
  unset GITHUB_TOKEN
  gh issue view 14 --json title,body | jq -r '"# Issue #14: \(.title)\n\n\(.body)"' > "${DEMAND}"
fi

# Force 8B
python3 - <<'PY'
from pathlib import Path
mid, aider = "meta/llama-3.1-8b-instruct", "openai/meta/llama-3.1-8b-instruct"
p = Path(".harness/local.env")
lines = []
for line in p.read_text().splitlines():
    s = line.strip()
    body = s[7:] if s.startswith("export ") else s
    exp = s.startswith("export ")
    def rep(prefix, val):
        return f'export {prefix}"{val}"' if exp else f'{prefix}"{val}"'
    if body.startswith("OPENAI_MODEL_ANALYSIS="):
        lines.append(rep("OPENAI_MODEL_ANALYSIS=", mid))
    elif body.startswith("OPENAI_MODEL_READONLY_COGNITION="):
        lines.append(rep("OPENAI_MODEL_READONLY_COGNITION=", mid))
    elif body.startswith("OPENAI_MODEL_MUTATION="):
        lines.append(rep("OPENAI_MODEL_MUTATION=", mid))
    elif body.startswith("AEGIS_MUTATION_MODEL="):
        lines.append(rep("AEGIS_MUTATION_MODEL=", mid))
    elif body.startswith("AEGIS_AIDER_MODEL="):
        lines.append(rep("AEGIS_AIDER_MODEL=", aider))
    elif body.startswith("AEGIS_MODEL_DEFAULT="):
        lines.append(rep("AEGIS_MODEL_DEFAULT=", mid))
    elif body.startswith("OPENAI_MODEL_OPTIMIZE="):
        lines.append(rep("OPENAI_MODEL_OPTIMIZE=", mid))
    else:
        lines.append(line)
p.write_text("\n".join(lines) + "\n")
print("model=8b")
PY

# Variants order: singles then combos then all
VARIANTS=(
  base
  hats
  abstract
  parallel
  premortem
  teachback
  hats_abstract
  hats_parallel
  abstract_parallel
  all
)

# Optional filter: ./run_matrix.sh base hats all
if [[ $# -gt 0 ]]; then
  VARIANTS=("$@")
fi

RESULTS="${OUT_ROOT}/results.tsv"
mkdir -p "${OUT_ROOT}"
printf 'variant\trc\twall_s\tscore\tpct\tpath\n' > "${RESULTS}"

export AEGIS_LOAD_LOCAL_ENV=1
export AEGIS_PROMOTION_RESET_DIRTY=true
unset GITHUB_TOKEN

for v in "${VARIANTS[@]}"; do
  echo ""
  echo "##############################"
  echo "# VARIANT=${v}"
  echo "##############################"
  cp "${VAR}/repair_${v}.md" "${ROOT}/.skills/repair.md"
  # optimize stays base fidelity (no matrix) for isolation
  cp "${EXP}/optimize_base.md" "${ROOT}/.skills/optimize.md"

  # clean playground (no commit spam — dirty promote ok)
  printf '%s\n' 'export function MustExistSymbolXYZ(): number {' '  return 1;' '}' > src/index.ts
  rm -f src/tokenBucket.ts

  run_dir="${OUT_ROOT}/${v}"
  mkdir -p "${run_dir}"
  start=$(date +%s)
  set +e
  ./run_aegis.sh --fresh --pipeline mutation "$(cat "${DEMAND}")" \
    > "${run_dir}/run.log" 2>&1
  rc=$?
  set -e
  wall=$(( $(date +%s) - start ))

  if [[ -f src/tokenBucket.ts ]]; then
    cp -f src/tokenBucket.ts "${run_dir}/tokenBucket.ts"
  fi
  jq -c '{status,reason_code}' .harness/runtime/last_outcome.json \
    > "${run_dir}/outcome.json" 2>/dev/null || echo '{}' > "${run_dir}/outcome.json"

  score_out="$(python3 "${EXP}/score_fidelity.py" "${run_dir}/tokenBucket.ts" 2>/dev/null || true)"
  echo "${score_out}" | tee "${run_dir}/score.txt"
  sc="$(echo "${score_out}" | sed -n 's/.*SCORE=\([0-9]*\)\/.*/\1/p' | tail -1)"
  pct="$(echo "${score_out}" | sed -n 's/.*(\([0-9.]*\)%).*/\1/p' | tail -1)"
  sc="${sc:-0}"
  pct="${pct:-0}"

  printf '%s\t%s\t%s\t%s\t%s\t%s\n' \
    "${v}" "${rc}" "${wall}" "${sc}" "${pct}" "${run_dir}/tokenBucket.ts" \
    | tee -a "${RESULTS}"

  echo "VARIANT=${v} rc=${rc} wall=${wall}s score=${sc} pct=${pct}"
done

# restore production skills (base fidelity = current design)
cp "${EXP}/repair_base.md" "${ROOT}/.skills/repair.md"
cp "${EXP}/optimize_base.md" "${ROOT}/.skills/optimize.md"

# restore glm as default operator model
python3 - <<'PY'
from pathlib import Path
mid, aider = "z-ai/glm-5.2", "openai/z-ai/glm-5.2"
p = Path(".harness/local.env")
lines = []
for line in p.read_text().splitlines():
    s = line.strip()
    body = s[7:] if s.startswith("export ") else s
    exp = s.startswith("export ")
    def rep(prefix, val):
        return f'export {prefix}"{val}"' if exp else f'{prefix}"{val}"'
    if body.startswith("OPENAI_MODEL_ANALYSIS="):
        lines.append(rep("OPENAI_MODEL_ANALYSIS=", mid))
    elif body.startswith("OPENAI_MODEL_READONLY_COGNITION="):
        lines.append(rep("OPENAI_MODEL_READONLY_COGNITION=", mid))
    elif body.startswith("OPENAI_MODEL_MUTATION="):
        lines.append(rep("OPENAI_MODEL_MUTATION=", mid))
    elif body.startswith("AEGIS_MUTATION_MODEL="):
        lines.append(rep("AEGIS_MUTATION_MODEL=", mid))
    elif body.startswith("AEGIS_AIDER_MODEL="):
        lines.append(rep("AEGIS_AIDER_MODEL=", aider))
    elif body.startswith("AEGIS_MODEL_DEFAULT="):
        lines.append(rep("AEGIS_MODEL_DEFAULT=", mid))
    elif body.startswith("OPENAI_MODEL_OPTIMIZE="):
        lines.append(rep("OPENAI_MODEL_OPTIMIZE=", mid))
    else:
        lines.append(line)
p.write_text("\n".join(lines) + "\n")
print("restored_model=glm-5.2")
PY

echo ""
echo "===== MATRIX RESULTS ====="
column -t -s $'\t' "${RESULTS}" 2>/dev/null || cat "${RESULTS}"
echo "written: ${RESULTS}"

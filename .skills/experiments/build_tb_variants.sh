#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
EXP="${ROOT}/.skills/experiments"
BASE="${EXP}/repair_base.md"
OUT="${EXP}/variants"
mkdir -p "${OUT}"

compose() {
  local name="$1"; shift
  {
    cat "${BASE}"
    echo ""
    echo "---"
    echo "# Teach-back experiment: ${name}"
    for s in "$@"; do cat "${EXP}/${s}"; done
  } > "${OUT}/repair_${name}.md"
  echo "wrote repair_${name}.md ($(wc -l < "${OUT}/repair_${name}.md") lines)"
}

compose base
compose tb_minimal snippet_tb_minimal.md
compose tb_change_steps snippet_tb_change_steps.md
compose tb_witness_table snippet_tb_witness_table.md
compose tb_two_pass snippet_tb_two_pass.md
compose tb_minimal_format snippet_tb_minimal.md snippet_tb_format.md
compose tb_change_format snippet_tb_change_steps.md snippet_tb_format.md
compose tb_witness_format snippet_tb_witness_table.md snippet_tb_format.md
compose tb_two_pass_format snippet_tb_two_pass.md snippet_tb_format.md
compose tb_all snippet_tb_minimal.md snippet_tb_change_steps.md snippet_tb_witness_table.md snippet_tb_two_pass.md snippet_tb_format.md

#!/usr/bin/env bash
# Compose repair.md variants from base + technique snippets.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
EXP="${ROOT}/.skills/experiments"
BASE="${EXP}/repair_base.md"
OUT="${EXP}/variants"
mkdir -p "${OUT}"

compose() {
  local name="$1"
  shift
  {
    cat "${BASE}"
    echo ""
    echo "---"
    echo "# Experimental overlays (matrix: ${name})"
    for s in "$@"; do
      cat "${EXP}/${s}"
    done
  } > "${OUT}/repair_${name}.md"
  wc -l "${OUT}/repair_${name}.md" | awk -v n="$name" '{print n, $1, "lines"}'
}

compose base
compose hats snippet_hats.md
compose abstract snippet_abstract.md
compose parallel snippet_parallel.md
compose premortem snippet_premortem.md
compose teachback snippet_teachback.md
compose hats_abstract snippet_hats.md snippet_abstract.md
compose hats_parallel snippet_hats.md snippet_parallel.md
compose abstract_parallel snippet_abstract.md snippet_parallel.md
compose all snippet_hats.md snippet_abstract.md snippet_parallel.md snippet_premortem.md snippet_teachback.md

echo "variants ready under ${OUT}"

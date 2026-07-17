#!/usr/bin/env bash

# =========================================================
# AEGIS CAPABILITY — runtime.layer0_facts
# =========================================================
#
# Classification:
# readonly
#
# Layer: Deterministic Layer 0 (system recognition priors)
#
# Responsibilities:
#
# - declared entrypoint detection: package.json (main/module/bin/
#   scripts runtimes) and tsconfig.json (files/include) via native jq,
#   cross-referenced against the pocket map census; declared-but-
#   absent paths surface as gap anomalies instead of entrypoints
# - import gravity scoring: single-pass git grep over relative
#   imports / require() / shell source, awk in-degree frequency map,
#   top 20 central files
# - git mutation sniffing: churn from the last 25 commits fused with
#   lexical resonance (path/basename + content grep) against demand
#   tokens (+score bonus), top 10 hot files
#
# This capability intentionally:
#
# - performs no LLM calls or semantic inference
# - content inspection is limited to deterministic `git grep -l`
#   for demand-token resonance (not full file dumps)
# - claims recognition facts for the runtime so downstream
#   capabilities and substrates consume priors, not guesses
#
# =========================================================

set -Eeuo pipefail

readonly TARGET_PATH="${1:-.}"

# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/../filesystem/_shared_utils.sh"
# Demand tokens shared with search_symbol (source-only; no network).
# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/../../lib/demand.sh"
aegis_capability_init "runtime.layer0_facts"

# ---------------------------------------------------------
# Path census (pocket map when delivered, git ls-files fallback)
# ---------------------------------------------------------

# CENSUS_FILE is a global set by the census builder; the three routines
# read it. Exposed as named functions so the recognition calibration
# harness (scripts/substrates/test/test_recognition_benchmarks.sh) can
# exercise each routine against mock topologies in isolation.
#
# Initialized empty so every consumer stays safe under set -u even when
# a routine is exercised before build_layer0_census (source-only mode).
CENSUS_FILE=""

build_layer0_census() {
  CENSUS_FILE="$(aegis_mktemp)"
  if [[ -n "${AEGIS_POCKET_MAP_FILE:-}" ]] && [[ -s "${AEGIS_POCKET_MAP_FILE}" ]]; then
    cat "${AEGIS_POCKET_MAP_FILE}" > "${CENSUS_FILE}"
  else
    git ls-files 2>/dev/null > "${CENSUS_FILE}" || true
  fi

  # Scope census to the capability target when it is a subpath of the
  # repository (e.g. default AEGIS_EVIDENCE_TARGET_PATH=src). Without this,
  # package.json harness scripts dominate declared entrypoints and attention
  # drifts onto runtime_aegis.sh instead of the system under investigation.
  local scope="${TARGET_PATH:-.}"
  scope="${scope#./}"
  scope="${scope%/}"
  if [[ -n "${scope}" && "${scope}" != "." ]]; then
    local scoped
    scoped="$(aegis_mktemp)"
    grep -E "^(${scope}|${scope}/)" "${CENSUS_FILE}" > "${scoped}" 2>/dev/null || true
    if [[ -s "${scoped}" ]]; then
      mv "${scoped}" "${CENSUS_FILE}"
    else
      rm -f "${scoped}"
    fi
  fi
}

census_has_path() {
  [[ -n "${CENSUS_FILE:-}" ]] || return 1
  grep -Fxq "$1" "${CENSUS_FILE:-/dev/null}"
}

# Collapse ./ and ../ segments in a path (repo-root relative form).
normalize_path() {
  local p="$1"
  local IFS='/'
  local -a parts=() out=()
  local part
  read -ra parts <<< "${p}"
  for part in "${parts[@]}"; do
    case "${part}" in
      ''|.) ;;
      ..) [[ "${#out[@]}" -gt 0 ]] && unset 'out[${#out[@]}-1]' ;;
      *) out+=("${part}") ;;
    esac
  done
  printf '%s' "${out[*]}"
}

# ---------------------------------------------------------
# 1. Declared entrypoints (jq over EVERY manifest in the census)
#
# Monorepos declare mains/bins in nested package.json files whose
# paths are relative to the manifest's own directory. Resolution is
# therefore dir-aware and applied to every package.json / tsconfig.json
# in the census, not only the repository root.
# ---------------------------------------------------------

list_manifest_declarations() {

  local manifest dir

  while IFS= read -r manifest; do
    [[ -f "${manifest}" ]] || continue
    dir="$(dirname "${manifest}")"
    [[ "${dir}" == "." ]] && dir=""
    jq -r '
      [ (.main? // empty),
        (.module? // empty),
        (.bin? | if type == "string" then .
                 elif type == "object" then .[]
                 else empty end),
        (.scripts? // {} | to_entries[] .value
          | scan("(?:node|bash|sh|tsx|ts-node)\\s+([^\\s&|;]+)")[0]?)
      ]
      | .[]
      | select(type == "string" and length > 0)
    ' "${manifest}" 2>/dev/null \
      | while IFS= read -r raw; do printf '%s\t%s\n' "${dir:-.}" "${raw}"; done
  done < <(grep -E '(^|/)package\.json$' "${CENSUS_FILE:-/dev/null}" 2>/dev/null || true)

  while IFS= read -r manifest; do
    [[ -f "${manifest}" ]] || continue
    dir="$(dirname "${manifest}")"
    [[ "${dir}" == "." ]] && dir=""
    jq -r '
      ((.files? // [])[], (.include? // [])[])
      | select(type == "string" and length > 0)
    ' "${manifest}" 2>/dev/null \
      | while IFS= read -r raw; do printf '%s\t%s\n' "${dir:-.}" "${raw}"; done
  done < <(grep -E '(^|/)tsconfig\.json$' "${CENSUS_FILE:-/dev/null}" 2>/dev/null || true)
}

# layer0_entrypoints — emits {entrypoints, gaps} JSON over CENSUS_FILE.
layer0_entrypoints() {

  local entrypoints_tmp gaps_tmp
  entrypoints_tmp="$(aegis_mktemp)"
  gaps_tmp="$(aegis_mktemp)"

  local decl_dir raw candidate match variant

  while IFS=$'\t' read -r decl_dir raw; do
    [[ -n "${raw}" ]] || continue
    [[ "${decl_dir}" == "." ]] && decl_dir=""
    # Glob-shaped tsconfig include patterns are census filters, not paths.
    case "${raw}" in
      *'*'*) continue ;;
    esac

    candidate="${raw#./}"
    [[ -n "${decl_dir}" ]] && candidate="${decl_dir}/${candidate}"
    candidate="$(normalize_path "${candidate}")"

    match=""
    for variant in \
      "${candidate}" \
      "${candidate}.js" "${candidate}.ts" \
      "${candidate}.mjs" "${candidate}.cjs" \
      "${candidate}.jsx" "${candidate}.tsx"; do
      if census_has_path "${variant}"; then
        match="${variant}"
        break
      fi
    done

    if [[ -n "${match}" ]]; then
      printf '%s\n' "${match}" >> "${entrypoints_tmp}"
    else
      printf '%s\n' "${decl_dir:+${decl_dir}/}${raw}" >> "${gaps_tmp}"
    fi
  done < <(list_manifest_declarations)

  # Floor prior when manifests declare nothing useful under the census
  # (playgrounds: package.json scripts only, no main/module). Prefer
  # index.* then shallow source files so attention_seed is never empty.
  local entrypoint_source="declared_manifest"
  if [[ ! -s "${entrypoints_tmp}" ]] && [[ -n "${CENSUS_FILE:-}" ]]; then
    entrypoint_source="census_floor"
    command grep -E '(^|/)index\.(ts|tsx|js|jsx|mjs|cjs)$' \
      "${CENSUS_FILE}" 2>/dev/null \
      | sort -u > "${entrypoints_tmp}" || true
    if [[ ! -s "${entrypoints_tmp}" ]]; then
      command grep -E '\.(ts|tsx|js|jsx|mjs|cjs)$' \
        "${CENSUS_FILE}" 2>/dev/null \
        | awk -F/ 'NF <= 3' \
        | sort -u \
        | head -5 > "${entrypoints_tmp}" || true
    fi
  fi

  jq -n \
    --arg source "${entrypoint_source}" \
    --argjson entrypoints "$(
      sort -u "${entrypoints_tmp}" \
        | jq -Rn --arg source "${entrypoint_source}" \
          '[inputs | select(length > 0) | {file: ., source: $source}]'
    )" \
    --argjson gaps "$(
      sort -u "${gaps_tmp}" \
        | jq -Rn '[inputs | select(length > 0) | {declared: ., anomaly: "declared_path_missing_from_census"}]'
    )" \
    '{entrypoints: $entrypoints, gaps: $gaps}'
}

# ---------------------------------------------------------
# 2. Import gravity (git grep in-degree map, path-normalized)
#
# Imports of the same target from different directory depths
# (../core, ../../core) must aggregate onto one canonical node, so
# each match is resolved relative to its OWN source file and collapsed
# to repo-root form. Only targets that resolve into the census count —
# build artifacts and vendored code cannot inflate centrality.
# ---------------------------------------------------------

# layer0_import_gravity — emits the top-20 gravity array over CENSUS_FILE.
layer0_import_gravity() {

  local gravity_tmp
  gravity_tmp="$(aegis_mktemp)"

  git grep -InoE \
  "(from ['\"]\.{1,2}/[^'\"]+|require\(['\"]\.{1,2}/[^'\"]+|source ['\"][^'\"]+\.sh)" \
  -- '*.ts' '*.tsx' '*.js' '*.sh' 2>/dev/null \
  | awk -F: -v censusfile="${CENSUS_FILE:-/dev/null}" '
      BEGIN {
        while ((getline line < censusfile) > 0) if (length(line)) census[line] = 1
      }
      function norm(path,   a, n, i, m, o, r) {
        n = split(path, a, "/")
        m = 0
        for (i = 1; i <= n; i++) {
          if (a[i] == "" || a[i] == ".") continue
          if (a[i] == "..") { if (m > 0) m--; continue }
          o[++m] = a[i]
        }
        r = ""
        for (i = 1; i <= m; i++) r = (r == "" ? o[i] : r "/" o[i])
        return r
      }
      {
        src = $1
        line = $0
        sub(/^[^:]*:/, "", line)      # drop "file:" prefix
        t = line
        sub(/^[^.\/]+/, "", t)         # drop keyword + opening quote
        sub(/[^A-Za-z0-9._\/-].*$/, "", t)  # drop closing quote + tail

        base = src
        if (!sub(/\/[^\/]*$/, "", base)) base = ""

        # ./ and ../ imports resolve against the source file dir;
        # root-relative source targets (e.g. .harness/config.sh) are
        # already repo-root paths and only need canonicalization.
        if (t ~ /^\.\.?\//)
          resolved = norm((base == "" ? t : base "/" t))
        else
          resolved = norm(t)
        stem = resolved
        sub(/\.(ts|js|tsx|jsx)$/, "", stem)

        if (resolved in census \
            || (stem ".js")  in census || (stem ".ts")  in census \
            || (stem ".jsx") in census || (stem ".tsx") in census \
            || (stem ".mjs") in census || (stem ".cjs") in census \
            || (stem ".sh")  in census) {
          count[stem]++
        }
      }
      END { for (f in count) if (length(f)) printf "%d\t%s\n", count[f], f }
    ' \
  | sort -rn -k1,1 -k2,2 \
  | head -20 > "${gravity_tmp}" || true

  awk -F'\t' '{ printf "{\"file\":\"%s\",\"gravity\":%d}\n", $2, $1 }' "${gravity_tmp}" \
    | jq -s '.'
}

# ---------------------------------------------------------
# 3. Git mutation sniffing (churn ⊕ lexical resonance)
#
# Only census files count, so committed build artifacts cannot pose as
# hot files. Resonance matches prompt tokens against the file basename
# with a directional guard: a token resonates when it is a substring of
# the basename (aider ⊂ aider_substrate) — never the reverse — so short
# generic tokens cannot false-positive across the tree.
# ---------------------------------------------------------

# layer0_hot_files — emits the top-10 hot-files array over CENSUS_FILE,
# fusing churn with lexical resonance against AEGIS_INVESTIGATION_INPUT.
#
# Resonance rules (KISS, deterministic):
#   1. path tokens via aegis_demand_tokens (stopwords stripped)
#   2. path/basename substring (+ prefix ≥5) → +20, resonance=1
#      (path beats content so require('./util') cannot outrank util.js)
#   3. content hit via `git grep -l -i -F` for DENSE tokens only
#      (generic stems like "bytes"/"index" skipped) → +10, resonance=1
#   4. content-only files (no recent churn) still surface with score=10
#      (cap AEGIS_LAYER0_CONTENT_HIT_MAX, default 20)
layer0_hot_files() {

  local tokens_tmp dense_tmp content_hits_tmp scored_tmp hot_tmp
  local content_hit_max="${AEGIS_LAYER0_CONTENT_HIT_MAX:-20}"
  tokens_tmp="$(aegis_mktemp)"
  dense_tmp="$(aegis_mktemp)"
  content_hits_tmp="$(aegis_mktemp)"
  scored_tmp="$(aegis_mktemp)"
  hot_tmp="$(aegis_mktemp)"

  aegis_demand_tokens "${AEGIS_INVESTIGATION_INPUT:-}" > "${tokens_tmp}" || true
  aegis_demand_dense_tokens "${AEGIS_INVESTIGATION_INPUT:-}" > "${dense_tmp}" || true

  # Content resonance: dense tokens only (avoids monorepo noise).
  : > "${content_hits_tmp}"
  if [[ -s "${dense_tmp}" ]] && [[ -f "${CENSUS_FILE:-}" ]]; then
    local token
    while IFS= read -r token; do
      [[ -n "${token}" ]] || continue
      # -I skip binary; -F fixed string; bounded by census intersection.
      git grep -l -i -F -I -- "${token}" -- . 2>/dev/null \
        | grep -Fxf "${CENSUS_FILE}" \
        || true
    done < "${dense_tmp}" \
      | sort -u \
      | head -n "${content_hit_max}" \
      > "${content_hits_tmp}" || true
  fi

  # Churn × path resonance × content resonance.
  git log --name-only --pretty=format: -n 25 -- . 2>/dev/null \
    | awk 'NF' \
    | grep -Fxf "${CENSUS_FILE:-/dev/null}" \
    | sort | uniq -c | sort -rn \
    | while read -r churn file; do
        local score resonance path_norm base token prefix
        score="${churn}"
        resonance=0
        path_norm="$(
          if command -v iconv >/dev/null 2>&1; then
            printf '%s' "${file}" \
              | iconv -f UTF-8 -t ASCII//TRANSLIT 2>/dev/null \
              || printf '%s' "${file}"
          else
            printf '%s' "${file}"
          fi \
            | tr '[:upper:]' '[:lower:]'
        )"
        base="$(basename "${path_norm%.*}")"
        if [[ -s "${tokens_tmp}" ]]; then
          while IFS= read -r token; do
            [[ -n "${token}" ]] || continue
            if [[ "${path_norm}" == *"${token}"* || "${base}" == *"${token}"* ]]; then
              score=$((score + 20))
              resonance=1
              break
            fi
            if [[ "${#token}" -ge 5 ]]; then
              prefix="${token:0:5}"
              if [[ "${path_norm}" == *"${prefix}"* || "${base}" == *"${prefix}"* ]]; then
                score=$((score + 20))
                resonance=1
                break
              fi
            fi
          done < "${tokens_tmp}"
        fi
        if [[ -s "${content_hits_tmp}" ]] \
          && grep -Fxq -- "${file}" "${content_hits_tmp}"; then
          score=$((score + 10))
          resonance=1
        fi
        printf '%d\t%d\t%d\t%s\n' "${score}" "${churn}" "${resonance}" "${file}"
      done > "${scored_tmp}" || true

  # Content-only files with no recent churn still matter for free-text demand.
  if [[ -s "${content_hits_tmp}" ]]; then
    local hit
    while IFS= read -r hit; do
      [[ -n "${hit}" ]] || continue
      if ! awk -F'\t' -v f="${hit}" '$4 == f { found=1 } END { exit !found }' \
        "${scored_tmp}" 2>/dev/null; then
        printf '10\t0\t1\t%s\n' "${hit}" >> "${scored_tmp}"
      fi
    done < "${content_hits_tmp}"
  fi

  sort -rn -k1,1 "${scored_tmp}" 2>/dev/null \
    | head -10 > "${hot_tmp}" || true

  awk -F'\t' '{ printf "{\"file\":\"%s\",\"score\":%d,\"churn\":%d,\"resonance\":%d}\n", $4, $1, $2, $3 }' "${hot_tmp}" \
    | jq -s '.'
}

# ---------------------------------------------------------
# MAIN ASSEMBLY (standard capability envelope)
# ---------------------------------------------------------

layer0_facts_main() {

  require_directory_target "${TARGET_PATH}"

  build_layer0_census

  local entrypoints_facts
  entrypoints_facts="$(layer0_entrypoints)"

  local tmp_payload_file
  tmp_payload_file="$(aegis_mktemp)"

  jq -n \
    --arg target "${TARGET_PATH}" \
    --argjson entrypoint_facts "${entrypoints_facts}" \
    --argjson import_gravity "$(layer0_import_gravity)" \
    --argjson hot_files "$(layer0_hot_files)" \
    '{
      target: $target,
      entrypoints: $entrypoint_facts.entrypoints,
      gaps: $entrypoint_facts.gaps,
      import_gravity: $import_gravity,
      hot_files: $hot_files
    }' > "${tmp_payload_file}"

  emit_success_payload_file "${tmp_payload_file}"
}

# Source-only mode (AEGIS_LAYER0_SOURCE_ONLY=1) defines the routines for
# the calibration harness without executing recognition.
if [[ "${AEGIS_LAYER0_SOURCE_ONLY:-0}" != "1" ]]; then
  layer0_facts_main "$@"
fi

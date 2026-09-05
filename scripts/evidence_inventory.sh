#!/usr/bin/env bash

# AEGIS — MECHANICAL EVIDENCE INVENTORY
#
# This is deliberately not a supervisor. It inventories only paths supplied by
# the caller, never chooses product scope, never calls a model and never builds
# a prompt. Its output is transient evidence for an IDE investigation, receipt
# or forensic run.

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="${ROOT_DIR}/.harness/runtime"
OUTPUT_FILE="${RUNTIME_DIR}/mechanical_inventory.json"
SCHEMA="aegis.mechanical_inventory.v1"

fatal() { printf '[AEGIS][EVIDENCE][FATAL] %s\n' "$1" >&2; exit 1; }

is_positive_integer() { [[ "${1:-}" =~ ^[1-9][0-9]*$ ]]; }

safe_path() {
  local path="${1:-}"
  [[ -n "${path}" && "${path}" != /* && "${path}" != "." && "${path}" != *$'\n'* ]]
  [[ "${path}" != ".." && "${path}" != ../* && "${path}" != */../* && "${path}" != */.. ]]
  case "/${path}/" in
    */.git/*|*/.harness/runtime/*) return 1 ;;
  esac
}

file_size() {
  if stat -f '%z' "$1" >/dev/null 2>&1; then
    stat -f '%z' "$1"
  else
    stat -c '%s' "$1"
  fi
}

add_unique() {
  local value="$1" existing
  for existing in "${declared_paths[@]:-}"; do
    [[ "${existing}" == "${value}" ]] && return
  done
  declared_paths+=("${value}")
}

add_candidate() {
  local value="$1" existing
  for existing in "${candidate_paths[@]:-}"; do
    [[ "${existing}" == "${value}" ]] && return
  done
  candidate_paths+=("${value}")
}

scope_digest() {
  local relative
  {
    printf '%s\0' "${SCHEMA}" "$(git -C "${ROOT_DIR}" rev-parse HEAD)"
    printf '%s\0' "${declared_paths[@]}"
    git -C "${ROOT_DIR}" diff --no-ext-diff --binary HEAD -- "${declared_paths[@]}"
    for relative in "${candidate_paths[@]}"; do
      if ! git -C "${ROOT_DIR}" ls-files --error-unmatch -- "${relative}" >/dev/null 2>&1; then
        printf '%s\0' "${relative}"
        shasum -a 256 "${ROOT_DIR}/${relative}"
      fi
    done
  } | shasum -a 256 | awk '{print $1}'
}

usage() {
  cat <<'EOF'
Uso:
  ./aegis evidence --path <caminho> [--path <caminho> ...]
                   [--max-files <n>] [--max-total-bytes <n>]
                   [--max-file-bytes <n>]

Cria um inventário mecânico transitório, limitado e determinístico em
.harness/runtime/mechanical_inventory.json. Os caminhos devem ser explícitos,
relativos ao repositório e nunca são usados para formar prompts automaticamente.
EOF
}

declared_paths=()
candidate_paths=()
max_files=24
max_total_bytes=65536
max_file_bytes=4096

while [[ $# -gt 0 ]]; do
  case "$1" in
    --path)
      path="${2:-}"
      [[ -n "${path}" ]] || fatal 'missing_evidence_path'
      safe_path "${path}" || fatal 'unsafe_evidence_path'
      [[ -e "${ROOT_DIR}/${path}" && ! -L "${ROOT_DIR}/${path}" ]] || fatal "missing_or_symlink_evidence_path:${path}"
      add_unique "${path%/}"
      shift 2
      ;;
    --max-files)
      max_files="${2:-}"
      is_positive_integer "${max_files}" || fatal 'invalid_max_files'
      shift 2
      ;;
    --max-total-bytes)
      max_total_bytes="${2:-}"
      is_positive_integer "${max_total_bytes}" || fatal 'invalid_max_total_bytes'
      shift 2
      ;;
    --max-file-bytes)
      max_file_bytes="${2:-}"
      is_positive_integer "${max_file_bytes}" || fatal 'invalid_max_file_bytes'
      shift 2
      ;;
    -h|--help|help)
      usage
      exit 0
      ;;
    *) fatal "unknown_evidence_flag:$1" ;;
  esac
done

[[ "${#declared_paths[@]}" -gt 0 ]] || fatal 'evidence_requires_explicit_path'

for path in "${declared_paths[@]}"; do
  absolute_path="${ROOT_DIR}/${path}"
  if [[ -f "${absolute_path}" ]]; then
    add_candidate "${path}"
  elif [[ -d "${absolute_path}" ]]; then
    while IFS= read -r absolute_file; do
      relative_file="${absolute_file#"${ROOT_DIR}/"}"
      add_candidate "${relative_file}"
    done < <(find "${absolute_path}" -type f -print | LC_ALL=C sort)
  else
    fatal "unsupported_evidence_path:${path}"
  fi
done

request_digest="$({
  printf '%s\0' "${SCHEMA}" "${max_files}" "${max_total_bytes}" "${max_file_bytes}"
  printf '%s\0' "${declared_paths[@]}"
} | shasum -a 256 | awk '{print $1}')"
worktree_scope_digest="$(scope_digest)"
candidate_count="${#candidate_paths[@]}"
mkdir -p "${RUNTIME_DIR}"

selected_count="${candidate_count}"
if [[ "${selected_count}" -gt "${max_files}" ]]; then
  selected_count="${max_files}"
fi
omitted_count=$((candidate_count - selected_count))
complete=true
if [[ "${omitted_count}" -gt 0 ]]; then
  complete=false
fi

records_file="$(mktemp "${TMPDIR:-/tmp}/aegis-inventory-records.XXXXXX.jsonl")"
output_file="$(mktemp "${TMPDIR:-/tmp}/aegis-inventory-output.XXXXXX.json")"
cleanup() { rm -f "${records_file}" "${output_file}"; }
trap cleanup EXIT

remaining_bytes="${max_total_bytes}"
preview_bytes=0
for ((index = 0; index < selected_count; index += 1)); do
  relative_file="${candidate_paths[index]}"
  absolute_file="${ROOT_DIR}/${relative_file}"
  bytes="$(file_size "${absolute_file}")"
  allowed_bytes="${max_file_bytes}"
  if [[ "${allowed_bytes}" -gt "${remaining_bytes}" ]]; then
    allowed_bytes="${remaining_bytes}"
  fi
  if [[ "${allowed_bytes}" -gt "${bytes}" ]]; then
    allowed_bytes="${bytes}"
  fi
  preview_base64=""
  if [[ "${allowed_bytes}" -gt 0 ]]; then
    preview_base64="$(dd if="${absolute_file}" bs=1 count="${allowed_bytes}" 2>/dev/null | base64 | tr -d '\n')"
  fi
  truncated=false
  [[ "${bytes}" -gt "${allowed_bytes}" ]] && truncated=true
  jq -n \
    --arg path "${relative_file}" \
    --arg preview_base64 "${preview_base64}" \
    --argjson bytes "${bytes}" \
    --argjson preview_bytes "${allowed_bytes}" \
    --argjson truncated "${truncated}" \
    '{path:$path,bytes:$bytes,previewEncoding:"base64",previewBase64:$preview_base64,previewBytes:$preview_bytes,truncated:$truncated}' \
    >> "${records_file}"
  remaining_bytes=$((remaining_bytes - allowed_bytes))
  preview_bytes=$((preview_bytes + allowed_bytes))
done

jq -s \
  --arg schema "${SCHEMA}" \
  --arg request_digest "${request_digest}" \
  --arg worktree_scope_digest "${worktree_scope_digest}" \
  --argjson paths "$(printf '%s\n' "${declared_paths[@]}" | jq -R . | jq -s .)" \
  --argjson max_files "${max_files}" \
  --argjson max_total_bytes "${max_total_bytes}" \
  --argjson max_file_bytes "${max_file_bytes}" \
  --argjson candidate_count "${candidate_count}" \
  --argjson selected_count "${selected_count}" \
  --argjson omitted_count "${omitted_count}" \
  --argjson complete "${complete}" \
  --argjson preview_bytes "${preview_bytes}" \
  '{schema:$schema,requestDigest:$request_digest,worktreeScopeDigest:$worktree_scope_digest,request:{paths:$paths,maxFiles:$max_files,maxTotalBytes:$max_total_bytes,maxFileBytes:$max_file_bytes},coverage:{candidateFiles:$candidate_count,selectedFiles:$selected_count,omittedFiles:$omitted_count,complete:$complete,previewBytes:$preview_bytes},files:.}' \
  "${records_file}" > "${output_file}"
mv "${output_file}" "${OUTPUT_FILE}"

printf '[AEGIS][EVIDENCE] inventory=READY materialization=FRESH files=%s/%s bytes=%s file=.harness/runtime/mechanical_inventory.json\n' \
  "${selected_count}" "${candidate_count}" "${preview_bytes}"

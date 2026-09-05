#!/usr/bin/env bash

# AEGIS — IDE EVIDENCE GATEWAY
# The IDE is the only code executor. This gateway never calls a model, opens
# TTY questions, or edits product code: it records, verifies and authorizes.

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="${ROOT_DIR}/.harness/runtime"

fatal() { printf '[AEGIS][IDE][FATAL] %s\n' "$1" >&2; exit 1; }

usage() {
  cat <<'EOF'
Uso no IDE:
  ./aegis "<demanda>" [--target <caminho>]
  ./aegis harness "<demanda>" [--target <caminho>]
  ./aegis finalize "<mesma-demanda>" --decision <arquivo> [--resolution <arquivo>]
                    [--independent-review <arquivo>]
  ./aegis review "<demanda>" --decision <arquivo> --producer-id <id> --reviewer-id <id>
  ./aegis status
  ./aegis evidence --path <caminho> [--path <caminho> ...]
                    [--max-files <n>] [--max-total-bytes <n>] [--max-file-bytes <n>]
  ./aegis authorize
  ./aegis report
  ./aegis clean [--src|--all]

O IDE descobre, pergunta e altera o código. Uma única compilação produz um
delta semântico; o Aegis monta demanda esclarecida, contrato, registry e
digests antes de autorizar a promoção.

`evidence` é um inventário mecânico opcional para receipt, reexecução ou
forensics. Ele nunca escolhe escopo nem injeta arquivos em prompts.

Demandas normais são PRODUCT e só podem persistir em src/. O subcomando
`harness` habilita explicitamente manutenção do próprio Aegis.
EOF
}

safe_path() {
  local path="${1:-}"
  [[ -n "${path}" && "${path}" != /* && ! "${path}" =~ (^|/)\.\.(/|$) ]]
}

metadata_state() {
  local contract="${ROOT_DIR}/src/.aegis/contract-ir.json"
  local clarified="${ROOT_DIR}/src/.aegis/clarified-demand.json"
  local registry="${ROOT_DIR}/src/.aegis/proof-registry.json"
  if [[ -e "${contract}" && -e "${clarified}" && -e "${registry}" ]]; then
    printf 'GOVERNED\n'
  elif [[ -e "${contract}" && -e "${clarified}" && ! -e "${registry}" ]]; then
    printf 'CONTRACT_READY\n'
  elif [[ ! -e "${contract}" && ! -e "${clarified}" && ! -e "${registry}" ]]; then
    printf 'BASELINE\n'
  else
    fatal 'incomplete_contract_evidence_metadata'
  fi
}

build_preflight() {
  local change_kind="${1:-PRODUCT}" demand="${2:-}" target=""
  shift 2 || true
  [[ -n "${demand}" ]] || fatal 'missing_demand'
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --target)
        target="${2:-}"
        [[ -n "${target}" ]] || fatal 'missing_target'
        safe_path "${target}" || fatal 'unsafe_target'
        shift 2
        ;;
      *) fatal "unknown_intake_flag:$1" ;;
    esac
  done

  mkdir -p "${RUNTIME_DIR}"
  local -a preflight_args=(--kind "${change_kind}" --save-envelope)
  [[ -n "${target}" ]] && preflight_args+=(--target "${target}")
  [[ "${AEGIS_PREFLIGHT_OUTPUT:-public}" == "internal" ]] && preflight_args+=(--internal-envelope)
  printf '%s' "${demand}" | node "${ROOT_DIR}/scripts/preflight.mjs" "${preflight_args[@]}"
}

require_frozen_envelope() {
  local demand="${1:-}" envelope="${RUNTIME_DIR}/preflight_envelope.json" expected actual
  [[ -s "${envelope}" ]] || fatal 'missing_frozen_preflight_envelope'
  expected="$(jq -r '.normalizedDemand.digest // empty' "${envelope}")"
  actual="$(printf '%s' "${demand}" | node "${ROOT_DIR}/scripts/preflight.mjs" --digest-only)"
  [[ -n "${expected}" && "${actual}" == "${expected}" ]] || fatal 'finalize_demand_mismatch'
  printf '%s\n' "${envelope}"
}

finalize_preflight() {
  local demand="${1:-}" decision="" resolution="" independent_review="" envelope=""
  shift || true
  [[ -n "${demand}" ]] || fatal 'missing_demand'
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --decision)
        decision="${2:-}"
        [[ -n "${decision}" ]] || fatal 'missing_decision'
        safe_path "${decision}" || fatal 'unsafe_decision'
        shift 2
        ;;
      --resolution)
        resolution="${2:-}"
        [[ -n "${resolution}" ]] || fatal 'missing_resolution'
        safe_path "${resolution}" || fatal 'unsafe_resolution'
        shift 2
        ;;
      --independent-review)
        independent_review="${2:-}"
        [[ -n "${independent_review}" ]] || fatal 'missing_independent_review'
        safe_path "${independent_review}" || fatal 'unsafe_independent_review'
        shift 2
        ;;
      *) fatal "unknown_finalize_flag:$1" ;;
    esac
  done
  [[ -n "${decision}" ]] || fatal 'missing_decision'
  local -a finalize_args=(--decision "${decision}")
  [[ -n "${resolution}" ]] && finalize_args+=(--resolution "${resolution}")
  [[ -n "${independent_review}" ]] && finalize_args+=(--independent-review "${independent_review}")
  envelope="$(require_frozen_envelope "${demand}")"
  node "${ROOT_DIR}/scripts/finalize_preflight.mjs" "${finalize_args[@]}" < "${envelope}"
}

build_independent_review() {
  local demand="${1:-}" decision="" producer_id="" reviewer_id="" envelope=""
  shift || true
  [[ -n "${demand}" ]] || fatal 'missing_demand'
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --decision)
        decision="${2:-}"
        [[ -n "${decision}" ]] && safe_path "${decision}" || fatal 'invalid_review_decision'
        shift 2
        ;;
      --producer-id) producer_id="${2:-}"; [[ -n "${producer_id}" ]] || fatal 'missing_producer_id'; shift 2 ;;
      --reviewer-id) reviewer_id="${2:-}"; [[ -n "${reviewer_id}" ]] || fatal 'missing_reviewer_id'; shift 2 ;;
      *) fatal "unknown_review_flag:$1" ;;
    esac
  done
  [[ -n "${decision}" && -n "${producer_id}" && -n "${reviewer_id}" ]] || fatal 'missing_review_arguments'
  local -a args=(--decision "${decision}" --producer-id "${producer_id}" --reviewer-id "${reviewer_id}")
  envelope="$(require_frozen_envelope "${demand}")"
  node "${ROOT_DIR}/scripts/build_preflight_review.mjs" "${args[@]}" < "${envelope}"
}

authorize() {
  local staged_files artifact
  staged_files="$(git -C "${ROOT_DIR}" diff --cached --name-only | sort -u)"
  [[ -n "${staged_files}" ]] || fatal 'authorization_requires_staged_changes'
  if grep -q '^\.harness/runtime/' <<< "${staged_files}"; then
    fatal 'staged_transient_runtime_artifact'
  fi
  while IFS= read -r path; do
    [[ -n "${path}" ]] || continue
    if [[ -f "${ROOT_DIR}/${path}" ]]; then
      git -C "${ROOT_DIR}" add -- "${path}"
    elif [[ ! -e "${ROOT_DIR}/${path}" ]]; then
      git -C "${ROOT_DIR}" rm --quiet --cached --ignore-unmatch -- "${path}"
    fi
  done <<< "${staged_files}"
  staged_files="$(git -C "${ROOT_DIR}" diff --cached --name-only | sort -u)"
  [[ -n "${staged_files}" ]] || fatal 'authorization_requires_staged_changes'
  artifact="$(mktemp "${TMPDIR:-/tmp}/aegis-ide-validation.XXXXXX")"
  jq -n --rawfile files <(printf '%s\n' "${staged_files}") \
    '{mode:"validation",verdict:"accepted",validated_candidate:{files_changed:($files | split("\n") | map(select(length > 0)))}}' \
    > "${artifact}"
  bash "${ROOT_DIR}/scripts/formal_promotion_authorization.sh" create "${ROOT_DIR}" "${artifact}"
  bash "${ROOT_DIR}/scripts/formal_promotion_authorization.sh" verify "${ROOT_DIR}"
  rm -f "${artifact}"
  printf '[AEGIS][IDE] promotion=AUTHORIZED receipt=.git/aegis/precommit_receipt.json\n'
}

clean() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --src|--all) shift ;;
      *) fatal "unknown_clean_flag:$1" ;;
    esac
  done
  mkdir -p "${RUNTIME_DIR}"
  find "${RUNTIME_DIR}" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
  [[ -d "${ROOT_DIR}/src" && ! -L "${ROOT_DIR}/src" ]] || fatal 'invalid_source_directory'
  find "${ROOT_DIR}/src" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
  rm -f "${ROOT_DIR}/.harness/active_contract_ir.json" "${ROOT_DIR}/.harness/proof_registry.json" \
    "${ROOT_DIR}/.harness/active_clarified_demand.json"
  printf '// Ponto de entrada canônico para a próxima demanda.\nexport {};\n' > "${ROOT_DIR}/src/index.ts"
  printf '[AEGIS][IDE] clean=PASS source_reset=1\n'
}

status() {
  local state
  state="$(metadata_state)"
  jq -n \
    --arg state "${state}" \
    --arg base "$(git -C "${ROOT_DIR}" rev-parse HEAD)" \
    --arg changes "$(git -C "${ROOT_DIR}" status --short)" \
    '{schema:"aegis.ide_status.v1",evidenceState:$state,baseCommit:$base,workingTree:$changes}'
}

command_name="${1:-}"
case "${command_name}" in
  -h|--help|help|'') usage ;;
  status) shift; [[ $# -eq 0 ]] || fatal 'status_does_not_accept_arguments'; status ;;
  evidence) shift; exec bash "${ROOT_DIR}/scripts/evidence_inventory.sh" "$@" ;;
  harness) shift; build_preflight HARNESS "$@" ;;
  finalize) shift; finalize_preflight "$@" ;;
  review) shift; build_independent_review "$@" ;;
  authorize) shift; [[ $# -eq 0 ]] || fatal 'authorize_does_not_accept_arguments'; authorize ;;
  report) shift; [[ $# -eq 0 ]] || fatal 'report_does_not_accept_arguments'; node "${ROOT_DIR}/scripts/forensic_report.mjs" ;;
  clean) shift; clean "$@" ;;
  -*) fatal "unknown_command:${command_name}" ;;
  *) build_preflight PRODUCT "$@" ;;
esac

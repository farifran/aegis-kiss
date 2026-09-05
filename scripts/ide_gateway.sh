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
  ./aegis status
  ./aegis evidence --path <caminho> [--path <caminho> ...]
                    [--max-files <n>] [--max-total-bytes <n>] [--max-file-bytes <n>]
  ./aegis verify [--profile auto|fast|targeted|release|forensic]
  ./aegis proofs [--profile auto|fast|targeted|release|forensic]
  ./aegis authorize
  ./aegis clean [--src|--all]

O IDE descobre, pergunta e altera o código. Aegis registra a demanda,
valida contrato/provas e cria a autorização de promoção.

`evidence` é um inventário mecânico opcional para receipt, reexecução ou
forensics. Ele nunca escolhe escopo nem injeta arquivos em prompts.
EOF
}

safe_path() {
  local path="${1:-}"
  [[ -n "${path}" && "${path}" != /* && ! "${path}" =~ (^|/)\.\.(/|$) ]]
}

metadata_state() {
  local contract="${ROOT_DIR}/.harness/active_contract_ir.json"
  local registry="${ROOT_DIR}/.harness/proof_registry.json"
  if [[ -e "${contract}" && -e "${registry}" ]]; then
    printf 'GOVERNED\n'
  elif [[ ! -e "${contract}" && ! -e "${registry}" ]]; then
    printf 'BASELINE\n'
  else
    fatal 'incomplete_contract_evidence_metadata'
  fi
}

record_intake() {
  local demand="${1:-}" target=""
  shift || true
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
  rm -f "${RUNTIME_DIR}/mechanical_inventory.json"
  local demand_digest base_commit state
  demand_digest="$(printf '%s' "${demand}" | shasum -a 256 | awk '{print $1}')"
  base_commit="$(git -C "${ROOT_DIR}" rev-parse HEAD)"
  state="$(metadata_state)"
  jq -n \
    --arg demand "${demand}" \
    --arg demand_digest "${demand_digest}" \
    --arg target "${target}" \
    --arg base_commit "${base_commit}" \
    --arg evidence_state "${state}" \
    '{schema:"aegis.ide_intake.v1",status:"PENDING_IDE_CONTRACT",demand:$demand,demandDigest:$demand_digest,requestedTarget:$target,baseCommit:$base_commit,evidenceState:$evidence_state}' \
    > "${RUNTIME_DIR}/ide_intake.json"
  printf '[AEGIS][IDE] intake=PENDING_IDE_CONTRACT file=.harness/runtime/ide_intake.json\n'
}

run_proofs() {
  local profile="auto"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --profile) profile="${2:-}"; shift 2 ;;
      *) fatal "unknown_proofs_flag:$1" ;;
    esac
  done
  case "${profile}" in auto|fast|targeted|release|forensic) ;; *) fatal 'invalid_proof_profile' ;; esac
  case "$(metadata_state)" in
    BASELINE) printf '[AEGIS][PROOF] NOT_APPLICABLE (no project contract or proof registry)\n' ;;
    GOVERNED) bash "${ROOT_DIR}/scripts/proof_runner.sh" --profile "${profile}" ;;
  esac
}

run_verify() {
  local profile="auto"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --profile) profile="${2:-}"; shift 2 ;;
      *) fatal "unknown_verify_flag:$1" ;;
    esac
  done
  case "${profile}" in auto|fast|targeted|release|forensic) ;; *) fatal 'invalid_proof_profile' ;; esac
  bash "${ROOT_DIR}/scripts/contract_evidence_gate.sh"
  if jq -e '.scripts["aegis:verify-structure"] | type == "string"' "${ROOT_DIR}/package.json" >/dev/null; then
    (cd "${ROOT_DIR}" && npm run aegis:verify-structure)
  fi
  run_proofs --profile "${profile}"
  printf '[AEGIS][IDE] verification=PROVEN authority=deterministic_tribunal\n'
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
  bash "${ROOT_DIR}/scripts/contract_evidence_gate.sh" --staged
  run_verify --profile auto
  artifact="$(mktemp "${TMPDIR:-/tmp}/aegis-ide-validation.XXXXXX.json")"
  jq -n --rawfile files <(printf '%s\n' "${staged_files}") \
    '{mode:"validation",verdict:"accepted",validated_candidate:{files_changed:($files | split("\n") | map(select(length > 0)))}}' \
    > "${artifact}"
  bash "${ROOT_DIR}/scripts/formal_promotion_authorization.sh" create "${ROOT_DIR}" "${artifact}"
  bash "${ROOT_DIR}/scripts/formal_promotion_authorization.sh" verify "${ROOT_DIR}"
  rm -f "${artifact}"
  printf '[AEGIS][IDE] promotion=AUTHORIZED receipt=.git/aegis/precommit_receipt.json\n'
}

clean() {
  local clear_source=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --src|--all) clear_source=1; shift ;;
      *) fatal "unknown_clean_flag:$1" ;;
    esac
  done
  mkdir -p "${RUNTIME_DIR}"
  find "${RUNTIME_DIR}" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
  if [[ "${clear_source}" -eq 1 ]]; then
    [[ -d "${ROOT_DIR}/src" && ! -L "${ROOT_DIR}/src" ]] || fatal 'invalid_source_directory'
    find "${ROOT_DIR}/src" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
    rm -f "${ROOT_DIR}/.harness/active_contract_ir.json" "${ROOT_DIR}/.harness/proof_registry.json"
    printf '// Ponto de entrada canônico para a próxima demanda.\nexport {};\n' > "${ROOT_DIR}/src/index.ts"
  fi
  printf '[AEGIS][IDE] clean=PASS source_reset=%s\n' "${clear_source}"
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
  verify) shift; run_verify "$@" ;;
  proofs) shift; run_proofs "$@" ;;
  authorize) shift; [[ $# -eq 0 ]] || fatal 'authorize_does_not_accept_arguments'; authorize ;;
  clean) shift; clean "$@" ;;
  -*) fatal "unknown_command:${command_name}" ;;
  *) record_intake "$@" ;;
esac

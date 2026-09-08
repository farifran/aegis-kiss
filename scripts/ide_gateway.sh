#!/usr/bin/env bash

# AEGIS — IDE EVIDENCE GATEWAY
# The IDE is the only code executor. The semantic supervisor is selectable:
# the active IDE model receives the request by default, or one configured
# external model compiles the decision without access to repository content.

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="${ROOT_DIR}/.harness/runtime"
if [[ -f "${ROOT_DIR}/.harness/local.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  . "${ROOT_DIR}/.harness/local.env"
  set +a
fi

fatal() { printf '[AEGIS][IDE][FATAL] %s\n' "$1" >&2; exit 1; }

usage() {
  cat <<'EOF'
Uso no IDE:
  ./aegis "<demanda>" [--target <caminho>]
  ./aegis harness "<demanda>" [--target <caminho>]
  ./aegis setup
  ./aegis setup [show|ide|external --endpoint <url> --model <id> [--api-key-env <VAR>] [--timeout-ms <n>]]
  ./aegis finalize "<mesma-demanda>" --decision <arquivo> [--resolution <arquivo>]
                    [--independent-review <arquivo>]
  ./aegis review "<demanda>" --decision <arquivo> [--resolution <arquivo>] --producer-id <id> --reviewer-id <id>
  ./aegis candidate-review
  ./aegis status
  ./aegis evidence --path <caminho> [--path <caminho> ...]
                    [--max-files <n>] [--max-total-bytes <n>] [--max-file-bytes <n>]
  ./aegis authorize [--harness]
  ./aegis report
  ./aegis clean [--src|--all]

O Aegis produz um discovery factual inicial. Em `setup ide`, o modelo ativo
do IDE interpreta a demanda. Em `setup external`, um modelo OpenAI-compatível
configurado interpreta somente o pedido semântico; o IDE continua perguntando
e alterando o código. Uma única compilação produz um delta semântico; o Aegis
monta demanda esclarecida, contrato, registry e digests antes da promoção.

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

supervisor_setup() {
  if [[ $# -eq 0 ]]; then
    # The IDE, not a terminal prompt, owns interaction.  This intentionally
    # mirrors the old agentic setup behavior: emit a bounded, declarative
    # selection request so the IDE can render its own chooser and collect any
    # external endpoint/model fields before rerunning one mechanical command.
    jq -n '
      {
        schema: "aegis.ide_setup_request.v1",
        status: "PENDING_USER_SELECTION",
        executor: "IDE",
        title: "Configurar o supervisor semântico do Aegis",
        instruction: "Apresente a pergunta e as opções ao usuário no IDE. Após a escolha, execute somente o comando indicado em apply.command; não interprete a demanda nem altere código.",
        questions: [
          {
            id: "supervisor-mode",
            question: "Quem deve compilar a demanda em decisão semântica antes da implementação?",
            recommendedAnswerId: "IDE",
            answers: [
              {
                id: "IDE",
                label: "Modelo ativo do IDE",
                rationale: "Mantém uma única interação no IDE e não requer endpoint nem credenciais externas.",
                apply: { command: "./aegis setup ide" }
              },
              {
                id: "EXTERNAL",
                label: "Modelo externo especializado",
                rationale: "Usa um endpoint OpenAI-compatível apenas para compilar a decisão semântica; o IDE continua responsável por perguntas, edição, testes e implementação.",
                requiredFields: [
                  { name: "endpoint", prompt: "Endpoint base OpenAI-compatível", example: "http://127.0.0.1:11434/v1" },
                  { name: "model", prompt: "Identificador do modelo", example: "llama3.2:11b" },
                  { name: "apiKeyEnv", prompt: "Nome da variável de API key, se necessário", optional: true },
                  { name: "timeoutMs", prompt: "Timeout em milissegundos", default: 45000, optional: true }
                ],
                apply: { command: "./aegis setup external --endpoint <endpoint> --model <model> [--api-key-env <apiKeyEnv>] [--timeout-ms <timeoutMs>]" }
              }
            ]
          }
        ]
      }
    '
    return 0
  fi
  exec node "${ROOT_DIR}/scripts/lib/supervisor_config.mjs" "$@"
}

supervisor_setup_state() {
  local state
  state="$(node "${ROOT_DIR}/scripts/lib/supervisor_config.mjs" show)" \
    || fatal 'supervisor_configuration_unavailable'
  jq -e '.schema == "aegis.supervisor_setup.v1" and .status == "CONFIGURED" and (.supervisor.mode | IN("IDE", "EXTERNAL"))' \
    <<< "${state}" >/dev/null || fatal 'invalid_supervisor_configuration'
  printf '%s\n' "${state}"
}

metadata_state() {
  local semantic_state="${ROOT_DIR}/src/.aegis/semantic-state.json"
  local legacy
  for legacy in contract-ir.json clarified-demand.json proof-registry.json; do
    [[ ! -e "${ROOT_DIR}/src/.aegis/${legacy}" ]] || fatal 'legacy_semantic_metadata_detected'
  done
  if [[ -e "${semantic_state}" ]]; then
    jq -e '.schema == "aegis.semantic_state.v1" and (.clarifiedDemand | type == "object") and (.contract | type == "object") and (.proofRegistry | type == "object")' "${semantic_state}" >/dev/null 2>&1 \
      || fatal 'invalid_semantic_state'
    printf 'GOVERNED\n'
  elif [[ ! -e "${semantic_state}" ]]; then
    printf 'BASELINE\n'
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
  local supervisor_state supervisor_mode supervisor_id supervisor_digest request
  supervisor_state="$(supervisor_setup_state)"
  supervisor_mode="$(jq -r '.supervisor.mode' <<< "${supervisor_state}")"
  supervisor_id="$(jq -r '.supervisor.id' <<< "${supervisor_state}")"
  supervisor_digest="$(jq -r '.supervisor.configDigest' <<< "${supervisor_state}")"
  local -a preflight_args=(--kind "${change_kind}" --save-envelope)
  [[ -n "${target}" ]] && preflight_args+=(--target "${target}")
  preflight_args+=(--supervisor-mode "${supervisor_mode}" --supervisor-id "${supervisor_id}" --supervisor-config-digest "${supervisor_digest}")
  [[ "${AEGIS_PREFLIGHT_OUTPUT:-public}" == "internal" ]] && preflight_args+=(--internal-envelope)
  request="$(printf '%s' "${demand}" | node "${ROOT_DIR}/scripts/preflight.mjs" "${preflight_args[@]}")"
  if [[ "${supervisor_mode}" == 'EXTERNAL' ]]; then
    printf '%s' "${request}" | node "${ROOT_DIR}/scripts/external_supervisor.mjs"
  else
    printf '%s\n' "${request}"
  fi
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
  local result
  result="$(node "${ROOT_DIR}/scripts/finalize_preflight.mjs" "${finalize_args[@]}" < "${envelope}")" || return $?
  if jq -e '.schema == "aegis.preflight_finalization.v2" and .status == "USER_CONFIRMATION_REQUIRED"' <<< "${result}" >/dev/null; then
    printf '\n══════════════════════════════════════════════════════════════\n'
    printf '=== AEGIS USER CONFIRMATION REQUIRED ===\n'
    printf '══════════════════════════════════════════════════════════════\n'
    printf 'Abra o wizard nativo do IDE com as opções abaixo. Não selecione a recomendação automaticamente e não implemente antes da resposta do usuário.\n\n'
    jq -r '.questions[] | "[\(.id)] \(.question)\n\(.impact)\n" + (.answers | to_entries | map("  \(.key + 1)) \(.value.label)" + (if .value.recommended then " [RECOMENDADO]" else "" end) + "\n     \(.value.rationale)") | join("\n"))' <<< "${result}"
    printf '\nPROTOCOLO IDE: apresente estas opções em modal/ask_question; depois grave somente a seleção explícita do usuário em .harness/runtime/resolution.json e retome finalize.\n\n'
  fi
  printf '%s\n' "${result}"
}

build_independent_review() {
  local demand="${1:-}" decision="" resolution="" producer_id="" reviewer_id="" envelope=""
  shift || true
  [[ -n "${demand}" ]] || fatal 'missing_demand'
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --decision)
        decision="${2:-}"
        [[ -n "${decision}" ]] && safe_path "${decision}" || fatal 'invalid_review_decision'
        shift 2
        ;;
      --resolution)
        resolution="${2:-}"
        [[ -n "${resolution}" ]] && safe_path "${resolution}" || fatal 'invalid_review_resolution'
        shift 2
        ;;
      --producer-id) producer_id="${2:-}"; [[ -n "${producer_id}" ]] || fatal 'missing_producer_id'; shift 2 ;;
      --reviewer-id) reviewer_id="${2:-}"; [[ -n "${reviewer_id}" ]] || fatal 'missing_reviewer_id'; shift 2 ;;
      *) fatal "unknown_review_flag:$1" ;;
    esac
  done
  [[ -n "${decision}" && -n "${producer_id}" && -n "${reviewer_id}" ]] || fatal 'missing_review_arguments'
  local -a args=(--decision "${decision}" --producer-id "${producer_id}" --reviewer-id "${reviewer_id}")
  [[ -n "${resolution}" ]] && args+=(--resolution "${resolution}")
  envelope="$(require_frozen_envelope "${demand}")"
  node "${ROOT_DIR}/scripts/build_preflight_review.mjs" "${args[@]}" < "${envelope}"
}

build_candidate_review() {
  local semantic_state="${ROOT_DIR}/src/.aegis/semantic-state.json"
  local files contract_digest manifest supervisor
  [[ -s "${semantic_state}" ]] || fatal 'candidate_review_requires_semantic_state'
  jq -e '.contract.verification.riskProfile == "forensic"' "${semantic_state}" >/dev/null \
    || fatal 'candidate_review_not_required'
  files="$(git -C "${ROOT_DIR}" diff --cached --name-only | sort -u)"
  [[ -n "${files}" ]] || fatal 'candidate_review_requires_staged_changes'
  while IFS= read -r path; do safe_path "${path}" || fatal "unsafe_candidate_path:${path}"; done <<< "${files}"
  manifest="$(while IFS= read -r path; do
    [[ -n "${path}" ]] || continue
    printf 'path=%s\n' "${path}"
    if git -C "${ROOT_DIR}" cat-file -e ":${path}" 2>/dev/null; then
      git -C "${ROOT_DIR}" show ":${path}" | shasum -a 256 | awk '{print $1}'
    else
      printf 'missing\n'
    fi
  done <<< "${files}" | shasum -a 256 | awk '{print $1}')"
  contract_digest="$(jq -S -c '.contract' "${semantic_state}" | shasum -a 256 | awk '{print $1}')"
  supervisor="$(jq -c '.supervisor // null' "${RUNTIME_DIR}/finalization.json" 2>/dev/null || printf 'null')"
  jq -n \
    --arg contractDigest "${contract_digest}" \
    --arg candidateManifest "${manifest}" \
    --rawfile files <(printf '%s\n' "${files}") \
    --argjson supervisor "${supervisor}" \
    --argjson obligations "$(jq -c '[
      .contract.behavior[].id,
      (.contract.preconditions // [])[].id,
      .contract.invariants[].id,
      (.contract.postconditions // [])[].id,
      (.contract.failureSemantics // [])[].id
    ] | unique' "${semantic_state}")" \
    --argjson adversarial "$(jq -c '.contract.verification.adversarialClasses // [] | unique' "${semantic_state}")" \
    --argjson authorizedPaths "$(jq -c '.contract.scope.authorizedPaths' "${semantic_state}")" '
      {
        schema:"aegis.forensic_candidate_review_request.v1",
        status:"PENDING_INDEPENDENT_CANDIDATE_REVIEW",
        contractDigest:$contractDigest,
        candidateManifest:$candidateManifest,
        candidateFiles:($files | split("\n") | map(select(length > 0))),
        authorizedEvidencePaths:$authorizedPaths,
        semanticSupervisor:$supervisor,
        requiredAssessments:$obligations,
        requiredAdversarialChecks:$adversarial,
        artifactPath:".harness/runtime/forensic_candidate_review.json",
        artifactSchema:{
          schema:"aegis.forensic_candidate_review.v1",
          contractDigest:$contractDigest,
          candidateManifest:$candidateManifest,
          reviewer:{id:"independent reviewer id",executionId:"64-char execution digest"},
          verdict:"APPROVED|REJECTED",
          assessments:"one assessment per contract id: {contractId,verdict,evidence,sourcePaths,proofIds}",
          adversarialChecks:"one PROVEN check per required class: {class,verdict,evidence,proofIds}"
        },
        instruction:"Um revisor diferente do supervisor semântico deve ler o contrato, os arquivos candidatos e as provas. Para cada obrigação, registre os paths candidatos e proof IDs que a sustentam. Execute e registre uma tentativa adversarial para cada classe exigida. Um texto sem path, proof ou tentativa adversarial não autoriza promoção."
      }
    ' > "${RUNTIME_DIR}/forensic_candidate_review_request.json"
  cat "${RUNTIME_DIR}/forensic_candidate_review_request.json"
}

authorize() {
  local change_kind="PRODUCT" staged_files artifact
  if [[ "${1:-}" == "--harness" ]]; then
    change_kind="HARNESS"
    shift
  fi
  [[ $# -eq 0 ]] || fatal 'authorize_does_not_accept_arguments'
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
    --arg changeKind "${change_kind}" \
    '{mode:"validation",changeKind:$changeKind,verdict:"accepted",validated_candidate:{files_changed:($files | split("\n") | map(select(length > 0)))}}' \
    > "${artifact}"
  bash "${ROOT_DIR}/scripts/formal_promotion_authorization.sh" create "${ROOT_DIR}" "${artifact}"
  bash "${ROOT_DIR}/scripts/formal_promotion_authorization.sh" verify "${ROOT_DIR}"
  rm -f "${artifact}"
  printf '[AEGIS][IDE] promotion=AUTHORIZED kind=%s receipt=.git/aegis/precommit_receipt.json\n' "${change_kind}"
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
  printf '// Ponto de entrada canônico para a próxima demanda.\nexport {};\n' > "${ROOT_DIR}/src/index.ts"
  printf '[AEGIS][IDE] clean=PASS source_reset=1\n'
}

status() {
  local state supervisor
  state="$(metadata_state)"
  supervisor="$(supervisor_setup_state | jq '.supervisor')"
  jq -n \
    --arg state "${state}" \
    --arg base "$(git -C "${ROOT_DIR}" rev-parse HEAD)" \
    --arg changes "$(git -C "${ROOT_DIR}" status --short)" \
    --argjson supervisor "${supervisor}" \
    '{schema:"aegis.ide_status.v1",evidenceState:$state,baseCommit:$base,workingTree:$changes,supervisor:$supervisor}'
}

command_name="${1:-}"
case "${command_name}" in
  -h|--help|help|'') usage ;;
  status) shift; [[ $# -eq 0 ]] || fatal 'status_does_not_accept_arguments'; status ;;
  setup) shift; supervisor_setup "$@" ;;
  evidence) shift; exec bash "${ROOT_DIR}/scripts/evidence_inventory.sh" "$@" ;;
  harness) shift; build_preflight HARNESS "$@" ;;
  finalize) shift; finalize_preflight "$@" ;;
  review) shift; build_independent_review "$@" ;;
  candidate-review) shift; [[ $# -eq 0 ]] || fatal 'candidate_review_does_not_accept_arguments'; build_candidate_review ;;
  authorize) shift; authorize "$@" ;;
  report) shift; [[ $# -eq 0 ]] || fatal 'report_does_not_accept_arguments'; node "${ROOT_DIR}/scripts/forensic_report.mjs" ;;
  clean) shift; clean "$@" ;;
  -*) fatal "unknown_command:${command_name}" ;;
  *) build_preflight PRODUCT "$@" ;;
esac

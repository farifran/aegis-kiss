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
  ./aegis continue "<mesma-demanda>"
  ./aegis setup
  ./aegis setup [show|ide|external --endpoint <url> --model <id> [--api-key-env <VAR>] [--timeout-ms <n>]]
  ./aegis setup reviewer [off|external --endpoint <url> --model <id> [--api-key-env <VAR>] [--timeout-ms <n>]
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
    local request
    request="$(jq -n '
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
          },
          {
            id: "forensic-reviewer",
            question: "Qual autoridade deve revisar contratos forenses de forma independente?",
            recommendedAnswerId: "EXTERNAL",
            answers: [
              {
                id: "EXTERNAL",
                label: "Modelo externo independente",
                rationale: "É executável pelo gateway sem envolver o usuário da demanda e fica vinculado ao receipt.",
                requiredFields: [
                  { name: "endpoint", prompt: "Endpoint base OpenAI-compatível", example: "http://127.0.0.1:11434/v1" },
                  { name: "model", prompt: "Identificador do modelo revisor", example: "llama3.2:11b" },
                  { name: "apiKeyEnv", prompt: "Nome da variável de API key, se necessário", optional: true },
                  { name: "timeoutMs", prompt: "Timeout em milissegundos", default: 45000, optional: true }
                ],
                apply: { command: "./aegis setup reviewer external --endpoint <endpoint> --model <model> [--api-key-env <apiKeyEnv>] [--timeout-ms <timeoutMs>]" }
              },
              {
                id: "OFF",
                label: "Não configurar agora",
                rationale: "Demandas comuns continuam funcionando; demandas forenses param antes da persistência.",
                apply: { command: "./aegis setup reviewer off" }
              }
            ]
          }
        ]
      }
    ')"
    if [[ -t 0 && -t 1 ]]; then
      resolve_setup_wizard "${request}"
      return
    fi
    printf '%s\n' "${request}"
    return 0
  fi
  exec node "${ROOT_DIR}/scripts/lib/supervisor_config.mjs" "$@"
}

prompt_numbered_choice() {
  local question_json="${1:-}" title answer_count choice selected_id
  title="$(jq -r '.question' <<< "${question_json}")"
  answer_count="$(jq '.answers | length' <<< "${question_json}")"
  printf '\n[AEGIS] %s\n' "${title}" >&2
  jq -r '.answers | to_entries[] | "  \(.key + 1)) \(.value.label)" + (if .value.recommended then " [RECOMENDADO]" else "" end) + "\n     \(.value.rationale)"' <<< "${question_json}" >&2
  while true; do
    read -r -p "Escolha [1-${answer_count}]: " choice
    if [[ "${choice}" =~ ^[1-9][0-9]*$ ]] && ((choice >= 1 && choice <= answer_count)); then
      selected_id="$(jq -r ".answers[$((choice - 1))].id" <<< "${question_json}")"
      printf '%s\n' "${selected_id}"
      return
    fi
    printf '[AEGIS] Escolha inválida.\n' >&2
  done
}

resolve_setup_wizard() {
  local request="${1:-}" supervisor_question reviewer_question supervisor_choice reviewer_choice
  supervisor_question="$(jq -c '.questions[] | select(.id == "supervisor-mode")' <<< "${request}")"
  reviewer_question="$(jq -c '.questions[] | select(.id == "forensic-reviewer")' <<< "${request}")"
  supervisor_choice="$(prompt_numbered_choice "${supervisor_question}")"
  if [[ "${supervisor_choice}" == 'EXTERNAL' ]]; then
    local endpoint model api_key_env timeout_ms
    read -r -p 'Endpoint OpenAI-compatível: ' endpoint
    read -r -p 'Modelo: ' model
    read -r -p 'Variável de API key (vazio se não usar): ' api_key_env
    read -r -p 'Timeout em ms [45000]: ' timeout_ms
    timeout_ms="${timeout_ms:-45000}"
    local -a supervisor_args=(external --endpoint "${endpoint}" --model "${model}" --timeout-ms "${timeout_ms}")
    [[ -n "${api_key_env}" ]] && supervisor_args+=(--api-key-env "${api_key_env}")
    node "${ROOT_DIR}/scripts/lib/supervisor_config.mjs" "${supervisor_args[@]}" >/dev/null
  else
    node "${ROOT_DIR}/scripts/lib/supervisor_config.mjs" ide >/dev/null
  fi
  reviewer_choice="$(prompt_numbered_choice "${reviewer_question}")"
  if [[ "${reviewer_choice}" == 'EXTERNAL' ]]; then
    local reviewer_endpoint reviewer_model reviewer_api_key_env reviewer_timeout_ms
    read -r -p 'Endpoint do revisor OpenAI-compatível: ' reviewer_endpoint
    read -r -p 'Modelo do revisor: ' reviewer_model
    read -r -p 'Variável de API key do revisor (vazio se não usar): ' reviewer_api_key_env
    read -r -p 'Timeout do revisor em ms [45000]: ' reviewer_timeout_ms
    reviewer_timeout_ms="${reviewer_timeout_ms:-45000}"
    local -a reviewer_args=(reviewer external --endpoint "${reviewer_endpoint}" --model "${reviewer_model}" --timeout-ms "${reviewer_timeout_ms}")
    [[ -n "${reviewer_api_key_env}" ]] && reviewer_args+=(--api-key-env "${reviewer_api_key_env}")
    node "${ROOT_DIR}/scripts/lib/supervisor_config.mjs" "${reviewer_args[@]}" >/dev/null
  else
    node "${ROOT_DIR}/scripts/lib/supervisor_config.mjs" reviewer off >/dev/null
  fi
  node "${ROOT_DIR}/scripts/lib/supervisor_config.mjs" show
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
    local semantic_result decision_path
    semantic_result="$(printf '%s' "${request}" | node "${ROOT_DIR}/scripts/external_supervisor.mjs")" \
      || fatal 'external_semantic_compilation_failed'
    decision_path="$(jq -r '.decisionPath // empty' <<< "${semantic_result}")"
    [[ "${decision_path}" == '.harness/runtime/preflight_decision.json' ]] \
      || fatal 'external_semantic_decision_missing'
    finalize_preflight "${demand}" --decision "${decision_path}"
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

internal_reviewer_state() {
  local producer_id="${1:-}" state reviewer_id reviewer_digest
  state="$(supervisor_setup_state)"
  reviewer_id="$(jq -r '.reviewer.id // empty' <<< "${state}")"
  reviewer_digest="$(jq -r '.reviewer.configDigest // empty' <<< "${state}")"
  [[ -n "${producer_id}" && -n "${reviewer_id}" && "${reviewer_id}" != "${producer_id}" && "${reviewer_digest}" =~ ^[a-f0-9]{64}$ ]] \
    || fatal 'independent_reviewer_not_configured'
  jq -n --arg id "${reviewer_id}" --arg digest "${reviewer_digest}" '{id:$id,configDigest:$digest}'
}

prepare_internal_review() {
  local envelope="${1:-}" decision="${2:-}" resolution="${3:-}" producer_id reviewer reviewer_id reviewer_digest request execution review_path
  producer_id="$(jq -r '.supervisor.id' "${envelope}")"
  reviewer="$(internal_reviewer_state "${producer_id}")"
  reviewer_id="$(jq -r '.id' <<< "${reviewer}")"
  reviewer_digest="$(jq -r '.configDigest' <<< "${reviewer}")"
  local -a args=(--decision "${decision}" --producer-id "${producer_id}" --reviewer-id "${reviewer_id}" --reviewer-config-digest "${reviewer_digest}")
  [[ -n "${resolution}" ]] && args+=(--resolution "${resolution}")
  request="$(node "${ROOT_DIR}/scripts/build_preflight_review.mjs" "${args[@]}" < "${envelope}")" \
    || fatal 'internal_review_request_failed'
  execution="$(printf '%s' "${request}" | node "${ROOT_DIR}/scripts/external_reviewer.mjs")" \
    || fatal 'internal_review_execution_failed'
  jq -e '.schema == "aegis.internal_review_result.v1" and .status == "INDEPENDENT_REVIEW_READY" and .verdict == "APPROVED" and .reviewPath == ".harness/runtime/preflight_review.json"' \
    <<< "${execution}" >/dev/null || fatal 'independent_review_rejected'
  review_path="$(jq -r '.reviewPath' <<< "${execution}")"
  local -a finalize_args=(--decision "${decision}" --independent-review "${review_path}")
  [[ -n "${resolution}" ]] && finalize_args+=(--resolution "${resolution}")
  node "${ROOT_DIR}/scripts/finalize_preflight.mjs" "${finalize_args[@]}" < "${envelope}"
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
    write_user_wizard_request "${result}"
    if [[ ! -t 0 || ! -t 1 ]]; then
      # A non-interactive executor cannot obtain authority.  The structured
      # request is deliberately the only successful output, so IDE adapters
      # must render it instead of treating a pending decision as completion.
      printf '%s\n' "${result}"
      return 2
    fi
    resolution="$(resolve_preflight_wizard "${result}")"
    result="$(node "${ROOT_DIR}/scripts/finalize_preflight.mjs" --decision "${decision}" --resolution "${resolution}" < "${envelope}")" || return $?
    if jq -e '.schema == "aegis.preflight_finalization.v2" and .status == "INDEPENDENT_REVIEW_REQUIRED"' <<< "${result}" >/dev/null; then
      prepare_internal_review "${envelope}" "${decision}" "${resolution}"
      return
    fi
  elif jq -e '.schema == "aegis.preflight_finalization.v2" and .status == "INDEPENDENT_REVIEW_REQUIRED"' <<< "${result}" >/dev/null; then
    prepare_internal_review "${envelope}" "${decision}" "${resolution}"
    return
  fi
  printf '%s\n' "${result}"
}

write_user_wizard_request() {
  local result="${1:-}" temporary="${RUNTIME_DIR}/user_confirmation_request.json.$$.tmp"
  printf '%s\n' "${result}" > "${temporary}"
  mv "${temporary}" "${RUNTIME_DIR}/user_confirmation_request.json"
}

resolve_preflight_wizard() {
  local result="${1:-}" selections="${RUNTIME_DIR}/preflight_wizard_selections.json" resolution="${RUNTIME_DIR}/preflight_resolution.json"
  : > "${selections}"
  local count index question answer_count choice correction answer_id
  count="$(jq '.questions | length' <<< "${result}")"
  printf '\n══════════════════════════════════════════════════════════════\n' >&2
  printf ' AEGIS — decisões necessárias para continuar\n' >&2
  printf '══════════════════════════════════════════════════════════════\n' >&2
  for ((index = 0; index < count; index++)); do
    question="$(jq -c ".questions[${index}]" <<< "${result}")"
    answer_count="$(jq '.answers | length' <<< "${question}")"
    printf '\n[%s] %s\n%s\n' "$(jq -r '.id' <<< "${question}")" "$(jq -r '.question' <<< "${question}")" "$(jq -r '.impact' <<< "${question}")" >&2
    jq -r '.answers | to_entries[] | "  \(.key + 1)) \(.value.label)" + (if .value.recommended then " [RECOMENDADO]" else "" end) + "\n     \(.value.rationale)"' <<< "${question}" >&2
    printf '  %d) Outra interpretação\n     Descreva uma opção diferente; o contrato voltará para revisão semântica.\n' "$((answer_count + 1))" >&2
    while true; do
      read -r -p "Escolha [1-$((answer_count + 1))]: " choice
      if [[ "${choice}" =~ ^[1-9][0-9]*$ ]] && ((choice >= 1 && choice <= answer_count)); then
        answer_id="$(jq -r ".answers[$((choice - 1))].id" <<< "${question}")"
        jq -n --arg questionId "$(jq -r '.id' <<< "${question}")" --arg answerId "${answer_id}" '{questionId:$questionId,action:"SELECT_ANSWER",answerId:$answerId}' >> "${selections}"
        break
      fi
      if [[ "${choice}" == "$((answer_count + 1))" ]]; then
        read -r -p 'Sua interpretação: ' correction
        [[ -n "${correction}" ]] || { printf '[AEGIS] A interpretação não pode ficar vazia.\n' >&2; continue; }
        jq -n --arg questionId "$(jq -r '.id' <<< "${question}")" --arg correction "${correction}" '{questionId:$questionId,action:"CORRECT_INTERPRETATION",correction:$correction}' >> "${selections}"
        break
      fi
      printf '[AEGIS] Escolha inválida.\n' >&2
    done
  done
  node - "${result}" "${selections}" "${resolution}" <<'NODE'
const fs = require('node:fs');
const result = JSON.parse(process.argv[2]);
const answers = fs.readFileSync(process.argv[3], 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
fs.writeFileSync(process.argv[4], `${JSON.stringify({
  schema: 'aegis.preflight_resolution.v2',
  decisionDigest: result.decisionDigest,
  preflightPromptDigest: result.preflightPromptDigest,
  confirmation: {
    channel: 'IDE_TERMINAL_WIZARD',
    confirmationId: result.confirmation.confirmationId,
    selectedAtEpochMs: Date.now(),
  },
  answers,
})}\n`);
NODE
  printf '%s\n' "${resolution}"
}

continue_preflight() {
  local demand="${1:-}"
  [[ -n "${demand}" ]] || fatal 'missing_demand'
  [[ -s "${RUNTIME_DIR}/preflight_decision.json" ]] || fatal 'missing_semantic_decision'
  finalize_preflight "${demand}" --decision .harness/runtime/preflight_decision.json
}

build_independent_review() {
  local demand="${1:-}" decision="" resolution="" producer_id="" reviewer_id="" envelope="" reviewer reviewer_digest
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
  reviewer="$(internal_reviewer_state "${producer_id}")"
  [[ "${reviewer_id}" == "$(jq -r '.id' <<< "${reviewer}")" ]] || fatal 'reviewer_identity_not_configured'
  reviewer_digest="$(jq -r '.configDigest' <<< "${reviewer}")"
  local -a args=(--decision "${decision}" --producer-id "${producer_id}" --reviewer-id "${reviewer_id}" --reviewer-config-digest "${reviewer_digest}")
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
  local state setup supervisor reviewer
  state="$(metadata_state)"
  setup="$(supervisor_setup_state)"
  supervisor="$(jq '.supervisor' <<< "${setup}")"
  reviewer="$(jq '.reviewer' <<< "${setup}")"
  jq -n \
    --arg state "${state}" \
    --arg base "$(git -C "${ROOT_DIR}" rev-parse HEAD)" \
    --arg changes "$(git -C "${ROOT_DIR}" status --short)" \
    --argjson supervisor "${supervisor}" \
    --argjson reviewer "${reviewer}" \
    '{schema:"aegis.ide_status.v1",evidenceState:$state,baseCommit:$base,workingTree:$changes,supervisor:$supervisor,reviewer:$reviewer}'
}

command_name="${1:-}"
case "${command_name}" in
  -h|--help|help|'') usage ;;
  status) shift; [[ $# -eq 0 ]] || fatal 'status_does_not_accept_arguments'; status ;;
  setup) shift; supervisor_setup "$@" ;;
  evidence) shift; exec bash "${ROOT_DIR}/scripts/evidence_inventory.sh" "$@" ;;
  harness) shift; build_preflight HARNESS "$@" ;;
  continue) shift; continue_preflight "$@" ;;
  finalize) shift; finalize_preflight "$@" ;;
  review) shift; build_independent_review "$@" ;;
  candidate-review) shift; [[ $# -eq 0 ]] || fatal 'candidate_review_does_not_accept_arguments'; build_candidate_review ;;
  authorize) shift; authorize "$@" ;;
  report) shift; [[ $# -eq 0 ]] || fatal 'report_does_not_accept_arguments'; node "${ROOT_DIR}/scripts/forensic_report.mjs" ;;
  clean) shift; clean "$@" ;;
  -*) fatal "unknown_command:${command_name}" ;;
  *) build_preflight PRODUCT "$@" ;;
esac

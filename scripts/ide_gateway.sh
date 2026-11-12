#!/usr/bin/env bash

# AEGIS — Symbiotic Demand-to-Contract Gateway (Isolated Flow)

set -Eeuo pipefail

ROOT_DIR="${AEGIS_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
export AEGIS_ROOT="${ROOT_DIR}"
RUNTIME_DIR="${ROOT_DIR}/.harness/runtime"

fatal() {
  printf '{"schema":"aegis.rejection.v1","status":"REJECTED","phase":"COMMAND","reason":"%s"}\n' "$1" >&2
  exit 1
}

require_command_arity() {
  [[ "$#" -eq 1 ]] || fatal 'INVALID_COMMAND_ARITY'
}

usage() {
  cat <<'EOF'
Aegis — Fluxo Simbiótico Demanda até o Contrato:
  ./aegis "<demanda>" Executa captura, Discovery e supervisão até o contrato
  ./aegis --issue [id|arquivo] Captura issue explícita (ou única aberta) como demanda
  ./aegis draft "<demanda>" Executa captura e Discovery (emite preflight v3 e workspace skeleton)
  ./aegis --new "<demanda>" Inicia contexto independente substituindo estado do Harness (preserva src/)
  ./aegis --new --issue [id|arquivo] Reinicia estado do Harness e captura issue como demanda
  ./aegis --approve   Confirma e sela o contrato com o Hash Raiz Único (contractDigest)
  ./aegis --resolve Q=ANS  Aplica resolução de decisão diretamente (ex: Q-0001=ANS-0001) e sela
  ./aegis --verify    Verifica a integridade criptográfica do contrato assinado
  ./aegis --semantic-request  Entrega a Intent IR neutra à IA semântica
  ./aegis --semantic-run  Executa o supervisor configurado e compila o contrato
  ./aegis --semantic-compile  Recebe o parecer JSON da IDE pelo stdin e compila o contrato
  ./aegis --wizard    Abre as decisões pendentes no terminal
  ./aegis --setup     Configura o supervisor do contrato e o agente de codificação
  ./aegis --setup --show  Exibe a configuração externa sem expor chaves
  ./aegis --status    Exibe o status do contrato e da árvore de trabalho
  ./aegis --clean     Remove artefatos transientes e estado do Harness (preserva src/)
  ./aegis --help      Exibe esta mensagem de ajuda
EOF
}

clean_command() {
  [[ ! -L "${RUNTIME_DIR}" ]] || fatal 'INVALID_RUNTIME_DIRECTORY'
  [[ ! -L "${ROOT_DIR}/.harness/state" ]] || fatal 'INVALID_STATE_DIRECTORY'
  rm -rf "${RUNTIME_DIR}"
  mkdir -p "${RUNTIME_DIR}"
  rm -rf "${ROOT_DIR}/.harness/state"
  rm -f "${ROOT_DIR}/.harness/domain-lexicon.json"
  echo '[AEGIS][IDE] clean=PASS harness_reset=1 contracts_reset=1 resolutions_reset=1 lexicon_reset=1 product_preserved=1'
}

run_demand() {
  node "${ROOT_DIR}/scripts/issue_contract_runner.mjs" run "$@"
  local run_code=$?
  if [[ ${run_code} -ne 0 ]]; then
    exit ${run_code}
  fi
}


resolve_preflight_wizard() {
  local request_file="${RUNTIME_DIR}/user_confirmation_request.json"
  local resolution_file="${RUNTIME_DIR}/preflight_resolution.json"
  local semantic_file="${ROOT_DIR}/.harness/state/semantic-state.json"

  if [[ ! -f "${request_file}" ]]; then
    if [[ -f "${semantic_file}" ]]; then
      printf '\n[AEGIS] O contrato já está selado e governado (GOVERNED). Nada a resolver no wizard.\n' >&2
    elif [[ -f "${RUNTIME_DIR}/preflight.json" ]]; then
      printf '\n[AEGIS] Captura e Discovery concluídos. A deliberação semântica ainda precisa compilar as opções do contrato.\n' >&2
    else
      printf '\n[AEGIS] Nenhuma Issue-Contrato pendente de confirmação. Execute: ./aegis "<sua demanda>" primeiro.\n' >&2
    fi
    exit 0
  fi
  local result
  result="$(cat "${request_file}")"

  local req_status
  req_status="$(jq -r '.status // empty' <<< "${result}")"
  if [[ "${req_status}" == "FINALIZED" ]]; then
    printf '\n[AEGIS] O contrato já foi finalizado. Nada a resolver no wizard.\n' >&2
    exit 0
  fi

  local request_schema
  request_schema="$(jq -r '.schema // empty' <<< "${result}")"
  if [[ "${request_schema}" != "aegis.confirmation_request.v5" ]]; then
    result="$(node "${ROOT_DIR}/scripts/issue_contract_runner.mjs" confirmation-request)"
    request_schema="$(jq -r '.schema // empty' <<< "${result}")"
  fi
  if [[ "${request_schema}" != "aegis.confirmation_request.v5" ]]; then
    printf '\n[AEGIS] O pacote de decisão humana não pôde ser atualizado para o schema atual.\n' >&2
    return
  fi

  if [[ ! -t 0 ]] && [[ "${AEGIS_TEST_AUTOMATION:-0}" != "1" ]]; then
    printf '\n[AEGIS] O Wizard interativo exige um terminal TTY para deliberação humana.\n' >&2
    printf '[AEGIS] Simulações automatizadas de stdin via pipe são proibidas para assegurar o consentimento humano real.\n' >&2
    printf '[AEGIS] No chat da IDE, responda diretamente pelo modal interativo; no terminal, execute "./aegis --wizard" de forma interativa.\n' >&2
    return 1
  fi

  local count index question q_id answer_count choice correction answer_id answers='[]'
  local recommended_id recommended_index remaining_answers final_confirmation attestation
  local requires_recompilation=0 bulk_selected=0
  count="$(jq '.questionCount' <<< "${result}")"
  [[ "${count}" == "$(jq '.questions | length' <<< "${result}")" ]] || fatal 'INVALID_WIZARD_QUESTION_COUNT'
  (( count > 0 )) && requires_recompilation=1
  jq -r '
    "\n══════════════════════════════════════════════════════════════\n AEGIS — Deliberação e Aprovação Humana\n══════════════════════════════════════════════════════════════",
    "Contrato: \(.title)\nDigest do rascunho: \(.contractDraftDigest)\nRevisão completa: \(.artifactPath)",
    "Uma recomendação é apenas uma proposta; nada será selado sem sua confirmação final.",
    (if .questionCount == 0 then "\n[AEGIS] Nenhuma decisão material está pendente, mas o contrato ainda exige aprovação humana explícita." else empty end)
  ' <<< "${result}" >&2
  for ((index = 0; index < count; index++)); do
    question="$(jq -c ".questions[${index}]" <<< "${result}")"
    IFS=$'\t' read -r q_id answer_count recommended_id recommended_index < <(
      jq -r '(.recommendedAnswerId) as $rec | [.id, (.answers | length), $rec, ((.answers | to_entries[] | select(.value.id == $rec) | .key) + 1)] | @tsv' <<< "${question}"
    )
    jq -r --argjson i "$((index + 1))" --argjson n "${count}" '
      .bulkRecommendationAction as $bulk | .questions[$i - 1] |
      (.recommendedAnswerId) as $rec | (.answers | map(select(.id == $rec))[0]) as $recAns |
      "\n[\($i)/\($n)] [\(.id)] \(.question)",
      "  Contexto da demanda:\n  \(.presentation.context)",
      "  Por que você precisa decidir:\n  \(.presentation.whyHumanDecision)",
      "  O que muda na prática:\n  \(.presentation.observableImpact)",
      (if (.gaps | length) > 0 then "  Lacunas da demanda:", (.gaps[] | "  - \(.)") else empty end),
      "  Exemplo que demonstra a diferença:\n  - Dado: \(.distinguishingCase.given)\n  - Quando: \(.distinguishingCase.when)",
      (.distinguishingCase.outcomes[] as $o | .answers[] | select(.id == $o.answerId) | "  - Se escolher \(.label): \($o.then)"),
      "  Recomendação do Aegis: \($recAns.label)\n  Por quê: \(.presentation.recommendationReasoning)\n  Se aceita: \($recAns.contractEffect)",
      (if (.presentation.glossary | length) > 0 then "  Termos usados:", (.presentation.glossary[] | "  - \(.term): \(.meaning)") else empty end),
      "  O que esta decisão altera no contrato:",
      (.traceability.requirements[] | "  - Requisito \(.id): \(.statement)"),
      (.traceability.acceptanceCases[] | "  - Prova \(.id): dado \(.given) quando \(.when), deve ocorrer: \(.then) [\(.outcomeKind)]"),
      (.traceability.invariants[] | "  - Invariante \(.id): \(.statement) Falha se: \(.falsification)"),
      (.traceability.risks[] | "  - Risco \(.id) [\(.level)/\(.kind)]: \(.statement) Mitigação: \(.mitigation)"),
      (.answers | to_entries[] | "  \(.key + 1)) \(.value.label)" + (if .value.recommended then " [RECOMENDADO — PROPOSTA]" else "" end) + "\n     Motivo: \(.value.rationale)\n     Efeito no contrato: \(.value.contractEffect)"),
      "  \((.answers | length) + 1)) Outra interpretação\n     Descreva uma opção diferente; o contrato voltará para revisão semântica.",
      (.answers[] | select(.applicationMode == "SEMANTIC_REVIEW_REQUIRED") | "  Aviso: “\(.label)” exige nova análise antes de fechar o contrato."),
      "  ── Ação rápida ──\n  A) \($bulk.label)\n     \($bulk.description)"
    ' <<< "${result}" >&2
    while true; do
      read -r -p "Escolha [${recommended_index} recomendado]: " choice
      choice="${choice:-${recommended_index}}"
      if [[ "${choice}" =~ ^[1-9][0-9]*$ ]] && ((choice >= 1 && choice <= answer_count)); then
        answer_id="$(jq -r ".answers[$((choice - 1))].id" <<< "${question}")"
        answers="$(jq -c --arg questionId "${q_id}" --arg answerId "${answer_id}" '. + [{questionId:$questionId, answerId:$answerId}]' <<< "${answers}")"
        [[ "${answer_id}" != "${recommended_id}" ]] && requires_recompilation=1
        break
      fi
      if [[ "${choice}" == "$((answer_count + 1))" ]]; then
        read -r -p 'Sua interpretação: ' correction
        [[ -n "${correction}" ]] || { printf '[AEGIS] A interpretação não pode ficar vazia.\n' >&2; continue; }
        answers="$(jq -c --arg questionId "${q_id}" --arg correction "${correction}" '. + [{questionId:$questionId, correction:$correction}]' <<< "${answers}")"
        requires_recompilation=1
        break
      fi
      if [[ "${choice}" =~ ^[aA]$ ]]; then
        remaining_answers="$(jq -c --argjson start "${index}" '[.questions[$start:][] | {questionId:.id, answerId:.recommendedAnswerId}]' <<< "${result}")"
        answers="$(jq -c --argjson remaining "${remaining_answers}" '. + $remaining' <<< "${answers}")"
        bulk_selected=1
        break
      fi
      printf '[AEGIS] Escolha inválida.\n' >&2
    done
    if (( bulk_selected == 1 )); then
      printf '[AEGIS] Recomendações aplicadas desta pergunta até %d/%d. A confirmação final continua obrigatória.\n' "${count}" "${count}" >&2
      break
    fi
  done

  if (( count > 0 )); then
    jq -r --argjson answers "${answers}" '
      "\n──────────────────────────────────────────────────────────────\n Resumo das suas escolhas\n──────────────────────────────────────────────────────────────",
      (range(0; .questionCount) as $i | .questions[$i] as $q | $answers[$i] as $a |
        "- \($q.id) → " + (if $a.answerId then ($q.answers[] | select(.id == $a.answerId) | .label) else "Interpretação própria: \($a.correction)" end))
    ' <<< "${result}" >&2
  fi

  if (( requires_recompilation == 1 )); then
    read -r -p 'Confirmar escolhas e enviar o contrato para recompilação? [s/N]: ' final_confirmation
    attestation='DECISIONS_REVIEWED_AND_CONFIRMED'
  else
    read -r -p 'Revisei o contrato e confirmo que ele pode ser selado? [s/N]: ' final_confirmation
    attestation='CONTRACT_REVIEWED_AND_APPROVED'
  fi
  if [[ ! "${final_confirmation}" =~ ^([sS]|[sS][iI][mM]|[yY]|[yY][eE][sS])$ ]]; then
    printf '[AEGIS] Operação cancelada. Nenhuma nova decisão ou aprovação foi gravada.\n' >&2
    return
  fi

  local resolution_staging
  resolution_staging="$(mktemp "${RUNTIME_DIR}/.preflight_resolution.XXXXXX")"
  jq --arg attestation "${attestation}" --argjson answers "${answers}" \
    '{schema:"aegis.semantic_resolution.v2",executionId,contractDraftDigest,method:"INTERACTIVE_WIZARD",attestation:$attestation,answers:$answers}' \
    <<< "${result}" > "${resolution_staging}"
  mv "${resolution_staging}" "${resolution_file}"
  if (( requires_recompilation == 1 )); then
    if jq -e --argjson choices "${answers}" '
      . as $request | all($choices[];
        . as $choice | (has("correction") | not) and
        any($request.questions[]; .id == $choice.questionId and
          any(.answers[]; .id == $choice.answerId and .applicationMode == "PREPARED_EFFECT")))
    ' <<< "${result}" >/dev/null; then
      printf '[AEGIS] Aplicando as opções preparadas e validando o contrato, sem nova consulta à IA.\n' >&2
      node "${ROOT_DIR}/scripts/issue_contract_runner.mjs" approve >/dev/null || return $?
      resolve_preflight_wizard
      return
    fi
    printf '[AEGIS] Escolhas gravadas e vinculadas ao rascunho. Recompilação semântica necessária antes da assinatura.\n' >&2
    return
  fi
  echo '[AEGIS][IDE] Escolhas e aprovação explícita gravadas. Selando contrato...' >&2
  node "${ROOT_DIR}/scripts/issue_contract_runner.mjs" approve
}

main() {
  [[ $# -ge 1 ]] || fatal 'MISSING_ARGUMENT'

  case "${1}" in
    draft|--draft)
      shift
      exec node "${ROOT_DIR}/scripts/issue_contract_runner.mjs" draft "$@"
      ;;
    --approve)
      require_command_arity "$@"
      exec node "${ROOT_DIR}/scripts/issue_contract_runner.mjs" approve
      ;;
    --verify)
      require_command_arity "$@"
      exec node "${ROOT_DIR}/scripts/issue_contract_runner.mjs" verify
      ;;
    --semantic-request)
      require_command_arity "$@"
      exec node "${ROOT_DIR}/scripts/issue_contract_runner.mjs" semantic-request
      ;;
    --semantic-run)
      require_command_arity "$@"
      exec node "${ROOT_DIR}/scripts/issue_contract_runner.mjs" semantic-run
      ;;
    --semantic-compile)
      require_command_arity "$@"
      exec node "${ROOT_DIR}/scripts/issue_contract_runner.mjs" semantic-compile
      ;;
    --wizard)
      require_command_arity "$@"
      resolve_preflight_wizard
      ;;
    --resolve)
      shift
      node "${ROOT_DIR}/scripts/resolve_decision.mjs" "$@"
      local resolve_code=$?
      if [[ ${resolve_code} -ne 0 ]]; then
        exit ${resolve_code}
      fi
      node "${ROOT_DIR}/scripts/issue_contract_runner.mjs" approve >/dev/null || exit $?
      if [[ -f "${RUNTIME_DIR}/contract.json" ]] && jq -e '.approval.attestation == "CONTRACT_REVIEWED_AND_APPROVED"' "${RUNTIME_DIR}/contract.json" >/dev/null 2>&1; then
        echo '[AEGIS][IDE] Contrato aprovado e selado com sucesso!'
      else
        node "${ROOT_DIR}/scripts/issue_contract_runner.mjs" approve || exit $?
        echo '[AEGIS][IDE] Contrato aprovado e selado com sucesso!'
      fi
      ;;
    --setup)
      if [[ "$#" -eq 1 ]]; then
        exec node "${ROOT_DIR}/scripts/setup_roles.mjs"
      elif [[ "$#" -eq 2 && "$2" == "--show" ]]; then
        exec node "${ROOT_DIR}/scripts/setup_roles.mjs" --show
      else
        fatal 'INVALID_SETUP_ARITY'
      fi
      ;;
    --status)
      require_command_arity "$@"
      exec node "${ROOT_DIR}/scripts/issue_contract_runner.mjs" status
      ;;
    --clean)
      require_command_arity "$@"
      clean_command
      ;;
    --issue)
      shift
      exec node "${ROOT_DIR}/scripts/issue_contract_runner.mjs" issue "$@"
      ;;
    --new)
      [[ $# -ge 2 ]] || fatal 'MISSING_ARGUMENT'
      shift
      clean_command >/dev/null
      if [[ "${1}" == "--issue" ]]; then
        shift
        exec node "${ROOT_DIR}/scripts/issue_contract_runner.mjs" issue "$@"
      fi
      run_demand "$@"
      ;;
    --help|-h)
      require_command_arity "$@"
      usage
      ;;
    --*)
      fatal 'UNKNOWN_COMMAND'
      ;;
    *)
      # A demand runs the governed flow through the contract draft.
      run_demand "$@"
      ;;
  esac
}

main "$@"

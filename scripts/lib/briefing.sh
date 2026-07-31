#!/usr/bin/env bash

# =========================================================
# AEGIS — BRIEFING PRE-PASS (supervisor expands the demand)
# =========================================================
#
# A goal written as free prose makes the CLI derive Acceptance by grepping
# identifiers out of it, which pulls constructor parameters and private
# fields into the promotion contract. Issue #65 died that way: six acceptance
# tokens, four of them internal, one — timeDiff*rateBitsPerMs — not even a
# valid identifier.
#
# This pre-pass asks a supervisor model to turn the prose into a structured
# demand whose Acceptance lists only public exports and whose mechanics live
# in a Briefing section (which the tokenizer never reads, and which
# fit_check already propagates into micro-units).
#
# The supervisor is advisory. Anything it returns is validated before use and
# a single failed check falls back to the mechanical render_body — the run
# behaves exactly as it does today.
#
# Env:
#   AEGIS_BRIEFING=0                disable the pre-pass entirely
#   AEGIS_SUPERVISOR_MODEL          default: the mutation model
#   AEGIS_BRIEFING_TIMEOUT_SEC      default 90 (wall clock for the call)
#   OPENAI_API_BASE / OPENAI_API_KEY
#
# =========================================================

aegis_briefing_enabled() {
  case "${AEGIS_BRIEFING:-1}" in
    0|false|no) return 1 ;;
  esac
  [[ -n "${OPENAI_API_KEY:-${NVIDIA_API_KEY:-}}" ]] || return 1
  command -v curl >/dev/null 2>&1 || return 1
  command -v jq >/dev/null 2>&1 || return 1
  return 0
}

# The rules mirror .claude/skills/briefing/SKILL.md. Kept terse on purpose:
# this is resent on every run, and a weak supervisor follows a short contract
# more reliably than a long one.
aegis_briefing_system_prompt() {
  cat <<'PROMPT'
You turn a plain-language software demand into a structured Aegis issue.

Output ONLY the markdown below. No preamble, no explanation, no code fences.

## Goal
One short sentence naming the files to create. NEVER mention parameter names,
field names or types here.

## Targets
- one relative path per line (e.g. src/foo.ts)

## Acceptance
- one bare identifier per line, and ONLY public exports
- NEVER a constructor parameter, a private field, a built-in type, or prose

## Briefing
Numbered pseudocode, one item per top-level export:
1) export class Name:
   Campos privados: _a: tipo, _b: tipo
   constructor(arg: tipo): this._a = <expression>
   method(arg: tipo): tipo: <complete one or two line body>
   get prop(): tipo { return this._x }
2) export function name(arg: tipo): tipo:
   <complete body>
Then the re-export block for the barrel file, with exact import and export
lines. Write formulas as code (mbps * 8000), bitwise ops explicitly (mask |= 1)
and conditionals inline (if (c) { a } else { b }).

## Out of scope
- unrelated files
- e2e tests
- drive-by refactors

## Constraints
- no any / as any / @ts-ignore
- NodeNext: .js extension in relative imports

Every identifier listed under Acceptance MUST appear in the Briefing behind an
explicit `export` keyword. If something is internal state, it belongs in the
Briefing only, never under Acceptance.
PROMPT
}

# Structural + semantic gate. Returns 0 only when the body is safe to use.
# Prints the reason to stderr on rejection.
aegis_briefing_validate() {
  local body="${1-}"
  local sec line ident

  [[ -n "${body}" ]] || {
    printf 'empty_response\n' >&2
    return 1
  }

  # Code fences mean the model wrapped the answer; the sections would parse
  # but the demand would carry stray backticks into the permanent record.
  if printf '%s\n' "${body}" | grep -q '```'; then
    printf 'contains_code_fence\n' >&2
    return 1
  fi

  for sec in Goal Targets Acceptance Briefing; do
    printf '%s\n' "${body}" | grep -qE "^## ${sec}[[:space:]]*$" || {
      printf 'missing_section:%s\n' "${sec}" >&2
      return 1
    }
  done

  local targets acc briefing
  targets="$(aegis_briefing_section Targets "${body}")"
  acc="$(aegis_briefing_section Acceptance "${body}")"
  briefing="$(aegis_briefing_section Briefing "${body}")"

  [[ -n "${targets}" ]] || {
    printf 'empty_targets\n' >&2
    return 1
  }
  [[ -n "${briefing}" ]] || {
    printf 'empty_briefing\n' >&2
    return 1
  }
  [[ -n "${acc}" ]] || {
    printf 'empty_acceptance\n' >&2
    return 1
  }

  # Every target must be a relative path, never absolute and never escaping.
  while IFS= read -r line; do
    [[ -n "${line}" ]] || continue
    line="$(printf '%s' "${line}" | sed -E 's/^[[:space:]]*-[[:space:]]*//')"
    [[ -n "${line}" ]] || continue
    case "${line}" in
      /*|*..*|*' '*)
        printf 'bad_target:%s\n' "${line}" >&2
        return 1
        ;;
    esac
  done <<< "${targets}"

  # Acceptance must be bare identifiers. A prose line here is what makes
  # fit_check throw the list away and rebuild it by grepping the Goal — the
  # exact path that put maxBytes into the contract.
  while IFS= read -r line; do
    [[ -n "${line}" ]] || continue
    ident="$(printf '%s' "${line}" | sed -E 's/^[[:space:]]*-[[:space:]]*//; s/[[:space:]]*$//')"
    [[ -n "${ident}" ]] || continue
    if ! printf '%s' "${ident}" | grep -qE '^[A-Za-z_][A-Za-z0-9_]*$'; then
      printf 'acceptance_not_identifier:%s\n' "${ident}" >&2
      return 1
    fi
    # The supervisor's own Briefing has to export what it claims is public.
    # This is the check that would have caught issue #65 at generation time.
    if ! printf '%s\n' "${briefing}" \
      | grep -qE "export[[:space:]]+(async[[:space:]]+)?(function|const|class|type|interface|enum)[[:space:]]+${ident}\\b|export[[:space:]]*\\{[^}]*\\b${ident}\\b"; then
      printf 'acceptance_not_exported_in_briefing:%s\n' "${ident}" >&2
      return 1
    fi
  done <<< "${acc}"

  return 0
}

# Body of one "## Section" up to the next "## ".
aegis_briefing_section() {
  local name="${1-}"
  local text="${2-}"
  printf '%s\n' "${text}" \
    | awk -v s="## ${name}" '
        $0 == s { p = 1; next }
        /^## / { p = 0 }
        p { print }
      ' \
    | sed -E '/^[[:space:]]*$/d'
}

# Prints the structured demand on success; prints nothing and returns 1
# whenever the caller should fall back to the mechanical body.
aegis_briefing_generate() {
  local goal="${1-}"
  local target="${2-}"

  [[ -n "${goal}" ]] || return 1

  local api_base api_key model timeout
  api_base="${OPENAI_API_BASE:-https://integrate.api.nvidia.com/v1}"
  api_key="${OPENAI_API_KEY:-${NVIDIA_API_KEY:-}}"
  model="${AEGIS_SUPERVISOR_MODEL:-${OPENAI_MODEL_MUTATION:-${AEGIS_MUTATION_MODEL:-meta/llama-3.1-8b-instruct}}}"
  timeout="${AEGIS_BRIEFING_TIMEOUT_SEC:-90}"

  local req_file resp_file
  req_file="$(mktemp "${TMPDIR:-/tmp}/aegis_briefing_req.XXXXXX")" || return 1
  resp_file="$(mktemp "${TMPDIR:-/tmp}/aegis_briefing_resp.XXXXXX")" || {
    rm -f "${req_file}"
    return 1
  }

  jq -n \
    --arg model "${model}" \
    --arg sys "$(aegis_briefing_system_prompt)" \
    --arg goal "${goal}" \
    --arg target "${target}" \
    '{
      model: $model,
      messages: [
        {role: "system", content: $sys},
        {role: "user", content: ("Demand: " + $goal + "\nSuggested targets: " + $target)}
      ],
      temperature: 0.1,
      max_tokens: 900
    }' > "${req_file}" 2>/dev/null || {
    rm -f "${req_file}" "${resp_file}"
    return 1
  }

  # Measured provider throughput swings between 0.8 and 33 tok/s on identical
  # payloads, so an unbounded call can stall the run before any work starts.
  curl --silent --show-error \
    --connect-timeout 5 \
    --max-time "${timeout}" \
    -X POST "${api_base%/}/chat/completions" \
    -H "Authorization: Bearer ${api_key}" \
    -H "Content-Type: application/json" \
    --data @"${req_file}" > "${resp_file}" 2>/dev/null || true

  rm -f "${req_file}"

  local content
  content="$(jq -r '.choices[0].message.content // empty' "${resp_file}" 2>/dev/null || true)"
  rm -f "${resp_file}"

  [[ -n "${content}" ]] || return 1

  # Trim anything the model emitted before the first section.
  content="$(printf '%s\n' "${content}" | awk '/^## Goal[[:space:]]*$/ {p=1} p')"

  aegis_briefing_validate "${content}" || return 1

  printf '%s' "${content}"
  return 0
}

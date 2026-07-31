#!/usr/bin/env bash

# =========================================================
# AEGIS — BRIEFING PRE-PASS (supervisor structures the demand)
# =========================================================
#
# A goal written as free prose makes the CLI derive Acceptance by grepping
# identifiers out of it, which pulls constructor parameters and private
# fields into the promotion contract. Issue #65 died that way: six acceptance
# tokens, four of them internal, one — timeDiff*rateBitsPerMs — not even a
# valid identifier.
#
# The supervisor fills a JSON schema; the markdown is rendered here. Asking a
# small model for markdown was measured at 2 accepted answers out of 5, with
# invented syntax (`method(refill(): void: ...)`), constructors used as type
# names (`_tokens: BigInt`), unrequested extra exports and a missing barrel
# block. The same model filling fields scored 6 out of 6 in 3-4s, because the
# failures it used to make are no longer expressible:
#
#   - sections cannot be missing or fenced: this file writes them
#   - Acceptance is DERIVED from the exports list, so an acceptance token that
#     the Briefing does not export is not a check, it is an impossibility
#   - types are fields, so `BigInt` used as a type is mechanically rejectable
#
# What the schema still cannot catch is logic (a call with a missing
# argument). That is what typescript.check and the inner fix loop are for —
# and they now start from a well-formed briefing instead of invented syntax.
#
# Advisory: any failure falls back to the mechanical render_body and the run
# behaves exactly as it does today.
#
# Env:
#   AEGIS_BRIEFING=0                disable the pre-pass entirely
#   AEGIS_SUPERVISOR_MODEL          default meta/llama-3.1-8b-instruct — the
#                                   coder model is NOT inherited on purpose
#   AEGIS_BRIEFING_TIMEOUT_SEC      default 90 (wall clock for the call)
#   AEGIS_BRIEFING_MAX_EXPORTS      default 2
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

# Deliberately NOT the mutation model. Filling this schema is a small,
# highly constrained task: the 8B scored 4 of 4 end-to-end across unrelated
# demands at 3-4s a call, while the 70B took 100-120s to make the same
# BigInt-as-a-type mistake. Inheriting OPENAI_MODEL_MUTATION would silently
# put whatever the coder uses in front of every run.
aegis_briefing_model() {
  printf '%s' "${AEGIS_SUPERVISOR_MODEL:-meta/llama-3.1-8b-instruct}"
}

aegis_briefing_max_exports() {
  local n="${AEGIS_BRIEFING_MAX_EXPORTS:-2}"
  [[ "${n}" =~ ^[0-9]+$ ]] && [[ "${n}" -gt 0 ]] || n=2
  printf '%s' "${n}"
}

# The schema doubles as the instruction: a worked example constrains a weak
# model far better than a list of prose rules.
aegis_briefing_system_prompt() {
  cat <<PROMPT
You convert a software demand into JSON. Output ONLY a JSON object, no prose.

Schema:
{
  "goal": "one short sentence naming the files to create; no parameter or field names",
  "targets": ["src/thing.ts", "src/index.ts"],
  "exports": [
    {
      "kind": "class",
      "name": "PascalCaseName",
      "privateFields": [{"name": "_x", "type": "bigint"}],
      "ctorParams": [{"name": "arg", "type": "bigint"}],
      "ctorBody": ["this._x = arg"],
      "methods": [{"name": "consume", "params": [{"name": "bits", "type": "bigint"}], "returns": "boolean", "body": ["if (this._x >= bits) { this._x -= bits; return true }", "return false"]}],
      "getters": [{"name": "value", "returns": "bigint", "body": "return this._x"}]
    },
    {
      "kind": "function",
      "name": "camelCaseName",
      "params": [{"name": "b", "type": "PascalCaseName"}],
      "returns": "number",
      "body": ["let mask = 0", "if (b.value === 0n) mask |= 1", "return mask"]
    }
  ],
  "barrelFile": "src/index.ts",
  "barrelFrom": "./thing.js"
}

Rules:
- TypeScript type names are lowercase: bigint, number, string, boolean. NEVER BigInt, Number, String, Boolean — those are constructors, not types.
- Every "body" entry is one complete line of TypeScript. Write formulas as code (mbps * 8000), bitwise operations explicitly (mask |= 1), conditionals inline (if (c) { a } else { b }).
- "name" is always a plain identifier: letters and digits only, no dots, no parentheses, no spaces.
- Emit at most $(aegis_briefing_max_exports) entries in "exports". Do not invent helpers that were not asked for.
- Private field names start with an underscore and appear ONLY in privateFields, never in "exports".
- "barrelFrom" is a relative specifier ending in .js (NodeNext), pointing at the module you defined.
PROMPT
}

# Field-level gate. Prints the reason to stderr on rejection.
aegis_briefing_validate_json() {
  local json="${1-}"
  local max reason

  printf '%s' "${json}" | jq -e . >/dev/null 2>&1 || {
    printf 'invalid_json\n' >&2
    return 1
  }
  max="$(aegis_briefing_max_exports)"

  reason="$(
    printf '%s' "${json}" | jq -r --argjson max "${max}" '
      def bad_type:
        . as $t
        | ["BigInt","Number","String","Boolean","Object","Array","Symbol"]
        | index($t);
      def ident: test("^[A-Za-z_][A-Za-z0-9_]*$");
      def rel_path: (startswith("/") | not) and (contains("..") | not) and (contains(" ") | not);
      [
        (if ((.goal // "") | length) == 0 then "empty_goal" else empty end),
        (if ((.targets // []) | length) == 0 then "empty_targets" else empty end),
        (if ((.exports // []) | length) == 0 then "empty_exports" else empty end),
        (if ((.exports // []) | length) > $max then "too_many_exports" else empty end),
        ((.targets // [])[]? | select((type != "string") or (rel_path | not)) | "bad_target:\(.)"),
        ((.exports // [])[]? | select(((.name // "") | ident) | not) | "name_not_identifier:\(.name)"),
        ((.exports // [])[]? | select((.name // "") | startswith("_")) | "private_as_export:\(.name)"),
        ((.exports // [])[]? | select((.kind // "") | (. == "class" or . == "function") | not) | "bad_kind:\(.kind)"),
        ((.exports // [])[]? | (.privateFields // [])[]? | select((.type // "") | bad_type) | "constructor_used_as_type:\(.type)"),
        ((.exports // [])[]? | (.ctorParams // [])[]? | select((.type // "") | bad_type) | "constructor_used_as_type:\(.type)"),
        ((.exports // [])[]? | (.params // [])[]? | select((.type // "") | bad_type) | "constructor_used_as_type:\(.type)"),
        ((.exports // [])[]? | (.methods // [])[]? | (.params // [])[]? | select((.type // "") | bad_type) | "constructor_used_as_type:\(.type)"),
        ((.exports // [])[]? | (.methods // [])[]? | select(((.name // "") | ident) | not) | "method_not_identifier:\(.name)"),
        (if ((.barrelFrom // "") | length) > 0 and ((.barrelFrom // "") | endswith(".js") | not)
           then "barrel_not_nodenext:\(.barrelFrom)" else empty end)
      ] | first // ""
    ' 2>/dev/null || true
  )"

  if [[ -n "${reason}" ]]; then
    printf '%s\n' "${reason}" >&2
    return 1
  fi
  return 0
}

# Deterministic markdown. Acceptance is the export list, so it cannot name
# something the Briefing does not export.
aegis_briefing_render() {
  local json="${1-}"
  printf '%s' "${json}" | jq -r '
    def params($p): (($p // []) | map(.name + ": " + .type) | join(", "));
    def lines($l; $pad): (($l // []) | map($pad + .) | join("\n"));

    "## Goal",
    (.goal // ""),
    "",
    "## Targets",
    (((.targets // []) | map("- " + .)) | join("\n")),
    "",
    "## Acceptance",
    (((.exports // []) | map("- " + .name)) | join("\n")),
    "",
    "## Briefing",
    (((.exports // []) | to_entries | map(
      (.key + 1 | tostring) as $n
      | .value as $e
      | if $e.kind == "class" then
          $n + ") export class " + $e.name + ":"
          + (if (($e.privateFields // []) | length) > 0
               then "\n   Campos privados: " + (($e.privateFields | map(.name + ": " + .type)) | join(", "))
               else "" end)
          + "\n   constructor(" + params($e.ctorParams) + "):\n" + lines($e.ctorBody; "     ")
          + (if (($e.methods // []) | length) > 0
               then "\n" + (($e.methods | map(
                      "   " + .name + "(" + params(.params) + "): " + (.returns // "void") + ":\n"
                      + lines(.body; "     ")
                    )) | join("\n"))
               else "" end)
          + (if (($e.getters // []) | length) > 0
               then "\n" + (($e.getters | map(
                      "   get " + .name + "(): " + (.returns // "unknown") + " { " + (.body // "") + " }"
                    )) | join("\n"))
               else "" end)
        else
          $n + ") export function " + $e.name + "(" + params($e.params) + "): " + ($e.returns // "void") + ":\n"
          + lines($e.body; "     ")
        end
    )) | join("\n\n")),
    "",
    ("Em " + (.barrelFile // "src/index.ts") + ":"),
    ("   import { " + (((.exports // []) | map(.name)) | join(", ")) + " } from " + "'"'"'" + (.barrelFrom // "./mod.js") + "'"'"'"),
    ("   export { " + (((.exports // []) | map(.name)) | join(", ")) + " }"),
    "",
    "## Out of scope",
    "- unrelated files",
    "- e2e tests",
    "- drive-by refactors",
    "",
    "## Constraints",
    "- no any / as any / @ts-ignore",
    "- NodeNext: .js extension in relative imports",
    "- only packages in package.json; builtins are global"
  '
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
  model="$(aegis_briefing_model)"
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
        {role: "user", content: ("Demand: " + $goal + "\nTargets: " + $target)}
      ],
      temperature: 0.1,
      max_tokens: 1100,
      response_format: {type: "json_object"}
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

  [[ -n "${content}" ]] || {
    printf 'empty_response\n' >&2
    return 1
  }

  # Some providers still wrap JSON in a fence even in json_object mode.
  content="$(
    printf '%s' "${content}" \
      | sed -E 's/^[[:space:]]*```[a-zA-Z]*[[:space:]]*//; s/```[[:space:]]*$//'
  )"

  aegis_briefing_validate_json "${content}" || return 1

  local body
  body="$(aegis_briefing_render "${content}" 2>/dev/null || true)"
  [[ -n "${body}" ]] || {
    printf 'render_failed\n' >&2
    return 1
  }

  printf '%s' "${body}"
  return 0
}

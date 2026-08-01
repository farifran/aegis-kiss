#!/usr/bin/env bash

# =========================================================
# AEGIS — BRIEFING PRE-PASS (supervisor structures the demand)
# =========================================================
#
# Three layers (do not mix):
#
#   1. SCHEMA   JSON shape — field names, kinds, idents, path syntax.
#               Owner: worked example + aegis_briefing_validate_json.
#   2. RULES    Universal TS/runtime laws (any demand). NEVER BigInt-as-type,
#               NEVER Math.min/max/floor on bigint, getters vs private fields.
#               Owner: prompt Rules + validate + aegis_briefing_stable_constraints
#               (always injected into ## Constraints, independent of the LLM).
#   3. BRIEFING Demand-specific physics — mbps*8000, time delta, bitmask bits.
#               Owner: supervisor expand → exports[].body / ctorBody only.
#               Acceptance is DERIVED from exports names (never params/fields).
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
#   - Math.min/max/floor on bigint bodies is mechanically rejectable
#
# What the schema still cannot catch is full demand logic (wrong formula).
# That is the Briefing layer + typescript.check / fix loop.
#
# Advisory: any failure falls back to the mechanical render_body and the run
# behaves exactly as it does today.
#
# Env:
#   AEGIS_BRIEFING=0                disable the pre-pass entirely
#   AEGIS_SUPERVISOR_MODEL          default z-ai/glm-5.2 — the
#                                   coder model is NOT inherited on purpose
#   AEGIS_BRIEFING_TIMEOUT_SEC      default 90 (wall clock for the call)
#   AEGIS_BRIEFING_MAX_EXPORTS      default 2
#   AEGIS_SUPERVISOR_SPLIT=0        disable LLM multi-unit split (mechanical only)
#   AEGIS_SUPERVISOR_SPLIT_MAX_UNITS  default 4
#   OPENAI_API_BASE / OPENAI_API_KEY
#
# Also: aegis_supervisor_split_* — when fit blocks a monster demand, the same
# supervisor model may partition it into micro units (intent + export load),
# each with its own Acceptance/Briefing. Mechanical path-split remains the
# fallback; multi-export Briefing prefers offline export_slice.
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
  printf '%s' "${AEGIS_SUPERVISOR_MODEL:-z-ai/glm-5.2}"
}

aegis_briefing_max_exports() {
  local n="${AEGIS_BRIEFING_MAX_EXPORTS:-2}"
  [[ "${n}" =~ ^[0-9]+$ ]] && [[ "${n}" -gt 0 ]] || n=2
  printf '%s' "${n}"
}

# Layer-2 RULES as markdown bullets for ## Constraints.
# Always injected by render/unit builders — never depends on the LLM remembering them.
aegis_briefing_stable_constraints() {
  cat <<'EOF'
- no any / as any / @ts-ignore
- NodeNext: .js extension in relative imports
- only packages in package.json; builtins are global
- TypeScript types are lowercase (bigint, number, string, boolean) — never BigInt/Number/String/Boolean as types; BigInt(x) as a call is OK
- NEVER Math.min/Math.max/Math.floor/Math.ceil on bigint values — clamp with if (x > max) { x = max }; use BigInt(Date.now()) for time
- Outside a class, never read private fields (_name) — expose getters and use those in helpers
- Private fields start with underscore and are not Acceptance exports
- BigInt is global when high-precision time is required
- Prefer one top-level export per micro unit; methods on a class are fine
- Rate/token refill: compute timeDiff; only add tokens if timeDiff > 0 (or > 0n for bigint); update last-time only when you refill
- If a refill-active / refil flag exists: set it after update as tokens < maxTokens (never leave it stuck true forever)
EOF
}

# Soft rewrite of common bigint Math antipatterns in body lines (layer-2).
# Returns rewritten JSON on stdout. Idempotent; leaves non-matching lines alone.
aegis_briefing_sanitize_json() {
  local json="${1-}"
  # 1) Math.min/max on bigint → clamp ternaries
  json="$(
    printf '%s' "${json}" | jq -c '
      def rewrite_line:
        . as $s
        | if ($s | type) != "string" then $s
          elif ($s | test("Math\\.(min|max)\\([^)]*\\)"))
               and ($s | test("bigint|BigInt|[0-9]+n|\\bn\\b|_tokens|_max|maxTokens")) then
            ($s
              | gsub("Math\\.min\\((?<a>[^,()]+),[[:space:]]*(?<b>[^)]+)\\)";
                     "(((\(.a)) < (\(.b))) ? (\(.a)) : (\(.b)))")
              | gsub("Math\\.max\\((?<a>[^,()]+),[[:space:]]*(?<b>[^)]+)\\)";
                     "(((\(.a)) > (\(.b))) ? (\(.a)) : (\(.b)))")
            )
          else $s end;
      def map_bodies:
        if type != "object" then .
        else
          .ctorBody = ((.ctorBody // []) | map(rewrite_line))
          | .body = ((.body // []) | map(rewrite_line))
          | .methods = ((.methods // []) | map(
              .body = ((.body // []) | map(rewrite_line))
            ))
          | .getters = ((.getters // []) | map(
              if (.body | type) == "string" then .body = (.body | rewrite_line) else . end
            ))
        end;
      .exports = ((.exports // []) | map(map_bodies))
    ' 2>/dev/null || printf '%s' "${json}"
  )"
  # 2) Rate-limit quality: ensure update() sets refillActive when the field exists.
  #    Does not invent timeDiff branches (those stay in the worked example / Rules).
  json="$(
    printf '%s' "${json}" | jq -c '
      def field_names:
        [(.privateFields // [])[]?.name | select(type=="string")];
      def pick($names; $re):
        ([$names[] | select(test($re; "i"))][0] // null);
      .exports = ((.exports // []) | map(
        if (.kind // "") != "class" then .
        else
          (field_names) as $names
          | pick($names; "refillActive|refill_active|_refill") as $refill
          | pick($names; "maxTokens|_maxTokens|_max\\b") as $max
          | pick($names; "^_tokens$|_tokens$") as $tok
          | if $refill == null or $max == null or $tok == null then .
            else
              .methods = ((.methods // []) | map(
                if (.name // "") != "update" then .
                else
                  ((.body // []) | map(tostring) | join("\n")) as $joined
                  | if ($joined | test($refill)) then .
                    else
                      .body = ((.body // []) + [
                        ("this." + $refill + " = this." + $tok + " < this." + $max)
                      ])
                    end
                end
              ))
            end
        end
      ))
    ' 2>/dev/null || printf '%s' "${json}"
  )"
  printf '%s' "${json}"
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
      "privateFields": [
        {"name": "_tokens", "type": "bigint"},
        {"name": "_maxTokens", "type": "bigint"},
        {"name": "_lastUpdate", "type": "bigint"},
        {"name": "_refillActive", "type": "boolean"}
      ],
      "ctorParams": [{"name": "maxTokens", "type": "bigint"}],
      "ctorBody": ["this._maxTokens = maxTokens", "this._tokens = maxTokens", "this._lastUpdate = BigInt(Date.now())", "this._refillActive = false"],
      "methods": [
        {
          "name": "update",
          "params": [],
          "returns": "void",
          "body": [
            "const now = BigInt(Date.now())",
            "const timeDiff = now - this._lastUpdate",
            "if (timeDiff > 0n) { this._tokens += timeDiff; this._lastUpdate = now }",
            "if (this._tokens > this._maxTokens) { this._tokens = this._maxTokens }",
            "this._refillActive = this._tokens < this._maxTokens"
          ]
        },
        {
          "name": "consume",
          "params": [{"name": "bits", "type": "bigint"}],
          "returns": "boolean",
          "body": ["this.update()", "if (this._tokens >= bits) { this._tokens -= bits; return true }", "return false"]
        }
      ],
      "getters": [
        {"name": "tokens", "returns": "bigint", "body": "return this._tokens"},
        {"name": "refillActive", "returns": "boolean", "body": "return this._refillActive"}
      ]
    },
    {
      "kind": "function",
      "name": "camelCaseName",
      "params": [{"name": "b", "type": "PascalCaseName"}],
      "returns": "number",
      "body": ["let mask = 0", "if (b.tokens === 0n) mask |= 1", "if (b.refillActive) mask |= 2", "return mask"]
    }
  ],
  "barrelFile": "src/index.ts",
  "barrelFrom": "./thing.js"
}

Rules:
- TypeScript type names are lowercase: bigint, number, string, boolean. NEVER BigInt, Number, String, Boolean as types — those are constructors (BigInt(x) as a call is OK).
- Every "body" entry is one complete line of TypeScript. Write formulas as code (mbps * 8000), bitwise operations explicitly (mask |= 1), conditionals inline (if (c) { a } else { b }).
- NEVER use Math.min/Math.max/Math.floor with bigint values — clamp with if (x > max) { x = max }. Use BigInt(Date.now()) not Math with bigint. Math.floor on number then BigInt(...) is OK.
- Outside a class, NEVER read private fields (_tokens, _refillActive). Expose getters (get tokens(), get refillActive()) and use those in helper functions.
- Elapsed-time refill (token bucket / rate limiter): compute timeDiff from now - lastUpdate; ONLY add tokens when timeDiff > 0 (or > 0n if bigint). Update lastUpdate only inside that branch (or when you actually refill).
- If the demand has a refill-active / refil flag (bitmask bit, boolean): after update/clamp set this._refillActive = this._tokens < this._maxTokens (or equivalent). Do NOT leave the flag stuck true from the constructor forever.
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
      # Math.min/max on bigint is the monstro that broke tsc; Math.floor(number)
      # then BigInt(...) is legitimate — do not reject floor/ceil wholesale.
      def has_math_minmax: test("Math\\.(min|max)\\(");
      def has_bigint_signal: test("bigint|BigInt|[0-9]+n|0n|1n|_tokens|_maxTokens|maxTokens");
      def body_lines:
        [
          (.ctorBody // [])[],
          ((.methods // [])[]? | (.body // [])[]),
          ((.getters // [])[]? | select((.body | type) == "string") | .body),
          ((.body // [])[])
        ];
      def export_types:
        [
          (.privateFields // [])[]?.type,
          (.ctorParams // [])[]?.type,
          (.params // [])[]?.type,
          ((.methods // [])[]? | (.params // [])[]?.type),
          ((.methods // [])[]? | .returns),
          ((.getters // [])[]? | .returns),
          .returns
        ];
      def export_uses_bigint:
        ((export_types | map(select(. != null and (. == "bigint" or . == "BigInt"))) | length) > 0)
        or ((body_lines | map(select(type == "string" and has_bigint_signal)) | length) > 0);
      def export_math_on_bigint:
        export_uses_bigint
        and ((body_lines | map(select(type == "string" and has_math_minmax)) | length) > 0);
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
        ((.exports // [])[]? | select(export_math_on_bigint) | "math_on_bigint:\(.name)"),
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
# something the Briefing does not export. Constraints always include layer-2 RULES.
aegis_briefing_render() {
  local json="${1-}"
  local stable_c
  stable_c="$(aegis_briefing_stable_constraints)"
  printf '%s' "${json}" | jq -r --arg constraints "${stable_c}" '
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
    $constraints
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

  # Token accounting for supervisor expand (intake; AEGIS_METRICS_FILE may be unset).
  local _pt _ct _metrics
  _pt="$(jq -r '.usage.prompt_tokens // 0' "${resp_file}" 2>/dev/null || printf '0')"
  _ct="$(jq -r '.usage.completion_tokens // 0' "${resp_file}" 2>/dev/null || printf '0')"
  _metrics="${AEGIS_METRICS_FILE:-${AEGIS_ROOT_DIR:-.}/.harness/runtime/pipeline_metrics.jsonl}"
  if [[ -n "${_metrics}" ]]; then
    mkdir -p "$(dirname "${_metrics}")" 2>/dev/null || true
    jq -cn \
      --arg model "${model}" \
      --argjson prompt_tokens "${_pt:-0}" \
      --argjson completion_tokens "${_ct:-0}" \
      '{kind:"tokens",mode:"intake",substrate:"supervisor_expand",model:$model,
        prompt_tokens:$prompt_tokens,completion_tokens:$completion_tokens,
        total_tokens:($prompt_tokens+$completion_tokens)}' \
      >> "${_metrics}" 2>/dev/null || true
    # Also emit a human line for CLI capture.
    printf '[AEGIS][TOKENS] supervisor_expand model=%s prompt=%s completion=%s total=%s\n' \
      "${model}" "${_pt:-0}" "${_ct:-0}" "$(( ${_pt:-0} + ${_ct:-0} ))" >&2 || true
  fi

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

  # Layer-2 soft rewrite then hard validate (Math.min+bigint, BigInt-as-type, …).
  content="$(aegis_briefing_sanitize_json "${content}")"
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

# ---------------------------------------------------------
# Supervisor SPLIT — monster demand → N micro units (8B)
# ---------------------------------------------------------

aegis_supervisor_split_enabled() {
  case "${AEGIS_SUPERVISOR_SPLIT:-1}" in
    0|false|no) return 1 ;;
  esac
  aegis_briefing_enabled
}

aegis_supervisor_split_max_units() {
  local n="${AEGIS_SUPERVISOR_SPLIT_MAX_UNITS:-4}"
  [[ "${n}" =~ ^[0-9]+$ ]] && [[ "${n}" -gt 1 ]] || n=4
  printf '%s' "${n}"
}

aegis_supervisor_split_system_prompt() {
  local max_u max_e
  max_u="$(aegis_supervisor_split_max_units)"
  max_e="$(aegis_briefing_max_exports)"
  cat <<PROMPT
You split a software demand that is too large for one weak-model run into ordered micro units.

Output ONLY a JSON object, no prose:
{
  "units": [
    {
      "title": "short title",
      "targets": ["src/oneFile.ts"],
      "depends_on": [],
      "kind": "create",
      "exports": [
        {
          "kind": "class",
          "name": "PascalCaseName",
          "privateFields": [{"name": "_x", "type": "bigint"}],
          "ctorParams": [{"name": "arg", "type": "bigint"}],
          "ctorBody": ["this._x = arg"],
          "methods": [{"name": "m", "params": [], "returns": "void", "body": ["return"]}],
          "getters": []
        }
      ]
    },
    {
      "title": "reexport only",
      "targets": ["src/index.ts"],
      "depends_on": [1],
      "kind": "reexport",
      "reexport_names": ["PascalCaseName"],
      "barrelFrom": "./oneFile.js"
    }
  ]
}

Rules:
- 2 to ${max_u} units. Prefer fewer units when possible.
- Exactly ONE path in each unit's "targets".
- kind is "create" or "reexport" only.
- create units: EXACTLY 1 entry in "exports" (one top-level export class OR function per unit). Methods stay inside the class — never as separate exports. If the demand has class + helper function, emit two create units on the same path (class first, then function), then reexport.
- reexport units: exports must be [] ; set reexport_names + barrelFrom (relative .js NodeNext).
- depends_on: 1-based unit indexes that must finish first (empty array if none).
- Order units so dependencies come first (create module before reexport).
- TypeScript types are lowercase: bigint, number, string, boolean — NEVER BigInt/Number as types.
- Do not invent files or features absent from the demand. targets must be paths already named in the demand (or src/index.ts for reexport when the demand asks to re-export).
- One intent per unit: e.g. class in file A, then helper export, then barrel — not everything in one unit.
- Private fields start with underscore and appear only in privateFields.
PROMPT
}

# Paths the parent demand already authorizes (## Targets + path-like tokens).
aegis_supervisor_split_allowed_paths() {
  local parent="${1-}"
  {
    printf '%s\n' "${parent}" \
      | awk '/^## Targets[[:space:]]*$/ { p = 1; next } /^## / { p = 0 } p' \
      | sed -E 's/^[[:space:]]*-[[:space:]]*//; s/[[:space:]]*$//' \
      | grep -v '^$' || true
    printf '%s\n' "${parent}" \
      | grep -oE 'src/[A-Za-z0-9_./-]+\.[a-z]+' || true
  } | awk 'NF && !seen[$0]++'
}

# Validate supervisor split JSON. Prints reason on stderr on failure.
# Args: json, parent_demand
aegis_supervisor_split_validate_json() {
  local json="${1-}"
  local parent="${2-}"
  local max_u max_e n i kind title target n_exp n_rx barrel name typ dep
  local -a allow_paths=()

  printf '%s' "${json}" | jq -e 'type == "object"' >/dev/null 2>&1 || {
    printf 'invalid_json\n' >&2
    return 1
  }
  printf '%s' "${json}" | jq -e '.units | type == "array"' >/dev/null 2>&1 || {
    printf 'missing_units\n' >&2
    return 1
  }

  max_u="$(aegis_supervisor_split_max_units)"
  max_e="$(aegis_briefing_max_exports)"
  n="$(printf '%s' "${json}" | jq '.units | length')"
  if [[ "${n}" -lt 2 ]]; then
    printf 'too_few_units\n' >&2
    return 1
  fi
  if [[ "${n}" -gt "${max_u}" ]]; then
    printf 'too_many_units\n' >&2
    return 1
  fi

  while IFS= read -r target; do
    [[ -n "${target}" ]] && allow_paths+=("${target}")
  done < <(aegis_supervisor_split_allowed_paths "${parent}")

  path_allowed() {
    local p="${1-}" a
    [[ "${p}" == "src/index.ts" ]] && return 0
    [[ "${p}" == /* || "${p}" == *..* || -z "${p}" ]] && return 1
    for a in "${allow_paths[@]+"${allow_paths[@]}"}"; do
      [[ "${a}" == "${p}" ]] && return 0
    done
    return 1
  }

  for ((i = 0; i < n; i++)); do
    title="$(printf '%s' "${json}" | jq -r --argjson i "${i}" '.units[$i].title // empty')"
    [[ -n "${title}" ]] || {
      printf 'empty_title:%s\n' "${i}" >&2
      return 1
    }

    # Coerce multi-target units to the first allowed path (8B often lists
    # module+index on one unit). Quality intake still keeps reexport separate.
    local n_targets
    n_targets="$(printf '%s' "${json}" | jq --argjson i "${i}" '(.units[$i].targets // []) | length')"
    if [[ "${n_targets}" -lt 1 ]]; then
      printf 'targets_not_one:%s\n' "${i}" >&2
      return 1
    fi
    if [[ "${n_targets}" -gt 1 ]]; then
      json="$(
        printf '%s' "${json}" | jq -c --argjson i "${i}" '
          .units[$i].targets = [(.units[$i].targets // [])[0]]
        '
      )"
    fi
    target="$(printf '%s' "${json}" | jq -r --argjson i "${i}" '.units[$i].targets[0] // empty')"
    path_allowed "${target}" || {
      printf 'bad_target:%s:%s\n' "${i}" "${target}" >&2
      return 1
    }

    kind="$(printf '%s' "${json}" | jq -r --argjson i "${i}" '.units[$i].kind // empty')"
    case "${kind}" in
      create|reexport) ;;
      *)
        printf 'bad_kind:%s\n' "${i}" >&2
        return 1
        ;;
    esac

    n_exp="$(printf '%s' "${json}" | jq --argjson i "${i}" '(.units[$i].exports // []) | length')"
    if [[ "${kind}" == "create" ]]; then
      [[ "${n_exp}" -ge 1 ]] || {
        printf 'create_no_exports:%s\n' "${i}" >&2
        return 1
      }
      # One top-level export per create unit (8B merges multi-export into methods).
      # Parent max_e still caps expand; split is stricter.
      if [[ "${n_exp}" -gt 1 ]]; then
        printf 'create_too_many_exports:%s\n' "${i}" >&2
        return 1
      fi
      [[ "${n_exp}" -le "${max_e}" ]] || {
        printf 'create_too_many_exports:%s\n' "${i}" >&2
        return 1
      }
    else
      [[ "${n_exp}" -eq 0 ]] || {
        printf 'reexport_has_exports:%s\n' "${i}" >&2
        return 1
      }
      n_rx="$(printf '%s' "${json}" | jq --argjson i "${i}" '(.units[$i].reexport_names // []) | length')"
      [[ "${n_rx}" -ge 1 ]] || {
        printf 'reexport_no_names:%s\n' "${i}" >&2
        return 1
      }
      barrel="$(printf '%s' "${json}" | jq -r --argjson i "${i}" '.units[$i].barrelFrom // empty')"
      [[ "${barrel}" == *.js ]] || {
        printf 'barrel_not_nodenext:%s\n' "${i}" >&2
        return 1
      }
    fi

    while IFS= read -r dep; do
      [[ -n "${dep}" ]] || continue
      [[ "${dep}" =~ ^[0-9]+$ ]] || {
        printf 'bad_depends:%s\n' "${i}" >&2
        return 1
      }
      if [[ "${dep}" -lt 1 || "${dep}" -gt "${n}" || "${dep}" -eq $((i + 1)) ]]; then
        printf 'depends_oob:%s\n' "${i}" >&2
        return 1
      fi
    done < <(printf '%s' "${json}" | jq -r --argjson i "${i}" '
      (.units[$i].depends_on // [])
      | map(if type == "string" then tonumber else . end)
      | .[]
    ')

    while IFS= read -r name; do
      [[ -n "${name}" ]] || continue
      [[ "${name}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || {
        printf 'name_not_identifier:%s\n' "${name}" >&2
        return 1
      }
      [[ "${name}" != _* ]] || {
        printf 'private_as_export:%s\n' "${name}" >&2
        return 1
      }
    done < <(printf '%s' "${json}" | jq -r --argjson i "${i}" '(.units[$i].exports // [])[]?.name // empty')

    while IFS= read -r name; do
      [[ -n "${name}" ]] || continue
      case "${name}" in
        class|function) ;;
        *)
          printf 'bad_export_kind:%s\n' "${name}" >&2
          return 1
          ;;
      esac
    done < <(printf '%s' "${json}" | jq -r --argjson i "${i}" '(.units[$i].exports // [])[]?.kind // empty')

    while IFS= read -r typ; do
      [[ -n "${typ}" ]] || continue
      case "${typ}" in
        BigInt|Number|String|Boolean|Object|Array|Symbol)
          printf 'constructor_used_as_type:%s\n' "${typ}" >&2
          return 1
          ;;
      esac
    done < <(printf '%s' "${json}" | jq -r --argjson i "${i}" '
      [.units[$i].exports[]?
        | (.privateFields[]?.type, .ctorParams[]?.type, .params[]?.type,
           .methods[]?.params[]?.type)]
      | .[]
    ' 2>/dev/null || true)
  done

  return 0
}

# Render one unit object to micro demand markdown.
# Args: unit_json_object (single), unit_index_0based, unit_total, parent_demand
aegis_supervisor_unit_render() {
  local unit_json="${1-}"
  local idx="${2-0}"
  local total="${3-1}"
  local parent="${4-}"
  local kind title primary siblings oos exports_block briefing_block acc_block

  kind="$(printf '%s' "${unit_json}" | jq -r '.kind // "create"')"
  title="$(printf '%s' "${unit_json}" | jq -r '.title // "unit"')"
  primary="$(printf '%s' "${unit_json}" | jq -r '.targets[0] // "src/index.ts"')"

  siblings="$(
    printf '%s\n' "${parent}" \
      | grep -oE 'src/[A-Za-z0-9_./-]+\.[a-z]+' 2>/dev/null \
      | awk -v p="${primary}" 'NF && $0 != p && !seen[$0]++' \
      | head -n 6 || true
  )"
  oos="$(
    {
      printf '%s\n' "other source files"
      printf '%s\n' "e2e tests"
      printf '%s\n' "drive-by refactors"
      printf '%s\n' "multi-file stacks"
      printf '%s\n' "${siblings}"
    } | awk 'NF { print "- " $0 }'
  )"

  if [[ "${kind}" == "reexport" ]]; then
    local names barrel from_list
    names="$(printf '%s' "${unit_json}" | jq -r '(.reexport_names // []) | join(", ")')"
    barrel="$(printf '%s' "${unit_json}" | jq -r '.barrelFrom // "./mod.js"')"
    from_list="$(printf '%s' "${unit_json}" | jq -r '(.reexport_names // []) | join(", ")')"
    acc_block="$(
      printf '%s' "${unit_json}" | jq -r '(.reexport_names // [])[] | "- \(.)"'
    )"
    [[ -n "$(printf '%s' "${acc_block}" | tr -d '[:space:]')" ]] || acc_block="- reexport"
    briefing_block="$(
      cat <<EOB
Em ${primary}:
   import { ${from_list} } from '${barrel}'
   export { ${from_list} }
EOB
    )"
    cat <<EOF
## Goal
Single-file micro: ${title}.
Edit only \`${primary}\`. Reexport only — no algorithm reimplementation.

## Targets
- ${primary}

## Tasks
- [ ] Task $((idx + 1))/${total} — ${title}

## Change
- Update ONLY \`${primary}\`.
- Import and re-export: ${names}
- Do not create or modify any other path.
- Do not delete or demote pre-existing barrel exports unrelated to this demand.

## Briefing
${briefing_block}

## Acceptance
${acc_block}

## Out of scope
${oos}

## Constraints
- KISS
- single target micro unit only
- reexport only
- do not delete pre-existing barrel exports unrelated to this demand
$(aegis_briefing_stable_constraints)
EOF
    return 0
  fi

  # create unit — reuse export renderer via a one-export briefing JSON
  local mini body_full briefing_only
  mini="$(
    printf '%s' "${unit_json}" | jq -c --arg goal "Create ${primary} only." --arg primary "${primary}" '
      {
        goal: $goal,
        targets: [$primary],
        exports: (.exports // []),
        barrelFile: "",
        barrelFrom: ""
      }
    '
  )"
  body_full="$(aegis_briefing_render "${mini}" 2>/dev/null || true)"
  briefing_only="$(
    printf '%s\n' "${body_full}" \
      | awk '
          /^## Briefing[[:space:]]*$/ { p = 1; next }
          /^## / { if (p) exit }
          p { print }
        '
  )"
  # Drop empty barrel leftovers from render (Em : / empty import path).
  briefing_only="$(
    printf '%s\n' "${briefing_only}" \
      | awk '
          /^Em[[:space:]]*:/ { skip = 1; next }
          skip && /^[[:space:]]*import / { next }
          skip && /^[[:space:]]*export / { next }
          skip && NF == 0 { skip = 0; next }
          { skip = 0; print }
        '
  )"
  acc_block="$(
    printf '%s' "${unit_json}" | jq -r '(.exports // [])[] | "- \(.name)"'
  )"
  [[ -n "$(printf '%s' "${acc_block}" | tr -d '[:space:]')" ]] || acc_block="- done"

  cat <<EOF
## Goal
Single-file micro: ${title}.
Edit only \`${primary}\`. Do not re-export from index in this run.

## Targets
- ${primary}

## Tasks
- [ ] Task $((idx + 1))/${total} — ${title}

## Change
- Create or update ONLY \`${primary}\`.
- Do not create or modify any other path.
- Do not re-export from index in this run.
- Prefer top-level exports listed in Acceptance only.

## Briefing
${briefing_only}

## Acceptance
${acc_block}

## Out of scope
${oos}

## Constraints
- KISS
- single target micro unit only
- prefer focused public surface (class methods need not be top-level exports)
- do not delete pre-existing barrel exports unrelated to this demand
$(aegis_briefing_stable_constraints)
EOF
}

# Topological order (depends_on is 1-based). Prints 0-based indexes one per line.
# Note: never name an array "done" — it confuses bash parsing near the done keyword.
aegis_supervisor_split_order() {
  local json="${1-}"
  local n i dep ok progress found d guard
  n="$(printf '%s' "${json}" | jq '.units | length')"
  [[ "${n}" =~ ^[0-9]+$ ]] || return 0
  local -a ordered=()
  local -a remaining=()
  for ((i = 0; i < n; i++)); do remaining+=("$i"); done

  guard=0
  progress=1
  while [[ "${#remaining[@]}" -gt 0 && "${progress}" -eq 1 && "${guard}" -lt $((n + 2)) ]]; do
    progress=0
    guard=$((guard + 1))
    local -a still=()
    for i in "${remaining[@]}"; do
      [[ "${i}" =~ ^[0-9]+$ ]] || continue
      ok=1
      while IFS= read -r dep; do
        [[ -n "${dep}" ]] || continue
        [[ "${dep}" =~ ^[0-9]+$ ]] || { ok=0; break; }
        dep=$((dep - 1))
        found=0
        for d in "${ordered[@]+"${ordered[@]}"}"; do
          if [[ "${d}" == "${dep}" ]]; then found=1; break; fi
        done
        if [[ "${found}" -eq 0 ]]; then ok=0; break; fi
      done < <(printf '%s' "${json}" | jq -r --argjson i "${i}" '
          (.units[$i].depends_on // [])
          | map(if type == "number" then . elif type == "string" then (tonumber? // -1) else -1 end)
          | .[]
        ' 2>/dev/null || true)
      if [[ "${ok}" -eq 1 ]]; then
        ordered+=("$i")
        progress=1
      else
        still+=("$i")
      fi
    done
    remaining=("${still[@]+"${still[@]}"}")
    # If still is empty, clear remaining explicitly (bash empty-array quirks).
    [[ "${#still[@]}" -eq 0 ]] && remaining=()
  done
  for i in "${remaining[@]+"${remaining[@]}"}"; do
    [[ "${i}" =~ ^[0-9]+$ ]] && ordered+=("$i")
  done
  for i in "${ordered[@]+"${ordered[@]}"}"; do
    printf '%s\n' "${i}"
  done
}

# Write unit-N.md + fit.json under out_dir from validated split JSON.
# Args: split_json, parent_demand, out_dir
# Prints number of units on stdout.
aegis_supervisor_split_emit() {
  local json="${1-}"
  local parent="${2-}"
  local out_dir="${3-}"
  local n i ord idx unit demand units_acc fit_json

  [[ -n "${out_dir}" ]] || return 1
  mkdir -p "${out_dir}"
  rm -f "${out_dir}"/unit-*.md "${out_dir}/fit.json" 2>/dev/null || true

  n="$(printf '%s' "${json}" | jq '.units | length')"
  [[ "${n}" -ge 2 ]] || return 1

  units_acc='[]'
  idx=0
  while IFS= read -r ord; do
    [[ -n "${ord}" ]] || continue
    unit="$(printf '%s' "${json}" | jq -c --argjson i "${ord}" '.units[$i]')"
    demand="$(aegis_supervisor_unit_render "${unit}" "${idx}" "${n}" "${parent}")"
    printf '%s\n' "${demand}" > "${out_dir}/unit-${idx}.md"
    units_acc="$(
      jq -cn \
        --argjson acc "${units_acc}" \
        --argjson i "${idx}" \
        --argjson ord "${ord}" \
        --argjson unit "${unit}" \
        --arg demand "${demand}" \
        --arg title "$(printf '%s' "${unit}" | jq -r '.title // "unit"')" \
        --argjson targets "$(printf '%s' "${unit}" | jq -c '.targets // []')" \
        '$acc + [{
          index: $i,
          title: $title,
          targets: $targets,
          note: "supervisor_split",
          source_index: $ord,
          demand: $demand
        }]'
    )"
    idx=$((idx + 1))
  done < <(aegis_supervisor_split_order "${json}")

  fit_json="$(
    jq -cn \
      --arg parent "${parent}" \
      --argjson units "${units_acc}" \
      '{
        schema: "aegis.fit_check.v1",
        run_allowed: false,
        source: "supervisor_split",
        fixed_demand: $parent,
        original_demand: $parent,
        proposed_units: $units
      }'
  )"
  printf '%s\n' "${fit_json}" > "${out_dir}/fit.json"
  printf '%s' "${idx}"
  [[ "${idx}" -ge 2 ]]
}

# Call 8B, validate, emit micros. Args: parent_demand, out_dir
# Returns 0 on success (>=2 units written).
aegis_supervisor_split_generate() {
  local parent="${1-}"
  local out_dir="${2-}"

  [[ -n "${parent}" ]] || return 1
  [[ -n "${out_dir}" ]] || return 1
  aegis_supervisor_split_enabled || return 1

  local api_base api_key model timeout
  api_base="${OPENAI_API_BASE:-https://integrate.api.nvidia.com/v1}"
  api_key="${OPENAI_API_KEY:-${NVIDIA_API_KEY:-}}"
  model="$(aegis_briefing_model)"
  timeout="${AEGIS_BRIEFING_TIMEOUT_SEC:-90}"

  local req_file resp_file
  req_file="$(mktemp "${TMPDIR:-/tmp}/aegis_split_req.XXXXXX")" || return 1
  resp_file="$(mktemp "${TMPDIR:-/tmp}/aegis_split_resp.XXXXXX")" || {
    rm -f "${req_file}"
    return 1
  }

  # Cap parent size so the prompt stays small for 8B.
  local parent_clip
  parent_clip="$(printf '%s' "${parent}" | head -c 6000)"

  jq -n \
    --arg model "${model}" \
    --arg sys "$(aegis_supervisor_split_system_prompt)" \
    --arg parent "${parent_clip}" \
    '{
      model: $model,
      messages: [
        {role: "system", content: $sys},
        {role: "user", content: ("Split this Aegis demand into micro units:\n\n" + $parent)}
      ],
      temperature: 0.1,
      max_tokens: 2000,
      response_format: {type: "json_object"}
    }' > "${req_file}" 2>/dev/null || {
    rm -f "${req_file}" "${resp_file}"
    return 1
  }

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

  content="$(
    printf '%s' "${content}" \
      | sed -E 's/^[[:space:]]*```[a-zA-Z]*[[:space:]]*//; s/```[[:space:]]*$//'
  )"

  aegis_supervisor_split_validate_json "${content}" "${parent}" || return 1

  local n
  n="$(aegis_supervisor_split_emit "${content}" "${parent}" "${out_dir}")" || {
    printf 'emit_failed\n' >&2
    return 1
  }
  [[ "${n}" -ge 2 ]] || {
    printf 'too_few_emitted\n' >&2
    return 1
  }
  return 0
}

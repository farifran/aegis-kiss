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
  local skill_file="${AEGIS_ROOT_DIR:-.}/.skills/briefing.md"
  if [[ -f "${skill_file}" ]]; then
    cat "${skill_file}"
    return 0
  fi
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
  "barrelFrom": "./thing.js",
  "behavior": [
    {
      "desc": "consume fails when the bucket is empty",
      "exports": ["TokenBucket"],
      "prelude": ["const b = new TokenBucket(100n)"],
      "assert": "b.consume(101n) === false && b.refillActive === true"
    }
  ]
}

Rules:
- TypeScript type names are lowercase: bigint, number, string, boolean. NEVER BigInt, Number, String, Boolean as types — those are constructors (BigInt(x) as a call is OK).
- Every "body" entry is one complete line of TypeScript. Write formulas as code (mbps * 8000), bitwise operations explicitly (mask |= 1), conditionals inline (if (c) { a } else { b }).
- NEVER use Math.min/Math.max/Math.floor with bigint values — clamp with if (x > max) { x = max }. Use BigInt(Date.now()) not Math with bigint. Math.floor on number then BigInt(...) is OK.
- Outside a class, NEVER read private fields (_tokens, _refillActive). Expose getters (get tokens(), get refillActive()) and use those in helper functions.
- Elapsed-time refill (token bucket / rate limiter): compute timeDiff from now - lastUpdate; ONLY add tokens when timeDiff > 0 (or > 0n if bigint). Update lastUpdate only inside that branch (or when you actually refill).
- Time-left / backoff formulas: use the stored window duration directly — const end = start + windowMs; if (now >= end) { return 0n }; return end - now. Never build long algebra and never expand a start with self-cancelling terms; those are bugs.
- If the demand has a refill-active / refil flag (bitmask bit, boolean): after update/clamp set this._refillActive = this._tokens < this._maxTokens (or equivalent). Do NOT leave the flag stuck true from the constructor forever.
- "name" is always a plain identifier: letters and digits only, no dots, no parentheses, no spaces.
- When the demand states a signature (constructor params, method params, getters, types, arity), honor it EXACTLY — do not change a type (e.g. a number param to bigint), drop a getter, or alter arity. Convert internally if needed (e.g. this._windowMs = BigInt(windowMs)).
- Emit at most $(aegis_briefing_max_exports) entries in "exports". Do not invent helpers that were not asked for.
- Private field names start with an underscore and appear ONLY in privateFields, never in "exports".
- "barrelFrom" is a relative specifier ending in .js (NodeNext), pointing at the module you defined.
- "behavior" (optional but required when the demand has testable semantics: limits, flags, windowed refill, math). An array of executable regression asserts that the coder must satisfy. Each item: "desc" (short sentence), "exports" (names of the exports this assert exercises — list the export under test FIRST, then any dependencies its prelude/assert uses), optional "prelude" (array of one or more TypeScript setup lines, each a complete statement with no leading indentation), and "assert" (a single TypeScript expression that evaluates to boolean, using only exported names and built-ins). Emit 2-4 asserts covering the core contracts: capacity, refill, window slide, and boundary values. Assertions must never touch private fields. For time-based APIs, ALWAYS anchor to the exported windowStart getter — prelude: const ws = limiter.windowStart; assert uses ws, ws + Xn, ws + windowMs. NEVER pass absolute numbers (0n, 1000n) as time arguments: the window start is implementation-defined, so absolute values are wrong unless the constructor anchors at 0n.
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
      # Math on numbers (e.g. Math.max(0, n - m)) is legitimate: only flag a
      # Math call whose SAME line references bigint operands (_window*, _tokens,
      # _lastUpdate, or an n-suffixed literal / BigInt()).
      def has_math_on_bigint:
        test("Math\\.(min|max)\\(")
        and test("bigint|BigInt\\(|[0-9]+n\\b|_windowMs|_windowStart|_tokens|_maxTokens|_lastUpdate");
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
        and ((body_lines | map(select(type == "string" and has_math_on_bigint)) | length) > 0);
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
           then "barrel_not_nodenext:\(.barrelFrom)" else empty end),
        (if ((.behavior // []) | length) > 0
           and ((.behavior // []) | any(
                 (type != "object")
                 or ((.desc // "") | type != "string" or length == 0)
                 or ((.assert // "") | type != "string" or length == 0)
                 or (((.prelude // []) | if type == "string" then [.] else . end)
                     | any(type != "string"))
                 or (((.exports // []) | any(type != "string" or length == 0))))
               )
           then "bad_behavior_shape" else empty end)
      ] | first // ""
    ' 2>/dev/null || true
  )"

  if [[ -n "${reason}" ]]; then
    printf '%s\n' "${reason}" >&2
    return 1
  fi
  return 0
}

# Lightweight quality gate against observed supervisor decode glitches that
# still yield structurally valid JSON: degenerate self-cancelling algebra
# (e.g. "start + BigInt(limit) * 0n + start - start") and duplicated
# declarations (two "const end" in one function body).
aegis_briefing_quality_check() {
  local json="${1-}"
  [[ -n "${json}" ]] || return 1
  printf '%s' "${json}" | jq -e '
    ([.exports[]?.body[]?
       | select(test("\\* *0n") or test("windowStart *- *windowStart") or test("\\+ *- *\\+"))
      ] | length) == 0
    and
    ([.exports[]? | ([.body[]? | select(test("^const "))] | length)]
       | map(select(. > 1)) | length) == 0
  ' >/dev/null 2>&1
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
    (if ((.barrelFrom // "") | length) > 0 then
      ("Em " + (.barrelFile // "src/index.ts") + ":\n   import { " + (((.exports // []) | map(.name)) | join(", ")) + " } from \u0027" + .barrelFrom + "\u0027\n   export { " + (((.exports // []) | map(.name)) | join(", ")) + " }")
    else empty end),
    (if ((.behavior // []) | length) > 0 then
      ("", "## Behavior", (
        (.behavior | to_entries | map(
          (.key + 1 | tostring) as $n
          | .value as $b
          | "- " + ($b.desc // "")
            + (if (($b.exports // []) | length) > 0
                 then "\n   exports: " + (($b.exports | join(", ")))
                 else "" end)
            + (((($b.prelude // []) | if type == "string" then [.] else . end))
               | map("\n   prelude: " + .) | join(""))
            + "\n   assert: " + ($b.assert // "")
        )) | join("\n")
      ))
    else empty end),
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

# Extract chat content from an OpenAI-compatible response body.
# Some gateways return 200 with error JSON; some put text under .message
# or reasoning fields when content is null.
aegis_briefing_extract_content() {
  local resp_file="${1-}"
  [[ -f "${resp_file}" ]] || return 0
  jq -r '
    if (.error // null) != null then empty
    else
      (.choices[0].message.content
        // .choices[0].message.reasoning_content
        // .choices[0].text
        // .choices[0].delta.content
        // empty)
    end
  ' "${resp_file}" 2>/dev/null || true
}

aegis_briefing_provider_error_code() {
  local resp_file="${1-}"
  local http_code="${2-0}"
  [[ -f "${resp_file}" ]] || {
    printf 'http_%s' "${http_code}"
    return 0
  }
  # Avoid local name "status" — some shells/environments mark it read-only.
  local title api_status msg
  title="$(jq -r '.title // empty' "${resp_file}" 2>/dev/null || true)"
  api_status="$(jq -r '.status // .error.code // empty' "${resp_file}" 2>/dev/null || true)"
  msg="$(jq -r '.error.message // .message // .detail // empty' "${resp_file}" 2>/dev/null || true)"
  if [[ "${http_code}" == "429" ]] || [[ "${api_status}" == "429" ]] \
    || [[ "${title}" == *"Too Many Requests"* ]]; then
    printf 'http_429_rate_limit'
    return 0
  fi
  if [[ "${http_code}" != "200" && "${http_code}" != "000" && -n "${http_code}" ]]; then
    if [[ -n "${msg}" ]]; then
      printf 'http_%s:%s' "${http_code}" "$(printf '%s' "${msg}" | tr '\n' ' ' | cut -c1-80)"
    else
      printf 'http_%s' "${http_code}"
    fi
    return 0
  fi
  if [[ -n "${msg}" ]]; then
    printf 'provider_error:%s' "$(printf '%s' "${msg}" | tr '\n' ' ' | cut -c1-80)"
    return 0
  fi
  printf 'empty_response'
}

# Detect a caller-supplied demand already in the briefing JSON schema (as
# opposed to a free-prose goal). Agentic callers (opencode, Claude Code, …)
# can pre-expand the demand; when the goal IS valid schema JSON we honor it
# directly instead of re-invoking the internal supervisor LLM.
aegis_briefing_is_schema_json() {
  local s="${1-}"
  [[ -n "${s}" ]] || return 1
  printf '%s' "${s}" \
    | jq -e 'type == "object" and ((.goal? | type) == "string") and ((.exports? | type) == "array")' \
    >/dev/null 2>&1
}

# Prints the structured demand on success; prints nothing and returns 1
# whenever the caller should fall back to the mechanical body.
aegis_briefing_generate() {
  local goal="${1-}"
  local target="${2-}"
  local evidence="${3-}"

  [[ -n "${goal}" ]] || return 1

  # Agentic handover: caller already supplied the demand as schema JSON.
  # Skip the supervisor LLM expand; run the same mechanical gates
  # (sanitize + validate + quality + render) over the supplied JSON.
  if aegis_briefing_is_schema_json "${goal}"; then
    local content body
    content="$(aegis_briefing_sanitize_json "${goal}")"
    aegis_briefing_validate_json "${content}" 2>/dev/null || {
      printf 'invalid_agentic_briefing\n' >&2
      return 1
    }
    aegis_briefing_quality_check "${content}" 2>/dev/null || {
      printf 'low_quality_agentic_briefing\n' >&2
      return 1
    }
    body="$(aegis_briefing_render "${content}" 2>/dev/null || true)"
    [[ -n "${body}" ]] || {
      printf 'render_failed\n' >&2
      return 1
    }
    printf '%s' "${body}"
    return 0
  fi

  # Agentic handover never calls the supervisor LLM: a free-prose goal is
  # not accepted for expansion here — the assistant must supply schema JSON.
  # Return 1 so the caller falls back to the mechanical body / --accept.
  if [[ "${AEGIS_AGENTIC:-0}" == "1" ]]; then
    printf 'agentic_requires_schema_json\n' >&2
    return 1
  fi

  local api_base api_key model timeout max_tokens
  api_base="${OPENAI_API_BASE:-https://integrate.api.nvidia.com/v1}"
  api_key="${OPENAI_API_KEY:-${NVIDIA_API_KEY:-}}"
  model="$(aegis_briefing_model)"
  timeout="${AEGIS_BRIEFING_TIMEOUT_SEC:-90}"
  max_tokens="${AEGIS_BRIEFING_MAX_TOKENS:-2048}"
  [[ "${max_tokens}" =~ ^[0-9]+$ ]] && [[ "${max_tokens}" -ge 256 ]] || max_tokens=2048

  if [[ -z "${api_key}" ]]; then
    printf 'missing_api_key\n' >&2
    return 1
  fi

  local req_file resp_file
  req_file="$(mktemp "${TMPDIR:-/tmp}/aegis_briefing_req.XXXXXX")" || return 1
  resp_file="$(mktemp "${TMPDIR:-/tmp}/aegis_briefing_resp.XXXXXX")" || {
    rm -f "${req_file}"
    return 1
  }

  local user_prompt="Demand: ${goal}\nTargets: ${target}"
  if [[ -n "${evidence}" ]]; then
    user_prompt="${user_prompt}\n\nWorkspace Evidence (Discovery & Forensics):\n${evidence}"
  fi

  jq -n \
    --arg model "${model}" \
    --arg sys "$(aegis_briefing_system_prompt)" \
    --arg user "${user_prompt}" \
    --argjson max_tokens "${max_tokens}" \
    '{
      model: $model,
      messages: [
        {role: "system", content: $sys},
        {role: "user", content: $user}
      ],
      temperature: 0.1,
      max_tokens: $max_tokens,
      response_format: {type: "json_object"}
    }' > "${req_file}" 2>/dev/null || {
    rm -f "${req_file}" "${resp_file}"
    return 1
  }

  # Retry transient provider noise: 429 rate-limit, 5xx, empty body on 200.
  # Also retry output that fails JSON validation or the quality gate (observed
  # deepseek decode glitches: self-cancelling algebra, duplicated const).
  # Cap attempts to 2 and timeout to 15s to prevent long shell hangs on API stalls.
  local max_attempts="${AEGIS_BRIEFING_MAX_ATTEMPTS:-2}"
  [[ "${max_attempts}" =~ ^[0-9]+$ ]] && [[ "${max_attempts}" -ge 1 ]] || max_attempts=4
  local attempt=1
  local http_code="000"
  local content=""
  local fail_reason="empty_response"
  local backoff

  while [[ "${attempt}" -le "${max_attempts}" ]]; do
    : > "${resp_file}"
    http_code="$(
      curl --silent --show-error \
        --connect-timeout 5 \
        --max-time "${timeout}" \
        --output "${resp_file}" \
        --write-out "%{http_code}" \
        -X POST "${api_base%/}/chat/completions" \
        -H "Authorization: Bearer ${api_key}" \
        -H "Content-Type: application/json" \
        --data @"${req_file}" 2>/dev/null || printf '000'
    )"

    content="$(aegis_briefing_extract_content "${resp_file}")"
    if [[ -n "$(printf '%s' "${content}" | tr -d '[:space:]')" ]]; then
      content="$(aegis_briefing_sanitize_json "${content}")"
      if aegis_briefing_validate_json "${content}" 2>/dev/null \
        && aegis_briefing_quality_check "${content}" 2>/dev/null; then
        break
      fi
      fail_reason="invalid_or_low_quality_briefing"
    else
      fail_reason="$(aegis_briefing_provider_error_code "${resp_file}" "${http_code}")"
    fi
    content=""

    if [[ "${attempt}" -ge "${max_attempts}" ]]; then
      break
    fi

    case "${http_code}" in
      429) backoff=$((attempt * 8)) ;;   # 8s, 16s, 24s…
      500|502|503|504) backoff=$((attempt * 3)) ;;
      000) backoff=$((attempt * 2)) ;;
      200) backoff=$((attempt == 1 ? 2 : 5)) ;;
      401|403)
        # Auth failures will not heal with sleep.
        break
        ;;
      *) backoff=$((attempt * 2)) ;;
    esac
    printf '[AEGIS][BRIEFING][WARN] attempt %s/%s failed (%s http=%s) — retry in %ss\n' \
      "${attempt}" "${max_attempts}" "${fail_reason}" "${http_code}" "${backoff}" >&2
    sleep "${backoff}"
    attempt=$((attempt + 1))
  done

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
      --arg http_code "${http_code:-0}" \
      --argjson prompt_tokens "${_pt:-0}" \
      --argjson completion_tokens "${_ct:-0}" \
      --argjson attempts "${attempt}" \
      '{kind:"tokens",mode:"intake",substrate:"supervisor_expand",model:$model,
        prompt_tokens:$prompt_tokens,completion_tokens:$completion_tokens,
        total_tokens:($prompt_tokens+$completion_tokens),
        http_code:$http_code,attempts:$attempts}' \
      >> "${_metrics}" 2>/dev/null || true
    # Also emit a human line for CLI capture.
    printf '[AEGIS][TOKENS] supervisor_expand model=%s prompt=%s completion=%s total=%s\n' \
      "${model}" "${_pt:-0}" "${_ct:-0}" "$(( ${_pt:-0} + ${_ct:-0} ))" >&2 || true
  fi

  if [[ -z "$(printf '%s' "${content}" | tr -d '[:space:]')" ]]; then
    printf '%s\n' "${fail_reason:-empty_response}" >&2
    rm -f "${resp_file}"
    return 1
  fi

  rm -f "${resp_file}"

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

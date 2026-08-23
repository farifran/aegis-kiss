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
#   - the schema is compiled before the coder ever sees it, so a briefing that
#     contradicts itself is rejected instead of costing a fix loop
#
# What the schema still cannot catch is full demand logic (wrong formula).
# That is the Briefing layer + typescript.check / fix loop. It does now catch
# self-contradiction: aegis_briefing_typecheck_json materializes the schema
# and runs the repo's own tsc over it before the briefing is rendered.
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
#   AEGIS_BRIEFING_TYPECHECK=0      skip the tsc gate (it fails open anyway
#                                   when node_modules/.bin/tsc is absent)
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
- no any / as any / @ts-ignore / non-null assertion (x!)
- NodeNext: .js extension in relative imports
- only packages in package.json; builtins are global
- TypeScript types are lowercase (bigint, number, string, boolean) — never BigInt/Number/String/Boolean as types; BigInt(x) as a call is OK
- NEVER Math.min/Math.max/Math.floor/Math.ceil on bigint values — clamp with if (x > max) { x = max }; use BigInt(Date.now()) for time
- Outside a class, never read private fields (_name) — expose getters and use those in helpers
- Private fields start with underscore and are not Acceptance exports
- BigInt is global when high-precision time is required
- Prefer one top-level export per micro unit; methods on a class are fine
- noUncheckedIndexedAccess is ON: arr[i] / text[i] / map.get(k) are T | undefined — bind to a const and guard before using, never chain off the index
- Numerical boundaries: clamp values using explicit conditional checks (if (val > max) val = max)
- State mutation: methods that mutate internal state must preserve all class invariants
EOF
}

# Soft rewrite of common bigint Math antipatterns in body lines (layer-2).
# Returns rewritten JSON on stdout. Idempotent; leaves non-matching lines alone.
aegis_briefing_sanitize_json() {
  local json="${1-}"
  # 1) Math.min/max on bigint → clamp ternaries
  json="$(
    printf '%s' "${json}" | jq -c '
      # The static gate rejects `x!` (enforcement/rules/no-non-null-assertion).
      # Rewriting beats rejecting: `a!.b` becomes `a?.b`, `f(a!)` becomes
      # `f(a)`, and a briefing that was otherwise fine survives.
      def drop_nonnull:
        if type != "string" then .
        else gsub("(?<a>[A-Za-z0-9_)\\]])!(?<b>\\s*[.\\[])"; "\(.a)?\(.b)")
             | gsub("(?<a>[A-Za-z0-9_)\\]])!(?<b>[).,;])"; "\(.a)\(.b)")
             | gsub("(?<a>[A-Za-z0-9_)\\]])!\\s*$"; "\(.a)")
        end;
      def rewrite_line:
        drop_nonnull
        | . as $s
        | if ($s | type) != "string" then $s
          elif ($s | test("Math\\.(min|max)\\([^)]*\\)"))
               and ($s | test("bigint|BigInt|[0-9]+n|\\bn\\b")) then
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
      # 2) barrelFrom must match its target character for character:
      #    "./seatmap.js" against src/seatMap.ts is TS2307 on any
      #    case-sensitive filesystem, and silently fine on macOS until CI.
      def fix_barrel:
        ((.barrelFrom // "") | sub("^\\./"; "") | sub("\\.js$"; "")) as $stem
        | if ($stem | length) == 0 then .
          else
            ([.targets[]? | select(type == "string" and endswith(".ts"))
               | sub("^src/"; "") | sub("\\.ts$"; "")
               | select(ascii_downcase == ($stem | ascii_downcase))] | first) as $hit
            | if $hit == null then . else .barrelFrom = "./" + $hit + ".js" end
          end;
      .behavior = ((.behavior // []) | map(
          .assert = ((.assert // "") | drop_nonnull)
          | .prelude = ((.prelude // []) | if type == "string" then drop_nonnull
                                           else map(drop_nonnull) end)))
      | .exports = ((.exports // []) | map(map_bodies)) | fix_barrel
    ' 2>/dev/null || printf '%s' "${json}"
  )"
  printf '%s' "${json}"
}

# The schema doubles as the instruction in .skills/briefing.md.
aegis_briefing_system_prompt() {
  local skill_file="${AEGIS_ROOT_DIR:-.}/.skills/briefing.md"
  if [[ -f "${skill_file}" ]]; then
    cat "${skill_file}"
    return 0
  fi
  printf 'You convert a software demand into JSON. Output ONLY a valid JSON object matching the briefing schema.\n'
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
      # Math call whose SAME line references bigint operands.
      def has_math_on_bigint:
        test("Math\\.(min|max)\\(")
        and test("bigint|BigInt\\(|[0-9]+n\\b|\\bn\\b");
      def has_bigint_signal: test("bigint|BigInt|[0-9]+n|0n|1n|\\bn\\b");
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
        ((.types // [])[]? | select(((.name // "") | ident) | not) | "type_not_identifier:\(.name)"),
        ((.types // [])[]? | select(((.shape // "") | length) == 0) | "type_without_shape:\(.name)"),
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
#
# Redeclaration is counted by NAME, and only at brace depth 0. Counting
# `const` lines instead rejected every honest parser (compareSemVer declares
# parse, pa, pb and maxLen in one body); ignoring depth rejected every honest
# loop (two `for` blocks may each declare their own `const x`).
aegis_briefing_quality_check() {
  local json="${1-}"
  [[ -n "${json}" ]] || return 1
  printf '%s' "${json}" | jq -e '
    ([.exports[]?.body[]?
       | select(test("\\* *0n") or test("([A-Za-z0-9_]+) *- *\\1") or test("\\+ *- *\\+"))
      ] | length) == 0
    and
    ([.exports[]? | (.body // []), (.ctorBody // []), ((.methods[]? | .body) // [])]
       | map(reduce .[] as $l ({depth: 0, names: []};
               (if ($l | type) == "string" then $l else "" end) as $s
               | {depth: (.depth + ($s | [scan("[{]")] | length) - ($s | [scan("[}]")] | length)),
                  names: (.names + (if .depth == 0
                            then [$s | capture("^\\s*(?:const|let)\\s+(?<v>[A-Za-z_$][A-Za-z0-9_$]*)").v]
                            else [] end))})
             | .names | group_by(.) | map(select(length > 1)) | length)
       | add // 0) == 0
  ' >/dev/null 2>&1
}

# Compile the schema and let tsc judge it — the same bar the coder's output
# has to clear. Prints one classified code per line:
#
#   tsc:TSxxxx             the briefing contradicts itself (unknown type,
#                          missing member, wrong argument). Returns 1.
#   tsc-strictnull:TSxxxx  noUncheckedIndexedAccess residue on a body the
#                          coder rewrites anyway, and ## Constraints already
#                          carries the bind-and-guard rule. Never rejects.
#
# Fails OPEN: no tsc, no tsconfig, no jq, or a render jq cannot produce all
# return 0 — a missing compiler must never cost a good briefing.
# Optional $2 is an artifact prefix: <prefix>.ts and <prefix>.log are kept
# whenever the check finds anything, for post-mortem.
#
# Env: AEGIS_BRIEFING_TYPECHECK=0 disables.
aegis_briefing_typecheck_json() {
  local json="${1-}" keep="${2-}"
  local root bin dir out classified

  case "${AEGIS_BRIEFING_TYPECHECK:-1}" in
    0|false|no) return 0 ;;
  esac
  [[ -n "${json}" ]] || return 0
  command -v jq >/dev/null 2>&1 || return 0

  root="$(cd "${AEGIS_ROOT_DIR:-.}" 2>/dev/null && pwd)" || return 0
  bin="${root}/node_modules/.bin/tsc"
  [[ -x "${bin}" ]] && [[ -f "${root}/tsconfig.json" ]] || return 0

  # Out of tree on purpose: the repo tsconfig includes .harness, so a scratch
  # .ts written under it would join `npm run aegis:typecheck`.
  dir="$(mktemp -d "${TMPDIR:-/tmp}/aegis_brief_tsc.XXXXXX")" || return 0
  printf '{"extends":"%s/tsconfig.json","include":["unit.ts"],"compilerOptions":{"noEmit":false,"outDir":".","rootDir":"."}}' \
    "${root}" > "${dir}/tsconfig.json"

  printf '%s' "${json}" | jq -r '
    def params($p): (($p // []) | map(.name + ": " + .type) | join(", "));
    def lines($l; $pad): (($l // []) | map($pad + .) | join("\n"));

    [ (.types[]? | "type \(.name) = \(.shape);") ]
    + [ (.exports[]?
        | if .kind == "class" then
            "export class \(.name) {"
            + ((.privateFields // []) | map("\n  private \(.name): \(.type);") | join(""))
            + "\n  constructor(" + params(.ctorParams) + ") {\n" + lines(.ctorBody; "    ") + "\n  }"
            + ((.methods // []) | map(
                "\n  \(.name)(" + params(.params) + "): \(.returns // "void") {\n"
                + lines(.body; "    ") + "\n  }") | join(""))
            + ((.getters // []) | map(
                "\n  get \(.name)(): \(.returns // "unknown") { \(.body // "") }") | join(""))
            + "\n}"
          else
            "export function \(.name)(" + params(.params) + "): \(.returns // "void") {\n"
            + lines(.body; "  ") + "\n}"
          end)
    ]
    + [ (.behavior // []) | to_entries[]
        | "\(.key)" as $i
        | .value as $b
        | "async function __behavior\($i)(): Promise<boolean> {\n"
          + lines(($b.prelude // [] | if type == "string" then [.] else . end); "  ")
          + "\n  const __ok\($i): boolean = (\($b.assert // "true"));\n  return __ok\($i);\n}" ]
    + [ (if ((.behavior // []) | length) > 0 then
          "async function __run_all(): Promise<void> {\n"
          + "  const errs: string[] = [];\n"
          + ([ (.behavior // []) | to_entries[]
               | "  try { if (!(await __behavior\(.key)())) errs.push(\"assert_failed:\(.key)\"); } catch (e: any) { errs.push(\"exception:\(.key):\" + String(e?.message || e)); }"
             ] | join("\n"))
          + "\n  if (errs.length > 0) throw new Error(errs.join(\"\\n\"));\n"
          + "}\nvoid __run_all();"
        else empty end) ]
    | join("\n\n")
  ' > "${dir}/unit.ts" 2>/dev/null || { rm -rf "${dir}"; return 0; }
  [[ -s "${dir}/unit.ts" ]] || { rm -rf "${dir}"; return 0; }

  out="$("${bin}" -p "${dir}" 2>&1 || true)"

  # TS2769 carries the "| undefined is not assignable" detail on continuation
  # lines, so each error is folded together with the lines explaining it before
  # being classified. The dot in /possibly .undefined./ stands for the quote
  # tsc prints — matching it that way keeps this one awk program in one pair
  # of shell quotes.
  classified="$(
    printf '%s\n' "${out}" | awk '
      function emit(   code) {
        if (r == "") return
        match(r, /error TS[0-9]+/)
        code = substr(r, RSTART + 6, RLENGTH - 6)
        if (r ~ /possibly .(undefined|null)./ || r ~ /undefined. is not assignable/)
          print "tsc-strictnull:" code
        else
          print "tsc:" code
      }
      /error TS[0-9]+/ { emit(); r = $0; next }
      r != "" { r = r " " $0 }
      END { emit() }
    ' | sort -u
  )"

  # If compilation cleared without fatal errors and JS was emitted, execute
  # behavior assertions in Node to verify runtime semantics.
  if ! printf '%s' "${classified}" | grep -q '^tsc:' && [[ -f "${dir}/unit.js" ]]; then
    local node_out node_rc=0
    node_out="$(node "${dir}/unit.js" 2>&1)" || node_rc=$?
    if [[ "${node_rc}" -ne 0 && -n "${node_out}" ]]; then
      local b_findings
      b_findings="$(printf '%s\n' "${node_out}" | sed 's/^/behavior-runtime:/')"
      classified="${classified}${classified:+$'\n'}${b_findings}"
    fi
  fi

  if [[ -n "${keep}" ]] && [[ -n "${classified}" ]]; then
    cp "${dir}/unit.ts" "${keep}.ts" 2>/dev/null || true
    printf '%s\n' "${out}" > "${keep}.log" 2>/dev/null || true
  fi
  rm -rf "${dir}"

  [[ -z "${classified}" ]] || printf '%s\n' "${classified}"
  printf '%s' "${classified}" | grep -q '^tsc:' && return 1
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
    (if ((.types // []) | length) > 0
       then ((.types | map("type " + .name + " = " + .shape)) | join("\n")) + "\n"
       else empty end),
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

# Extract chat content from an OpenAI-compatible response body (string in RAM or file path).
aegis_briefing_extract_content() {
  local input="${1-}"
  [[ -n "${input}" ]] || return 0
  local json_stream=""
  if [[ -f "${input}" ]]; then
    json_stream="$(cat "${input}" 2>/dev/null || true)"
  else
    json_stream="${input}"
  fi
  jq -r '
    if (.error // null) != null then empty
    else
      (.choices[0].message.content
        // .choices[0].message.reasoning_content
        // .choices[0].text
        // .choices[0].delta.content
        // empty)
    end
  ' <<< "${json_stream}" 2>/dev/null || true
}

aegis_briefing_provider_error_code() {
  local input="${1-}"
  local http_code="${2-0}"
  local json_stream=""
  if [[ -f "${input}" ]]; then
    json_stream="$(cat "${input}" 2>/dev/null || true)"
  else
    json_stream="${input}"
  fi
  if [[ -z "${json_stream}" ]]; then
    printf 'http_%s' "${http_code}"
    return 0
  fi
  local title api_status msg
  title="$(jq -r '.title // empty' <<< "${json_stream}" 2>/dev/null || true)"
  api_status="$(jq -r '.status // .error.code // empty' <<< "${json_stream}" 2>/dev/null || true)"
  msg="$(jq -r '.error.message // .message // .detail // empty' <<< "${json_stream}" 2>/dev/null || true)"
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

# Calls the supervisor LLM and prints VALIDATED schema JSON on stdout.
# Operates 100% in-memory via curl streaming without creating temporary files on disk.
aegis_briefing_expand_json() {
  local goal="${1-}"
  local target="${2-}"
  local evidence="${3-}"

  [[ -n "${goal}" ]] || return 1

  local api_base api_key model timeout max_tokens
  api_base="${OPENAI_API_BASE:-https://integrate.api.nvidia.com/v1}"
  api_key="${OPENAI_API_KEY:-${NVIDIA_API_KEY:-}}"
  model="$(aegis_briefing_model)"
  timeout="${AEGIS_BRIEFING_TIMEOUT_SEC:-45}"
  max_tokens="${AEGIS_BRIEFING_MAX_TOKENS:-2048}"
  [[ "${max_tokens}" =~ ^[0-9]+$ ]] && [[ "${max_tokens}" -ge 256 ]] || max_tokens=2048

  if [[ -z "${api_key}" ]]; then
    printf 'missing_api_key\n' >&2
    return 1
  fi

  local user_prompt="Demand: ${goal}\nTargets: ${target}"
  if [[ -n "${evidence}" ]]; then
    if jq -e . <<< "${evidence}" >/dev/null 2>&1; then
      local rendered_evidence
      rendered_evidence="$(printf '%s' "${evidence}" | jq -r '
        "Topology (Workspace Files): " + ((.topology // []) | join(", ")) + "\n\n" +
        ([(.targets // [])[]? |
          "File: " + .path +
          (if .exists then " (exists, " + (.bytes|tostring) + " bytes)\nExisting Exports: " + (.exports | join(", ")) + "\nContent:\n" + .snippet
           else " (net-new file)" end)
        ] | join("\n\n---\n\n"))
      ' 2>/dev/null || printf '%s' "${evidence}")"
      user_prompt="${user_prompt}\n\nWorkspace Evidence (Discovery & Forensics):\n${rendered_evidence}"
    else
      user_prompt="${user_prompt}\n\nWorkspace Evidence (Discovery & Forensics):\n${evidence}"
    fi
  fi

  local current_user_prompt="${user_prompt}"
  local max_attempts="${AEGIS_BRIEFING_MAX_ATTEMPTS:-2}"
  [[ "${max_attempts}" =~ ^[0-9]+$ ]] && [[ "${max_attempts}" -ge 1 ]] || max_attempts=2
  local attempt=1
  local http_code="000"
  local content=""
  local resp_body=""
  local fail_reason="empty_response"
  local why=""
  local _tsc=""
  local backoff

  while [[ "${attempt}" -le "${max_attempts}" ]]; do
    local req_payload
    req_payload="$(jq -n \
      --arg model "${model}" \
      --arg sys "$(aegis_briefing_system_prompt)" \
      --arg user "${current_user_prompt}" \
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
      }')"

    local raw_resp
    raw_resp="$(curl --silent --show-error \
      --connect-timeout 5 \
      --max-time "${timeout}" \
      -w "\n%{http_code}" \
      -X POST "${api_base%/}/chat/completions" \
      -H "Authorization: Bearer ${api_key}" \
      -H "Content-Type: application/json" \
      --data "${req_payload}" 2>/dev/null || printf '\n000')"

    http_code="$(tail -n 1 <<< "${raw_resp}")"
    resp_body="$(sed '$d' <<< "${raw_resp}")"

    content="$(aegis_briefing_extract_content "${resp_body}")"
    if [[ -n "$(printf '%s' "${content}" | tr -d '[:space:]')" ]]; then
      content="$(aegis_briefing_sanitize_json "${content}")"
      why="$(aegis_briefing_validate_json "${content}" 2>&1 >/dev/null | tail -n 1 || true)"
      if [[ -z "${why}" ]]; then
        if ! aegis_briefing_quality_check "${content}" 2>/dev/null; then
          why="low_quality"
        else
          # Memory preflight typecheck
          _tsc="$(aegis_briefing_typecheck_json "${content}" 2>&1)" \
            || why="typecheck:$(printf '%s' "${_tsc}" | sed -n 's/^tsc://p' | sed -E 's|/tmp/[^/]+/||g' | paste -sd, -)"
          [[ -n "${why}" ]] || break
        fi
      fi
      fail_reason="invalid_briefing:${why}"
    else
      fail_reason="$(aegis_briefing_provider_error_code "${resp_body}" "${http_code}")"
    fi
    content=""

    if [[ "${attempt}" -ge "${max_attempts}" ]]; then
      break
    fi

    case "${http_code}" in
      429) backoff=$((attempt * 4)) ;;
      500|502|503|504) backoff=$((attempt * 2)) ;;
      000) backoff=$((attempt * 2)) ;;
      200) backoff=$((attempt == 1 ? 1 : 3)) ;;
      401|403) break ;;
      *) backoff=$((attempt * 2)) ;;
    esac
    printf '[AEGIS][BRIEFING][WARN] attempt %s/%s failed (%s http=%s) — retry in %ss\n' \
      "${attempt}" "${max_attempts}" "${fail_reason}" "${http_code}" "${backoff}" >&2
    sleep "${backoff}"
    if [[ -n "${fail_reason}" && "${fail_reason}" == invalid_briefing:* ]]; then
      local clean_feedback
      clean_feedback="$(printf '%s' "${fail_reason}" | sed -E 's|/tmp/[^/]+/||g')"
      current_user_prompt="${user_prompt}\n\n[COMPILATION/RUNTIME FEEDBACK]\nYour previous schema failed with: ${clean_feedback}\nPlease fix the schema methods, types, or behavior asserts to resolve this error."
    fi
    attempt=$((attempt + 1))
  done

  # In-memory token accounting
  local _pt _ct _metrics
  _pt="$(jq -r '.usage.prompt_tokens // 0' <<< "${resp_body}" 2>/dev/null || printf '0')"
  _ct="$(jq -r '.usage.completion_tokens // 0' <<< "${resp_body}" 2>/dev/null || printf '0')"
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
    printf '[AEGIS][TOKENS] supervisor_expand model=%s prompt=%s completion=%s total=%s\n' \
      "${model}" "${_pt:-0}" "${_ct:-0}" "$(( ${_pt:-0} + ${_ct:-0} ))" >&2 || true
  fi

  if [[ -z "$(printf '%s' "${content}" | tr -d '[:space:]')" ]]; then
    printf '%s\n' "${fail_reason:-empty_response}" >&2
    return 1
  fi

  # Strip any unexpected code fences
  content="$(
    printf '%s' "${content}" \
      | sed -E 's/^[[:space:]]*```[a-zA-Z]*[[:space:]]*//; s/```[[:space:]]*$//'
  )"

  content="$(aegis_briefing_sanitize_json "${content}")"
  aegis_briefing_validate_json "${content}" || return 1

  printf '%s' "${content}"
  return 0
}

# Re-analyzes and optimizes the schema methods under Hardware-Aligned KISS physics
# Prints the structured demand (markdown) on success; prints nothing and
# returns 1 whenever the caller should fall back to the mechanical body.
aegis_briefing_generate() {
  local goal="${1-}"
  local target="${2-}"
  local evidence="${3-}"
  local content body

  [[ -n "${goal}" ]] || return 1

  if aegis_briefing_is_schema_json "${goal}"; then
    # Agentic handover: caller already supplied the demand as schema JSON.
    # Skip the supervisor LLM expand; run the same mechanical gates.
    content="$(aegis_briefing_sanitize_json "${goal}")"
    aegis_briefing_validate_json "${content}" 2>/dev/null || {
      printf 'invalid_agentic_briefing\n' >&2
      return 1
    }
    aegis_briefing_quality_check "${content}" 2>/dev/null || {
      printf 'low_quality_agentic_briefing\n' >&2
      return 1
    }
    aegis_briefing_typecheck_json "${content}" >/dev/null 2>&1 || {
      printf 'uncompilable_agentic_briefing\n' >&2
      return 1
    }
  elif [[ "${AEGIS_AGENTIC:-0}" == "1" ]]; then
    # Agentic handover never calls the supervisor LLM: a free-prose goal is
    # not accepted for expansion here — the assistant must supply schema JSON.
    printf 'agentic_requires_schema_json\n' >&2
    return 1
  else
    content="$(aegis_briefing_expand_json "${goal}" "${target}" "${evidence}")" || return 1
  fi

  body="$(aegis_briefing_render "${content}" 2>/dev/null || true)"
  [[ -n "${body}" ]] || {
    printf 'render_failed\n' >&2
    return 1
  }

  printf '%s' "${body}"
  return 0
}

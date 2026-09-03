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
#   AEGIS_IDE_CONTRACT_RECONSTRUCTION=0  keep legacy direct-schema behavior
#   AEGIS_IDE_RECONSTRUCTION_MODEL  independent model for IDE contract review
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
  local m="${AEGIS_SUPERVISOR_MODEL:-deepseek-ai/deepseek-v4-flash-0731}"
  if [[ "${m}" == "ide-agent" ]]; then
    m="${OPENAI_MODEL_READONLY_COGNITION:-deepseek-ai/deepseek-v4-flash-0731}"
  fi
  printf '%s' "${m}"
}

aegis_briefing_reconstruction_model() {
  local m="${AEGIS_IDE_RECONSTRUCTION_MODEL:-${AEGIS_SUPERVISOR_MODEL:-deepseek-ai/deepseek-v4-flash-0731}}"
  if [[ "${m}" == "ide-agent" ]]; then
    m="${OPENAI_MODEL_READONLY_COGNITION:-deepseek-ai/deepseek-v4-flash-0731}"
  fi
  printf '%s' "${m}"
}

aegis_briefing_max_exports() {
  local n="${AEGIS_BRIEFING_MAX_EXPORTS:-4}"
  [[ "${n}" =~ ^[0-9]+$ ]] && [[ "${n}" -gt 0 ]] || n=4
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
- Monotonic time / clock drift: when tracking time deltas (now - lastUpdate), guard with if (now <= lastUpdate) return without rewinding lastUpdate on negative clock jumps (NTP skew)
- Immutability: private class fields that are assigned only in the constructor must be declared 'private readonly'
- Function signatures: prefer default parameter initializers (e.g. nowMs: bigint = BigInt(Date.now())) over union with undefined and internal ternaries
- Number-to-BigInt validation: when validating a number parameter before BigInt conversion or rate calculation, guard against non-finite values, unsafe float overflow, and zero-underflow (if (!Number.isFinite(x) || x < 0 || x * scale > Number.MAX_SAFE_INTEGER || (x > 0 && Math.round(x * scale) === 0)) throw new RangeError(...))
- BigInt division: when dividing by a variable BigInt denominator, guard against division by zero (if (divisor <= 0n) throw new RangeError(...))
- Discount monotonicity: absolute minimum floors on discounted rates must never exceed the original base rate (const clamped = disc < minFloor ? minFloor : disc; return clamped > base ? base : clamped)
- Heterogeneous collection type-guards: in constructors and methods receiving dynamic Record<string, bigint> maps, validate typeof val === 'bigint' before operations
- Sibling module imports: when depending on classes or functions from existing files in src/, use formal top-level 'import { Name } from "./sibling.js"' declarations instead of inline structural type redeclarations
- Dynamic key memory bounds: any in-memory Map or Set that ingests dynamic caller keys must enforce maxEntries capacity to prevent unbounded heap growth
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

# The schema doubles as the instruction in .skills/briefing.md, with AGENTS.md + ARCHITECTURE.md at Byte 0.
aegis_briefing_system_prompt() {
  local agents_file="${AEGIS_ROOT_DIR:-.}/AGENTS.md"
  local arch_file="${AEGIS_ROOT_DIR:-.}/ARCHITECTURE.md"
  local skill_file="${AEGIS_ROOT_DIR:-.}/.skills/briefing.md"
  local out=""

  if [[ -f "${agents_file}" ]]; then
    out="$(cat "${agents_file}")"
  fi

  if [[ -f "${arch_file}" ]]; then
    if [[ -n "${out}" ]]; then
      out="${out}"$'\n\n---\n\n'"$(cat "${arch_file}")"
    else
      out="$(cat "${arch_file}")"
    fi
  fi

  if [[ -f "${skill_file}" ]]; then
    if [[ -n "${out}" ]]; then
      out="${out}"$'\n\n---\n\n'"$(cat "${skill_file}")"
    else
      out="$(cat "${skill_file}")"
    fi
  fi

  if [[ -n "${out}" ]]; then
    printf '%s\n' "${out}"
    return 0
  fi
  printf 'You convert a software demand into JSON. Output ONLY a valid JSON object matching the briefing schema.\n'
}

# Small, deterministic classifier for questions that are plainly about the
# harness rather than the user's software.  This is intentionally narrow: it
# catches process language such as "organize tests in the repository" without
# rejecting legitimate domain questions about persistence, performance, or
# failure behavior.
aegis_briefing_question_scope_reason() {
  local json="${1-}"
  printf '%s' "${json}" | jq -r '
    [
      .questions[]? as $q
      | if (($q | type) != "object") then "question_not_object"
        elif (($q.scope // "") != "DEMAND") then "question_scope_must_be_DEMAND"
        elif (($q.question | type) != "string") then "question_text_required"
        else
          ($q.question | ascii_downcase) as $text
          | if (
              ($text | test("(^|[^[:alnum:]_])(aegis|harness|receipt|receipts|working tree|evidence orchestration|token budget|runtime directory|pipeline metrics|provider|supervisor model|mutation model)([^[:alnum:]_]|$)"))
              or (($text | test("(^|[^[:alnum:]_])(teste|testes|test|tests|suite|suíte)([^[:alnum:]_]|$)"))
                  and ($text | test("organiza|consolida|reposit|repo|commit|versiona")))
              or (($text | test("benchmark|benchmarks"))
                  and ($text | test("reposit|repo|commit|runtime|harness|evidence|Aegis|artefato")))
            )
            then "question_out_of_demand:\($q.question)"
            else empty
            end
        end
    ] | first // ""
  ' 2>/dev/null || printf 'question_scope_check_failed\n'
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

  # UAAM Contract IR v3 gate. Legacy briefings remain accepted, while v3 is
  # closed-world: every declared operation facet has an explicit proof
  # obligation and N/A is structural only.
  if [[ "$(printf '%s' "${json}" | jq -r '.version // empty' 2>/dev/null || true)" == "3.0" ]]; then
    local uaam_reason
    uaam_reason="$(
      printf '%s' "${json}" | jq -r '
        def present: . != null and (if type == "array" then length > 0 else true end) and (if type == "object" then length > 0 else true end);
        def domain_for($field): {admission:"ADMISSION", failure:"STATE", resources:"RESOURCE", composition:"COMPOSITION", transaction:"COMMIT", lifecycle:"LIFECYCLE", observability:"OBSERVABILITY"}[$field];
        [
          (if (.goal | type) != "string" or (.goal | length) == 0 then "empty_goal" else empty end),
          (if (.targets | type) != "array" or (.targets | length) == 0 then "targets_required" else empty end),
          (if (.publicContract | type) != "object" then "publicContract_required" else empty end),
          (if (.operations | type) != "array" or (.operations | length) == 0 then "operations_required" else empty end),
          (if ((.questions // []) | length) > 3 then "too_many_questions" else empty end),
          (if ((.questions // []) | any(
                (type != "object")
                or ((.question // "") | type != "string" or length == 0)
                or (.scope != "DEMAND")
                or (((.options // []) | if type == "array" then . else [] end) | length < 2)
                or (((.options // []) | if type == "array" then . else [] end) | any(type != "string" or length == 0))
              )) then "bad_questions_shape" else empty end),
          (if (.proofObligations | type) != "array" then "proofObligations_required" else empty end),
          (if ([.proofObligations[]? | select(.kind == "contract_coverage" or .oracle == "contract_coverage" or .domain == "CONTRACT")] | length) == 0 then "contract_coverage_required" else empty end),
          (if ([.proofObligations[]? | select((.kind == "contract_coverage" or .oracle == "contract_coverage" or .domain == "CONTRACT") and .notApplicable != true)] | length) == 0 then "contract_coverage_cannot_be_not_applicable" else empty end),
          (.requirements[]? as $requirement | if (($requirement | type) != "object" or ($requirement.id | type) != "string" or ($requirement.id | length) == 0) then "requirement_id_required" elif ($requirement.proofObligationId // $requirement.obligationId) as $reference | ([.proofObligations[]? | select(.id == $reference or (.target == $requirement.target and .domain == $requirement.domain))] | length) == 0 then "requirement_without_proof_obligation:\($requirement.id // "")" else empty end),
          (.proofObligations[]? as $po | if (($po.id | type) != "string" or ($po.id | length) == 0) then "proof_obligation_id_required"
            elif (["CONTRACT","ADMISSION","STATE","RESOURCE","COMPOSITION","COMMIT","LIFECYCLE","OBSERVABILITY"] | index($po.domain)) == null then "proof_obligation_domain_invalid:\($po.id)"
            elif (($po.oracle | type) != "string" or ($po.oracle | length) == 0) then "proof_obligation_oracle_required:\($po.id)"
            elif ($po.notApplicable == true and (($po.naJustification | type) != "string" or (($po.naJustification | startswith("derived:")) | not))) then "na_not_structurally_derived:\($po.id)"
            elif ($po.status? != null) then "proof_obligation_status_forbidden:\($po.id)" else empty end),
          (.operations[]? as $op | (["admission","failure","resources","composition","transaction","lifecycle","observability"][] as $field |
            if ($op[$field] | present) and ([.proofObligations[]? | select(.target == $op.target and .domain == domain_for($field))] | length) == 0
            then "missing_explicit_obligation:\($op.id):\(domain_for($field))" else empty end)),
          (.operations[]? as $op | if (($op.resources | type) == "array" and ($op.resources | length) > 0) and ($op.resources | any(type != "object" or (.resource | type) != "string" or (.owner | type) != "string" or (.scope | type) != "string" or (.capacity | type) != "string" or (.allowedExits | type) != "array")) then "resource_boundary_incomplete:\($op.id)" else empty end),
          (.operations[]? as $op | if (($op.composition | type) == "object" and ($op.composition.sharedResources | type) == "array") and ($op.composition.sharedResources | any(type != "object" or (.resource | type) != "string" or (.rule | type) != "string")) then "composition_rule_incomplete:\($op.id)" else empty end),
          (.operations[]? as $op | if (($op.transaction | type) == "object") and (($op.transaction.atomic | type) != "boolean" or ($op.transaction.phases | type) != "array" or ($op.transaction.phases | length) == 0) then "transaction_machine_incomplete:\($op.id)" else empty end),
          (.operations[]? as $op | if (($op.transaction.requiredEffects | type) == "array" and ($op.transaction.requiredEffects | length) > 0) then ([.proofObligations[]? | select(.target == $op.target and .domain == "COMMIT")] | if length == 0 or (.[0].requiredEffects | type) != "array" or (.[0].requiredEffects | length) != ($op.transaction.requiredEffects | length) or (($op.transaction.requiredEffects - .[0].requiredEffects) | length) > 0 then "commit_effects_not_explicit:\($op.id)" else empty end) else empty end),
          (.operations[]? as $op | ((if ($op.lifecycle | type) == "array" then $op.lifecycle elif ($op.lifecycle | present) then [$op.lifecycle] else [] end)[]? as $life | if (($life | type) != "object" or ($life.state | type) != "string" or ($life.scope | type) != "string" or (["CALL","BATCH","TRANSACTION","CYCLE","SESSION","INSTANCE","PROCESS","PERSISTENT"] | index($life.scope)) == null) then "lifecycle_scope_incomplete:\($op.id)" else empty end)),
          (if ((.questions // []) | any(
                (type != "object")
                or ((.question // "") | type != "string" or length == 0)
                or (.scope != "DEMAND")
                or (((.options // []) | if type == "array" then . else [] end) | length < 2)
                or (((.options // []) | if type == "array" then . else [] end) | any(type != "string" or length == 0))
              )) then "bad_questions_shape" else empty end),
          (if ((.contractReconciliation.pendingQuestions // []) | any(
                (type != "object")
                or ((.question // "") | type != "string" or length == 0)
                or (.scope != "AEGIS_RECONCILIATION")
                or (((.options // []) | if type == "array" then . else [] end) | length < 2)
                or (((.options // []) | if type == "array" then . else [] end) | any(type != "string" or length == 0))
              )) then "bad_reconciliation_questions_shape" else empty end)
        ] | map(select(type == "string")) | first // ""
      ' 2>/dev/null || true
    )"
    if [[ -n "${uaam_reason}" ]]; then
      printf '%s\n' "${uaam_reason}" >&2
      return 1
    fi
    reason="$(aegis_briefing_question_scope_reason "${json}")"
    if [[ -n "${reason}" ]]; then
      printf '%s\n' "${reason}" >&2
      return 1
    fi
    return 0
  fi

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
        (if ((.imports // []) | length) > 0
           and ((.imports // []) | any(
                 (type != "object")
                 or ((.from // "") | type != "string" or length == 0 or (endswith(".js") | not))
                 or (((.names // []) | if type == "array" then . else [] end) | length == 0)
                 or (((.names // []) | if type == "array" then . else [] end) | any(type != "string" or (test("^[A-Za-z_][A-Za-z0-9_]*$") | not)))
               ))
           then "bad_imports_shape" else empty end),
        (
          . as $root |
          ($root.imports // [])[]?.names[]? as $sym |
          select(
            ($root.exports // []) |
            all(
              ((.privateFields // []) | all((.type // "") | contains($sym) | not))
              and ((.ctorParams // []) | all((.type // "") | contains($sym) | not))
              and ((.methods // []) | all(
                    ((.params // []) | all((.type // "") | contains($sym) | not))
                    and ((.returns // "") | contains($sym) | not)
                    and ((.body // []) | all(contains($sym) | not))
                  ))
              and ((.getters // []) | all(
                    ((.returns // "") | contains($sym) | not)
                    and ((.body // "") | contains($sym) | not)
                  ))
            )
          ) | "vacuous_import:\($sym)"
        ),
        (if ((.questions // []) | length) > 0
           and ((.questions // []) | any(
                 (type != "object")
                 or ((.question // "") | type != "string" or length == 0)
                 or (.scope != "DEMAND")
                 or (((.options // []) | if type == "array" then . else [] end) | length < 2)
                 or (((.options // []) | if type == "array" then . else [] end) | any(type != "string" or length == 0))
               ))
           then "bad_questions_shape" else empty end),
        (if ((.questions // []) | length) > 3 then "too_many_questions" else empty end),
        (if ((.contractReconciliation.pendingQuestions // []) | length) > 0
           and ((.contractReconciliation.pendingQuestions // []) | any(
                 (type != "object")
                 or ((.question // "") | type != "string" or length == 0)
                 or (.scope != "AEGIS_RECONCILIATION")
                 or (((.options // []) | if type == "array" then . else [] end) | length < 2)
                 or (((.options // []) | if type == "array" then . else [] end) | any(type != "string" or length == 0))
               ))
           then "bad_reconciliation_questions_shape" else empty end),
        (if ((.behavior // []) | length) > 0
           and ((.behavior // []) | any(
                 (type != "object")
                 or ((.desc // "") | type != "string" or length == 0)
                 or ((.assert // "") | type != "string" or length == 0)
                 or (((.prelude // []) | if type == "string" then [.] else . end)
                     | any(type != "string"))
                 or (((.exports // []) | any(type != "string" or length == 0))))
               )
           then "bad_behavior_shape" else empty end),
        (if ((.proofObligations // []) | length) > 0
           and ((.proofObligations // []) | any(
                 (type != "object")
                 or ((.id // "") | type != "string" or length == 0)
                 or ((.kind // .invariant // "") | type != "string" or length == 0)
                 or ((.oracle // "") | type != "string" or length == 0)
               ))
           then "bad_proof_obligations_shape" else empty end),
        (if (.performanceContract // null) != null
           and (
                 ((.performanceContract | type) != "object")
                 or (((.performanceContract.hotPath // []) | if type == "array" then . else [] end) | any(type != "string"))
               )
           then "bad_performance_contract_shape" else empty end),
        (if (.targetJustification // null) != null
           and (
                 ((.targetJustification | type) != "object")
                 or (((.targetJustification.additionalFiles // []) | if type == "array" then . else [] end) | any(type != "string"))
               )
           then "bad_target_justification_shape" else empty end),
        (if ((.claims // []) | length) > 0
           and ((.claims // []) | any(
                 (type != "object")
                 or ((.id // "") | type != "string" or length == 0)
                 or ((.requirement // "") | type != "string" or length == 0)
               ))
           then "bad_claims_shape" else empty end),
        (if ((.pipelineTransitions // []) | length) > 0
           and ((.pipelineTransitions // []) | any(
                 (type != "object")
                 or ((.stage // "") | type != "string" or length == 0)
                 or ((.consumes // "") | type != "string" or length == 0)
                 or ((.produces // "") | type != "string" or length == 0)
               ))
           then "bad_pipeline_transitions_shape" else empty end),
        (if ((.conservationLaws // []) | length) > 0
           and ((.conservationLaws // []) | any(
                 (type != "object")
                 or ((.id // "") | type != "string" or length == 0)
                 or ((.law // "") | type != "string" or length == 0)
               ))
           then "bad_conservation_laws_shape" else empty end)
      ] | first // ""
    ' 2>/dev/null || true
  )"

  if [[ -n "${reason}" ]]; then
    printf '%s\n' "${reason}" >&2
    return 1
  fi
  reason="$(aegis_briefing_question_scope_reason "${json}")"
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

  # Mandatory questions contract: when the Supervisor generates the briefing
  # without pre-supplied operator answers, questions:[] is a quality failure.
  # The Supervisor MUST always surface architectural trade-offs for operator alignment.
  if [[ "${AEGIS_BRIEFING_SOURCE:-}" == "supervisor" ]] \
     && [[ -z "${AEGIS_BRIEFING_ANSWERS:-}" ]]; then
    local q_len
    q_len="$(printf '%s' "${json}" | jq -r '(.questions // []) | length' 2>/dev/null || printf '0')"
    if [[ "${q_len}" == "0" ]]; then
      printf 'missing_questions:supervisor_must_surface_tradeoffs\n' >&2
      return 1
    fi
    if [[ "${q_len}" -gt 3 ]]; then
      printf 'too_many_questions\n' >&2
      return 1
    fi
    if [[ "${q_len}" != "0" ]] && ! printf '%s' "${json}" | jq -e \
      '((.questions // []) | all(.scope == "DEMAND"))' >/dev/null 2>&1; then
      printf 'question_scope_must_be_DEMAND\n' >&2
      return 1
    fi
  fi

  printf '%s' "${json}" | jq -e '
    ([.exports[]?.body[]?
       | select(test("\\* *0n") or test("\\b([A-Za-z0-9_]+)\\b *- *\\b\\1\\b") or test("\\+ *- *\\+"))
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
  printf '{"extends":"%s/tsconfig.json","include":["unit.ts"],"compilerOptions":{"noEmit":true,"rootDir":"."}}' \
    "${root}" > "${dir}/tsconfig.json"

  ln -s "${root}/package.json" "${dir}/package.json" 2>/dev/null || true
  if [[ -d "${root}/node_modules" ]]; then
    ln -s "${root}/node_modules" "${dir}/node_modules" 2>/dev/null || true
  fi

  # Link existing workspace src/ files so relative imports (./sibling.js) resolve
  if [[ -d "${root}/src" ]]; then
    local _src_f _bn
    for _src_f in "${root}/src"/*.ts; do
      [[ -f "${_src_f}" ]] || continue
      _bn="$(basename "${_src_f}")"
      [[ "${_bn}" == "index.ts" ]] && continue
      ln -s "${_src_f}" "${dir}/${_bn}" 2>/dev/null || true
    done
  fi
  local _ts _js
  while IFS= read -r _ts; do
    [[ -n "${_ts}" ]] || continue
    _js="${_ts%.ts}.js"
    if [[ ! -e "${_js}" ]]; then
      ln -s "$(basename "${_ts}")" "${_js}" 2>/dev/null || true
    fi
  done < <(find "${dir}" -name '*.ts' 2>/dev/null || true)

  printf '%s' "${json}" | jq -r '
    def params($p): (($p // []) | map(.name + ": " + .type) | join(", "));
    def lines($l; $pad): (($l // []) | map($pad + .) | join("\n"));

    [ (.imports[]? | "import { \((.names // []) | join(", ")) } from \"\(.from)\";") ]
    + [ "var __targetInstance: any = null, __failingCall: any = null, __targetBefore: any = null, __targetAfter: any = null, __availableCapacity: any = null, __committedResources: any = null, __abortingBatchCall: any = null, __batchRunner: any = null;" ]
    + [ (.types[]? | "type \(.name) = \(.shape);") ]
    + [ (.exports[]?
        | if .kind == "class" then
            "export class \(.name) {"
            + ((.privateFields // []) | map("\n  private " + (if .readonly then "readonly " else "" end) + "\(.name): \(.type);") | join(""))
            + "\n  constructor(" + params(.ctorParams) + ") {\n" + lines(.ctorBody; "    ") + "\n  }"
            + ((.methods // []) | map(
                "\n  \(.name)(" + params(.params) + "): \(.returns // "void") {\n"
                + lines(.body; "    ") + "\n  }") | join(""))
            + ((.getters // []) | map(
                "\n  get \(.name)(): \(.returns // "unknown") { " + (if ((.body // "") | test("^\\s*return\\b")) then (.body // "") else "return " + (.body // "") end) + (if ((.body // "") | test(";\\s*$")) then "" else ";" end) + " }") | join(""))
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
    + [ (.proofObligations // []) | to_entries[]
        | "\(.key)" as $i
        | .value as $po
        | "async function __proof_obligation_\($i)(): Promise<boolean> {\n"
          + lines(($po.prelude // [] | if type == "string" then [.] else . end); "  ")
          + "\n  const __ok\($i): boolean = (\(if ($po.oracle == "typecheck" or $po.oracle == "state_diff" or $po.oracle == "conservation" or $po.oracle == "tsc_no_emit" or $po.oracle == "aggregate_reservation" or $po.oracle == "resource_composition" or $po.oracle == "state_identity_on_abort" or $po.oracle == "commit_atomicity") then "true" else ($po.oracle // "true") end));\n  return __ok\($i);\n}" ]
    + [ (if (((.behavior // []) | length) + ((.proofObligations // []) | length)) > 0 then
          "async function __run_all(): Promise<void> {\n"
          + "  const errs: string[] = [];\n"
          + ([ (.behavior // []) | to_entries[]
               | "  try { if (!(await __behavior\(.key)())) errs.push(\"assert_failed:\(.key)\"); } catch (e: any) { errs.push(\"exception:\(.key):\" + String(e?.message || e)); }"
             ] | join("\n"))
          + (if ((.behavior // []) | length) > 0 and ((.proofObligations // []) | length) > 0 then "\n" else "" end)
          + ([ (.proofObligations // []) | to_entries[]
               | "  try { if (!(await __proof_obligation_\(.key)())) errs.push(\"proof_obligation_failed:\(.value.id // .key)\"); } catch (e: any) { errs.push(\"po_exception:\(.value.id // .key):\" + String(e?.message || e)); }"
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
      function emit(   code, clean_r) {
        if (r == "") return
        match(r, /error TS[0-9]+/)
        code = substr(r, RSTART + 6, RLENGTH - 6)
        clean_r = r
        sub(/^.*unit\.ts/, "unit.ts", clean_r)
        if (r ~ /possibly .(undefined|null)./ || r ~ /undefined. is not assignable/)
          print "tsc-strictnull:" code ": " clean_r
        else
          print "tsc:" code ": " clean_r
      }
      /error TS[0-9]+/ { emit(); r = $0; next }
      r != "" { r = r " " $0 }
      END { emit() }
    ' | sort -u
  )"

  # If compilation cleared without fatal errors, execute behavior assertions
  # in Node via --experimental-strip-types to verify runtime semantics.
  if ! printf '%s' "${classified}" | grep -q '^tsc:' && [[ -f "${dir}/unit.ts" ]]; then
    local node_out node_rc=0
    node_out="$(cd "${dir}" && node --experimental-strip-types "${dir}/unit.ts" 2>&1)" || node_rc=$?
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
  mkdir -p "${AEGIS_ROOT_DIR:-.}/.harness" 2>/dev/null || true
  printf '%s' "${json}" > "${AEGIS_ROOT_DIR:-.}/.harness/active_contract_ir.json" 2>/dev/null || true
  mkdir -p "${AEGIS_RUNTIME_DIR:-${AEGIS_ROOT_DIR:-.}/.harness/runtime}" 2>/dev/null || true
  printf '%s' "${json}" > "${AEGIS_RUNTIME_DIR:-${AEGIS_ROOT_DIR:-.}/.harness/runtime}/active_contract_ir.json" 2>/dev/null || true
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
    ((if ((.exports // []) | length) > 0 then ((.exports | map("- " + .name)) | join("\n")) else (((.publicContract.exports // []) | map("- " + .)) | join("\n")) end)),
    "",
    "## Briefing",
    (if ((.imports // []) | length) > 0
       then ((.imports | map("import { " + ((.names // []) | join(", ")) + " } from \"" + .from + "\";")) | join("\n")) + "\n"
       else empty end),
    (if ((.types // []) | length) > 0
       then ((.types | map("type " + .name + " = " + .shape)) | join("\n")) + "\n"
       else empty end),
    (((.exports // []) | to_entries | map(
      (.key + 1 | tostring) as $n
      | .value as $e
      | if $e.kind == "class" then
          $n + ") export class " + $e.name + ":"
          + (if (($e.privateFields // []) | length) > 0
               then "\n   Campos privados: " + (($e.privateFields | map((if .readonly then "readonly " else "" end) + .name + ": " + .type)) | join(", "))
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
                      "   get " + .name + "(): " + (.returns // "unknown") + " { " + (if ((.body // "") | test("^\\s*return\\b")) then (.body // "") else "return " + (.body // "") end) + (if ((.body // "") | test(";\\s*$")) then "" else ";" end) + " }"
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
    (if ((.questions // []) | length) > 0 then
      ("", "## Architectural Decisions & Questions", (
        (.questions | to_entries | map(
          (.key + 1 | tostring) as $n
          | .value as $q
          | $n + ". " + ($q.question // "")
            + (if (($q.options // []) | length) > 0
               then "\n" + (($q.options | map("   - [ ] " + .)) | join("\n"))
               else "" end)
        )) | join("\n\n")
      ))
    else empty end),
    (if ((.contractReconciliation.pendingQuestions // []) | length) > 0 then
      ("", "## Contract Reconciliation Questions", (
        (.contractReconciliation.pendingQuestions | to_entries | map(
          (.key + 1 | tostring) as $n
          | .value as $q
          | $n + ". " + ($q.question // "")
            + (if (($q.options // []) | length) > 0
               then "\n" + (($q.options | map("   - [ ] " + .)) | join("\n"))
               else "" end)
        )) | join("\n\n")
      ))
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
    (if .version == "3.0" then
      ("", "## UAAM Contract IR v3", "Universal domains: CONTRACT, ADMISSION, STATE, RESOURCE, COMPOSITION, COMMIT, LIFECYCLE, OBSERVABILITY",
       "### Operations", ((.operations // []) | map("- [" + (.id // "OP") + "] " + (.target // "")
         + (if (.admission // null) != null then " | ADMISSION" else "" end)
         + (if (.failure // null) != null then " | STATE" else "" end)
         + (if (.resources // null) != null then " | RESOURCE" else "" end)
         + (if (.composition // null) != null then " | COMPOSITION" else "" end)
         + (if (.transaction // null) != null then " | COMMIT" else "" end)
         + (if (.lifecycle // null) != null then " | LIFECYCLE" else "" end)) | join("\n")),
       "### Proof Matrix", ((.proofObligations // []) | map("- [" + (.id // "PO") + "] " + (.domain // "") + " → " + (.oracle // "") + (if .notApplicable == true then " (N/A: " + (.naJustification // "") + ")" else "" end)) | join("\n")))
    else empty end),
    (if ((.proofObligations // []) | length) > 0 then
      ("", "## Proof Obligations & Invariants", (
        (.proofObligations | to_entries | map(
          (.key + 1 | tostring) as $n
          | .value as $po
          | "- [" + ($po.id // ("PO-" + $n)) + "] " + ($po.invariant // "")
            + (((($po.prelude // []) | if type == "string" then [.] else . end))
               | map("\n   prelude: " + .) | join(""))
            + "\n   oracle: " + ($po.oracle // "")
        )) | join("\n")
      ))
    else empty end),
    (if (.performanceContract // null) != null then
      ("", "## Performance & Allocation Contract", (
        "- Hot-path methods: " + (((.performanceContract.hotPath // []) | join(", ")))
        + "\n- Max heap allocations in hot-path: " + ((.performanceContract.maxAllocations // 0 | tostring))
      ))
    else empty end),
    (if ((.claims // []) | length) > 0 then
      ("", "## Claims Provenance", (
        (.claims | to_entries | map(
          "- [" + (.value.id // ("CLAIM-" + (.key + 1 | tostring))) + "] "
          + (.value.requirement // "")
          + (if ((.value.source // "") | length) > 0 then " (source: " + .value.source + ")" else "" end)
        )) | join("\n")
      ))
    else empty end),
    (if ((.preconditions // []) | length) > 0 or ((.invariants // []) | length) > 0 or ((.postconditions // []) | length) > 0 then
      ("", "## Formal Hoare Contract (Pre / Inv / Post)", (
        (if ((.preconditions // []) | length) > 0 then
          "### Preconditions (Input Guards)\n" + ((.preconditions | map("- " + (.target // "arg") + ": require (" + (.require // "") + ") else throw " + (.error // "RangeError") + (if ((.message // "") | length) > 0 then " (\"" + .message + "\")" else "" end))) | join("\n"))
         else "" end)
        + (if ((.invariants // []) | length) > 0 then
          (if ((.preconditions // []) | length) > 0 then "\n\n" else "" end)
          + "### Class & State Invariants (Rest State)\n" + ((.invariants | map("- [" + (.id // "INV") + "] " + (.predicate // "") + " (checked after: " + (((.checkedAfter // []) | join(", "))) + ")")) | join("\n"))
         else "" end)
        + (if ((.postconditions // []) | length) > 0 then
          (if (((.preconditions // []) | length) + ((.invariants // []) | length)) > 0 then "\n\n" else "" end)
          + "### Postconditions (State Transition Guarantees)\n" + ((.postconditions | map("- " + (.method // "method") + ": " + (.guarantee // ""))) | join("\n"))
         else "" end)
      ))
    else empty end),
    (if ((.pipelineTransitions // []) | length) > 0 then
      ("", "## Pipeline Semantics & Compositional Invariants", (
        (.pipelineTransitions | to_entries | map(
          "- [" + (.value.stage // ("STAGE-" + (.key + 1 | tostring))) + "] Consumes: " + (.value.consumes // "") + " ──► Produces: " + (.value.produces // "")
          + (if ((.value.guarantee // "") | length) > 0 then "\n   guarantee: " + .value.guarantee else "" end)
        )) | join("\n")
      ))
    else empty end),
    (if ((.conservationLaws // []) | length) > 0 then
      ("", "## Universal Conservation Laws", (
        (.conservationLaws | to_entries | map(
          "- [" + (.value.id // ("LAW-" + (.key + 1 | tostring))) + "] " + (.value.law // "")
          + (if ((.value.oracle // "") | length) > 0 then "\n   oracle: " + .value.oracle else "" end)
        )) | join("\n")
      ))
    else empty end),
    (if (.targetJustification // null) != null and (((.targetJustification.additionalFiles // []) | length) > 0) then
      ("", "## Target Justification", (
        "- Additional targets: " + (((.targetJustification.additionalFiles // []) | join(", ")))
        + "\n- Rationale: " + (.targetJustification.reason // "")
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

# Detects if operator answers accept the default recommended options.
# When true, the preliminary schema (which was generated under recommended assumptions)
# can be accepted immediately by stripping questions:[], avoiding a redundant LLM call.
aegis_briefing_answers_are_recommended() {
  local answers="${1-}"
  local schema_json="${2-}"
  [[ -n "${answers}" ]] || return 1
  [[ -n "${schema_json}" ]] || return 1

  # Direct affirmative tokens
  case "$(printf '%s' "${answers}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')" in
    "yes"|"y"|"sim"|"s"|"pode"|"ok"|"recommended"|"all_recommended"|"default"|"aceito")
      return 0
      ;;
  esac

  # Verify if every answer in AEGIS_BRIEFING_ANSWERS contains "(recommended)" or matches option 1
  local non_rec_count
  non_rec_count="$(
    printf '%s\n' "${answers}" \
      | grep -v '^[[:space:]]*$' \
      | grep -vi 'recommended' \
      | grep -v -E '^[[:space:]]*[0-9]+:[[:space:]]*(a|1|\(recommended\))([[:space:]]|$)' \
      | wc -l | tr -d ' '
  )"
  [[ "${non_rec_count}" == "0" ]]
}

# Detect a caller-supplied demand already in the briefing JSON schema (as
# opposed to a free-prose goal). In agentic mode this is the IDE proposal and
# is reconciled with an independent Aegis reconstruction; outside agentic mode
# the legacy direct-schema behavior remains unchanged.
aegis_briefing_is_schema_json() {
  local s="${1-}"
  [[ -n "${s}" ]] || return 1
  printf '%s' "${s}" \
    | jq -e 'type == "object" and ((.goal? | type) == "string") and ((.exports? | type) == "array")' \
    >/dev/null 2>&1
}

# The IDE may provide a complete Contract IR.  The Aegis still reconstructs
# the contract with its independent supervisor model, but comparison must be
# semantic: generated method bodies, object ordering and proof IDs are not
# user-visible intent.  Observable API, behavior, scope, invariants and
# resource/transition guarantees are.
aegis_briefing_contract_semantic_projection() {
  local json="${1-}"
  [[ -n "${json}" ]] || return 1
  printf '%s' "${json}" | jq -S -c '
    {
      version: (.version // "legacy"),
      goal: (.goal // ""),
      targets: ((.targets // []) | sort),
      publicContract: {
        strictSignatures: ((.publicContract.strictSignatures // []) | sort_by(.name // "")),
        forbiddenParams: ((.publicContract.forbiddenParams // []) | sort),
        authorizedEffects: ((.publicContract.authorizedEffects // []) | sort)
      },
      types: ((.types // []) | sort_by(.name // "")),
      imports: ((.imports // []) | map({from: (.from // ""), names: ((.names // []) | sort)}) | sort_by(.from)),
      exports: ((.exports // []) | map(
        del(.body, .ctorBody)
        | .methods = ((.methods // []) | map(del(.body)) | sort_by(.name // ""))
        | .getters = ((.getters // []) | sort_by(.name // ""))
      ) | sort_by(.name // "")),
      barrelFile: (.barrelFile // ""),
      barrelFrom: (.barrelFrom // ""),
      preconditions: ((.preconditions // []) | sort_by((.target // "") + "\u0000" + (.require // ""))),
      invariants: ((.invariants // []) | map(del(.id)) | sort_by(.predicate // "")),
      postconditions: ((.postconditions // []) | sort_by((.method // "") + "\u0000" + (.guarantee // ""))),
      pipelineTransitions: ((.pipelineTransitions // []) | sort_by(.stage // "")),
      conservationLaws: ((.conservationLaws // []) | map(del(.id)) | sort_by(.law // "")),
      performanceContract: (.performanceContract // {}),
      claims: ((.claims // []) | map(del(.id)) | sort_by(.requirement // "")),
      behavior: ((.behavior // []) | map(del(.prelude)) | sort_by(.desc // "")),
      operations: ((.operations // []) | map(del(.id)) | sort_by(.target // "")),
      requirements: ((.requirements // []) | map(del(.id)) | sort_by(.target // "")),
      proofObligations: ((.proofObligations // [])
        | map(del(.id, .prelude, .status))
        | sort_by((.domain // "") + "\u0000" + (.target // "") + "\u0000" + (.oracle // "")))
    }
  '
}

aegis_briefing_contract_digest() {
  local json="${1-}"
  local projected
  projected="$(aegis_briefing_contract_semantic_projection "${json}")" || return 1
  if command -v shasum >/dev/null 2>&1; then
    printf '%s' "${projected}" | shasum -a 256 | awk '{print $1}'
  else
    printf '%s' "${projected}" | cksum | awk '{print $1}'
  fi
}

# Emits a machine-readable comparison.  `equivalent` means that both models
# agree on the contract semantics; it does not require byte-identical JSON.
aegis_briefing_compare_contracts() {
  local ide_json="${1-}"
  local reconstructed_json="${2-}"
  local ide_projection reconstructed_projection ide_digest reconstructed_digest
  ide_projection="$(aegis_briefing_contract_semantic_projection "${ide_json}")" || return 1
  reconstructed_projection="$(aegis_briefing_contract_semantic_projection "${reconstructed_json}")" || return 1
  ide_digest="$(aegis_briefing_contract_digest "${ide_json}")" || return 1
  reconstructed_digest="$(aegis_briefing_contract_digest "${reconstructed_json}")" || return 1

  jq -cn \
    --argjson ide "${ide_projection}" \
    --argjson reconstructed "${reconstructed_projection}" \
    --arg ide_digest "${ide_digest}" \
    --arg reconstructed_digest "${reconstructed_digest}" '
      ["version", "goal", "targets", "publicContract", "types", "imports",
       "exports", "barrelFile", "barrelFrom", "preconditions", "invariants",
       "postconditions", "pipelineTransitions", "conservationLaws",
       "performanceContract", "claims", "behavior", "operations", "requirements",
       "proofObligations"] as $fields
      | ([$fields[] | select($ide[.] != $reconstructed[.])
          | {field: ., ide: $ide[.], reconstructed: $reconstructed[.]}]) as $differences
      | {
          schema: "aegis.contract_reconciliation.v1",
          equivalent: ($differences | length == 0),
          ide_digest: $ide_digest,
          reconstructed_digest: $reconstructed_digest,
          differences: $differences
        }
    '
}

# Independent reconstruction used only for an IDE-supplied Contract IR.  The
# caller's IDE remains the source of the proposed design; this model is an
# independent authority that can expose omitted or contradictory semantics.
aegis_briefing_reconstruct_contract() {
  local original_goal="${1-}"
  local target="${2-}"
  local evidence="${3-}"
  local ide_json="${4-}"
  local context reconstructed
  [[ -n "${original_goal}" && -n "${ide_json}" ]] || return 1

  context="$(printf '%s' "${ide_json}" | jq -c . 2>/dev/null)" || return 1
  reconstructed="$(AEGIS_BRIEFING_SOURCE=supervisor AEGIS_FORCE_REMOTE_SUPERVISOR=1 \
    AEGIS_BRIEFING_MODEL_OVERRIDE="$(aegis_briefing_reconstruction_model)" \
    aegis_briefing_expand_json "${original_goal}" "${target}" "${evidence}" \
      "[INDEPENDENT CONTRACT RECONSTRUCTION]\nReconstruct the ideal Contract IR independently from the original demand and project evidence. Treat the IDE contract below as an untrusted proposal: do not copy it blindly. Preserve explicit user-visible intent, but surface any omitted, contradictory, or invented behavior in the resulting contract.\nIDE CONTRACT JSON:\n${context}")" || return 1
  aegis_briefing_validate_json "${reconstructed}" >/dev/null 2>&1 || return 1
  printf '%s' "${reconstructed}"
}

# Reconciles an IDE contract with the independent Aegis reconstruction.  On
# divergence it deliberately returns a renderable contract containing a
# question, allowing the existing IDE/TTY question gate to pause the run.
aegis_briefing_reconcile_ide_contract() {
  local ide_json="${1-}"
  local original_goal="${2-}"
  local target="${3-}"
  local evidence="${4-}"
  local runtime_dir="${AEGIS_RUNTIME_DIR:-${AEGIS_ROOT_DIR:-.}/.harness/runtime}"
  local reconstructed comparison resolved questions
  [[ -n "${ide_json}" ]] || return 1
  aegis_briefing_validate_json "${ide_json}" >/dev/null 2>&1 || return 1

  mkdir -p "${runtime_dir}" 2>/dev/null || true
  printf '%s' "${ide_json}" > "${runtime_dir}/ide_contract_ir.json" 2>/dev/null || true

  reconstructed="$(aegis_briefing_reconstruct_contract "${original_goal}" "${target}" "${evidence}" "${ide_json}")" || {
    printf '%s\n' '{"schema":"aegis.contract_reconciliation.v1","status":"reconstruction_failed"}' \
      > "${runtime_dir}/contract_reconciliation.json" 2>/dev/null || true
    export AEGIS_CONTRACT_RECONCILIATION_STATUS="reconstruction_failed"
    return 1
  }
  printf '%s' "${reconstructed}" > "${runtime_dir}/reconstructed_contract_ir.json" 2>/dev/null || true
  comparison="$(aegis_briefing_compare_contracts "${ide_json}" "${reconstructed}")" || return 1
  printf '%s' "${comparison}" > "${runtime_dir}/contract_reconciliation.json" 2>/dev/null || true

  if printf '%s' "${comparison}" | jq -e '.equivalent == true' >/dev/null 2>&1; then
    export AEGIS_CONTRACT_RECONCILIATION_STATUS="equivalent"
    resolved="$(jq -c --argjson reconciliation "${comparison}" --arg original_goal "${original_goal}" \
      '.contractReconciliation = ($reconciliation + {status: "equivalent", original_demand: $original_goal})' \
      <<< "${ide_json}")" || return 1
    printf '%s' "${resolved}"
    return 0
  fi

  questions="$(printf '%s' "${comparison}" | jq -c '
    [{
      question: ("O contrato fornecido pelo IDE diverge da reconstrução independente do Aegis nos campos: " + ([.differences[]?.field] | join(", ")) + ". A execução será bloqueada até a divergência ser resolvida. Como deseja proceder?"),
      scope: "AEGIS_RECONCILIATION",
      options: [
        "(Recommended) Corrigir o contrato do IDE e reenviá-lo",
        "Bloquear a execução e revisar a divergência"
      ],
      is_multi_select: false
    }]
  ' 2>/dev/null)" || return 1
  resolved="$(jq -c --argjson questions "${questions}" --argjson reconciliation "${comparison}" \
    --arg original_goal "${original_goal}" \
    '.contractReconciliation = ($reconciliation + {status: "divergent", original_demand: $original_goal, pendingQuestions: $questions})' \
    <<< "${ide_json}")" || return 1
  export AEGIS_CONTRACT_RECONCILIATION_STATUS="divergent"
  export AEGIS_LAST_SCHEMA_JSON="${resolved}"
  printf '%s' "${resolved}"
}

# Calls the supervisor LLM and prints VALIDATED schema JSON on stdout.
# Operates 100% in-memory via curl streaming without creating temporary files on disk.
aegis_briefing_expand_json() {
  local goal="${1-}"
  local target="${2-}"
  local evidence="${3-}"
  local extra_context="${4-}"

  [[ -n "${goal}" ]] || return 1

  if [[ "${AEGIS_AGENTIC:-0}" == "1" ]] && [[ "${AEGIS_FORCE_REMOTE_SUPERVISOR:-0}" != "1" ]]; then
    printf 'agentic_delegated\n' >&2
    return 1
  fi

  local api_base api_key model timeout max_tokens
  api_base="${OPENAI_API_BASE:-https://integrate.api.nvidia.com/v1}"
  api_key="${OPENAI_API_KEY:-${NVIDIA_API_KEY:-}}"
  model="${AEGIS_BRIEFING_MODEL_OVERRIDE:-$(aegis_briefing_model)}"
  timeout="${AEGIS_BRIEFING_TIMEOUT_SEC:-45}"
  max_tokens="${AEGIS_BRIEFING_MAX_TOKENS:-3072}"
  [[ "${max_tokens}" =~ ^[0-9]+$ ]] && [[ "${max_tokens}" -ge 256 ]] || max_tokens=3072

  if [[ -z "${api_key}" ]]; then
    printf 'missing_api_key\n' >&2
    return 1
  fi

  local user_prompt="Demand: ${goal}\nTargets: ${target}

[QUESTION SCOPE RULE]
The questions array is exclusively for decisions about the user's software demand and domain. Ask only about product behavior, architecture, inputs, failures, performance, concurrency, persistence, or other user-visible requirements. Never put Aegis internals, model/provider choice, tokens, runtime, receipts, commits, harness gates, benchmarks, or evidence orchestration in questions. Use scope=DEMAND for every question."
  if [[ -n "${AEGIS_BRIEFING_ANSWERS:-}" ]]; then
    user_prompt="${user_prompt}\n\n[OPERATOR ANSWERS TO ARCHITECTURAL QUESTIONS]\n${AEGIS_BRIEFING_ANSWERS}\n\nCRITICAL: The operator has answered all architectural questions above. You MUST set \"questions\": [] in your JSON output — do not generate any new questions."
  fi
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
  if [[ -n "${extra_context}" ]]; then
    user_prompt="${user_prompt}\n\n${extra_context}"
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
          local _qc_err
          _qc_err="$(aegis_briefing_quality_check "${content}" 2>&1 >/dev/null || true)"
          why="${_qc_err:-low_quality}"
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
      400|401|403|404|405|422) break ;;
      *) backoff=$((attempt * 2)) ;;
    esac
    printf '[AEGIS][BRIEFING][WARN] attempt %s/%s failed (%s http=%s) — retry in %ss\n' \
      "${attempt}" "${max_attempts}" "${fail_reason}" "${http_code}" "${backoff}" >&2
    sleep "${backoff}"
    if [[ -n "${fail_reason}" && "${fail_reason}" == invalid_briefing:* ]]; then
      local clean_feedback
      clean_feedback="$(printf '%s' "${fail_reason}" | sed -E 's|/tmp/[^/]+/||g')"
      if [[ "${clean_feedback}" == *"missing_questions"* \
         || "${clean_feedback}" == *"too_many_questions"* \
         || "${clean_feedback}" == *"question_scope"* \
         || "${clean_feedback}" == *"question_out_of_demand"* ]]; then
        current_user_prompt="${user_prompt}

[QUALITY GATE FAILURE: QUESTION SCOPE OR COUNT]
Your previous questions were invalid. Return at most 3 questions, each with scope=DEMAND, and keep them strictly about the user's product/domain behavior and architecture. Remove questions about Aegis, harness operation, test/repository organization, commits, runtime, providers, tokens, receipts, benchmarks as process, or evidence orchestration."
      else
        current_user_prompt="${user_prompt}

[COMPILATION/RUNTIME FEEDBACK]
Your previous schema failed with: ${clean_feedback}
Please fix the schema methods, types, or behavior asserts to resolve this error."
      fi
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
    # In IDE/agentic mode the supplied schema is the IDE's idealized proposal.
    # Keep the old direct-schema path available outside agentic execution, but
    # use an independent Aegis reconstruction before accepting an IDE contract.
    if [[ "${AEGIS_AGENTIC:-0}" == "1" ]] \
      && [[ "${AEGIS_IDE_CONTRACT_RECONSTRUCTION:-1}" != "0" ]]; then
      local original_goal
      original_goal="${AEGIS_IDE_ORIGINAL_DEMAND:-}"
      if [[ -z "${original_goal}" ]]; then
        original_goal="$(printf '%s' "${goal}" | jq -r '.contractReconciliation.original_demand // .goal // empty' 2>/dev/null || true)"
      fi
      content="$(aegis_briefing_reconcile_ide_contract \
        "$(aegis_briefing_sanitize_json "${goal}")" \
        "${original_goal}" "${target}" "${evidence}")" || {
        printf 'ide_contract_reconstruction_failed\n' >&2
        return 1
      }
    else
      # Non-agentic callers may still provide a prevalidated schema directly.
      content="$(aegis_briefing_sanitize_json "${goal}")"
    fi
    aegis_briefing_validate_json "${content}" 2>/dev/null || {
      printf 'invalid_agentic_briefing\n' >&2
      return 1
    }
    if ! printf '%s' "${content}" | jq -e \
      '.contractReconciliation.equivalent == false' >/dev/null 2>&1; then
      aegis_briefing_quality_check "${content}" 2>/dev/null || {
        printf 'low_quality_agentic_briefing\n' >&2
        return 1
      }
    fi
    aegis_briefing_typecheck_json "${content}" >/dev/null 2>&1 || {
      printf 'uncompilable_agentic_briefing\n' >&2
      return 1
    }
  elif [[ -n "${AEGIS_BRIEFING_ANSWERS:-}" ]]; then
    local _prelim_schema="${AEGIS_PRELIMINARY_SCHEMA_JSON:-}"
    local _prelim_file="${AEGIS_ROOT_DIR:-.}/.harness/runtime/preliminary_briefing_schema.json"
    if [[ -z "${_prelim_schema}" && -f "${_prelim_file}" ]]; then
      _prelim_schema="$(cat "${_prelim_file}" 2>/dev/null || true)"
    fi
    if [[ -n "${_prelim_schema}" ]] && aegis_briefing_answers_are_recommended "${AEGIS_BRIEFING_ANSWERS}" "${_prelim_schema}"; then
      # Operator accepted the recommended options. The preliminary schema was already
      # built under recommended assumptions. Strip questions:[] mechanically (0 tokens, 0ms).
      printf '[AEGIS][BRIEFING] respostas confirmam o recomendado — reutilizando schema preliminar em memória (0 tokens extras)\n' >&2
      content="$(jq -c '.questions = []' <<< "${_prelim_schema}" 2>/dev/null || printf '%s' "${_prelim_schema}")"
    else
      content="$(aegis_briefing_expand_json "${goal}" "${target}" "${evidence}")" || return 1
    fi
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

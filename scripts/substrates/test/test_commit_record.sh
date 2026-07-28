#!/usr/bin/env bash

# =========================================================
# Managed commit record — trailers, pathspec scope, digest
# =========================================================
#
# Contract:
#
# - only commits carrying Aegis-Accept are record (test commits,
#   harness auto-commit and hand-made commits stay invisible)
# - every read is scoped by pathspec (construction commits never
#   leak into the target's record)
# - protected tokens survive multi-token trailers with spaces
# - the rendered message round-trips back through the reader
# - the digest flags a proven token that is no longer in the file
#
# =========================================================

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

# shellcheck disable=SC1091
source "${AEGIS_TEST_ROOT}/scripts/lib/common.sh"
# shellcheck disable=SC1091
source "${AEGIS_TEST_ROOT}/scripts/lib/record.sh"

repo="$(mktemp -d)"

test_cleanup_extra() {
  rm -rf "${repo}"
}

git -C "${repo}" init --quiet
git -C "${repo}" config user.email "test@aegis.local"
git -C "${repo}" config user.name "Aegis Test"
mkdir -p "${repo}/src" "${repo}/scripts"

commit_in_repo() {
  local message="$1"
  shift
  git -C "${repo}" add -- "$@"
  git -C "${repo}" commit --quiet -F - <<< "${message}"
}

# 1. Unmanaged commit on the target: no trailers, never record.
printf 'export function legacy(): number { return 1; }\n' > "${repo}/src/index.ts"
commit_in_repo "feat: add legacy helper" src/index.ts

# 2. Managed commit, single token.
printf 'export function legacy(): number { return 1; }
export function converterBytesEmBits(b: number): number { return b * 8; }
' > "${repo}/src/index.ts"
commit_in_repo "$(
  aegis_record_render_message 12 "add converterBytesEmBits" "converterBytesEmBits"
)" src/index.ts

# 3. Managed commit, multi-token trailer including spaces.
printf 'export function legacy(): number { return 1; }
export function converterBytesEmBits(b: number): number { return b * 8; }
export function converterBytesEmKilobits(b: number): number { return b * 8 / 1000; }
' > "${repo}/src/index.ts"
commit_in_repo "$(
  aegis_record_render_message 13 "add converterBytesEmKilobits" \
    "converterBytesEmKilobits, 8 / 1000"
)" src/index.ts

# 4. Managed-looking commit outside the target scope (harness construction).
printf '#!/usr/bin/env bash\n' > "${repo}/scripts/tool.sh"
commit_in_repo "$(
  aegis_record_render_message 99 "harness tooling" "harnessOnlyToken"
)" scripts/tool.sh

# --- entries: only managed commits, only in scope ---
entries="$(cd "${repo}" && aegis_record_entries src)"
entry_count="$(printf '%s\n' "${entries}" | grep -c . || true)"
[[ "${entry_count}" -eq 2 ]] \
  || fail "expected 2 record entries in src, got ${entry_count}: ${entries}"

printf '%s\n' "${entries}" | grep -q 'harnessOnlyToken' \
  && fail "construction commit leaked into the target record"

printf '%s\n' "${entries}" | grep -q $'\037''13'$'\037''converterBytesEmKilobits, 8 / 1000$' \
  || fail "issue/accept columns not parsed: ${entries}"

# --- pathspec isolation in the other direction ---
scripts_entries="$(cd "${repo}" && aegis_record_entries scripts)"
printf '%s\n' "${scripts_entries}" | grep -q 'harnessOnlyToken' \
  || fail "scoped read of scripts/ lost its own record"
printf '%s\n' "${scripts_entries}" | grep -q 'converterBytesEmBits' \
  && fail "target record leaked into the construction scope"

# --- protected tokens: split, trimmed, unique, spaces preserved ---
tokens="$(cd "${repo}" && aegis_record_protected_tokens src/index.ts)"
for expected in "converterBytesEmBits" "converterBytesEmKilobits" "8 / 1000"; do
  printf '%s\n' "${tokens}" | grep -Fxq -- "${expected}" \
    || fail "protected token missing: ${expected} (got: ${tokens//$'\n'/ | })"
done
token_count="$(printf '%s\n' "${tokens}" | grep -c . || true)"
[[ "${token_count}" -eq 3 ]] \
  || fail "expected 3 protected tokens, got ${token_count}"

# --- digest: proven token still present ---
digest="$(cd "${repo}" && aegis_record_digest src)"
printf '%s\n' "${digest}" | grep -q '2 commits geridos' \
  || fail "digest lost the record count: ${digest}"
printf '%s\n' "${digest}" | grep -q '✓ converterBytesEmBits' \
  || fail "digest did not mark a live token as present"

# --- digest: proven token silently removed from the file ---
printf 'export function legacy(): number { return 1; }
export function converterBytesEmKilobits(b: number): number { return b * 8 / 1000; }
' > "${repo}/src/index.ts"
commit_in_repo "chore: drop a proven export" src/index.ts

digest="$(cd "${repo}" && aegis_record_digest src)"
printf '%s\n' "${digest}" | grep -q '✗ converterBytesEmBits' \
  || fail "digest did not flag a proven token that left the file: ${digest}"
printf '%s\n' "${digest}" | grep -q '✓ converterBytesEmKilobits' \
  || fail "digest wrongly flagged a token that is still present"

# --- record without an issue number (no GitHub in the loop) ---
# Aegis-Accept is the load-bearing field; Aegis-Issue is a pointer. With
# the issue absent the middle field is empty, which a tab-separated read
# would collapse — dropping the tokens and listing nothing.
printf 'export function legacy(): number { return 1; }
export function converterBytesEmKilobits(b: number): number { return b * 8 / 1000; }
export function semIssue(): number { return 2; }
' > "${repo}/src/index.ts"
commit_in_repo "$(
  printf 'aegis: semIssue\n\nAegis-Accept: semIssue\n'
)" src/index.ts

tokens="$(cd "${repo}" && aegis_record_protected_tokens src/index.ts)"
printf '%s\n' "${tokens}" | grep -Fxq -- "semIssue" \
  || fail "record without an issue lost its tokens: ${tokens}"

digest="$(cd "${repo}" && aegis_record_digest src)"
printf '%s\n' "${digest}" | grep -q '✓ semIssue *(sem issue)' \
  || fail "digest did not render a record without an issue: ${digest}"

# --- record without Aegis-Issue (no GitHub in the loop) ---
# Regression: with a tab separator the shell collapses the two delimiters
# around the empty issue field, every value shifts left, and the digest
# reports a count with no rows.
no_issue_repo="$(mktemp -d)"
git -C "${no_issue_repo}" init --quiet
git -C "${no_issue_repo}" config user.email "test@aegis.local"
git -C "${no_issue_repo}" config user.name "Aegis Test"
mkdir -p "${no_issue_repo}/src"
printf 'export function somaSegura(): number { return 1; }\n' \
  > "${no_issue_repo}/src/a.ts"
git -C "${no_issue_repo}" add -A
printf 'aegis: somaSegura\n\nAegis-Accept: somaSegura\n' \
  | git -C "${no_issue_repo}" commit --quiet -F -

no_issue_tokens="$(cd "${no_issue_repo}" && aegis_record_protected_tokens src/a.ts)"
printf '%s\n' "${no_issue_tokens}" | grep -Fxq 'somaSegura' \
  || fail "record without Aegis-Issue lost its protected token"

no_issue_digest="$(cd "${no_issue_repo}" && aegis_record_digest src)"
printf '%s\n' "${no_issue_digest}" | grep -q '✓ somaSegura' \
  || fail "digest listed no rows for a record without an issue: ${no_issue_digest}"
rm -rf "${no_issue_repo}"

# --- empty record stays empty (no seeding, no invention) ---
empty_repo="$(mktemp -d)"
git -C "${empty_repo}" init --quiet
git -C "${empty_repo}" config user.email "test@aegis.local"
git -C "${empty_repo}" config user.name "Aegis Test"
mkdir -p "${empty_repo}/src"
printf 'export const x = 1;\n' > "${empty_repo}/src/index.ts"
git -C "${empty_repo}" add -A
git -C "${empty_repo}" commit --quiet -m "feat: initial"

empty_tokens="$(cd "${empty_repo}" && aegis_record_protected_tokens src/index.ts)"
[[ -z "${empty_tokens}" ]] \
  || fail "unmanaged history produced protected tokens: ${empty_tokens}"
empty_digest="$(cd "${empty_repo}" && aegis_record_digest src)"
printf '%s\n' "${empty_digest}" | grep -q 'nenhum commit gerido ainda' \
  || fail "empty record digest did not report an empty record"
rm -rf "${empty_repo}"

echo "[AEGIS][TEST][PASS] commit record: scope, trailers, digest"

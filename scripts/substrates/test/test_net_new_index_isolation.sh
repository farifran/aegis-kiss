#!/usr/bin/env bash

# =========================================================
# AEGIS TEST — NET-NEW INDEX ISOLATION
# =========================================================
#
# Proves that net-new file creation through the aider mutation substrate
# NEVER pollutes the operator's main git index.
#
# Reproduces production faithfully: the execution surface is a linked
# `git worktree` (NOT a standalone `git init` repo), and the parent passes
# AEGIS_MUTATION_GIT_DIR pointing at the MAIN `.git` — exactly as
# runtime_aegis.sh does. The substrate must scope its mutation git
# operations (intent-to-add pre-materialization, diff, rollback) to the
# worktree's own disposable index, so the `git add --intent-to-add` used
# to make a net-new file visible in `git diff HEAD` can never leave a
# phantom staged entry in the operator's index.
#
# Fail-powered: without surface-scoped git-dir, the intent-to-add lands in
# the main index and `git ls-files` in the main repo reports the phantom
# path — this suite then goes red.
#
# =========================================================

source "$(dirname "${BASH_SOURCE[0]}")/_test_lib.sh"

test_tmp="$(mktemp -d)"
main_repo="${test_tmp}/main"
surface="${test_tmp}/surface"
payload_dir="${test_tmp}/payloads"
fake_aider="${test_tmp}/fake-aider"
net_new_target="src/newModule.ts"

# config.sh hard-assigns AEGIS_EPISTEMIC_HANDOVER_FILE to the real runtime
# path when the substrate sources it, so the fixture handover must be
# written there. _test_lib restores the operator's handover on EXIT.
backup_epistemic_handover
handover_file="${AEGIS_EPISTEMIC_HANDOVER_FILE}"
mkdir -p "$(dirname "${handover_file}")"

test_cleanup_extra() {
  git -C "${main_repo}" worktree remove --force "${surface}" >/dev/null 2>&1 || true
  rm -rf "${test_tmp}"
}

# --- Main repo with one commit -------------------------------------------
mkdir -p "${main_repo}/src"
printf 'export {};\n' > "${main_repo}/src/index.ts"
git -C "${main_repo}" init -q
git -C "${main_repo}" -c user.name="Aegis Test" -c user.email="aegis-test@example.invalid" add src/index.ts
git -C "${main_repo}" -c user.name="Aegis Test" -c user.email="aegis-test@example.invalid" commit -qm "seed"

# --- Linked worktree surface (production shape) --------------------------
git -C "${main_repo}" worktree add --detach -q "${surface}" HEAD

mkdir -p "${payload_dir}"

# Forensics handover proposing the NET-NEW file as the repair candidate.
jq -n --arg t "${net_new_target}" '
  {
    artifact_snapshot: {
      mode: "forensics",
      operational_context: {
        repair_candidates: [
          { id: $t, reason: "create net-new module", evidence_refs: ["filesystem.search_symbol"] }
        ]
      }
    },
    epistemic_state: {
      next_attention_targets: [$t],
      attention_scope: "evidence-backed interpretation",
      attention_reason: "create net-new module"
    }
  }
' > "${handover_file}"

# fake aider: writes content into the (pre-materialized) net-new target.
cat > "${fake_aider}" <<'SH'
#!/usr/bin/env bash
set -Eeuo pipefail
target=""
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --file) target="$2"; shift 2 ;;
    *) shift ;;
  esac
done
[[ -n "${target}" ]] || exit 3
printf 'export const answer = (): number => 42;\n' > "${target}"
SH
chmod +x "${fake_aider}"

output="$(
  env \
    OPENAI_API_KEY="test-key" \
    AEGIS_MODE="repair" \
    AEGIS_EXECUTION_ID="test-execution" \
    AEGIS_EXECUTION_SURFACE_PATH="${surface}" \
    AEGIS_INVESTIGATION_INPUT="crie ${net_new_target}" \
    AEGIS_MUTATION_MODEL="aegis-test-frontier-model" \
    AEGIS_AIDER_BIN="${fake_aider}" \
    AEGIS_MUTATION_GIT_DIR="${main_repo}/.git" \
    bash scripts/substrates/aider_substrate.sh \
      ".skills/repair.md" \
      "${payload_dir}"
)"

# The substrate must succeed and the diff must show the net-new file.
artifact="$(extract_first_artifact_payload "${output}")"
printf '%s\n' "${artifact}" \
  | jq -e --arg t "${net_new_target}" '.files_changed == [$t]' >/dev/null \
  || fail "net_new_mutation_artifact_invalid"

# CORE INVARIANT (fail-powered): the operator's MAIN index must be pristine
# — no phantom intent-to-add entry for the net-new target.
if git -C "${main_repo}" ls-files --error-unmatch "${net_new_target}" >/dev/null 2>&1; then
  fail "main_index_polluted_with_net_new_target: ${net_new_target}"
fi

# And the main working tree must be clean (no leaked residue/staging).
[[ -z "$(git -C "${main_repo}" status --porcelain)" ]] \
  || fail "main_repo_not_clean_after_net_new_mutation: $(git -C "${main_repo}" status --porcelain | tr '\n' ';')"

echo "[PASS] net-new file creation leaves the operator index pristine"

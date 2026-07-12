# MODE 2 — OPTIMIZE

## PURPOSE
Optimize is a **bounded refinement mutation** on the Repair result already applied to the disposable execution surface.

Mission:
1. **Recognize** what Repair produced (the applied candidate on the loaded targets).
2. **Improve** it when a safe, functionality-preserving simplification exists (less redundancy, clearer structure, tighter types, fewer dead branches) **inside the same files**.
3. If the Repair result is already minimal and correct, make **no further edits** — the runtime will mark `no_optimization_needed` when the captured diff is identical to the Repair candidate.

Optimize is not a second Repair. It does not re-implement the investigation demand from scratch.

## LAYER 0 / SCOPE
- Targets are the files listed in the Repair handover (`files_changed`) plus any operator-named paths already loaded into the mutation chat.
- The Repair candidate has **already been applied** on the execution surface before you run.
- Respect high-gravity exports: never rename/remove public interfaces that would cascade breakage for a "cleaner" rewrite.

## CONSTRAINTS
1. **Mutate only loaded targets** — no new files, no renames, no scope expansion.
2. **Preserve behavior** of the Repair result and of all code the demand did not touch.
3. **Do not re-apply** the investigation demand as if Repair never ran.
4. **Do not strip** features Repair correctly added.
5. Prefer small, local simplifications over architectural rewrites.
6. No conversational prose in the edit reply — edits only (aider whole/diff format).

## SUCCESS CRITERIA
- Safe cleanup observed on the surface (fewer redundant lines, clearer control flow, strict types) **or**
- Surface left identical to the post-Repair state when no safe win exists.

## FAILURE POLICY
If the Repair candidate is missing or the surface is empty of targets, do not invent scope — stop without speculative edits. The runtime owns fatal preconditions.

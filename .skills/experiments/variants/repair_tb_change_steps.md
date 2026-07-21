# REPAIR — edit instructions (Aider)

You edit **only** the file(s) already in this chat. Reply with **edits only** (whole-file or search/replace). No JSON. No prose. No questions.

The investigation demand **must** be implemented (never skip the task). Be lazy about *how*, not about *whether* — and **not** lazy about *what the demand actually required*.

## Ladder (stop at the first step that works)
1. **Already here?** MUTATION BRIEF / EXPORTS NOW — reuse or **edit** an existing export if it matches the demand; do not re-implement beside it.
2. **One export / one change?** Prefer a single public export (one `export function` / `export class` / re-export). Methods on that export are fine. No parallel APIs (`foo` + `fooExact`), demos, or unsolicited helpers.
3. **Stdlib / language globals?** Use them (Math, BigInt, …). Do not add npm packages for what the language already has.
4. **Demand fidelity** (below) — the body must satisfy **stated constraints**, not only Acceptance names.
5. **Shortest correct diff** — only after fidelity. Boring over clever. Fewest lines that satisfy ALVO reason + demand direction (e.g. "X para Y" → convert **X → Y**, not reverse). Changed lines should use demand tokens / direction so the diff matches DEMAND ANCHORS / ALVO reason.

If **ALVO** / **MUTATION BRIEF** / **REPAIR FEEDBACK** appear later in this prompt, obey them over free invention. On REPAIR FEEDBACK: fix only listed violations inside listed scopes.

---

## Demand fidelity (general — any demand)

**Acceptance names alone are not “done”.** If Goal / Change / ALVO / structured headers state a constraint, the **file body** must show it.

### Extract constraints (only from this prompt — never invent)

Treat as a constraint anything the demand **explicitly** states as required behavior or shape, for example:

| Kind (abstract) | Witness in the body (must exist if demand states it) |
|-----------------|------------------------------------------------------|
| Named **public** operations | Function/method/export with that role (name or clear equivalent) |
| **Input/output units** or dual units (public vs internal) | Types/params/fields **and** conversion or scale, not a single opaque number with no link to the named units |
| **When** something runs (lazy, on each call, on construct, once, …) | Control flow that matches that timing |
| **State encoding** (bits, flags, enums, status codes described in demand) | Ops/constants matching the described encoding — not unrelated packing |
| **Ordering / direction** (A→B, not B→A) | Formula, names, or steps in that direction |
| **Numeric / formula** facts given in demand | Appears in the implementation (literal or equivalent) |
| Numbered / bulleted **Change steps** | Each step has a corresponding path in the body |

Skip marketing prose. Only **actionable** statements count.

### Self-check before you stop editing

1. List (mentally) constraints from Goal + Change + ALVO + REPAIR FEEDBACK — not only Acceptance.  
2. For each: is there a **witness** in the final body?  
3. If a witness is missing → keep editing **in the same file(s)** until it exists or the demand truly never required it.  
4. If the demand is ambiguous → smallest **literal** reading that still covers every explicit constraint; then stop.  
5. Do **not** add features, files, packages, or public APIs the demand did not ask for.

### Anti-patterns (wrong “done”)

- Export/method **names** match Acceptance, but body ignores units, timing, encoding, or steps in Change.  
- Stub / placeholder behavior that only satisfies the typechecker.  
- Re-encoding unrelated data when the demand specified a particular state layout.  
- Implementing the reverse conversion or the opposite direction of the demand.

---

## Don't
- Edit other paths, create *new* paths, rename files, or expand scope. (Loaded empty/stub targets: write the full implementation the demand needs.)
- Invent features not in the demand / ALVO reason.
- Ask for clarification — pick the smallest literal reading that still meets demand fidelity, then stop.

## TypeScript (when editing .ts)
- Prefer explicit types on new public APIs; no `any` / `as any` / `@ts-ignore`. Keep the file compiling.
- Relative imports: `from './file.js'` (NodeNext).
- Do not import language globals as npm packages.
- Do not rename existing exports unless the demand says so.

---
# Teach-back experiment: tb_change_steps

## Teach-back (Change steps only)

Ignore Acceptance labels for the “done” test.

1. Take only numbered/bulleted **Change** (and ALVO reason if present).  
2. Rewrite each as silent obligation: `code must <verb> <object>`.  
3. Implement until every obligation has a line witness in this file.  
4. Acceptance names must still appear if the demand lists them — as part of those obligations, not instead of them.  

No new files/exports. Edits only.

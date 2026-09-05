Language: [Português (Brasil)](README.pt-BR.md)

# Aegis Harness

Aegis is a small evidence-governance layer for IDE-driven software work. The
IDE discovers code, asks product questions, edits files and reacts to errors.
Aegis binds that work to a contract, checks scope and proofs, and authorizes a
commit only when the staged state matches verified evidence.

```text
IDE    → discovery, reading, interaction, editing and fast feedback
Aegis  → contract/evidence coherence, proof profiles, receipt and promotion
```

## Use from an IDE

```bash
./aegis "Describe the requested change" --target src
# The IDE performs one semantic compilation; Aegis finalizes demand + contract + proofs.

git add <files>
./aegis authorize
git commit -m "..."
```

Available commands:

- `./aegis "<demand>"`: starts a `PRODUCT` execution, freezes a clean baseline
  in transient runtime state and returns the compact semantic request. Every
  persistent product artifact must live in `src/`.
- `./aegis harness "<demand>"`: explicitly starts maintenance of Aegis itself;
  only this mode may authorize paths outside `src/`.
- `./aegis finalize …`: validates one semantic decision and persists the
  clarified demand, Contract IR v2 and proof registry together. It consumes
  the frozen intake instead of rediscovering a mutable worktree. Confirming a proposed
  interpretation is mechanical; only a correction requires another model call.
- `./aegis review …`: prepares an optional independent semantic review for a
  high-risk or forensic execution.
- `./aegis status`: shows evidence state and working-tree state.
- `./aegis evidence --path …`: creates an optional, bounded and transient
  mechanical inventory for a receipt or forensic investigation. It only reads
  explicitly declared paths, never sends code to a prompt and has no cache
  between demands.
- `./aegis authorize`: is the single promotion gate. It selects the profile,
  runs structural checks and applicable proofs once, then binds a receipt to
  the exact staged diff. The pre-commit hook only reissues an expired or stale
  receipt when the index actually changed.
- `./aegis report`: derives a compact forensic report from Git and the
  pre/post-commit receipts; it does not ask a model to invent measurements.
- `./aegis clean [--src|--all]`: starts a new demand by atomically clearing
  transient runtime state, `src/` and the active contract/proof metadata.
  `--src` and `--all` remain equivalent compatibility aliases.

There is no autonomous CLI coder, provider configuration or TTY workflow.
Surgical-edit discipline is retained by requiring a minimal diff, local
checks, proof execution, a staged manifest and a receipt.

Demand-specific governance records live in `src/.aegis/` beside the product
state they govern. `.harness/` contains only universal rules and ignored
runtime data, so executing a product demand never rewrites the harness core.

## Evidence profiles

| Profile | Purpose |
| --- | --- |
| `fast` | inexpensive deterministic health checks |
| `targeted` | proofs affected by the diff |
| `release` | full release obligations |
| `forensic` | benchmark, chaos and investigation evidence |

The project declares domain-specific proofs in its contract and proof
registry. The Aegis core does not accumulate blockchain, payment or other
domain tests.

`npm test` keeps deterministic harness checks. `./aegis review …` prepares the
optional independent-model review only for high-risk or forensic executions.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the formal model.

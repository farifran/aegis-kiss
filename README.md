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
# The IDE performs one semantic compilation; Aegis finalizes demand + contract.

./aegis verify
git add <files>
git commit -m "..."
```

Available commands:

- `./aegis "<demand>"`: returns an in-memory normalized preflight envelope for
  the IDE; it does not persist the raw demand.
- `./aegis finalize …`: validates one semantic decision and persists the
  clarified demand and Contract IR v2 together. Confirming a proposed
  interpretation is mechanical; only a correction requires another model call.
- `./aegis review …`: prepares an optional independent semantic review for a
  high-risk or forensic execution.
- `./aegis status`: shows evidence state and working-tree state.
- `./aegis evidence --path …`: creates an optional, bounded and transient
  mechanical inventory for a receipt or forensic investigation. It only reads
  explicitly declared paths, never sends code to a prompt and has no cache
  between demands.
- `./aegis verify [--profile …]`: runs structural checks and applicable proofs.
- `./aegis proofs [--profile …]`: runs only the selected proof profile.
- `./aegis authorize`: optionally creates the receipt before committing; the
  pre-commit hook automatically renews it for the exact staged diff.
- `./aegis clean [--src|--all]`: removes transient runtime state; `--src` also
  resets the product and its contract/proof pair together.

There is no autonomous CLI coder, provider configuration or TTY workflow.
Surgical-edit discipline is retained by requiring a minimal diff, local
checks, proof execution, a staged manifest and a receipt.

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

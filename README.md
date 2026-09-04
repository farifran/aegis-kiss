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
# The IDE creates or updates the demand contract and the code.

./aegis verify
git add <files>
git commit -m "..."
```

Available commands:

- `./aegis "<demand>"`: records demand provenance for the IDE.
- `./aegis status`: shows evidence state and working-tree state.
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

See [ARCHITECTURE.md](ARCHITECTURE.md) for the formal model.

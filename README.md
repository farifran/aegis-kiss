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

The semantic supervisor is separate from the code executor. By default it is
the model currently selected in the IDE. It can instead be an external,
OpenAI-compatible model (including a local Ollama/vLLM endpoint); the IDE
still owns questions, edits, tests and implementation.

```bash
./aegis setup
# The IDE renders the selection and collects any required fields.
./aegis setup ide
./aegis setup external --endpoint http://127.0.0.1:11434/v1 --model llama3.2:11b
./aegis setup show
```

For a provider requiring credentials, provide the name of an environment
variable rather than a secret value:

```bash
./aegis setup external --endpoint https://provider.example/v1 --model model-id --api-key-env PROVIDER_API_KEY
```

The selected supervisor is bound to the frozen preflight envelope. External
execution receives only the semantic request and records model identity,
timing, provider token usage when available, and the decision digest. The
promotion receipt carries that binding; it never contains API keys or raw
model output.

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
  For a forensic contract, the IDE automatically dispatches an isolated
  independent review before persistence; this is never a user step.
- `./aegis review …`: exposes the internal review-request builder for
  diagnostics; normal executions dispatch it automatically.
- `./aegis status`: shows evidence state and working-tree state.
- `./aegis setup`: emits an IDE-interactive selection. `ide` uses the active
  IDE model; `external` collects endpoint and model, then calls the configured
  OpenAI-compatible endpoint only for demand-to-decision compilation.
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

There is no autonomous CLI coder. The only optional provider integration is
the bounded external semantic supervisor configured through `setup`.
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

`npm test` keeps deterministic harness checks. High-risk or forensic contracts
always receive an isolated independent review automatically after any user
clarifications and before persistence.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the formal model.

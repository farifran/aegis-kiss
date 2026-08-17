# Universal Engineering Core (PonyTail Discipline)
<!-- KV-Cache Alert: Kept concise (<15 lines, ~200 tokens) for Byte-0 prefix cache efficiency -->
1. **Strict Types & Zero Any**: Never use `any` or ambiguous types. Require explicit return types and safe narrowing (`unknown`).
2. **Immutability & Pure Functions**: Prefer pure functions without hidden side effects. Mark public payloads/fields as `readonly`/`frozen`.
3. **Guard Clauses & Non-Negativity**: Validate argument limits and physical quantities (`arg <= 0`) in early guard clauses at the top of methods.
4. **Single Source of Truth**: Never store redundant mutable state flags; derive dynamic state via pure computed getters.
5. **Typed Domain Errors**: Forbid empty catch blocks or throwing raw generic strings; use typed domain errors.

## [typescript]
* **Stack**: Pure Vanilla TypeScript with NodeNext ESM (`import { fn } from './file.js'`). Zero external dependencies.
* **Math & Scale**: Use `BigInt` with pre-scaled integers (`Math.round(rate * 1_000_000)`) and multiply before dividing `(time * rate) / scale`.
* **Entrypoints**: New module interfaces and functions in `src/` must be re-exported in `src/index.ts`.

## [python]
* **Stack**: Python 3.11+ with strict PEP 484 Type Hints (`mypy`/`pyright`). Zero untyped `Any`.
* **Data & State**: Use `@dataclass(frozen=True)` or `NamedTuple` for immutable payloads. Snake_case for functions/modules, PascalCase for classes.
* **Entrypoints**: Public exports in `src/` must be exposed in `src/__init__.py` with `__all__`.

## [rust]
* **Stack**: Modern Rust (2021 edition). Zero `unsafe` blocks.
* **Errors & Types**: Explicit `Result<T, E>` and `Option<T>`. Immutability by default; minimal `mut`.
* **Entrypoints**: Public structs and traits in `src/` must be re-exported in `src/lib.rs`.

## [go]
* **Stack**: Go 1.21+ with `go.mod`.
* **Errors & State**: Explicit `if err != nil` handling. Zero `panic()` in business logic.
* **Encapsulation**: Capitalized identifiers for public API; private structs for internal state.

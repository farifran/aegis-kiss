# Language Facet: Rust (Safe & Idiomatic)
* **Stack**: Modern Rust (2021 edition). Zero `unsafe` blocks.
* **Errors & Types**: Explicit `Result<T, E>` and `Option<T>`. Immutability by default; minimal `mut`.
* **Entrypoints**: Public structs and traits in `src/` must be re-exported in `src/lib.rs`.

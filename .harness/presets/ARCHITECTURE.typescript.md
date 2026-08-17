# Language Facet: TypeScript (NodeNext ESM)
* **Stack**: Pure Vanilla TypeScript with NodeNext ESM (`import { fn } from './file.js'`). Zero external dependencies.
* **Math & Scale**: Use `BigInt` with pre-scaled integers (`Math.round(rate * 1_000_000)`) and multiply before dividing `(time * rate) / scale`.
* **Entrypoints**: New module interfaces and functions in `src/` must be re-exported in `src/index.ts`.

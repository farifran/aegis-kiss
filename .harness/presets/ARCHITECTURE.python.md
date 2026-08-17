# Language Facet: Python (PEP 484 & Native-First)
* **Stack**: Python 3.11+ with strict PEP 484 Type Hints (`mypy`/`pyright`). Zero untyped `Any`.
* **Data & State**: Use `@dataclass(frozen=True)` or `NamedTuple` for immutable payloads. Snake_case for functions/modules, PascalCase for classes.
* **Entrypoints**: Public exports in `src/` must be exposed in `src/__init__.py` with `__all__`.

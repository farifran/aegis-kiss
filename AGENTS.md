### AEGIS COGNITION CONTRACT (AGENTS.md)

1. RUNTIME AUTHORITY
Interpret only the authority explicitly delegated by the runtime. Do not assume permissions, repository knowledge, intent, or state beyond the provided capabilities and evidence.

2. EVIDENCE DISCIPLINE
Reason only from runtime-exposed evidence. Never invent facts, fill gaps, speculate, or substitute missing evidence with assumptions.

3. KISS
Prefer explicit, local, deterministic implementations. Avoid speculative abstractions, hidden behavior, unnecessary indirection, or premature generalization.

4. EPHEMERAL COGNITION
You do not own orchestration, memory, or persistence. Perform only the cognition requested by the current mode and produce only the required artifact.

5. DEMAND LAYERS (issue intake)
Do not mix these layers when expanding or implementing a demand:

| Layer | Holds | Does not hold |
|-------|--------|----------------|
| Schema | JSON shape, field names, kinds, idents, path syntax | Business formulas |
| Rules | Universal TS laws (no BigInt-as-type, no Math.min on bigint, getters vs `_private`) | Feature-specific constants |
| Briefing | This demand's physics (mbps*8000, time delta, bitmask bits) | Global style rules |

Acceptance is always derived from exported names — never constructor params or private fields.
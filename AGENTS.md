# AGENTS.md — Aegis Harness Constitutional Foundation

> [!WARNING]
> The prompt-based execution path is deprecated and will be removed in the next architectural revision. The canonical execution interface is an Engineering Plan.

## Purpose

Aegis Harness is a runtime-sovereign architecture for bounded cognition and controlled mutation.

This document is the constitution of the system.
It defines authority, boundaries, responsibilities, and invariants.

---

## Constitutional Principles

### Runtime Sovereignty

The runtime owns orchestration, lifecycle, capability exposure, cleanup, artifact promotion, persistence decisions, and continuity handling.

The model owns no authority.
The model owns no persistence.
The model owns no mutation boundaries.
The model consumes only what the runtime exposes.

### Explicit Capability Exposure

Repository awareness must be explicit.

The model may reason only over runtime-exposed capabilities, runtime-exposed evidence, manifests, capability payloads, and epistemic handover artifacts when the runtime explicitly exposes them.

Implicit repository inheritance is not allowed.

### Disposable Cognition

Cognition is disposable.

Reasoning may occur during execution, but reasoning itself is not evidence, not truth, not memory, and not an epistemic handover.

No hidden cognition survives across modes.

### Operational Memory Discipline

Aegis has exactly three operational surfaces for evidence and continuity:

- Capability payloads are runtime-owned evidence.
- Epistemic handover is transient attention, not truth, not evidence, and not memory.
- Git is persistent memory.

No other intermediate continuity or operational memory surface exists.

### Bounded Mutation

Mutation must remain bounded to explicit authorized surfaces.

Mutation may occur only within runtime-defined scope and capability boundaries.

### Epistemic Separation

The system must separate observation, interpretation, falsification, correction, and verification.

Not all responsibilities belong to the same mode.

### Epistemological Layer Model

The system operates on a strict three-tier epistemological separation:

| Layer | Runtime Component | Epistemic Role |
|---|---|---|
| Perception | Structural Builder | O que existe — what exists |
| Attention | Discovery | O que investigar — what to investigate |
| Interpretation | Forensics | O que significa — what it means |

**Corollary: information can only flow downward.**
- Structural Builder reads the filesystem. It produces structural facts.
- Discovery reads structural facts. It does not read file content.
  Therefore Discovery cannot speak about what code does.
- Forensics reads file content AND structural facts. It interprets meaning.

**The boundary rule:**
Topology position does not reveal function.
Only file content reveals function.
File content reading belongs to Forensics.
Discovery therefore speaks only about what the investigation must do —
never about what the system does.

---

## Constitutional Model

Aegis is organized around a layered runtime topology.

### Layer 1 — Constitutional Foundation

Layer 1 defines the fixed rules, constitutional semantics, and governance boundaries.

Primary Layer 1 artifact:

- `AGENTS.md`

### Layer 2 — Operational Runtime

Layer 2 implements the runtime mechanics that enforce Layer 1.

### Layer 3 — Future Capability Runtime

Layer 3 is a future evolution of the runtime and must not be assumed or invented prematurely.

---

## Investigation Scope

Prompts and issues define an investigation input for the runtime.

The runtime may preserve unresolved attention only as transient runtime-owned guidance.

The runtime must not introduce a hidden continuity surface or a separate intermediate demand file.

---

## Evidence and Memory

### Capability Payloads

Capability payloads are runtime-exposed evidence.

They are not memory.
They are evidence.

### Epistemic Handover

Epistemic handover is transient runtime-owned attention guidance.

It is not truth.
It is not evidence.
It is not interpretation.
It is not memory.

### Git

Git is persistent memory.

Git preserves accepted structural changes, code evolution, and official documentation.

---

## Runtime Responsibilities

The runtime owns:

- capability exposure
- artifact promotion
- mode routing
- task framing
- cleanup
- continuity handling
- execution isolation

The runtime must not introduce any hidden memory surface.
The runtime must not allow the model to silently inherit authority.

---

## Execution Surface

The execution surface is disposable.

Every execution should occur in a bounded and transient execution surface.

The execution surface must not become hidden persistent state.

---

## Capability Rules

Every capability must be explicitly named, classified, contracted, and handler-mapped.

Capabilities must not be ambiguous.
Capabilities must not imply broader authority than declared.
Readonly capability surfaces must remain readonly.
Mutation capabilities must remain bounded.

### Filesystem Exposure

Some runtime-owned files may be exposed through generic capabilities when the runtime decides they belong in the evidence surface.

The runtime decides which paths are exposed.

Capabilities must not hardcode fallback paths, autodiscover repository paths, or duplicate runtime policy.

---

## Governance and Precedence

Precedence order:

1. this constitution
2. runtime policy
3. capability contracts and manifests
4. mode skills
5. transient runtime artifacts
6. git history

Lower layers must not contradict higher layers.

If a lower layer conflicts with this constitution, this constitution wins.

---

## Proven / Intended / Deferred

### Proven

- runtime sovereignty
- capability exposure
- runtime-exposed evidence
- capability payload evidence
- disposable cognition
- bounded mutation
- transient epistemic guidance

### Intended

- stricter separation of observation and interpretation
- stronger capability coercion
- more explicit continuity handling

### Deferred

- distributed runtime execution
- advanced sandboxing layers
- cross-provider protocol normalization

---

## Non-Negotiable Constraints

- No hidden operational memory surface.
- No implicit repository inheritance.
- No model-owned persistence.
- No intermediate operational memory surface beyond capability payloads, ephemeral epistemic guidance, and git.
- No mutation outside authorized surfaces.
- No interpretation masquerading as observation.
- No validation masquerading as discovery.
- No epistemic handover masquerading as truth.
- Discovery must never repeat metrics, counts, or structural facts (e.g. node counts, edge counts, bridge counts) already present in the structural_context.
- Discovery must stop describing/narrating the topology structure and exclusively produce: attention priorities, gaps, recommended next actions, and investigative strategy (what to do with what exists, rather than what exists). Qualitative interpretation (hypotheses and risks) belongs exclusively to Forensics.

---

## Summary

Aegis is a runtime-sovereign, capability-exposed architecture for bounded cognition.

The runtime owns authority and operational memory boundaries.
The model consumes only runtime-exposed evidence.

Git is the only persistent memory.

Discovery directs attention.
Forensics interprets.
Repair corrects.
Optimize simplifies.
Adversarial challenges.
Validation judges.

The runtime does not invent intermediate memory.

Everything else is disposable.

# ADR-0003: Conflict Resolution Policy (CRDT-Light + Tombstones)

- Status: accepted
- Date: 2026-03-05
- Owners: Sync and merge

## Context

Askesis must merge local and remote states across unreliable networks and offline edits.
Full CRDT frameworks are powerful but heavy for this product scope.

## Decision

Adopt a CRDT-light policy.

### Habit level (`services/dataMerge/merge.ts`)

- Match by canonical id first
- `habit.deletedOn` wins for deletions; the latest `deletedOn` is kept
- Apply conservative dedup heuristics for likely duplicates
- Escalate ambiguous dedup cases to user confirmation modal

### Bitmask level (`HabitService.mergeLogValues`)

The unit of resolution is the 3-bit block of one slot (habit × day × period).
It is an **LWW-Register with union on absence**:

```
winnerBlock !== 000 -> winnerBlock
winnerBlock === 000 -> loserBlock
```

The winner is the `AppState` with the newer `lastModified`, selected in `mergeStates`.

Two rules follow, and both are load-bearing:

1. **The slot tombstone (`100`) has no unconditional priority.** It is one value
   among others, subject to the same LWW. Making it absorbing (the pre-2026-08
   behaviour) meant a stale replica's tombstone silently reverted a newer
   re-check — including on the very device that made it.
2. **Never combine blocks with bitwise OR.** OR mixes bits across distinct
   states and fabricates invalid values (`DONE 001 | DEFERRED 010 = DONE_PLUS 011`).
   All block combination goes through `HabitService.mergeLogValues`.

Orchestrated in `services/cloud.ts`.

## Alternatives considered

- Full CRDT library adoption
- Remote-wins always
- Local-wins always
- **Per-slot timestamp vector.** Rejected: 93 slots × 8 bytes per habit-month
  against ~35 bytes for the whole bitmask today (~20× blowup on data that is
  encrypted, sharded, gzipped and pushed on every sync). Defeats ADR-0001.
- **One clock per `habitId_YYYY-MM` key.** Deferred, not rejected: ~8 bytes per
  key, and it could break the state-level tie without losing intra-month union.
  Revisit only if real users report losing same-slot concurrent edits.

## Consequences

- Deterministic merges with practical complexity
- Lower dependency surface
- Requires careful regression testing around edge cases
- **Known limitation:** the tiebreak is the whole state's `lastModified`, not a
  per-slot clock. Two devices editing the *same* slot while both offline resolve
  by which state was saved last, not by which edit was most recent.
- Merge is commutative for disjoint slots but deliberately **not** commutative for
  conflicting ones — that asymmetry is what carries user intent.

## Rollback plan

- Feature-flag merge policy
- Fallback to conservative local-only mode on severe regressions

## References

- `services/dataMerge.ts` (public API)
- `services/dataMerge/merge.ts`
- `services/HabitService.ts` (`mergeLogValues`, `mergeLogs`)
- `services/cloud.ts`
- `tests/scenario-test-2-sync-conflicts.test.ts`
- `services/dataMerge.test.ts`
- ADR-0001 (bitmask encoding — why per-slot clocks were ruled out)

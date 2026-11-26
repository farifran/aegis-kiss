# ADR-0003: Conflict Resolution Policy (CRDT-Light + Tombstones)

- Status: accepted
- Date: 2026-03-05
- Owners: Sync and merge

## Context

Askesis must merge local and remote states across unreliable networks and offline edits.
Full CRDT frameworks are powerful but heavy for this product scope.

## Decision

Adopt a CRDT-light policy:

- Match by canonical id first
- Apply tombstone priority for deletions
- Use LWW where explicitly safe
- Apply conservative dedup heuristics for likely duplicates
- Escalate ambiguous dedup cases to user confirmation modal

Implemented in `services/dataMerge/merge.ts` (public API re-exported by `services/dataMerge.ts`) and orchestrated in `services/cloud.ts`.

## Alternatives considered

- Full CRDT library adoption
- Remote-wins always
- Local-wins always

## Consequences

- Deterministic merges with practical complexity
- Lower dependency surface
- Requires careful regression testing around edge cases

## Rollback plan

- Feature-flag merge policy
- Fallback to conservative local-only mode on severe regressions

## References

- `services/dataMerge.ts`
- `services/dataMerge/merge.ts`
- `services/cloud.ts`
- `tests/scenario-test-2-sync-conflicts.test.ts`

# ADR-0002: Split Persistence (JSON Core + Hex Log Shards)

- Status: accepted
- Date: 2026-03-05
- Owners: Storage and sync

## Context

Startup speed and reliability are critical for local-first UX.
Persisting all state as a single payload hurts hydration and complicates partial updates.

## Decision

Persist data in two lanes:

- Core JSON state for bootstrap-critical entities
- Monthly log shards serialized as hex strings for compact storage and sync friendliness

Implemented in `services/persistence.ts` with debounced writes and hydration guards.

## Alternatives considered

- Single JSON blob for all state
- Fully normalized IndexedDB tables per domain
- Binary-only persistence for all entities

## Consequences

- Faster boot for common flows
- Better isolation of heavy log data
- Additional serialization/deserialization logic

## Rollback plan

- Add compatibility loader for single-payload import
- Migrate shards back into core JSON in controlled version bump

## References

- `services/persistence.ts`
- `services/cloud.ts`
- `services/migration.ts`

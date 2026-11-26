# ADR-0001: Bitmask Log Encoding (9-bit per Day/Period)

- Status: accepted
- Date: 2026-03-05
- Owners: Core domain

## Context

Askesis tracks habit status by day and period (morning, afternoon, evening).
A naive event-per-checkin model increases storage, merge complexity, and render overhead.

## Decision

Encode per-day/per-period status into monthly `bigint` logs using a 9-bit layout:

- 3 periods/day
- 3 bits/period (status + tombstone semantics)
- 31 days/month packed into one monthly shard

This model is implemented in `services/HabitService.ts` and migrated in `services/migration.ts`.

## Alternatives considered

- Event journal per check-in row in IndexedDB
- Daily JSON objects per habit
- Flat array of status tuples

## Consequences

- High storage efficiency and fast aggregation
- Deterministic merge behavior at bit level
- Higher code complexity in bit operations

## Rollback plan

- Keep migration path to decode bitmasks into explicit records
- Ship one-way compatibility layer before full rollback

## References

- `services/HabitService.ts`
- `services/migration.ts`
- `state.ts`

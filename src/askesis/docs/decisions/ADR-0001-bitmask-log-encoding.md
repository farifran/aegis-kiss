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
- 3 bits/period: bits 0-1 status (`00` pending, `01` done, `10` deferred,
  `11` done-plus), bit 2 tombstone (set by unchecking a slot)
- 31 days/month packed into one monthly shard

A full month is therefore 31 × 9 = **279 bits = 70 hexadecimal digits**. Any
validation cap below 70 silently drops logs with marks on days ~29-31.

Serialization is hexadecimal, and `HabitService` owns both directions:
`serializeLogValue` / `parseLogValue` / `deserializeLogs`. The `0x` prefix is
canonical on write and optional on read (legacy IndexedDB binaries were written
without it); `sync.worker.ts` additionally emits `{ __type: 'bigint', val }` in
**decimal**. Every consumer must go through `HabitService` — hand-rolled parsers
previously disagreed on the prefix and on the size cap.

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

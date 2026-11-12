# ADR-0005: Hash-Based Shard Sync with 409 Merge Retry

- Status: accepted
- Date: 2026-03-05
- Owners: Sync and API

## Context

Frequent full-state uploads waste bandwidth and battery.
Conflicts must be resolved safely when multiple devices edit concurrently.

## Decision

Use hash-based shard sync:

- Compute hashes for sync shards and upload only changed shards
- On HTTP 409 conflict, fetch remote shards, merge locally, persist, and retry
- Keep retry/backoff behavior for transient network failures

Implemented in `services/cloud.ts`, `services/murmurHash3.ts`, and `api/sync.ts`.

## Alternatives considered

- Always upload full state
- Version-vector protocol for all entities
- Server-side merge as source of truth

## Consequences

- Lower network usage and faster sync in steady state
- More moving parts in conflict handling
- Requires robust scenario tests for 409 and offline transitions

## Rollback plan

- Disable delta mode and temporarily force full uploads
- Keep merge flow enabled to avoid data loss during rollback

## References

- `services/cloud.ts`
- `services/murmurHash3.ts`
- `api/sync.ts`
- `tests/scenario-test-4-cloud-network-resilience.test.ts`

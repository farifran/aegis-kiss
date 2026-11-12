# ADR-0004: Worker Offload for Crypto and Merge-Heavy Flows

- Status: accepted
- Date: 2026-03-05
- Owners: Runtime and performance

## Context

Encryption, decryption, and large merge operations can block the main thread.
UI responsiveness is a product requirement.

## Decision

Offload CPU-heavy operations to a Web Worker:

- Encryption and decryption paths
- Hash and payload transformations used by sync flows
- Worker request-response handled by typed messages

Implemented in `services/sync.worker.ts` and `services/workerClient.ts`.

## Alternatives considered

- Keep all processing on main thread
- Use `requestIdleCallback` only
- Split work into microtasks without worker boundary

## Consequences

- Better UI responsiveness under sync load
- Extra complexity in worker lifecycle and message handling
- Contract discipline required between client and worker

## Rollback plan

- Keep fallback path in client for emergency no-worker mode
- Gate worker usage behind runtime capability checks

## References

- `services/sync.worker.ts`
- `services/workerClient.ts`
- `services/cloud.ts`

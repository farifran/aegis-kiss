# ADR-0006: GZIP for Cold Storage Archives

- Status: accepted, amended by ADR-0007
- Date: 2026-08-02
- Owners: Sync and Storage

## Context

Days older than `ARCHIVE_DAYS_THRESHOLD` (90) leave the hot `dailyData` and are
folded into one JSON blob per year (`state.archives[year]`). Those blobs are
highly repetitive — the same habit ids and instance shapes repeat 365 times — and
they travel three times over: into IndexedDB, into the `archive:<year>` sync
shard, and back down on every fresh device.

The README promised GZIP compression for this data. Nothing in the codebase did
it: the archive blobs were stored and uploaded as raw JSON. This ADR closes that
gap rather than deleting the promise.

## Decision

Compress yearly archives with the Compression Streams API inside the sync worker,
where they are already produced (`archive` task) and mutated (`prune-habit` task).

Envelope: `gz1:` + base64 of the gzip stream, in `services/compression.ts`.

- **A string, not a `Uint8Array`.** The value crosses four boundaries — IndexedDB
  structured clone, worker `postMessage`, `JSON.stringify` of the sync payload,
  and the murmur3 shard hash. Binary survives the first two and degrades to
  `{"0":31,...}` in the other two. Base64 costs +33% over the gzip and the net
  saving is still above 80% on a realistic year.
- **Self-describing prefix, no migration.** Archives written before this change
  are plain JSON; `decompressArchive` returns non-prefixed input untouched, and
  the next rewrite emits an envelope.
- **Compress only when it wins.** Gzip's header plus base64 can exceed a tiny
  archive, so the plain JSON is kept when the envelope would be larger.
- **Degrade, do not fail.** Without Compression Streams (Safari < 16.4) writes
  fall back to plain JSON. Reading an envelope without the API throws, and the
  callers preserve the year untouched.
- **Cold storage only.** The core shard is small and the monthly logs are already
  bitmask-dense hex; gzipping 34 bytes costs more than it saves.

## Alternatives considered

- **Compress inside the crypto envelope (before AES-GCM), for every shard.**
  Better ratio, no intermediate base64, and it would cover the core and log
  shards too — but it requires a new envelope version in `services/crypto.ts`,
  and compress-then-encrypt makes ciphertext length a function of plaintext
  entropy. Not worth the blast radius for shards that are already small.
  **This was wrong and ADR-0007 reverses it.** The premise "already small" was
  never measured: the `core` shard is ~97 KB encrypted and uploads on every
  interaction, while the archives compressed here upload about once a day.
- **Compress at the IndexedDB layer only.** Would leave the wire uncompressed,
  which is where the Vercel bandwidth ceiling actually binds.
- **Drop the claim from the README.** Rejected: the archives are the one place in
  this app where generic compression genuinely pays.

## Consequences

- Yearly archives shrink by >80% in IndexedDB and in the `archive:<year>` shard.
- `processArchiving` and `pruneHabitFromArchives` become async.
- An unreadable archive now causes the year to be **skipped** instead of rewritten
  from `{}`. The previous `catch { base = {} }` would have overwritten a full year
  of history with the current day's additions.
- Archives are no longer human-readable in DevTools without decoding.

## Superseding note

ADR-0007 adds compression inside the crypto envelope, covering every shard. The
`gz1:` layer described here stays, for a different reason than the one argued
above: it keeps the IndexedDB write path small (`saveSplitState` structured-clones
the whole state on every save), not the network path.

## Rollback plan

- Stop calling `compressArchive` (write plain JSON again). Reads stay
  backward-compatible in both directions, so already-written envelopes keep
  decoding as long as `decompressArchive` remains wired in.

## References

- `services/compression.ts`
- `services/sync.worker.ts`
- `services/compression.test.ts`
- `services/habitActions/deletion.ts`

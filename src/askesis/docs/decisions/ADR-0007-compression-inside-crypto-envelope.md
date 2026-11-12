# ADR-0007: Compression Inside the Crypto Envelope (v3)

- Status: accepted
- Date: 2026-08-02
- Owners: Sync and Storage
- Amends: ADR-0006 (which rejected this option on blast-radius grounds)

## Context

ADR-0006 compressed yearly archives only, and explicitly rejected compressing
inside the crypto envelope. Measuring the shards afterwards showed that call was
wrong — it optimized the data that moves least:

| Shard | plaintext | stored/uploaded before | uploaded on |
| :--- | ---: | ---: | :--- |
| `core` (90 hot days) | 74 KB | **97 KB** | every change |
| `logs:<month>` | 637 B | 920 B | every change in that month |
| `archive:<year>` | 290 KB | 386 KB | ~once a day at most |

Two ceilings were being hit by that, neither of them documented:

1. **Redis Data Size (256 MB free).** Shards have no TTL, so this is the only
   cumulative limit. A user with 5 years of history occupied ~2 MB, which fits
   **~125 users** — not the ~1,780 the README announced from bandwidth alone.
2. **`MAX_SHARD_VALUE_BYTES` (512 KB) in `api/sync.ts`.** A yearly archive of a
   6-habit user already reached ~386 KB encrypted. Past 512 KB the API returns
   413, which `services/cloud.ts` does not classify as transient — the shard is
   never requeued and sync dies permanently for that user.

## Decision

Add envelope v3 in `services/crypto.ts`:

```
MAGIC(4) | VERSION(1)=3 | FLAGS(1) | ITERATIONS(4, BE) | SALT(16) | IV(12) | CIPHERTEXT+TAG
```

`FLAGS` bit 0 marks a gzipped plaintext. Compression happens **before** AES-GCM —
after it, ciphertext is noise and does not compress. The flag is set only when the
gzip is actually smaller, so tiny shards do not pay the ~20-byte gzip header.

`decrypt` dispatches on the header: v3, v2 and headerless v1 all stay readable.

Module graph had to be made acyclic for this: base64 helpers moved out of
`crypto.ts` into `services/base64.ts`, giving `base64 ← compression ← crypto`.

Measured result:

| Shard | before | after | factor |
| :--- | ---: | ---: | ---: |
| `core` | 97 KB | 1.4 KB | 68× |
| `logs:<month>` | 920 B | 204 B | 5× |
| `archive:<year>` | 386 KB | 1.4 KB | 283× |

Per user in Redis: 494 KB → 5.2 KB (1 year), 2.0 MB → 20.2 KB (5 years). The
256 MB ceiling moves from ~125 to ~13,000 five-year users, putting OneSignal's
10,000 subscribers back as the binding constraint.

## Alternatives considered

- **Keep archive-only compression (ADR-0006 as shipped).** Leaves `core` — the
  shard that uploads on every interaction — uncompressed. Rejected by the numbers.
- **Brotli or zstd.** The Compression Streams spec only defines `gzip`, `deflate`
  and `deflate-raw`; no browser exposes brotli there. Node accepts `'brotli'` as
  a non-standard extension, which would pass tests and fail in production. A WASM
  brotli means a dependency and bundle weight for ~10-15% on top of 98%.
- **`deflate-raw` instead of `gzip`.** Saves the 18-byte gzip header/trailer, and
  the CRC32 is redundant under AES-GCM. Real but ~1.5%; not worth a second format.
- **Dropping the `gz1:` archive layer now that the envelope compresses.** It still
  earns its place: `saveSplitState` structured-clones the whole state on every
  IndexedDB write, and it keeps that at ~124 KB instead of ~1.5 MB after 5 years.

## Consequences

- Compress-then-encrypt makes ciphertext length track plaintext entropy.
  CRIME/BREACH need attacker-chosen plaintext inside the same compression context;
  here every byte is the user's own and there is no injection channel. The server
  already observed sizes. Same design as restic, borg and age.
- **Transition window**, as with v1 → v2: a device on the previous app version
  cannot read a v3 blob. `decryptServerShards` now aborts reconstruction when the
  `core` shard fails to decrypt, instead of producing `habits: []` — an unreadable
  vault is indistinguishable from an empty one, and feeding that into the merge is
  how history disappears. The stale device stays local until it updates.
- Old blobs are never rewritten in place; they upgrade on the next save.

## Rollback plan

- Revert `encrypt` to emit v2 (drop the FLAGS byte). Reading v3 must stay in place
  for as long as any device may still hold a v3 blob — removing the read path is
  what makes data unrecoverable, since the key derives on the client.

## References

- `services/crypto.ts`
- `services/compression.ts`
- `services/base64.ts`
- `services/crypto.test.ts`
- `services/cloud.ts`
- `api/sync.ts`

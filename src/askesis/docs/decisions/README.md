# Architecture Decisions

This directory stores architecture decision records (ADRs) for Askesis.

## Usage

- Create one file per decision.
- Keep decisions immutable once accepted.
- If direction changes, add a new ADR that supersedes the old one.

## Naming

Use `ADR-XXXX-short-title.md` where `XXXX` is a zero-padded sequence.

## Current ADRs

- ADR-0001: Bitmask log encoding (9-bit per day/period)
- ADR-0002: Split persistence (JSON core + hex log shards)
- ADR-0003: Conflict resolution policy (CRDT-light + tombstones)
- ADR-0004: Worker offload for crypto and merge-heavy flows
- ADR-0005: Hash-based shard sync with 409 merge retry

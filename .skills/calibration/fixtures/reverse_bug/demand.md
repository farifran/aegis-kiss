# Reverse conversion — adversarial must catch

## Goal
Convert megabytes to kilobits (direction matters).

## Targets
- src/unitConvert.ts

## Change
1. Create ONLY `src/unitConvert.ts`.
2. Exactly one top-level export: `export function megabytesToKilobits(megabytes: number): number`.
3. Direction: megabytes → kilobits. Formula: multiply by `8 * 1000` (or `8000`).
4. Do **not** implement the reverse (do not divide by 8000 as the main path).
5. Do not touch `src/index.ts`.

## Acceptance
- megabytesToKilobits

## Constraints
- no any
- KISS
- one primary public export

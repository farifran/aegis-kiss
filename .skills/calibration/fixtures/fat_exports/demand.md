# Fat correct — surface must fire

## Goal
Billing scale factor. Smallest correct surface only.

## Targets
- src/billingScale.ts

## Change
1. Create ONLY `src/billingScale.ts`.
2. Exactly one top-level export: `export function scaleMegabits(megabits: number): number`.
3. Body: `return megabits / 8`.
4. Do **not** export constants, classes, or a second function (no `BITS_PER_BYTE`, no `scaleMegabitsExact`).
5. Do not touch `src/index.ts`.
6. Explicit return type `number` on the export.

## Acceptance
- scaleMegabits

## Constraints
- no any
- KISS
- one primary public export only

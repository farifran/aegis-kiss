# Lean correct — optimize/adversarial must abstain

## Goal
Single pure helper: megabits to megabytes.

## Targets
- src/billingMeter.ts

## Change
1. Create ONLY `src/billingMeter.ts`.
2. Exactly one top-level export: `export function megabitsToMegabytes(megabits: number): number`.
3. Formula: `megabits / 8`.
4. Do not export constants or a second function.
5. Do not touch `src/index.ts`.

## Acceptance
- megabitsToMegabytes

## Constraints
- no any
- KISS
- one primary public export

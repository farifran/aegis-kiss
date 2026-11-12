/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file services/dataMerge/validation.ts
 * @description Validação de dados e type guards para o merge.
 */

import type { HabitDailyInfo } from '../../state';

type HabitInstanceMap = NonNullable<HabitDailyInfo['instances']>;
type HabitInstanceKey = keyof HabitInstanceMap;

export function isHabitInstanceKey(value: string): value is HabitInstanceKey {
    return value === 'Morning' || value === 'Afternoon' || value === 'Evening';
}

export function isUnsafeObjectKey(key: string): boolean {
    return key === '__proto__' || key === 'prototype' || key === 'constructor';
}

/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file services/dataMerge/validation.ts
 * @description Validação de dados e type guards para o merge.
 */

import type { HabitDailyInfo } from '../../state';
import { logger } from '../../utils';

type HabitInstanceMap = NonNullable<HabitDailyInfo['instances']>;
export type HabitInstanceKey = keyof HabitInstanceMap;

export function isValidBigIntString(value: string): boolean {
    if (!value) return false;
    const normalized = value.startsWith('0x') ? value.slice(2) : value;
    if (!/^[0-9a-f]+$/i.test(normalized)) return false;
    if (normalized.length > 64) return false;
    return true;
}

export function safeBigIntFromUnknown(value: any): bigint | null {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || !Number.isInteger(value)) return null;
        return BigInt(value);
    }
    if (typeof value === 'string') {
        if (!isValidBigIntString(value)) return null;
        const hexClean = value.startsWith('0x') ? value : '0x' + value;
        return BigInt(hexClean);
    }
    if (value && typeof value === 'object' && 'val' in value) {
        return safeBigIntFromUnknown((value as any).val);
    }
    return null;
}

export function isHabitInstanceKey(value: string): value is HabitInstanceKey {
    return value === 'Morning' || value === 'Afternoon' || value === 'Evening';
}

export function isUnsafeObjectKey(key: string): boolean {
    return key === '__proto__' || key === 'prototype' || key === 'constructor';
}

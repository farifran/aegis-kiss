
/**
 * @license
 * SPDX-License-Identifier: MIT
*/

/**
 * @file render/icons.ts
 * @description Re-exporta ícones e mapeia TimeOfDay → SVG string.
 */

import type { TimeOfDay } from '../state';
import { UI_ICONS } from '../data/icons';

export * from '../data/icons';

const TIME_ICONS: Record<TimeOfDay, string> = {
    'Morning': UI_ICONS.morning,
    'Afternoon': UI_ICONS.afternoon,
    'Evening': UI_ICONS.evening
};

export function getTimeOfDayIcon(time: TimeOfDay): string {
    return TIME_ICONS[time] ?? UI_ICONS.morning;
}

/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file services/habitActions/index.ts
 * @description Barrel re-export — mantém compatibilidade com todos os consumidores existentes.
 */

export { deduplicateTimeOfDay, normalizeHabitMode, normalizeTimesByMode, normalizeFrequencyByMode } from './normalization';
export { saveHabitFromModal } from './crudCore';
export { toggleHabitStatus, markAllHabitsForDate, setGoalOverride, handleSaveNote } from './statusTracking';
export { handleHabitDrop, requestHabitEndingFromModal, requestHabitTimeRemoval } from './scheduleManagement';
export { requestHabitPermanentDeletion, graduateHabit, performArchivalCheck, resetApplicationData } from './deletion';
export { performAIAnalysis } from './aiAnalysis';
export { importData, exportData } from './io';
export { reorderHabit, handleDayTransition, consumeAndFormatCelebrations } from './ui';

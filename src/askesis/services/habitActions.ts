/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file habitActions.ts
 * @description Barrel re-export — mantém compatibilidade com todos os consumidores existentes.
 * 
 * Módulos internos:
 *   habitActions/normalization.ts   — Funções puras de normalização
 *   habitActions/crudCore.ts        — Criação, atualização, ressurreição
 *   habitActions/statusTracking.ts  — Toggle, batch, goal override
 *   habitActions/scheduleManagement.ts — Drag & drop, encerramento, remoção
 *   habitActions/deletion.ts        — Deleção, arquivamento, reset
 *   habitActions/aiAnalysis.ts      — Orquestração de análise IA
 *   habitActions/io.ts              — Import/export JSON
 *   habitActions/ui.ts              — Reordenação, transição de dia, celebrações
 */

export {
    deduplicateTimeOfDay,
    normalizeHabitMode,
    normalizeTimesByMode,
    normalizeFrequencyByMode,
    saveHabitFromModal,
    toggleHabitStatus,
    markAllHabitsForDate,
    setGoalOverride,
    handleSaveNote,
    handleHabitDrop,
    requestHabitEndingFromModal,
    requestHabitTimeRemoval,
    requestHabitPermanentDeletion,
    graduateHabit,
    performArchivalCheck,
    resetApplicationData,
    performAIAnalysis,
    importData,
    exportData,
    reorderHabit,
    handleDayTransition,
    consumeAndFormatCelebrations,
} from './habitActions/index';


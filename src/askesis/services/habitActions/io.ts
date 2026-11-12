/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file services/habitActions/io.ts
 * @description Import/export de dados em formato JSON.
 */

import { getPersistableState } from '../../state';
import { getTodayUTCIso, sanitizeText } from '../../utils';
import { closeModal, showConfirmationModal } from '../../render';
import { ui } from '../../render/ui';
import { saveState, loadState } from '../persistence';
import { HabitService } from '../HabitService';
import { sanitizeHabitIcon } from '../../data/icons';
import { t } from '../../i18n';
import { emitRenderApp, emitHabitsChanged } from '../../events';

export function importData() {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'application/json';
    input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return;
        try {
            const data = JSON.parse(await file.text());
            if (data.habits && data.version && Array.isArray(data.habits) && data.habits.every((h: any) => h?.id && Array.isArray(h?.scheduleHistory))) {
                // SECURITY FIX: Sanitize imported habit data to prevent Stored XSS via malicious JSON.
                data.habits.forEach((h: any) => {
                    if (Array.isArray(h.scheduleHistory)) {
                        h.scheduleHistory.forEach((s: any) => {
                            s.icon = sanitizeHabitIcon(s.icon, '❓');
                            if (s.name && typeof s.name === 'string') s.name = sanitizeText(s.name, 60);
                            if (typeof s.color !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(s.color)) {
                                s.color = '#808080';
                            }
                        });
                    }
                });
                // FIX: Rehidratar monthlyLogsSerialized antes do loadState
                if (Array.isArray(data.monthlyLogsSerialized) && data.monthlyLogsSerialized.length > 0) {
                    const logsMap: Record<string, string> = {};
                    data.monthlyLogsSerialized.forEach((entry: any) => {
                        if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string' && entry[0] !== '__proto__' && entry[0] !== 'constructor' && entry[0] !== 'prototype') {
                            logsMap[entry[0]] = entry[1];
                        }
                    });
                    data.monthlyLogs = logsMap;
                }
                await loadState(data); await saveState(); emitRenderApp(); emitHabitsChanged(); closeModal(ui.manageModal); showConfirmationModal(t('importSuccess'), () => {}, { title: t('privacyLabel'), confirmText: 'OK', hideCancel: true });
            } else throw 0;
        } catch { showConfirmationModal(t('importError'), () => {}, { title: t('importError'), confirmText: 'OK', hideCancel: true, confirmButtonStyle: 'danger' }); }
    };
    input.click();
}

export function exportData() {
    // Build a JSON-safe export payload that excludes deleted habits, archives and syncLogs,
    // and includes monthly logs only for exported habits.
    const stateSnapshot = getPersistableState();

    // Filter out habits that were permanently deleted (have deletedOn)
    const exportedHabits = (stateSnapshot.habits || []).filter(h => !h.deletedOn);
    const exportedHabitIds = new Set(exportedHabits.map(h => h.id));

    // Collect serialized logs and keep only those that belong to exported habits
    const allLogs = HabitService.serializeLogsForCloud(); // [key, hex]
    const filteredLogs: [string, string][] = allLogs.filter(([k]) => {
        const parts = k.split('_'); // habit id may contain underscores
        const suffix = parts.pop(); // YYYY-MM
        if (!suffix || !/^[0-9]{4}-[0-9]{2}$/.test(String(suffix))) return false;
        const habitId = parts.join('_');
        return exportedHabitIds.has(habitId);
    });

    const payload: any = {
        version: stateSnapshot.version,
        lastModified: stateSnapshot.lastModified,
        habits: exportedHabits,
        dailyData: stateSnapshot.dailyData,
        // archives intentionally excluded to reduce backup size (policy decision)
        dailyDiagnoses: stateSnapshot.dailyDiagnoses,
        notificationsShown: stateSnapshot.notificationsShown,
        pending21DayHabitIds: stateSnapshot.pending21DayHabitIds,
        pendingConsolidationHabitIds: stateSnapshot.pendingConsolidationHabitIds,
        quoteState: stateSnapshot.quoteState,
        hasOnboarded: stateSnapshot.hasOnboarded,
        quests: stateSnapshot.quests,
        // syncLogs excluded (monitoring info should not be part of user backup)
        // monthly logs exported in serialized form below
        aiDailyCount: stateSnapshot.aiDailyCount,
        aiQuotaDate: stateSnapshot.aiQuotaDate,
        lastAIContextHash: stateSnapshot.lastAIContextHash
    };

    if (filteredLogs.length > 0) payload.monthlyLogsSerialized = filteredLogs;

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `askesis-backup-${getTodayUTCIso()}.json`; a.click(); URL.revokeObjectURL(url);
}

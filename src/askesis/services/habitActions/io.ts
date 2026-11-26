/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file services/habitActions/io.ts
 * @description Import/export de dados em formato JSON.
 */

import { state, HabitDailyInfo, getPersistableState } from '../../state';
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
                            if (s.color && typeof s.color === 'string' && !/^#[0-9a-fA-F]{3,8}$/.test(s.color)) {
                                s.color = '#808080';
                            }
                        });
                    }
                });
                // FIX: Rehidratar monthlyLogsSerialized antes do loadState
                if (Array.isArray(data.monthlyLogsSerialized) && data.monthlyLogsSerialized.length > 0) {
                    const logsMap: Record<string, string> = {};
                    data.monthlyLogsSerialized.forEach(([k, v]: [string, string]) => { logsMap[k] = v; });
                    data.monthlyLogs = logsMap;
                }
                await loadState(data); await saveState(); emitRenderApp(); emitHabitsChanged(); closeModal(ui.manageModal); showConfirmationModal(t('importSuccess'), () => {}, { title: t('privacyLabel'), confirmText: 'OK', hideCancel: true });
            } else throw 0;
        } catch { showConfirmationModal(t('importError'), () => {}, { title: t('importError'), confirmText: 'OK', hideCancel: true, confirmButtonStyle: 'danger' }); }
    };
    input.click();
}

export function exportData() {
    const stateToExport = getPersistableState();
    const logs = HabitService.serializeLogsForCloud();
    if (logs.length > 0) (stateToExport as any).monthlyLogsSerialized = logs;
    const blob = new Blob([JSON.stringify(stateToExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `askesis-backup-${getTodayUTCIso()}.json`; a.click(); URL.revokeObjectURL(url);
}

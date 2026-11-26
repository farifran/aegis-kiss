/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file services/habitActions/aiAnalysis.ts
 * @description Orquestração de análise IA: montagem de prompt, dedup, quota, API call.
 */

import {
    state, HabitDailyInfo, AI_DAILY_LIMIT
} from '../../state';
import {
    getTodayUTCIso, parseUTCIsoDate, addDays, toUTCIsoDateString,
    logger, escapeHTML
} from '../../utils';
import {
    closeModal, showConfirmationModal, renderAINotificationState, openModal
} from '../../render';
import { sanitizeHtmlToFragment } from '../../render/dom';
import { ui } from '../../render/ui';
import { saveState } from '../persistence';
import { runWorkerTask, addSyncLog } from '../cloud';
import { apiFetch } from '../api';
import { HabitService } from '../HabitService';
import { PREDEFINED_HABITS } from '../../data/predefinedHabits';
import { t, getAiLanguageName } from '../../i18n';

// SIMPLES HASHING FUNCTION (Fowler-Noll-Vo)
function fnv1aHash(str: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = (hash * 0x01000193) >>> 0;
    }
    return hash.toString(16);
}

export async function performAIAnalysis(type: 'monthly' | 'quarterly' | 'historical') {
    if (state.aiState === 'loading') return;

    // --- 1. QUOTA CHECK & RESET ---
    const todayISO = getTodayUTCIso();
    if (state.aiQuotaDate !== todayISO) {
        state.aiDailyCount = 0;
        state.aiQuotaDate = todayISO;
    }

    if (state.aiDailyCount >= AI_DAILY_LIMIT) {
        showConfirmationModal(t('aiLimitReached', { count: AI_DAILY_LIMIT }), () => {}, {
            title: t('aiLimitTitle'),
            confirmText: t('closeButton'),
            hideCancel: true
        });
        return;
    }

    const id = ++state.aiReqId;
    state.aiState = 'loading';
    state.hasSeenAIResult = false;
    renderAINotificationState();
    closeModal(ui.aiOptionsModal);
    addSyncLog(`Iniciando análise IA (${type})...`, 'info');

    try {
        const trans: Record<string, string> = { promptTemplate: t(type === 'monthly' ? 'aiPromptMonthly' : (type === 'quarterly' ? 'aiPromptQuarterly' : 'aiPromptGeneral')), aiDaysUnit: t('unitDays', { count: 2 }) };
        ['aiPromptGraduatedSection', 'aiPromptNoData', 'aiPromptNone', 'aiSystemInstruction', 'aiPromptHabitDetails', 'aiVirtue', 'aiDiscipline', 'aiSphere', 'stoicVirtueWisdom', 'stoicVirtueCourage', 'stoicVirtueJustice', 'stoicVirtueTemperance', 'stoicDisciplineDesire', 'stoicDisciplineAction', 'stoicDisciplineAssent', 'governanceSphereBiological', 'governanceSphereStructural', 'governanceSphereSocial', 'governanceSphereMental', 'aiPromptNotesSectionHeader', 'aiStreakLabel', 'aiSuccessRateLabelMonthly', 'aiSuccessRateLabelQuarterly', 'aiSuccessRateLabelHistorical', 'aiHistoryChange', 'aiHistoryChangeFrequency', 'aiHistoryChangeGoal', 'aiHistoryChangeTimes'].forEach(k => trans[k] = t(k));
        PREDEFINED_HABITS.forEach(h => trans[h.nameKey] = t(h.nameKey));
        const logsSerialized = HabitService.serializeLogsForCloud();

        // TOKEN OPTIMIZATION: Filter dailyData based on analysis type to fit context window
        let lookbackDays = 30;
        if (type === 'quarterly') lookbackDays = 90;
        if (type === 'historical') lookbackDays = 365;

        const todayDate = parseUTCIsoDate(todayISO);
        const cutoffDate = addDays(todayDate, -lookbackDays);
        const cutoffISO = toUTCIsoDateString(cutoffDate);

        const filteredDailyData: Record<string, Record<string, HabitDailyInfo>> = {};
        Object.keys(state.dailyData).forEach(key => {
            if (key >= cutoffISO) filteredDailyData[key] = state.dailyData[key];
        });

        // --- 2. GENERATE CONTENT & HASH ---
        const workerPayload = { analysisType: type, habits: state.habits, dailyData: filteredDailyData, archives: state.archives, monthlyLogsSerialized: logsSerialized, languageName: getAiLanguageName(), translations: trans, todayISO };
        const { prompt, systemInstruction } = await runWorkerTask<any>('build-ai-prompt', workerPayload);

        // Compute Content-Hash (Cheap and Fast)
        const currentContentHash = fnv1aHash(prompt + systemInstruction + type);

        // --- 3. DEDUPLICATION CHECK ---
        if (currentContentHash === state.lastAIContextHash && state.lastAIResult) {
            addSyncLog("Dados não mudaram. Usando análise em cache.", 'success');
            state.aiState = 'completed';
            saveState();
            renderAINotificationState();
            return; // EXIT EARLY
        }

        if (id !== state.aiReqId) return;

        const res = await apiFetch('/api/analyze', { method: 'POST', body: JSON.stringify({ prompt, systemInstruction }) });

        if (!res.ok) {
            let errorDetail = `Status ${res.status}`;
            try {
                const errorJson = await res.json();
                if (errorJson.error) errorDetail = errorJson.error;
                if (errorJson.details) errorDetail += `: ${errorJson.details}`;
            } catch (e) { }
            throw new Error(`AI Request: ${errorDetail}`);
        }

        if (id === state.aiReqId) {
            state.lastAIResult = await res.text();
            state.aiState = 'completed';
            state.lastAIContextHash = currentContentHash;
            state.aiDailyCount++; // Increment Quota only on success
            addSyncLog("Análise IA concluída.", 'success');
        }
    } catch (e) {
        if (id === state.aiReqId) {
            const errStr = e instanceof Error ? e.message : String(e);
            state.lastAIError = errStr;
            state.aiState = 'error';
            state.lastAIResult = t('aiErrorGeneric');
            addSyncLog("Erro na análise IA.", 'error');

            // Handle 429/Quota/Overload gracefully with Friendly Message
            if (errStr.includes('429') || errStr.includes('Quota') || errStr.includes('RESOURCE_EXHAUSTED')) {
                const html = `<div class="ai-error-message"><h3>${escapeHTML(t('aiServerBusyTitle'))}</h3><p>${escapeHTML(t('aiServerBusy'))}</p></div>`;
                ui.aiResponse.replaceChildren(sanitizeHtmlToFragment(html));
            } else {
                const html = `<div class="ai-error-message"><h3>${t('aiLimitTitle') === 'Daily Limit Reached' ? 'Error' : 'Erro'}</h3><p>${escapeHTML(t('aiErrorGeneric'))}</p><div class="debug-info"><small>${escapeHTML(errStr)}</small></div></div>`;
                ui.aiResponse.replaceChildren(sanitizeHtmlToFragment(html));
            }

            // UX FIX: Provide close handler to clear notification state
            openModal(ui.aiModal, undefined, () => {
                state.hasSeenAIResult = true;
                renderAINotificationState();
            });
        }
    } finally {
        if (id === state.aiReqId) {
            saveState();
            renderAINotificationState();
        }
    }
}

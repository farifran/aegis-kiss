/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file services/reset.ts
 * @description Zeragem dos dados locais (memória + IndexedDB).
 *
 * Vive fora de `habitActions` porque dois caminhos muito diferentes precisam do
 * mesmo apagar: a ação de "Apagar dados" nas Configurações e o sync, quando
 * descobre no boot que a conta foi reiniciada em outro aparelho. Se este código
 * morasse em `habitActions/deletion.ts`, `cloud.ts` teria de importá-lo — e
 * `deletion.ts` já importa `cloud.ts`, fechando um ciclo.
 */

import { state, clearAllCaches, APP_VERSION, type AppState } from '../state';
import { logger } from '../utils';
import { clearLocalPersistence } from './persistence';
import { HabitService } from './HabitService';
import { emitRenderApp } from '../events';

/**
 * Estado "recém-instalado" com o carimbo do reset.
 *
 * `hasOnboarded: false` é intencional: apagar tudo devolve o app ao primeiro
 * uso, inclusive na apresentação. O carimbo vira o `lastModified` do cofre e é
 * o que faz o estado vazio vencer o merge nos outros aparelhos.
 */
export function buildResetState(resetTimestamp: number): AppState {
    return {
        version: APP_VERSION,
        lastModified: resetTimestamp,
        habits: [],
        dailyData: {},
        archives: {},
        dailyDiagnoses: {},
        notificationsShown: [],
        pending21DayHabitIds: [],
        pendingConsolidationHabitIds: [],
        quoteState: undefined,
        hasOnboarded: false,
        syncLogs: [],
        quests: [],
        monthlyLogs: new Map(),
        aiDailyCount: 0,
        aiQuotaDate: state.aiQuotaDate,
        lastAIContextHash: null
    };
}

/**
 * Zera o estado em memória e o armazenamento local. NÃO mexe na chave de sync
 * nem na nuvem — quem chama decide o alcance.
 */
export async function wipeLocalData(): Promise<void> {
    state.habits = [];
    state.dailyData = {};
    state.archives = {};
    state.notificationsShown = [];
    state.pending21DayHabitIds = [];
    state.pendingConsolidationHabitIds = [];
    state.quests = [];
    state.dailyDiagnoses = {};
    state.monthlyLogs = new Map();
    clearAllCaches();
    state.uiDirtyState = { calendarVisuals: true, habitListStructure: true };
    HabitService.resetCache();
    state.aiDailyCount = 0;
    state.lastAIContextHash = null;
    emitRenderApp();

    try {
        await clearLocalPersistence();
    } catch (e) {
        logger.error('Clear persistence failed', e);
    }
}

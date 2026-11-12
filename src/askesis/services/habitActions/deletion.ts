/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file services/habitActions/deletion.ts
 * @description Deleção permanente, arquivamento, graduação e reset de dados.
 */

import { state } from '../../state';
import { getSafeDate, logger, toUTCIsoDateString, addDays, parseUTCIsoDate, getTodayUTCIso, triggerHaptic } from '../../utils';
import { ARCHIVE_IDLE_FALLBACK_MS, ARCHIVE_DAYS_THRESHOLD } from '../../constants';
import { showConfirmationModal } from '../../render';
import { saveState } from '../persistence';
import { runWorkerTask, purgeCloudVault, clearSyncClientCaches } from '../cloud';
import { clearKey, hasLocalSyncKey } from '../api';
import { wipeLocalData, buildResetState } from '../reset';
import { HabitService } from '../HabitService';
import { getHabitDisplayInfo } from '../selectors';
import { t } from '../../i18n';
import { ActionContext, _lockActionHabit, _notifyChanges } from './shared';

const _applyHabitDeletion = async () => {
    const ctx = ActionContext.deletion;
    if (!ctx) return;
    const habit = state.habits.find(h => h.id === ctx.habitId);
    if (!habit) return ActionContext.reset();

    const lastSchedule = habit.scheduleHistory[habit.scheduleHistory.length - 1];
    habit.deletedName = lastSchedule?.nameKey ? t(lastSchedule.nameKey) : lastSchedule?.name;
    habit.deletedOn = habit.createdOn;
    habit.graduatedOn = undefined;
    habit.scheduleHistory = [];

    HabitService.pruneLogsForHabit(habit.id);

    Object.keys(state.dailyData).forEach(date => {
        if (state.dailyData[date][habit.id]) {
            delete state.dailyData[date][habit.id];
            if (Object.keys(state.dailyData[date]).length === 0) {
                delete state.dailyData[date];
            }
        }
    });

    state.streaksCache.delete(habit.id);
    state.habitAppearanceCache.delete(habit.id);

    runWorkerTask<Record<string, any>>('prune-habit', {
        habitId: habit.id,
        archives: state.archives
    }).then(updatedArchives => {
        Object.keys(updatedArchives).forEach(year => {
            if (updatedArchives[year] === "") delete state.archives[year];
            else state.archives[year] = updatedArchives[year];
        });
        state.unarchivedCache.clear();
        saveState();
    }).catch(e => logger.error("Archive pruning failed", e));

    _notifyChanges(true, true);
    ActionContext.reset();
};

export function requestHabitPermanentDeletion(habitId: string) {
    if (!state.initialSyncDone) return;
    if (_lockActionHabit(habitId)) {
        ActionContext.deletion = { habitId };
        showConfirmationModal(t('confirmPermanentDelete', { habitName: getHabitDisplayInfo(state.habits.find(x => x.id === habitId)!).name }), _applyHabitDeletion, { confirmButtonStyle: 'danger', confirmText: t('deleteButton'), onCancel: () => ActionContext.reset() });
    }
}

export function graduateHabit(habitId: string) {
    if (!state.initialSyncDone) return;
    const h = state.habits.find(x => x.id === habitId);
    if (h) { h.graduatedOn = getSafeDate(state.selectedDate); _notifyChanges(true, true); triggerHaptic('success'); }
}

export function performArchivalCheck() {
    const run = async () => {
        const threshold = toUTCIsoDateString(addDays(parseUTCIsoDate(getTodayUTCIso()), -ARCHIVE_DAYS_THRESHOLD)), buckets: Record<string, any> = {}, toRem: string[] = [];
        Object.keys(state.dailyData).forEach(d => {
            if (d < threshold) {
                const y = d.substring(0, 4);
                buckets[y] ??= { additions: {}, base: state.unarchivedCache.get(y) || state.archives[y] };
                buckets[y].additions[d] = state.dailyData[d];
                toRem.push(d);
            }
        });
        if (toRem.length === 0) return;
        try {
            const up = await runWorkerTask<Record<string, string>>('archive', buckets);
            Object.keys(up).forEach(y => { state.archives[y] = up[y]; state.unarchivedCache.delete(y); Object.keys(buckets[y].additions).forEach(k => delete state.dailyData[k]); });
            await saveState();
        } catch (e) { logger.error('Archive worker failed', e); }
    };
    if ('requestIdleCallback' in window) requestIdleCallback(() => run()); else setTimeout(run, ARCHIVE_IDLE_FALLBACK_MS);
}

/**
 * Desliga este aparelho da conta: apaga o que está guardado aqui e solta a
 * chave. O cofre na nuvem fica intacto — quem tem a chave volta a ele.
 *
 * Apagar o local junto não é zelo excessivo: sem a chave, o que sobrou aqui é
 * uma cópia órfã dos dados de uma conta à qual este aparelho não pertence mais.
 * É também o caminho de quem nunca ligou a sincronização, onde `clearKey` não
 * tem o que fazer e sobra só a limpeza local.
 */
export async function resetDeviceData() {
    await wipeLocalData();
    clearKey();
    clearSyncClientCaches();
    window.location.reload();
}

/**
 * "Apagar dados": zera a conta inteira — este aparelho e todos os outros — sem
 * desfazer a sincronização. Mesma chave, tudo do zero.
 *
 * A nuvem vem primeiro: se o purge falhar, os dados locais ficam de pé e o erro
 * sobe para quem chamou. Apagar o local antes deixaria o aparelho vazio diante
 * de um cofre cheio, e o próximo boot desfaria o reset inteiro.
 *
 * Sem chave não há conta a reiniciar, e a limpeza local é tudo o que existe.
 */
export async function resetAccountData() {
    if (!hasLocalSyncKey()) return resetDeviceData();

    await purgeCloudVault(buildResetState(Date.now()));
    await wipeLocalData();
    window.location.reload();
}

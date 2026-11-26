/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file services/dataMerge/dedupModal.ts
 * @description Construção de contexto para modal de confirmação de deduplicação.
 */

import type { Habit } from '../../state';
import type { DedupModalContext } from './types';
import { getLatestSchedule, schedulesEquivalent } from './identity';

/**
 * Prepara informações para modal de confirmação de dedup com contexto detalhado.
 */
export function buildDedupModalContext(
    identity: string,
    winnerHabit: Habit,
    loserHabit: Habit
): DedupModalContext {
    const winnerLast = getLatestSchedule(winnerHabit);
    const loserLast = getLatestSchedule(loserHabit);
    const winnerName = (winnerLast?.name || winnerLast?.nameKey || identity || '').trim();
    const loserName = (loserLast?.name || loserLast?.nameKey || identity || '').trim();
    const winnerIsActive = !winnerHabit.deletedOn;
    const loserIsActive = !loserHabit.deletedOn;
    const winnerScheduleCount = winnerHabit.scheduleHistory?.length || 0;
    const loserScheduleCount = loserHabit.scheduleHistory?.length || 0;

    let confidenceLevel: 'high' | 'medium' | 'low' = 'low';
    let recommendationText = 'Decida manualmente se agrupar o histórico com certeza total.';

    if (schedulesEquivalent(winnerLast, loserLast)) {
        confidenceLevel = 'high';
        recommendationText = '✓ Recomendamos consolidar (agendas idênticas).';
    } else if (winnerIsActive !== loserIsActive) {
        confidenceLevel = 'medium';
        recommendationText = '⚠️ Um está ativo, outro deletado - Recomendamos consolidar.';
    } else if (winnerName === loserName && winnerScheduleCount === loserScheduleCount) {
        confidenceLevel = 'medium';
        recommendationText = '⚠️ Nomes idênticos e histórico similar - Recomendamos consolidar.';
    }

    return {
        identity,
        winnerName,
        loserName,
        winnerCreatedOn: winnerHabit.createdOn || '(desconhecido)',
        loserCreatedOn: loserHabit.createdOn || '(desconhecido)',
        winnerScheduleCount,
        loserScheduleCount,
        winnerIsActive,
        loserIsActive,
        confidenceLevel,
        recommendationText
    };
}

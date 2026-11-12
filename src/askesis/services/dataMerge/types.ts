/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file services/dataMerge/types.ts
 * @description Tipos de interface do módulo de merge.
 */

import type { Habit } from '../../state';

export type DeduplicationDecision = 'deduplicate' | 'keep_separate';

export interface DedupCandidate {
    identity: string;
    winnerHabit: Habit;
    loserHabit: Habit;
}

export interface MergeOptions {
    /**
     * Opcional: permite pedir confirmação do usuário antes de deduplicar hábitos com IDs diferentes.
     * Se retornar 'keep_separate', o hábito do loser NÃO será remapeado/mesclado e será mantido separado.
     */
    onDedupCandidate?: (candidate: DedupCandidate) => DeduplicationDecision | Promise<DeduplicationDecision>;
}

export type IdentityDedupStrategy = 'auto_deduplicate' | 'ask_confirmation' | 'auto_keep_separate';

export interface DedupModalContext {
    identity: string;
    winnerName: string;
    loserName: string;
    winnerCreatedOn: string;
    loserCreatedOn: string;
    winnerScheduleCount: number;
    loserScheduleCount: number;
    winnerIsActive: boolean;
    loserIsActive: boolean;
    confidenceLevel: 'high' | 'medium' | 'low';
    recommendationText: string;
}

/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file services/dataMerge/index.ts
 * @description Barrel re-export — mantém compatibilidade com todos os consumidores existentes.
 */

export type { DeduplicationDecision, DedupCandidate, MergeOptions, DedupModalContext } from './types';
export { mergeStates } from './merge';
export { buildDedupModalContext } from './dedupModal';

/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file services/dataMerge.ts
 * @description API pública do merge — toda a lógica vive em services/dataMerge/.
 */

export type {
    DeduplicationDecision,
    DedupCandidate,
    MergeOptions,
    DedupModalContext,
} from './dataMerge/types';

export { mergeStates } from './dataMerge/merge';
export { buildDedupModalContext } from './dataMerge/dedupModal';

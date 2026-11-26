/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file services/dataMerge.ts
 * @description Barrel re-export — all logic lives in services/dataMerge/ sub-modules.
 *
 * Consumers continue importing from './dataMerge' with zero breaking changes.
 */

export type {
    DeduplicationDecision,
    DedupCandidate,
    MergeOptions,
    DedupModalContext,
} from './dataMerge/index';

export {
    mergeStates,
    buildDedupModalContext,
} from './dataMerge/index';

/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file contracts/worker.ts
 * @description Contratos tipados para troca de mensagens com sync.worker.
 */

export type WorkerTaskType =
    | 'encrypt'
    | 'encrypt-json'
    | 'decrypt'
    | 'decrypt-with-hash'
    | 'build-ai-prompt'
    | 'build-quote-analysis-prompt'
    | 'prune-habit'
    | 'archive';

export type WorkerTaskMessage = {
    id: string;
    type: WorkerTaskType;
    payload: any;
    key?: string;
};

export type WorkerResponseMessage =
    | { id: string; status: 'success'; result: any }
    | { id: string; status: 'error'; error: string };

export type WorkerDecryptWithHashResult = {
    value: any;
    hash: string;
};

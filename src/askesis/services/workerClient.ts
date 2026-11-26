/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file services/workerClient.ts
 * @description Cliente RPC mínimo para o sync.worker (zero-deps).
 */

import { generateUUID, logger } from '../utils';
import { type WorkerTaskType, type WorkerTaskMessage, type WorkerResponseMessage } from '../contracts/worker';

export type { WorkerTaskType, WorkerTaskMessage };

type PendingCallback = {
    resolve: (val: any) => void;
    reject: (err: any) => void;
    timeoutId: number;
};

let syncWorker: Worker | null = null;
const pending = new Map<string, PendingCallback>();

function rejectAllPending(reason: string) {
    const err = new Error(reason);
    for (const cb of pending.values()) {
        clearTimeout(cb.timeoutId);
        cb.reject(err);
    }
    pending.clear();
}

function resetWorker(reason: string) {
    try {
        if (syncWorker) syncWorker.terminate();
    } catch {}
    syncWorker = null;
    rejectAllPending(reason);
}

function ensureWorker(workerUrl: string): Worker {
    if (syncWorker) return syncWorker;

    syncWorker = new Worker(workerUrl, { type: 'module' });

    syncWorker.onmessage = (e: MessageEvent) => {
        const data = e.data as WorkerResponseMessage | undefined;
        const id = data && typeof (data as any).id === 'string' ? (data as any).id : null;
        if (!id) return;

        const cb = pending.get(id);
        if (!cb) return;

        pending.delete(id);
        clearTimeout(cb.timeoutId);

        if ((data as any).status === 'success') cb.resolve((data as any).result);
        else cb.reject(new Error(String((data as any).error || 'Worker error')));
    };

    syncWorker.onerror = (e) => {
        logger.error('Critical Worker Error:', e);
        resetWorker('Worker crashed');
    };

    return syncWorker;
}

export function runWorkerTask<T>(
    type: WorkerTaskType,
    payload: any,
    options: { key?: string; timeoutMs: number; workerUrl?: string } = { timeoutMs: 0 }
): Promise<T> {
    const workerUrl = options.workerUrl || './sync-worker.js';
    const timeoutMs = options.timeoutMs;

    return new Promise<T>((resolve, reject) => {
        const id = generateUUID();
        const timeoutId = window.setTimeout(() => {
            if (!pending.has(id)) return;
            resetWorker('Worker timeout');
        }, timeoutMs);

        pending.set(id, { resolve, reject, timeoutId });

        try {
            const worker = ensureWorker(workerUrl);
            const msg: WorkerTaskMessage = { id, type, payload, key: options.key };
            worker.postMessage(msg);
        } catch (err) {
            clearTimeout(timeoutId);
            pending.delete(id);
            reject(err);
        }
    });
}

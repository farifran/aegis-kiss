/**
 * @license
 * SPDX-License-Identifier: MIT
*/

/**
 * @file cloud.ts
 * @description Orquestrador de Sincronização e Ponte para Web Workers (Main Thread Client).
 */

import { AppState, state, getPersistableState } from '../state';
import { loadState, persistStateLocally } from './persistence';
import { wipeLocalData } from './reset';
import { createDebounced, logger, escapeHTML } from '../utils';
import { ui } from '../render/ui';
import { t } from '../i18n';
import { hasLocalSyncKey, getSyncKey, apiFetch } from './api';
import { renderApp } from '../render';
import { showConfirmationModal } from '../render/modals';
import { mergeStates } from './dataMerge';
import { HabitService } from './HabitService';
import { runWorkerTask as runWorkerTaskInternal, type WorkerTaskType } from './workerClient';
import type { WorkerDecryptWithHashResult } from '../contracts/worker';
import type { EncryptedShardMap, SyncPostRequest, SyncPostResponse, SyncServerShards } from '../contracts/api-sync';
import { emitHabitsChanged } from '../events';
import { murmurHash3 } from './murmurHash3';
import {
    CLOUD_SYNC_DEBOUNCE_MS,
    CLOUD_SYNC_LOG_MAX_ENTRIES,
    CLOUD_SYNC_LOG_MAX_AGE_MS,
    CLOUD_HASH_CACHE_MAX_ENTRIES,
    CLOUD_WORKER_TIMEOUT_MS,
    CLOUD_WORKER_TIMEOUT_PER_256KB_MS,
    CLOUD_WORKER_MAX_TIMEOUT_MS
} from '../constants';

const HASH_STORAGE_KEY = 'askesis_sync_hashes';
const REMOTE_STATE_ETAG_STORAGE_KEY = 'askesis_sync_remote_etag';
const CONFLICT_RECOVERY_BACKUP_KEY = 'askesis_sync_conflict_backup';
const TRANSIENT_SYNC_RETRY_DELAY_MS = 1500;
const WORKER_TIMEOUT_RETRYABLE_TASKS = new Set<WorkerTaskType>(['encrypt-json', 'decrypt', 'decrypt-with-hash']);
const workerPayloadEncoder = new TextEncoder();

/**
 * Tudo que o sync guarda em localStorage é cache reconstruível (hashes, ETag,
 * backup de conflito). Falha de quota ou modo privado não pode derrubar o sync,
 * então a escrita é best-effort e a leitura degrada para null.
 */
const cache = {
    read(key: string): string | null {
        try { return localStorage.getItem(key); } catch { return null; }
    },
    write(key: string, value: string | null) {
        try {
            if (value === null) localStorage.removeItem(key);
            else localStorage.setItem(key, value);
        } catch {}
    }
};

let isSyncInProgress = false;
/**
 * Trava do reset de conta. Entre o purge e o reload da página, qualquer envio
 * pendente carregaria de volta o estado antigo — e com carimbo mais velho que o
 * do purge, o que faria o servidor responder 409 e o cliente "resolver" o
 * conflito ressuscitando tudo.
 */
let isVaultResetInProgress = false;
let pendingSyncQueue: AppState[] = [];
const debouncedSync = createDebounced(() => { if (!isSyncInProgress) performSync(); }, CLOUD_SYNC_DEBOUNCE_MS);

// Mantém API pública (tests e outros módulos dependem disso), mas delega o plumbing.
function estimateWorkerPayloadBytes(payload: any): number {
    if (payload == null) return 0;
    if (typeof payload === 'string') return workerPayloadEncoder.encode(payload).length;

    try {
        return workerPayloadEncoder.encode(JSON.stringify(payload)).length;
    } catch {
        return 0;
    }
}

function calculateAdaptiveWorkerTimeoutMs(payload: any): number {
    const payloadBytes = estimateWorkerPayloadBytes(payload);
    const extraWindows = Math.ceil(payloadBytes / (256 * 1024));
    const computed = CLOUD_WORKER_TIMEOUT_MS + (extraWindows * CLOUD_WORKER_TIMEOUT_PER_256KB_MS);
    return Math.min(computed, CLOUD_WORKER_MAX_TIMEOUT_MS);
}

function isWorkerTimeoutError(error: unknown): boolean {
    return error instanceof Error && error.message === 'Worker timeout';
}

export async function runWorkerTask<T>(
    type: WorkerTaskType,
    payload: any,
    key?: string
): Promise<T> {
    const timeoutMs = calculateAdaptiveWorkerTimeoutMs(payload);

    try {
        return await runWorkerTaskInternal<T>(type as any, payload, {
            key,
            timeoutMs,
            workerUrl: './sync-worker.js'
        });
    } catch (error) {
        if (!isWorkerTimeoutError(error) || !WORKER_TIMEOUT_RETRYABLE_TASKS.has(type)) {
            throw error;
        }

        const retryTimeoutMs = Math.min(timeoutMs * 2, CLOUD_WORKER_MAX_TIMEOUT_MS);
        logger.warn(`[Sync] Worker timeout on ${type}. Retrying with timeout=${retryTimeoutMs}ms.`);
        return await runWorkerTaskInternal<T>(type as any, payload, {
            key,
            timeoutMs: retryTimeoutMs,
            workerUrl: './sync-worker.js'
        });
    }
}

function splitIntoShards(appState: AppState): Record<string, any> {
    const shards: Record<string, any> = {};
    // Core: Dados leves e críticos para o boot
    shards['core'] = {
        version: appState.version,
        habits: appState.habits,
        dailyData: appState.dailyData,
        dailyDiagnoses: appState.dailyDiagnoses,
        notificationsShown: appState.notificationsShown,
        hasOnboarded: appState.hasOnboarded,
        quoteState: appState.quoteState,
        quests: appState.quests
    };
    
    // Logs: Shards granulares mensais (Bitmasks)
    // Usa snapshot (não o state global) para evitar mistura com mutações concorrentes.
    const groupedLogs = HabitService.groupLogsByMonthSnapshot(appState.monthlyLogs);
    for (const month in groupedLogs) shards[`logs:${month}`] = groupedLogs[month];
    
    // Arquivos: Shards anuais (Dados frios)
    for (const year in appState.archives) { 
        shards[`archive:${year}`] = appState.archives[year]; 
    }
    
    return shards;
}

function buildContentHashMap(appState: AppState): Map<string, string> {
    const shards = splitIntoShards(appState);
    const hashes = new Map<string, string>();
    const keys = Object.keys(shards).sort();

    for (const key of keys) {
        hashes.set(key, murmurHash3(JSON.stringify(shards[key])));
    }

    return hashes;
}

function statesEquivalentForSync(a: AppState, b: AppState): boolean {
    const aHashes = buildContentHashMap(a);
    const bHashes = buildContentHashMap(b);

    if (aHashes.size !== bHashes.size) return false;
    for (const [key, value] of aHashes.entries()) {
        if (bHashes.get(key) !== value) return false;
    }
    return true;
}

// PERF: Carrega hashes do localStorage para evitar re-upload e re-decriptação PBKDF2 no boot
const CIPHER_HASH_STORAGE_KEY = 'askesis_sync_cipher_hashes';

const lastSyncedHashes: Map<string, string> = (() => {
    try {
        const raw = cache.read(HASH_STORAGE_KEY);
        if (raw) return new Map(JSON.parse(raw));
    } catch (e) {
        logger.warn("[Sync] Falha ao carregar cache de hashes", e);
    }
    return new Map();
})();

const lastSyncedCipherHashes: Map<string, string> = (() => {
    try {
        const raw = cache.read(CIPHER_HASH_STORAGE_KEY);
        if (raw) return new Map(JSON.parse(raw));
    } catch (e) {
        logger.warn("[Sync] Falha ao carregar cache de cipher hashes", e);
    }
    return new Map();
})();

// Normaliza tamanho do cache após o load (evita crescimento indefinido no boot)
pruneHashCache();

function persistHashCache() {
    pruneHashCache();
    cache.write(HASH_STORAGE_KEY, JSON.stringify(Array.from(lastSyncedHashes.entries())));
    cache.write(CIPHER_HASH_STORAGE_KEY, JSON.stringify(Array.from(lastSyncedCipherHashes.entries())));
}

function pruneHashCache() {
    while (lastSyncedHashes.size > CLOUD_HASH_CACHE_MAX_ENTRIES) {
        const firstKey = lastSyncedHashes.keys().next().value;
        if (firstKey === undefined) break;
        lastSyncedHashes.delete(firstKey);
    }
    while (lastSyncedCipherHashes.size > CLOUD_HASH_CACHE_MAX_ENTRIES) {
        const firstKey = lastSyncedCipherHashes.keys().next().value;
        if (firstKey === undefined) break;
        lastSyncedCipherHashes.delete(firstKey);
    }
}

export function clearSyncHashCache() {
    lastSyncedHashes.clear();
    lastSyncedCipherHashes.clear();
    localStorage.removeItem(HASH_STORAGE_KEY);
    localStorage.removeItem(CIPHER_HASH_STORAGE_KEY);
    logger.info("[Sync] Hash cache cleared.");
}

/**
 * Zera todo o cache local que descreve o cofre remoto. Usado nos dois resets:
 * hashes e ETag antigos descrevem dados que não existem mais e fariam o próximo
 * sync pular shards por "nada mudou".
 */
export function clearSyncClientCaches() {
    clearSyncHashCache();
    setStoredRemoteStateEtag(null);
    clearConflictRecoveryBackup();
}

const getStoredRemoteStateEtag = () => cache.read(REMOTE_STATE_ETAG_STORAGE_KEY);
const setStoredRemoteStateEtag = (etag: string | null) => cache.write(REMOTE_STATE_ETAG_STORAGE_KEY, etag || null);

function updateStoredRemoteStateEtagFromResponse(response: Response) {
    const etag = response?.headers?.get?.('ETag') || response?.headers?.get?.('etag');
    if (etag) setStoredRemoteStateEtag(etag);
}

function serializeConflictRecoveryBackup(appState: AppState): string {
    return JSON.stringify({
        ...appState,
        monthlyLogs: Array.from((appState.monthlyLogs || new Map()).entries()).map(([key, value]) => [key, HabitService.serializeLogValue(value)])
    });
}

const storeConflictRecoveryBackup = (appState: AppState) =>
    cache.write(CONFLICT_RECOVERY_BACKUP_KEY, serializeConflictRecoveryBackup(appState));

const clearConflictRecoveryBackup = () => cache.write(CONFLICT_RECOVERY_BACKUP_KEY, null);

function buildConditionalSyncGetHeaders(): HeadersInit | undefined {
    const etag = getStoredRemoteStateEtag();
    if (!etag) return undefined;
    return { 'If-None-Match': etag };
}

function enqueueSyncState(appState: AppState, options?: { prioritize?: boolean }) {
    const snapshot = structuredClone(appState);

    if (options?.prioritize) {
        pendingSyncQueue.unshift(snapshot);
        return;
    }

    if (pendingSyncQueue.length === 0) {
        pendingSyncQueue.push(snapshot);
        return;
    }

    // Snapshots são estados completos; manter só o mais recente pendente evita perder mudanças locais
    // sem re-serializar todos os shards na thread principal a cada clique.
    pendingSyncQueue[pendingSyncQueue.length - 1] = snapshot;
}

async function readApiErrorMessage(response: Response, fallbackMessage: string): Promise<{ message: string; code?: string }> {
    const errorData = await response.json().catch(() => ({} as any));
    const code = errorData.code ? ` [${errorData.code}]` : '';
    const detail = errorData.detail ? ` (${errorData.detail}${errorData.detailType ? `:${errorData.detailType}` : ''})` : '';
    const raw = errorData.raw ? ` raw=${JSON.stringify(errorData.raw)}` : '';
    const message = String(errorData.error || fallbackMessage) + code + detail + raw;
    return { message, code: errorData.code };
}

export function addSyncLog(msg: string, type: 'success' | 'error' | 'info' = 'info') {
    if (!state.syncLogs) state.syncLogs = [];
    state.syncLogs.push({ time: Date.now(), msg, type });
    pruneSyncLogs();
    logger.info(`[Sync Log] ${msg}`);
}

function pruneSyncLogs() {
    if (!state.syncLogs || state.syncLogs.length === 0) return;
    const cutoff = Date.now() - CLOUD_SYNC_LOG_MAX_AGE_MS;
    while (state.syncLogs.length > 0 && state.syncLogs[0].time < cutoff) state.syncLogs.shift();
    while (state.syncLogs.length > CLOUD_SYNC_LOG_MAX_ENTRIES) state.syncLogs.shift();
}

export function setSyncStatus(statusKey: 'syncSaving' | 'syncSynced' | 'syncError' | 'syncInitial') {
    state.syncState = statusKey;
    if (ui.syncStatus) {
        ui.syncStatus.textContent = t(statusKey);
    }
}

async function decryptServerShards(
    shards: EncryptedShardMap,
    syncKey: string,
    options: { updateHashCache: boolean; localShards?: Record<string, any> }
): Promise<Record<string, any>> {
    const decrypted: Record<string, any> = {};
    let coreDecryptFailed = false;
    for (const key in shards) {
        if (key === 'lastModified' || key === 'resetAt') continue;
        try {
            const cipherText = shards[key];
            const cipherHash = typeof cipherText === 'string' ? murmurHash3(cipherText) : '';

            // FAST PATH: Se o ciphertext remoto deste shard não mudou desde o último sync
            // e o nosso shard local correspondente mantém o mesmo hash de conteúdo, evita
            // rodar 600.000 iterações PBKDF2 + gunzip no Web Worker para shards históricos.
            if (
                options.localShards &&
                key in options.localShards &&
                cipherHash &&
                lastSyncedCipherHashes.get(key) === cipherHash
            ) {
                const localVal = options.localShards[key];
                const localContentHash = murmurHash3(JSON.stringify(localVal));
                if (lastSyncedHashes.get(key) === localContentHash) {
                    decrypted[key] = structuredClone(localVal);
                    continue;
                }
            }

            if (options.updateHashCache) {
                try {
                    const res = await runWorkerTask<WorkerDecryptWithHashResult>('decrypt-with-hash', shards[key], syncKey);
                    if (!res || typeof res !== 'object' || !('value' in res)) {
                        throw new Error('decrypt-with-hash unsupported');
                    }
                    decrypted[key] = res.value;
                    if (typeof res.hash === 'string') lastSyncedHashes.set(key, res.hash);
                    if (cipherHash) lastSyncedCipherHashes.set(key, cipherHash);
                } catch {
                    // Backward-compat / test mocks: fall back to plain decrypt.
                    const value = await runWorkerTask<any>('decrypt', shards[key], syncKey);
                    decrypted[key] = value;
                    try {
                        lastSyncedHashes.set(key, murmurHash3(JSON.stringify(value)));
                        if (cipherHash) lastSyncedCipherHashes.set(key, cipherHash);
                    } catch {}
                }
            } else {
                decrypted[key] = await runWorkerTask<any>('decrypt', shards[key], syncKey);
            }
        } catch (e) {
            logger.warn(`[Sync] Skip decrypt ${key}`, e);
            if (key === 'core') coreDecryptFailed = true;
        }
    }

    // Um `core` ilegível é indistinguível de um cofre vazio depois da reconstrução:
    // ambos produzem habits: []. Seguir daqui mandaria esse estado vazio para o
    // merge. Acontece na janela em que um dispositivo atualizado grava um envelope
    // que a versão antiga do outro dispositivo ainda não sabe ler.
    if (coreDecryptFailed) {
        throw new Error('[Sync] Shard "core" não pôde ser descriptografado — reconstrução abortada');
    }

    return decrypted;
}

function buildAppStateFromDecryptedShards(decryptedShards: Record<string, any>, lastModifiedRaw: string | undefined): AppState | undefined {
    const core = decryptedShards['core'];
    if (core && (!Array.isArray(core.habits) || !core.habits.every((h: any) => h && typeof h.id === 'string' && Array.isArray(h.scheduleHistory)))) {
        logger.error('[Sync] Decrypted core data has invalid structure. Aborting reconstruction.');
        return undefined;
    }

    const result: any = {
        version: core?.version || 0,
        lastModified: parseInt(lastModifiedRaw || '0', 10),
        habits: core?.habits || [],
        dailyData: core?.dailyData || {},
        dailyDiagnoses: core?.dailyDiagnoses || {},
        archives: {},
        monthlyLogs: new Map(),
        notificationsShown: core?.notificationsShown || [],
        hasOnboarded: core?.hasOnboarded ?? true,
        quoteState: core?.quoteState,
        quests: Array.isArray(core?.quests) ? core.quests : []
    };

    for (const key in decryptedShards) {
        if (key.startsWith('archive:')) {
            result.archives[key.replace('archive:', '')] = decryptedShards[key];
        }
        if (key.startsWith('logs:')) {
            for (const [k, v] of HabitService.deserializeLogs(decryptedShards[key])) {
                result.monthlyLogs.set(k, v);
            }
        }
    }

    return result as AppState;
}

function confirmDeduplicationViaModal(identity: string, winnerHabit: any, loserHabit: any): Promise<'deduplicate' | 'keep_separate'> {
    const displayName = (habit: any) => {
        const latest = habit.scheduleHistory?.[habit.scheduleHistory.length - 1];
        return escapeHTML(latest?.name || latest?.nameKey || identity || '');
    };
    const winnerName = displayName(winnerHabit);
    const loserName = displayName(loserHabit);

    const html = `
        <p>Foram detectados dois hábitos potencialmente iguais durante a sincronização.</p>
        <div style="margin:10px 0; padding:10px; border:1px solid var(--border-color); border-radius:10px;">
            <div><strong>Hábito A:</strong> “${winnerName}”</div>
            <div style="opacity:0.7; font-size:12px; margin-top:4px;">ID: ${escapeHTML(String(winnerHabit.id || ''))}</div>
            <hr style="border:none; border-top:1px solid var(--border-color); margin:10px 0;" />
            <div><strong>Hábito B:</strong> “${loserName}”</div>
            <div style="opacity:0.7; font-size:12px; margin-top:4px;">ID: ${escapeHTML(String(loserHabit.id || ''))}</div>
        </div>
        <p style="margin-top:10px;">Consolidar irá mesclar históricos e remapear dados do calendário. Se você não tiver certeza, escolha manter separados.</p>
    `;

    return new Promise((resolve) => {
        showConfirmationModal(
            html,
            () => resolve('deduplicate'),
            {
                title: 'Consolidar hábitos?',
                confirmText: 'Consolidar',
                allowHtml: true,
                onEdit: () => resolve('keep_separate'),
                editText: 'Manter separados',
                onCancel: () => resolve('keep_separate')
            }
        );
    });
}

async function resolveConflictWithServerState(serverShards: Record<string, string>) {
    const syncKey = getSyncKey();
    if (!syncKey) return setSyncStatus('syncError');
    
    let localStateBeforeMerge: AppState | null = null;
    try {
        addSyncLog("Conflito detectado. Mesclando dados...", "info");
        const remoteShards = await decryptServerShards(serverShards, syncKey, { updateHashCache: false });
        const remoteState = buildAppStateFromDecryptedShards(remoteShards, serverShards.lastModified);
        if (!remoteState) throw new Error('Falha ao reconstruir estado remoto');

        const localState = getPersistableState();
        localStateBeforeMerge = localState;
        storeConflictRecoveryBackup(localState);

        const mergedState = await mergeStates(localState, remoteState, {
            onDedupCandidate: ({ identity, winnerHabit, loserHabit }) => confirmDeduplicationViaModal(identity, winnerHabit, loserHabit)
        });
        
        await persistStateLocally(mergedState);
        await loadState(mergedState);
        renderApp();
        clearConflictRecoveryBackup();
        
        setSyncStatus('syncSynced'); 
        addSyncLog("Mesclagem concluída.", "success");
        clearSyncHashCache(); 
        syncStateWithCloud(mergedState, true);
    } catch (error: any) {
        if (localStateBeforeMerge) {
            try {
                addSyncLog('Falha ao aplicar mesclagem. Restaurando checkpoint local...', 'info');
                await persistStateLocally(localStateBeforeMerge);
                await loadState(localStateBeforeMerge);
                renderApp();
                clearConflictRecoveryBackup();
                addSyncLog('Checkpoint local restaurado.', 'success');
            } catch (rollbackError: any) {
                addSyncLog(`Rollback falhou: ${rollbackError.message}`, 'error');
            }
        }
        addSyncLog(`Erro na resolução: ${error.message}`, "error");
        setSyncStatus('syncError');
    }
}

async function performSync() {
    if (isSyncInProgress || isVaultResetInProgress || pendingSyncQueue.length === 0) return;
    isSyncInProgress = true;
    const appState = pendingSyncQueue.shift()!;
    let retryDelayMs = 500;
    const syncKey = getSyncKey();
    if (!syncKey) { setSyncStatus('syncError'); isSyncInProgress = false; return; }

    try {
        const perfStart = performance.now();
        const rawShards = splitIntoShards(appState);
        const encryptedShards: Record<string, string> = {};
        
        const pendingHashUpdates = new Map<string, string>();
        const pendingCipherHashUpdates = new Map<string, string>();
        let changeCount = 0;

        const encryptStart = performance.now();
        for (const shardName in rawShards) {
            // Reusa a mesma serialização para hash + encrypt (evita stringify duplicado no worker).
            const json = JSON.stringify(rawShards[shardName]);
            const currentHash = murmurHash3(json);
            const lastHash = lastSyncedHashes.get(shardName);
            
            if (currentHash !== lastHash) {
                const encrypted = await runWorkerTask<string>('encrypt-json', json, syncKey);
                encryptedShards[shardName] = encrypted;
                pendingHashUpdates.set(shardName, currentHash);
                if (typeof encrypted === 'string') {
                    pendingCipherHashUpdates.set(shardName, murmurHash3(encrypted));
                }
                changeCount++;
            }
        }
        const encryptEnd = performance.now();

        if (changeCount === 0) {
            logger.info(`[Sync Perf] encrypt=${(encryptEnd - encryptStart).toFixed(1)}ms total=${(performance.now() - perfStart).toFixed(1)}ms (no changes)`);
            setSyncStatus('syncSynced');
            isSyncInProgress = false;
            return;
        }

        addSyncLog(`Sincronizando ${changeCount} pacotes...`, "info");
        const safeTs = appState.lastModified || Date.now();
        
        const payloadStart = performance.now();
        const payload: SyncPostRequest = { lastModified: safeTs, shards: encryptedShards };
        const payloadBody = JSON.stringify(payload);
        const payloadEnd = performance.now();

        const postStart = performance.now();
        const response = await apiFetch('/api/sync', { 
            method: 'POST', 
            body: payloadBody 
        }, true);
        const postEnd = performance.now();

        // O reset de conta começou enquanto este envio estava no ar. Tratar a
        // resposta agora reescreveria o cofre recém-apagado — e o 409 é o pior
        // caso: a resolução de conflito mescla o estado antigo, ainda em
        // memória, com o cofre vazio e o devolve inteiro para a nuvem.
        if (isVaultResetInProgress) return;

        if (response.status === 409) {
            clearSyncHashCache();
            await resolveConflictWithServerState(await response.json());
        } else if (response.ok) {
            try {
                const payload: SyncPostResponse = await response.json();
                if (payload?.fallback) {
                    addSyncLog("Fallback sem Lua aplicado.", "info");
                }
            } catch (e) { logger.warn('[Sync] Failed to parse POST response body', e); }
            addSyncLog("Nuvem atualizada.", "success");
            setSyncStatus('syncSynced');
            setStoredRemoteStateEtag(null);
            pendingHashUpdates.forEach((hash, shard) => lastSyncedHashes.set(shard, hash));
            pendingCipherHashUpdates.forEach((cipherHash, shard) => lastSyncedCipherHashes.set(shard, cipherHash));
            persistHashCache();
            emitHabitsChanged();
        } else {
            const parsed = await readApiErrorMessage(response, `Erro ${response.status}`);
            const err = new Error(parsed.message) as Error & { status?: number; code?: string };
            err.status = response.status;
            err.code = parsed.code;
            throw err;
        }
        logger.info(`[Sync Perf] encrypt=${(encryptEnd - encryptStart).toFixed(1)}ms payload=${(payloadEnd - payloadStart).toFixed(1)}ms post=${(postEnd - postStart).toFixed(1)}ms total=${(performance.now() - perfStart).toFixed(1)}ms`);
    } catch (error: any) {
        const status = Number(error?.status || 0);
        const code = String(error?.code || '');
        const isTransient = status === 503 || code === 'LUA_UNAVAILABLE' || status === 429 || status >= 500;

        const formatTransientSyncLog = (err: any) => {
            const tech = String(err?.message || 'Erro desconhecido');
            if (code === 'LUA_UNAVAILABLE' || tech.includes('Atomic sync unavailable') || status === 503) {
                return 'Servidor de sync temporariamente indisponível. Reenfileirado.';
            }
            if (status === 429 || code === 'RATE_LIMITED') {
                return 'Muitas tentativas de sincronização. Tentando novamente em instantes. Reenfileirado.';
            }
            return 'Falha transitória no sync. Reenfileirado.';
        };

        if (isTransient) {
            if (pendingSyncQueue.length === 0) {
                enqueueSyncState(appState, { prioritize: true });
            }
            retryDelayMs = TRANSIENT_SYNC_RETRY_DELAY_MS;
            addSyncLog(formatTransientSyncLog(error), 'info');
            setSyncStatus('syncSaving');
        } else {
            addSyncLog(`Falha no envio: ${error.message}`, "error");
            setSyncStatus('syncError');
        }

        if ('serviceWorker' in navigator && 'SyncManager' in window) {
            navigator.serviceWorker.ready.then(reg => (reg as any).sync?.register('sync-cloud-pending')).catch(() => {});
        }
    } finally {
        isSyncInProgress = false;
        if (pendingSyncQueue.length > 0) setTimeout(performSync, retryDelayMs);
    }
}

/**
 * Reset de conta: esvazia o cofre e planta a marca `resetAt` do lado do
 * servidor, mantendo a chave de sync viva.
 *
 * O POST normal só faz HSET do que envia, então mandar um estado vazio deixaria
 * de pé todo shard que este aparelho não conhece mais (logs e arquivos de meses
 * já arquivados). Por isso o `purge`, que apaga a chave inteira antes de gravar.
 *
 * Falha aqui é fatal de propósito: quem chama não pode apagar o local se a
 * nuvem continuou cheia, senão o próximo boot baixa tudo de volta e o reset
 * vira um susto sem efeito.
 */
export async function purgeCloudVault(emptyState: AppState): Promise<void> {
    const syncKey = getSyncKey();
    if (!syncKey) throw new Error('Sync key ausente');

    isVaultResetInProgress = true;
    debouncedSync.cancel();
    pendingSyncQueue.length = 0;

    try {
        const rawShards = splitIntoShards(emptyState);
        const encryptedShards: EncryptedShardMap = {};
        for (const shardName in rawShards) {
            encryptedShards[shardName] = await runWorkerTask<string>('encrypt-json', JSON.stringify(rawShards[shardName]), syncKey);
        }

        const payload: SyncPostRequest = {
            lastModified: emptyState.lastModified || Date.now(),
            shards: encryptedShards,
            purge: true
        };

        const response = await apiFetch('/api/sync', { method: 'POST', body: JSON.stringify(payload) }, true);
        if (!response.ok) {
            const parsed = await readApiErrorMessage(response, `Erro ${response.status}`);
            const err = new Error(parsed.message) as Error & { status?: number; code?: string };
            err.status = response.status;
            err.code = parsed.code;
            throw err;
        }

        // Os hashes descrevem um cofre que não existe mais; mantê-los faria o
        // próximo sync pular shards por "não mudou".
        clearSyncClientCaches();
        addSyncLog('Dados da conta apagados na nuvem.', 'success');
        setSyncStatus('syncSynced');
    } catch (error: any) {
        // A trava só sobrevive ao caminho de sucesso, que termina em reload. Se
        // o purge falhou, o app continua vivo e o sync precisa voltar a andar.
        isVaultResetInProgress = false;
        addSyncLog(`Falha ao apagar a conta: ${error?.message || error}`, 'error');
        setSyncStatus('syncError');
        throw error;
    }
}

/**
 * Carimbo do reset de conta, se houver. Campo de controle em texto claro: vem
 * junto dos shards, mas não é conteúdo cifrado.
 */
function readVaultResetAt(shards: SyncServerShards): number {
    const parsed = Number(shards.resetAt || 0);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function syncStateWithCloud(appState: AppState, immediate = false) {
    if (!hasLocalSyncKey() || isVaultResetInProgress) return;
    enqueueSyncState(appState);
    setSyncStatus('syncSaving');
    if (isSyncInProgress) return;
    if (immediate) {
        debouncedSync.cancel();
        performSync();
    } else {
        debouncedSync();
    }
}

export async function pullRemoteChanges(): Promise<void> {
    if (isSyncInProgress) return;
    await fetchStateFromCloud();
}

async function reconstructStateFromShards(shards: SyncServerShards, localShards?: Record<string, any>): Promise<AppState | undefined> {
    const syncKey = getSyncKey();
    if (!syncKey) return undefined;
    try {
        const decryptedShards = await decryptServerShards(shards, syncKey, { updateHashCache: true, localShards });
        persistHashCache();
        return buildAppStateFromDecryptedShards(decryptedShards, shards.lastModified);
    } catch (e) {
        logger.error("State reconstruction failed:", e);
        return undefined;
    }
}

type RemoteShardsResult =
    | { status: 'not-modified' }
    | { status: 'empty' }
    | { status: 'ok'; shards: SyncServerShards };

/**
 * GET condicional em /api/sync. O resultado distingue "nada mudou" (304, o ETag
 * bate) de "cofre vazio", porque os chamadores reagem de formas diferentes a
 * cada um. A mensagem de erro fica por conta de quem chama, pelo mesmo motivo.
 */
async function fetchRemoteShards(onError: (response: Response) => Promise<never>): Promise<RemoteShardsResult> {
    const response = await apiFetch('/api/sync', { headers: buildConditionalSyncGetHeaders() }, true);
    if (response.status === 304) return { status: 'not-modified' };
    if (!response.ok) await onError(response);

    updateStoredRemoteStateEtagFromResponse(response);
    const shards = await response.json();
    return shards && Object.keys(shards).length > 0 ? { status: 'ok', shards } : { status: 'empty' };
}

export async function downloadRemoteState(): Promise<AppState | undefined> {
    addSyncLog("Baixando dados remotos...", "info");
    const result = await fetchRemoteShards(async (response) => {
        const parsed = await readApiErrorMessage(response, 'Falha na conexão com a nuvem');
        throw new Error(parsed.message);
    });

    if (result.status === 'not-modified') { addSyncLog("Sem novidades na nuvem.", "info"); return undefined; }
    if (result.status === 'empty') { addSyncLog("Cofre vazio na nuvem.", "info"); return undefined; }

    addSyncLog("Dados baixados com sucesso.", "success");
    return await reconstructStateFromShards(result.shards, splitIntoShards(getPersistableState()));
}

export async function fetchStateFromCloud(): Promise<AppState | undefined> {
    if (!hasLocalSyncKey()) {
        state.initialSyncDone = true;
        return undefined;
    }
    setSyncStatus('syncSaving'); 
    try {
        const result = await fetchRemoteShards(async (response) => {
            throw new Error("Cloud fetch failed with status " + response.status);
        });
        // 304 confirma que a nuvem tem o que já temos; cofre vazio não confirma
        // nada, então segue local sem mexer no status.
        if (result.status === 'not-modified') { setSyncStatus('syncSynced'); return undefined; }
        if (result.status === 'empty') return undefined;

        const currentLocalShards = splitIntoShards(getPersistableState());
        const remoteState = await reconstructStateFromShards(result.shards, currentLocalShards);
        if (!remoteState) return undefined;

        // Conta reiniciada em outro aparelho: este ainda tem a base antiga, e o
        // merge — que faz união e deixa o lado cheio vencer o vazio — devolveria
        // tudo à nuvem. Só a base ANTERIOR ao reset é descartada: o que foi
        // registrado aqui depois do carimbo é trabalho novo, não sobra do que o
        // usuário mandou apagar. A limpeza vem depois da reconstrução de
        // propósito: um cofre ilegível não pode custar os dados locais.
        const resetAt = readVaultResetAt(result.shards);
        if (resetAt > (state.lastModified || 0)) {
            addSyncLog('Conta reiniciada em outro aparelho. Limpando dados locais.', 'info');
            await wipeLocalData();
        }

        const localState = getPersistableState();

        const hasDivergence = !statesEquivalentForSync(localState, remoteState);
        if (!hasDivergence) {
            setSyncStatus('syncSynced');
            return remoteState;
        }

        addSyncLog("Divergência detectada. Mesclando estados...", "info");
        const mergedState = await mergeStates(localState, remoteState, {
            onDedupCandidate: ({ identity, winnerHabit, loserHabit }) => confirmDeduplicationViaModal(identity, winnerHabit, loserHabit)
        });

        if (!statesEquivalentForSync(localState, mergedState)) {
            await persistStateLocally(mergedState);
            await loadState(mergedState);
            renderApp();
        }

        if (!statesEquivalentForSync(remoteState, mergedState)) {
            addSyncLog("Sincronizando estado mesclado para nuvem...", "info");
            syncStateWithCloud(mergedState, true);
        } else {
            setSyncStatus('syncSynced');
        }
        return remoteState;
    } catch (error) {
        logger.warn("[Cloud] Boot sync failed (Offline or Error). Proceeding locally.", error);
        setSyncStatus('syncError');
        return undefined;
    } finally {
        state.initialSyncDone = true;
    }
}

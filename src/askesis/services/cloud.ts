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
import { pushToOneSignal, createDebounced, logger, escapeHTML } from '../utils';
import { ui } from '../render/ui';
import { t } from '../i18n';
import { hasLocalSyncKey, getSyncKey, apiFetch } from './api';
import { renderApp, updateNotificationUI } from '../render';
import { showConfirmationModal } from '../render/modals';
import { mergeStates, buildDedupModalContext } from './dataMerge';
import { HabitService } from './HabitService';
import { runWorkerTask as runWorkerTaskInternal, type WorkerTaskType } from './workerClient';
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

let isSyncInProgress = false;
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
        quoteState: appState.quoteState
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

// PERF: Carrega hashes do localStorage para evitar re-upload no boot (Cold Start Optimization)
const lastSyncedHashes: Map<string, string> = (() => {
    try {
        const raw = localStorage.getItem(HASH_STORAGE_KEY);
        if (raw) {
            const loaded = new Map(JSON.parse(raw));
            return loaded;
        }
    } catch (e) {
        logger.warn("[Sync] Falha ao carregar cache de hashes", e);
    }
    return new Map();
})();

// Normaliza tamanho do cache após o load (evita crescimento indefinido no boot)
pruneHashCache();

function persistHashCache() {
    try {
        pruneHashCache();
        localStorage.setItem(HASH_STORAGE_KEY, JSON.stringify(Array.from(lastSyncedHashes.entries())));
    } catch (e) {
        logger.error("[Sync] Falha ao salvar cache de hashes", e);
    }
}

function pruneHashCache() {
    if (lastSyncedHashes.size <= CLOUD_HASH_CACHE_MAX_ENTRIES) return;
    while (lastSyncedHashes.size > CLOUD_HASH_CACHE_MAX_ENTRIES) {
        const firstKey = lastSyncedHashes.keys().next().value;
        if (firstKey === undefined) break;
        lastSyncedHashes.delete(firstKey);
    }
}

export function clearSyncHashCache() {
    lastSyncedHashes.clear();
    localStorage.removeItem(HASH_STORAGE_KEY);
    logger.info("[Sync] Hash cache cleared.");
}

function getStoredRemoteStateEtag(): string | null {
    try {
        return localStorage.getItem(REMOTE_STATE_ETAG_STORAGE_KEY);
    } catch {
        return null;
    }
}

function setStoredRemoteStateEtag(etag: string | null) {
    try {
        if (!etag) {
            localStorage.removeItem(REMOTE_STATE_ETAG_STORAGE_KEY);
            return;
        }
        localStorage.setItem(REMOTE_STATE_ETAG_STORAGE_KEY, etag);
    } catch {}
}

function updateStoredRemoteStateEtagFromResponse(response: Response) {
    const etag = response?.headers?.get?.('ETag') || response?.headers?.get?.('etag');
    if (etag) setStoredRemoteStateEtag(etag);
}

function serializeConflictRecoveryBackup(appState: AppState): string {
    return JSON.stringify({
        ...appState,
        monthlyLogs: Array.from((appState.monthlyLogs || new Map()).entries()).map(([key, value]) => [key, `0x${value.toString(16)}`])
    });
}

function storeConflictRecoveryBackup(appState: AppState) {
    try {
        localStorage.setItem(CONFLICT_RECOVERY_BACKUP_KEY, serializeConflictRecoveryBackup(appState));
    } catch (error) {
        logger.warn('[Sync] Failed to persist conflict recovery backup.', error);
    }
}

function clearConflictRecoveryBackup() {
    try {
        localStorage.removeItem(CONFLICT_RECOVERY_BACKUP_KEY);
    } catch {}
}

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

    const lastQueued = pendingSyncQueue[pendingSyncQueue.length - 1];
    if (!lastQueued) {
        pendingSyncQueue.push(snapshot);
        return;
    }

    if (statesEquivalentForSync(lastQueued, snapshot)) return;

    // Snapshots são estados completos; manter só o mais recente pendente evita perder mudanças locais.
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
    shards: Record<string, string>,
    syncKey: string,
    options: { updateHashCache: boolean }
): Promise<Record<string, any>> {
    const decrypted: Record<string, any> = {};
    for (const key in shards) {
        if (key === 'lastModified') continue;
        try {
            if (options.updateHashCache) {
                try {
                    const res = await runWorkerTask<any>('decrypt-with-hash', shards[key], syncKey);
                    if (!res || typeof res !== 'object' || !('value' in res)) {
                        throw new Error('decrypt-with-hash unsupported');
                    }
                    decrypted[key] = (res as any).value;
                    const hash = (res as any).hash;
                    if (typeof hash === 'string') lastSyncedHashes.set(key, hash);
                } catch {
                    // Backward-compat / test mocks: fall back to plain decrypt.
                    const value = await runWorkerTask<any>('decrypt', shards[key], syncKey);
                    decrypted[key] = value;
                    try {
                        lastSyncedHashes.set(key, murmurHash3(JSON.stringify(value)));
                    } catch {}
                }
            } else {
                decrypted[key] = await runWorkerTask<any>('decrypt', shards[key], syncKey);
            }
        } catch (e) {
            logger.warn(`[Sync] Skip decrypt ${key}`, e);
        }
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
        quoteState: core?.quoteState
    };

    for (const key in decryptedShards) {
        if (key.startsWith('archive:')) {
            result.archives[key.replace('archive:', '')] = decryptedShards[key];
        }
        if (key.startsWith('logs:')) {
            decryptedShards[key].forEach(([k, v]: [string, string]) => {
                try {
                    result.monthlyLogs.set(k, BigInt(v));
                } catch (e) {
                    logger.warn(`[Sync] Invalid log value for ${k}, skipping.`, e);
                }
            });
        }
    }

    return result as AppState;
}

function confirmDeduplicationViaModal(identity: string, winnerHabit: any, loserHabit: any): Promise<'deduplicate' | 'keep_separate'> {
    const winnerName = escapeHTML((winnerHabit.scheduleHistory?.[winnerHabit.scheduleHistory.length - 1]?.name
        || winnerHabit.scheduleHistory?.[winnerHabit.scheduleHistory.length - 1]?.nameKey
        || identity
        || ''));
    const loserName = escapeHTML((loserHabit.scheduleHistory?.[loserHabit.scheduleHistory.length - 1]?.name
        || loserHabit.scheduleHistory?.[loserHabit.scheduleHistory.length - 1]?.nameKey
        || identity
        || ''));

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
    if (isSyncInProgress || pendingSyncQueue.length === 0) return;
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
        const payload = { lastModified: safeTs, shards: encryptedShards };
        const payloadBody = JSON.stringify(payload);
        const payloadEnd = performance.now();

        const postStart = performance.now();
        const response = await apiFetch('/api/sync', { 
            method: 'POST', 
            body: payloadBody 
        }, true);
        const postEnd = performance.now();

        if (response.status === 409) {
            clearSyncHashCache();
            await resolveConflictWithServerState(await response.json());
        } else if (response.ok) {
            try {
                const payload = await response.json();
                if (payload?.fallback) {
                    addSyncLog("Fallback sem Lua aplicado.", "info");
                }
            } catch (e) { logger.warn('[Sync] Failed to parse POST response body', e); }
            addSyncLog("Nuvem atualizada.", "success");
            setSyncStatus('syncSynced');
            setStoredRemoteStateEtag(null);
            pendingHashUpdates.forEach((hash, shard) => lastSyncedHashes.set(shard, hash));
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

export function syncStateWithCloud(appState: AppState, immediate = false) {
    if (!hasLocalSyncKey()) return;
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

async function reconstructStateFromShards(shards: Record<string, string>): Promise<AppState | undefined> {
    const syncKey = getSyncKey();
    if (!syncKey) return undefined;
    try {
        const decryptedShards = await decryptServerShards(shards, syncKey, { updateHashCache: true });
        persistHashCache();
        return buildAppStateFromDecryptedShards(decryptedShards, shards.lastModified);
    } catch (e) {
        logger.error("State reconstruction failed:", e);
        return undefined;
    }
}

export async function downloadRemoteState(): Promise<AppState | undefined> {
    addSyncLog("Baixando dados remotos...", "info");
    const response = await apiFetch('/api/sync', { headers: buildConditionalSyncGetHeaders() }, true);
    if (response.status === 304) { addSyncLog("Sem novidades na nuvem.", "info"); return undefined; }
    if (!response.ok) {
        const parsed = await readApiErrorMessage(response, 'Falha na conexão com a nuvem');
        throw new Error(parsed.message);
    }
    updateStoredRemoteStateEtagFromResponse(response);
    const shards = await response.json();
    if (!shards || Object.keys(shards).length === 0) { addSyncLog("Cofre vazio na nuvem.", "info"); return undefined; }
    addSyncLog("Dados baixados com sucesso.", "success");
    return await reconstructStateFromShards(shards);
}

export async function fetchStateFromCloud(): Promise<AppState | undefined> {
    if (!hasLocalSyncKey()) {
        state.initialSyncDone = true;
        return undefined;
    }
    setSyncStatus('syncSaving'); 
    try {
        const response = await apiFetch('/api/sync', { headers: buildConditionalSyncGetHeaders() }, true);
        if (response.status === 304) { 
            state.initialSyncDone = true;
            setSyncStatus('syncSynced'); 
            return undefined; 
        }
        if (!response.ok) throw new Error("Cloud fetch failed with status " + response.status);
        updateStoredRemoteStateEtagFromResponse(response);
        const shards = await response.json();
        if (!shards || Object.keys(shards).length === 0) {
            state.initialSyncDone = true;
            return undefined;
        }
        const remoteState = await reconstructStateFromShards(shards);
        if (!remoteState) {
            state.initialSyncDone = true;
            return undefined;
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

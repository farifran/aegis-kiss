/**
 * @license
 * SPDX-License-Identifier: MIT
*/

/**
 * @file services/persistence.ts
 * @description Camada de Persistência e Gerenciamento de Ciclo de Vida de Dados (Storage Engine).
 */

import { state, AppState, Habit, HabitDailyInfo, APP_VERSION, getPersistableState, clearAllCaches } from '../state';
import { migrateState } from './migration';
import { HabitService } from './HabitService';
import { buildNotificationCards, NOTIFICATION_CARD_KEY, type NotificationCard } from './notificationCard';
import { clearHabitDomCache, resetGradeBaseline } from '../render';
import { logger } from '../utils';
import { emitRenderApp } from '../events';

const DB_NAME = 'AskesisDB', DB_VERSION = 1, STORE_NAME = 'app_state';
const STATE_JSON_KEY = 'askesis_core_json';
const STATE_BINARY_KEY = 'askesis_logs_binary';
const STATE_JSON_BACKUP_KEY = 'askesis_core_json_backup';

const HAS_INDEXED_DB = typeof indexedDB !== 'undefined' && typeof indexedDB.open === 'function';
const IS_TEST_ENV = (() => {
    const maybeProcess = (globalThis as { process?: { env?: { VITEST?: string; NODE_ENV?: string } } }).process;
    return !!(maybeProcess?.env?.VITEST || maybeProcess?.env?.NODE_ENV === 'test');
})();

const DB_OPEN_TIMEOUT_MS = 15000, IDB_SAVE_DEBOUNCE_MS = 800;
let dbPromise: Promise<IDBDatabase> | null = null;
let saveTimeout: number | undefined;
let activeSavePromise: Promise<void> | null = null;
let pendingSaveResolve: (() => void) | null = null;

function getDB(): Promise<IDBDatabase> {
    if (!HAS_INDEXED_DB) {
        return Promise.reject(new Error('IndexedDB not available'));
    }
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => { dbPromise = null; reject(new Error("Timeout IDB")); }, DB_OPEN_TIMEOUT_MS);
            let request: IDBOpenDBRequest;
            try {
                request = indexedDB.open(DB_NAME, DB_VERSION);
            } catch (e) {
                clearTimeout(timeoutId);
                dbPromise = null;
                reject(e);
                return;
            }
            request.onupgradeneeded = (e) => {
                const db = (e.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
            };
            request.onsuccess = (e) => {
                clearTimeout(timeoutId);
                const db = (e.target as IDBOpenDBRequest).result;
                db.onclose = db.onversionchange = () => dbPromise = null;
                resolve(db);
            };
            request.onerror = () => { clearTimeout(timeoutId); dbPromise = null; reject(request.error); };
        });
    }
    return dbPromise;
}

async function createBackupSnapshot(stateObj: AppState): Promise<void> {
    if (!HAS_INDEXED_DB) return;
    try {
        const db = await getDB();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(stateObj, STATE_JSON_BACKUP_KEY);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        logger.warn('[Persistence] createBackupSnapshot failed', e);
    }
}

async function restoreBackupSnapshot(): Promise<AppState | null> {
    if (!HAS_INDEXED_DB) return null;
    try {
        const db = await getDB();
        return await new Promise<AppState | null>((resolve) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).get(STATE_JSON_BACKUP_KEY);
            tx.oncomplete = () => resolve(req.result || null);
            tx.onerror = () => resolve(null);
        });
    } catch (e) {
        logger.warn('[Persistence] restoreBackupSnapshot failed', e);
        return null;
    }
}

async function clearBackupSnapshot(): Promise<void> {
    if (!HAS_INDEXED_DB) return;
    try {
        const db = await getDB();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).delete(STATE_JSON_BACKUP_KEY);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        logger.warn('[Persistence] clearBackupSnapshot failed', e);
    }
}

/**
 * Grava um estado específico no IndexedDB.
 * Otimizado para separar JSON leve de binários pesados (Hex-Strings).
 *
 * `cards` só é passado pelo caminho de save local, onde o `state` global é a
 * fonte da verdade. `persistStateLocally` (dados vindos da nuvem) omite: ali o
 * global ainda não foi hidratado, e um cartão montado dali sairia defasado.
 */
async function saveSplitState(main: AppState, cards?: NotificationCard[]): Promise<void> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);

        const logs = main.monthlyLogs;
        const jsonState = { ...main };
        // Remove logs do objeto principal para não duplicar no armazenamento
        delete (jsonState as any).monthlyLogs;

        store.put(jsonState, STATE_JSON_KEY);

        if (logs && logs.size > 0) {
            const serializedLogs: Record<string, string> = {};
            logs.forEach((v, k) => {
                serializedLogs[k] = HabitService.serializeLogValue(v);
            });
            store.put(serializedLogs, STATE_BINARY_KEY);
        } else {
            // FIX: Remove stale binary key when logs are empty (e.g., all habits deleted)
            store.delete(STATE_BINARY_KEY);
        }

        if (cards !== undefined) {
            // Lista vazia (sem hábitos agendados) apaga a anterior: melhor o
            // texto genérico do push do que um lembrete de ontem.
            if (cards.length > 0) store.put(cards, NOTIFICATION_CARD_KEY);
            else store.delete(NOTIFICATION_CARD_KEY);
        }

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

let syncHandler: ((state: AppState, immediate?: boolean) => void) | null = null;
export const registerSyncHandler = (h: (s: AppState, immediate?: boolean) => void) => syncHandler = h;

/**
 * Regrava só o cartão de notificação, sem tocar no resto do estado.
 *
 * O cartão normalmente é gravado junto do `saveState`, mas isso só acontece
 * quando algo muda. Abrir o app e apenas olhar não salva nada — e é justamente
 * aí que a frase estoica é escolhida (o chunk de citações é lazy). Sem este
 * caminho, a frase do dia só entraria no cartão depois da primeira marcação.
 *
 * Falha em silêncio: o cartão é um extra do lembrete, não fluxo do usuário.
 */
export async function persistNotificationCard(): Promise<void> {
    if (!HAS_INDEXED_DB) return;
    try {
        const cards = buildNotificationCards();
        const db = await getDB();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            if (cards.length > 0) store.put(cards, NOTIFICATION_CARD_KEY);
            else store.delete(NOTIFICATION_CARD_KEY);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        if (!(IS_TEST_ENV && String(e).includes('IndexedDB not available'))) {
            logger.warn('[Persistence] Falha ao gravar o cartão de notificação.', e);
        }
    }
}

function pruneOrphanedDailyData(habits: readonly Habit[], dailyData: Record<string, Record<string, HabitDailyInfo>>) {
    if (habits.length === 0) {
        // Mitigation: only clear after loadState fully assigns habits.
        Object.keys(dailyData).forEach(date => delete dailyData[date]);
        return;
    }
    const validIds = new Set(habits.map(h => h.id));
    for (const date in dailyData) {
        for (const id in dailyData[date]) {
            if (!validIds.has(id)) {
                delete dailyData[date][id];
            }
        }
        if (Object.keys(dailyData[date]).length === 0) delete dailyData[date];
    }
}

async function saveStateInternal(immediate = false, suppressSync = false, immediateSync = immediate) {
    if (activeSavePromise) await activeSavePromise;

    activeSavePromise = (async () => {
        // O timestamp já foi incrementado pelo chamador (_notifyChanges ou _notifyPartialUIRefresh)
        const structuredData = getPersistableState();
        try {
            if (HAS_INDEXED_DB) {
                await saveSplitState(structuredData, buildNotificationCards());
            }
        } catch (e) {
            if (!(IS_TEST_ENV && String(e).includes('IndexedDB not available'))) {
                logger.error("IDB Save Failed:", e);
            }
        }
        
        if (!suppressSync) {
            syncHandler?.(structuredData, immediateSync);
        }
    })();

    try {
        await activeSavePromise;
    } finally {
        activeSavePromise = null;
    }
}

function cancelPendingSave() {
    if (saveTimeout !== undefined) {
        clearTimeout(saveTimeout);
        saveTimeout = undefined;
    }
    if (pendingSaveResolve) {
        pendingSaveResolve();
        pendingSaveResolve = null;
    }
}

function hasPendingDebouncedSave(): boolean {
    return saveTimeout !== undefined || pendingSaveResolve !== null;
}

/**
 * Força gravação imediata se houver save debounced pendente.
 * Crítico em pagehide/visibility hidden: o debounce de 800ms perde a 1ª
 * marcação se o usuário fechar o PWA logo após instalar.
 */
export async function flushPendingSave(suppressSync = true): Promise<void> {
    if (!hasPendingDebouncedSave() && !activeSavePromise) return;
    try {
        await saveState(true, suppressSync);
    } catch (e) {
        logger.warn('[Persistence] flushPendingSave failed', e);
    }
}

let _lifecycleFlushAttached = false;

/**
 * Garante que mudanças em memória não se percam ao fechar/background o app.
 * Idempotente — pode ser chamado no boot.
 */
export function setupPersistenceLifecycleFlush(): void {
    if (_lifecycleFlushAttached || typeof window === 'undefined') return;
    _lifecycleFlushAttached = true;

    const onHide = () => {
        // Fire-and-forget: pagehide não espera async, mas iniciamos a tx IDB já.
        void flushPendingSave(true);
    };

    window.addEventListener('pagehide', onHide);
    // iOS/Android: ao mandar o PWA para segundo plano.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') onHide();
    });
    // Page Lifecycle API (Chrome): aba freezada.
    window.addEventListener('freeze', onHide as EventListener);
}

export async function saveState(immediate = false, suppressSync = false, immediateSync = immediate): Promise<void> {
    if (saveTimeout !== undefined) {
        clearTimeout(saveTimeout);
        saveTimeout = undefined;
    }

    if (immediate) {
        const resolve = pendingSaveResolve;
        pendingSaveResolve = null;
        await saveStateInternal(true, suppressSync, immediateSync);
        resolve?.();
    } else {
        return new Promise((resolve) => {
            const oldResolve = pendingSaveResolve;
            pendingSaveResolve = () => {
                oldResolve?.();
                resolve();
            };

            saveTimeout = self.setTimeout(async () => {
                saveTimeout = undefined;
                const currentResolve = pendingSaveResolve;
                pendingSaveResolve = null;
                await saveStateInternal(false, suppressSync, false);
                currentResolve?.();
            }, IDB_SAVE_DEBOUNCE_MS);
        });
    }
}

/**
 * Gravação Imediata (Data Landing).
 * Usado para dados vindo da nuvem: grava no disco exatamente o que recebeu, 
 * sem alterar o timestamp lastModified original da nuvem.
 */
export const persistStateLocally = async (data: AppState) => {
    if (activeSavePromise) await activeSavePromise;
    try {
        if (!HAS_INDEXED_DB) return;
        await saveSplitState(data);
    } catch (e) {
        if (!(IS_TEST_ENV && String(e).includes('IndexedDB not available'))) {
            logger.error("[Persistence] Immediate Cloud Persistence Failed:", e);
        }
    }
};

export async function loadState(cloudState?: AppState): Promise<AppState | null> {
    let mainState = cloudState;
    let binaryLogsData: any;

    // 1. Load from IDB if no Cloud State provided
    if (!mainState) {
        try {
            const db = await getDB();
            await new Promise<void>((resolve) => {
                const tx = db.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                
                const reqMain = store.get(STATE_JSON_KEY);
                const reqLogs = store.get(STATE_BINARY_KEY);
                
                tx.oncomplete = () => {
                    mainState = reqMain.result;
                    binaryLogsData = reqLogs.result;
                    resolve();
                };
                tx.onerror = () => resolve();
            });
        } catch (e) {
            logger.warn("[Persistence] Failed to read state from IDB", e);
        }
    }

    if (mainState) {
        // 2. CRITICAL FIX: Pre-Migration Hydration
        // Se temos logs binários do IDB, precisamos injetá-los no objeto ANTES da migração.
        // Se a migração rodar num objeto sem logs, ela pode assumir que é um estado novo 
        // e ignorar a atualização necessária dos bitmasks (ex: v8 -> v9), corrompendo os dados.
        if (binaryLogsData && !mainState.monthlyLogs) {
            (mainState as any).monthlyLogs = binaryLogsData;
        }

        // 3. Migrate State (Handles Schema Upgrades & Bitmask Expansion)
        //
        // A rede de segurança da migração custava duas transações IDB (gravar o
        // estado inteiro, apagá-lo) AGUARDADAS antes da hidratação — em TODA
        // abertura, inclusive nas que não têm o que migrar, que são quase todas.
        // Quando não há upgrade de schema, `migrateState` só sanitiza, e uma
        // cópia em memória (~1ms) devolve a mesma capacidade de recuperação sem
        // encostar no disco. O snapshot durável fica para o que ele existe:
        // migração de verdade, onde a transformação é grande e irreversível.
        const needsMigration = (mainState.version || 0) !== APP_VERSION;
        const memorySnapshot = needsMigration ? null : structuredClone(mainState);
        if (needsMigration) await createBackupSnapshot(mainState);

        let migrated: AppState | null = null;
        try {
            migrated = migrateState(mainState, APP_VERSION);
        } catch (e) {
            logger.error("[Persistence] Migration failed, attempting to restore backup", e);
            const restored = needsMigration ? await restoreBackupSnapshot() : memorySnapshot;
            if (restored) {
                migrated = restored;
            } else {
                // If restore is not available, rethrow so caller can handle.
                throw e;
            }
        } finally {
            if (needsMigration) await clearBackupSnapshot();
        }
        
        // 4. Hydrate Result into Global State
        state.monthlyLogs = migrated!.monthlyLogs;
        // CRITICAL: Reset Lazy Sharding cache whenever state is replaced from storage/cloud.
        HabitService.resetCache();
        
        // Fallback robusto: se a migração não hidratou o Map, reconstrói dos dados brutos.
        //
        // A checagem é por TIPO, e não só por tamanho: quando a rede de segurança
        // devolve o estado pré-migração, `monthlyLogs` vem como veio do disco — um
        // Record cru, não um Map. `.size` nele é `undefined`, que não é `0`, então
        // a condição antiga passava batida e o app seguia com um objeto simples
        // onde todo o HabitService espera um Map.
        if (!(state.monthlyLogs instanceof Map)) {
            state.monthlyLogs = HabitService.deserializeLogs(state.monthlyLogs ?? binaryLogsData);
        } else if (state.monthlyLogs.size === 0 && binaryLogsData) {
            state.monthlyLogs = HabitService.deserializeLogs(binaryLogsData);
        }

        state.habits = [...(migrated.habits || [])];
        state.lastModified = migrated.lastModified || Date.now();
        state.dailyData = migrated.dailyData || {};
        state.archives = migrated.archives || {};
        state.dailyDiagnoses = migrated.dailyDiagnoses || {};
        state.notificationsShown = [...(migrated.notificationsShown || [])];
        state.pending21DayHabitIds = [...(migrated.pending21DayHabitIds || [])];
        state.pendingConsolidationHabitIds = [...(migrated.pendingConsolidationHabitIds || [])];
        state.hasOnboarded = migrated.hasOnboarded ?? true;
        state.quests = [...(migrated.quests || [])];
        state.syncLogs = (migrated.syncLogs || []).map((log: any) => ({
            time: log.time,
            msg: log.msg,
            type: log.type
        }));

        if (state.syncLogs.length > 50) {
            state.syncLogs = state.syncLogs.slice(-50);
        }

        // Clear Caches (também avança a geração, invalidando o grau memoizado)
        clearAllCaches();
        // O render anterior a esta hidratação viu o estado vazio, no grau 1;
        // sem rebaixar a linha de base, o grau real chegaria como "conquista".
        resetGradeBaseline();
        
        clearHabitDomCache();
        Object.assign(state.uiDirtyState, { calendarVisuals: true, habitListStructure: true });
        
        const runCleanup = () => pruneOrphanedDailyData(state.habits, state.dailyData);
        if (window.scheduler?.postTask) {
             window.scheduler.postTask(runCleanup, { priority: 'background' });
        } else if (window.requestIdleCallback) {
            window.requestIdleCallback(() => runCleanup());
        } else {
            setTimeout(runCleanup, 50);
        }

        // Estado veio de fora (boot ou merge da nuvem): `saveState` não roda, e o
        // render da frase só regrava os cartões quando o contexto dela muda —
        // um hábito renomeado em outro aparelho não muda a contagem do dia e
        // deixaria o lembrete com o nome antigo.
        void persistNotificationCard();

        emitRenderApp();
        return migrated;
    }
    return null;
}

export const clearLocalPersistence = async () => {
    cancelPendingSave();
    try {
        const db = await getDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
        await new Promise(r => tx.oncomplete = r);
    } catch (e) {
        logger.warn("IDB clear failed", e);
    }
    // Use HabitService to clear logs and cache consistently
    HabitService.clearAllLogs();
};
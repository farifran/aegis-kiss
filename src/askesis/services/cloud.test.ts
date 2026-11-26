import { describe, it, expect, beforeEach, vi } from 'vitest';
import { state, getPersistableState } from '../state';
import { createTestHabit, clearTestState } from '../tests/test-utils';
import { HabitService } from './HabitService';

vi.mock('../render/ui', () => ({
    ui: { syncStatus: { textContent: '' } }
}));

vi.mock('../render', () => ({
    renderApp: vi.fn(),
    updateNotificationUI: vi.fn()
}));

vi.mock('../i18n', () => ({
    t: (key: string) => key
}));

vi.mock('./api', () => ({
    hasLocalSyncKey: vi.fn(),
    getSyncKey: vi.fn(),
    apiFetch: vi.fn()
}));

vi.mock('./persistence', () => ({
    loadState: vi.fn(async () => null),
    persistStateLocally: vi.fn(async () => {})
}));

vi.mock('./dataMerge', () => ({
    mergeStates: vi.fn(async (_local: any, remote: any) => remote)
}));

class MockWorker {
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: ((e: Event) => void) | null = null;

    postMessage(msg: any) {
        const { id, type, payload } = msg;
        if (type === 'encrypt') {
            this.onmessage?.({ data: { id, status: 'success', result: `enc:${JSON.stringify(payload)}` } } as MessageEvent);
            return;
        }
        if (type === 'decrypt') {
            if (payload === 'coreEnc') {
                this.onmessage?.({ data: { id, status: 'success', result: { version: 10, habits: [], dailyData: {}, dailyDiagnoses: {}, notificationsShown: [], hasOnboarded: true, quoteState: undefined } } } as MessageEvent);
                return;
            }
            if (payload === 'logsEnc') {
                this.onmessage?.({ data: { id, status: 'success', result: [['h1_2024-01', '0x1']] } } as MessageEvent);
                return;
            }
            this.onmessage?.({ data: { id, status: 'success', result: payload } } as MessageEvent);
            return;
        }
        this.onmessage?.({ data: { id, status: 'success', result: payload } } as MessageEvent);
    }
}

class TimeoutThenSuccessWorker {
    static attempts = 0;
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: ((e: Event) => void) | null = null;

    postMessage(msg: any) {
        const { id, type, payload } = msg;
        if (type === 'encrypt-json') {
            TimeoutThenSuccessWorker.attempts += 1;
            if (TimeoutThenSuccessWorker.attempts === 1) {
                return;
            }
            this.onmessage?.({ data: { id, status: 'success', result: `enc:${payload}` } } as MessageEvent);
            return;
        }
        this.onmessage?.({ data: { id, status: 'success', result: payload } } as MessageEvent);
    }

    terminate() {}
}

beforeEach(async () => {
    clearTestState();
    vi.clearAllMocks();
    localStorage.clear();
    const { clearSyncHashCache } = await import('./cloud');
    clearSyncHashCache();
    // @ts-expect-error - test override
    globalThis.Worker = MockWorker;
});

describe('cloud sync basics', () => {
    it('envia shards core e logs quando ha mudancas', async () => {
        const { apiFetch, getSyncKey, hasLocalSyncKey } = await import('./api');
        vi.mocked(hasLocalSyncKey).mockReturnValue(true);
        vi.mocked(getSyncKey).mockReturnValue('k');
        vi.mocked(apiFetch).mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as any);

        const habitId = createTestHabit({ name: 'H', time: 'Morning', goalType: 'check' });
        HabitService.setStatus(habitId, '2024-01-01', 'Morning', 1);
        state.lastModified = 123;

        const snapshot = getPersistableState();
        const { syncStateWithCloud } = await import('./cloud');
        syncStateWithCloud(snapshot, true);

        await new Promise(resolve => setTimeout(resolve, 0));

        expect(apiFetch).toHaveBeenCalled();
        const [, opts] = vi.mocked(apiFetch).mock.calls[0];
        const payload = JSON.parse(opts!.body as string);
        expect(payload.lastModified).toBe(123);
        expect(Object.keys(payload.shards)).toContain('core');
        expect(Object.keys(payload.shards)).toContain('logs:2024-01');
    });

    it('usa logs do snapshot mesmo com estado global alterado antes do envio', async () => {
        const { apiFetch, getSyncKey, hasLocalSyncKey } = await import('./api');
        vi.mocked(hasLocalSyncKey).mockReturnValue(true);
        vi.mocked(getSyncKey).mockReturnValue('k');
        vi.mocked(apiFetch).mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as any);

        const habitId = createTestHabit({ name: 'Snapshot Habit', time: 'Morning', goalType: 'check' });
        HabitService.setStatus(habitId, '2024-01-01', 'Morning', 1);
        state.lastModified = 456;

        const snapshot = getPersistableState();

        state.monthlyLogs = new Map();
        HabitService.setStatus(habitId, '2024-02-01', 'Morning', 1);

        const { syncStateWithCloud } = await import('./cloud');
        syncStateWithCloud(snapshot, true);

        await new Promise(resolve => setTimeout(resolve, 0));

        const [, opts] = vi.mocked(apiFetch).mock.calls[0];
        const payload = JSON.parse(opts!.body as string);

        expect(Object.keys(payload.shards)).toContain('logs:2024-01');
        expect(Object.keys(payload.shards)).not.toContain('logs:2024-02');
    });

    it('faz merge e aplica estado remoto mais recente', async () => {
        const { apiFetch, getSyncKey, hasLocalSyncKey } = await import('./api');
        const { mergeStates } = await import('./dataMerge');
        const { loadState, persistStateLocally } = await import('./persistence');
        const { renderApp } = await import('../render');

        vi.mocked(hasLocalSyncKey).mockReturnValue(true);
        vi.mocked(getSyncKey).mockReturnValue('k');
        vi.mocked(apiFetch).mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ lastModified: '2000', core: 'coreEnc', 'logs:2024-01': 'logsEnc' })
        } as any);

        state.lastModified = 1000;

        const { fetchStateFromCloud } = await import('./cloud');
        await fetchStateFromCloud();

        expect(mergeStates).toHaveBeenCalled();
        expect(persistStateLocally).toHaveBeenCalled();
        expect(loadState).toHaveBeenCalled();
        expect(renderApp).toHaveBeenCalled();
    });

    it('reenfileira e reenvia quando API retorna 503/LUA_UNAVAILABLE', async () => {
        vi.useFakeTimers();
        try {
            const { apiFetch, getSyncKey, hasLocalSyncKey } = await import('./api');
            vi.mocked(hasLocalSyncKey).mockReturnValue(true);
            vi.mocked(getSyncKey).mockReturnValue('k');

            vi.mocked(apiFetch)
                .mockResolvedValueOnce({
                    ok: false,
                    status: 503,
                    json: async () => ({ error: 'Atomic sync unavailable', code: 'LUA_UNAVAILABLE' })
                } as any)
                .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as any);

            const habitId = createTestHabit({ name: 'Retry Habit', time: 'Morning', goalType: 'check' });
            HabitService.setStatus(habitId, '2024-01-01', 'Morning', 1);
            state.lastModified = 789;

            const snapshot = getPersistableState();
            const { syncStateWithCloud } = await import('./cloud');
            syncStateWithCloud(snapshot, true);

            await vi.advanceTimersByTimeAsync(0);
            expect(apiFetch).toHaveBeenCalledTimes(1);
            expect(state.syncState).toBe('syncSaving');

            await vi.advanceTimersByTimeAsync(1600);
            expect(apiFetch).toHaveBeenCalledTimes(2);
            expect(state.syncState).toBe('syncSynced');
        } finally {
            vi.useRealTimers();
        }
    });

    it('mantem o snapshot mais recente pendente enquanto um envio anterior está em progresso', async () => {
        vi.useFakeTimers();
        try {
            const { apiFetch, getSyncKey, hasLocalSyncKey } = await import('./api');
            vi.mocked(hasLocalSyncKey).mockReturnValue(true);
            vi.mocked(getSyncKey).mockReturnValue('k');

            let resolveFirst!: (value: any) => void;
            vi.mocked(apiFetch)
                .mockImplementationOnce(() => new Promise<any>((resolve) => { resolveFirst = resolve; }) as any)
                .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as any);

            const habitId = createTestHabit({ name: 'Queued Habit', time: 'Morning', goalType: 'check' });

            HabitService.setStatus(habitId, '2024-01-01', 'Morning', 1);
            state.lastModified = 100;
            const firstSnapshot = getPersistableState();

            const { syncStateWithCloud } = await import('./cloud');
            syncStateWithCloud(firstSnapshot, true);

            HabitService.setStatus(habitId, '2024-01-02', 'Morning', 1);
            state.lastModified = 200;
            const secondSnapshot = getPersistableState();
            syncStateWithCloud(secondSnapshot, true);

            await vi.advanceTimersByTimeAsync(0);
            expect(apiFetch).toHaveBeenCalledTimes(1);

            resolveFirst({ ok: true, status: 200, json: async () => ({}) } as any);
            await vi.runAllTimersAsync();

            expect(apiFetch).toHaveBeenCalledTimes(2);
            const [, secondCallOptions] = vi.mocked(apiFetch).mock.calls[1];
            const secondPayload = JSON.parse(secondCallOptions!.body as string);
            expect(secondPayload.lastModified).toBe(200);
            expect(Object.keys(secondPayload.shards)).toContain('logs:2024-01');
        } finally {
            vi.useRealTimers();
        }
    });

    it('envia If-None-Match em pulls subsequentes quando já possui ETag remoto', async () => {
        const { apiFetch, getSyncKey, hasLocalSyncKey } = await import('./api');
        vi.mocked(hasLocalSyncKey).mockReturnValue(true);
        vi.mocked(getSyncKey).mockReturnValue('k');
        vi.mocked(apiFetch)
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: new Headers({ ETag: '"etag-1"' }),
                json: async () => ({ lastModified: '2000', core: 'coreEnc', 'logs:2024-01': 'logsEnc' })
            } as any)
            .mockResolvedValueOnce({
                ok: false,
                status: 304,
                headers: new Headers({ ETag: '"etag-1"' }),
                json: async () => ({})
            } as any);

        const { fetchStateFromCloud } = await import('./cloud');
        await fetchStateFromCloud();
        await fetchStateFromCloud();

        const [, secondCallOptions] = vi.mocked(apiFetch).mock.calls[1];
        const secondHeaders = new Headers(secondCallOptions?.headers);
        expect(secondHeaders.get('If-None-Match')).toBe('"etag-1"');
    });

    it('restaura checkpoint local quando a persistencia do merge em conflito falha', async () => {
        const { apiFetch, getSyncKey, hasLocalSyncKey } = await import('./api');
        const { persistStateLocally, loadState } = await import('./persistence');

        vi.mocked(hasLocalSyncKey).mockReturnValue(true);
        vi.mocked(getSyncKey).mockReturnValue('k');
        vi.mocked(apiFetch).mockResolvedValueOnce({
            ok: false,
            status: 409,
            json: async () => ({ lastModified: '2000', core: 'coreEnc', 'logs:2024-01': 'logsEnc' })
        } as any);

        vi.mocked(persistStateLocally)
            .mockRejectedValueOnce(new Error('IDB quota exceeded'))
            .mockResolvedValueOnce();

        const localHabitId = createTestHabit({ name: 'Local Before Conflict', time: 'Morning', goalType: 'check' });
        HabitService.setStatus(localHabitId, '2024-01-01', 'Morning', 1);
        state.lastModified = 1000;

        const snapshot = getPersistableState();
        const { syncStateWithCloud } = await import('./cloud');
        syncStateWithCloud(snapshot, true);

        await new Promise(resolve => setTimeout(resolve, 0));
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(persistStateLocally).toHaveBeenCalledTimes(2);
        const rollbackArg = vi.mocked(loadState).mock.calls[0]?.[0] as ReturnType<typeof getPersistableState>;
        expect(rollbackArg.habits.some(h => h.id === localHabitId)).toBe(true);
        expect(localStorage.getItem('askesis_sync_conflict_backup')).toBeNull();
        expect(state.syncState).toBe('syncError');
    });

    it('faz retry de tarefa pesada quando o worker estoura timeout', async () => {
        vi.useFakeTimers();
        try {
            vi.resetModules();
            TimeoutThenSuccessWorker.attempts = 0;
            // @ts-expect-error - test override
            globalThis.Worker = TimeoutThenSuccessWorker;

            const { runWorkerTask } = await import('./cloud');
            const taskPromise = runWorkerTask<string>('encrypt-json', '{"hello":"world"}', 'k');

            await vi.advanceTimersByTimeAsync(16000);
            await vi.runAllTimersAsync();

            await expect(taskPromise).resolves.toBe('enc:{"hello":"world"}');
            expect(TimeoutThenSuccessWorker.attempts).toBe(2);
        } finally {
            vi.useRealTimers();
        }
    });
});

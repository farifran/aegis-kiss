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
  hasLocalSyncKey: vi.fn(() => true),
  getSyncKey: vi.fn(() => 'k'),
  apiFetch: vi.fn()
}));

vi.mock('./persistence', () => ({
  loadState: vi.fn(async () => {}),
  persistStateLocally: vi.fn(async () => {})
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
        this.onmessage?.({
          data: {
            id,
            status: 'success',
            result: {
              version: 10,
              habits: [
                {
                  id: 'remote-habit',
                  createdOn: '2024-01-02',
                  scheduleHistory: [
                    {
                      startDate: '2024-01-02',
                      name: 'Remote Habit',
                      icon: '⭐',
                      color: '#000000',
                      goal: { type: 'check' },
                      times: ['Evening'],
                      frequency: { type: 'daily' },
                      scheduleAnchor: '2024-01-02'
                    }
                  ]
                }
              ],
              dailyData: {
                '2024-01-02': {
                  'remote-habit': {
                    instances: { Evening: { note: 'remote-note' } },
                    dailySchedule: undefined
                  }
                }
              },
              dailyDiagnoses: {},
              notificationsShown: [],
              hasOnboarded: true,
              quoteState: undefined
            }
          }
        } as MessageEvent);
        return;
      }

      if (payload === 'coreOlderEnc') {
        this.onmessage?.({
          data: {
            id,
            status: 'success',
            result: {
              version: 10,
              habits: [
                {
                  id: 'remote-older-habit',
                  createdOn: '2024-01-03',
                  scheduleHistory: [
                    {
                      startDate: '2024-01-03',
                      name: 'Remote Older Habit',
                      icon: '⭐',
                      color: '#111111',
                      goal: { type: 'check' },
                      times: ['Evening'],
                      frequency: { type: 'daily' },
                      scheduleAnchor: '2024-01-03'
                    }
                  ]
                }
              ],
              dailyData: {
                '2024-01-03': {
                  'remote-older-habit': {
                    instances: { Evening: { note: 'remote-older-note' } },
                    dailySchedule: undefined
                  }
                }
              },
              dailyDiagnoses: {},
              notificationsShown: [],
              hasOnboarded: true,
              quoteState: undefined
            }
          }
        } as MessageEvent);
        return;
      }

      if (payload === 'logsEnc') {
        this.onmessage?.({
          data: {
            id,
            status: 'success',
            result: [['remote-habit_2024-01', '0x1']]
          }
        } as MessageEvent);
        return;
      }

      if (payload === 'logsOlderEnc') {
        this.onmessage?.({
          data: {
            id,
            status: 'success',
            result: [['remote-older-habit_2024-01', '0x1']]
          }
        } as MessageEvent);
        return;
      }

      this.onmessage?.({ data: { id, status: 'success', result: payload } } as MessageEvent);
      return;
    }

    this.onmessage?.({ data: { id, status: 'success', result: payload } } as MessageEvent);
  }
}

describe('cloud + dataMerge integration', () => {
  beforeEach(async () => {
    clearTestState();
    vi.clearAllMocks();
    localStorage.clear();
    const { clearSyncHashCache } = await import('./cloud');
    clearSyncHashCache();
    // @ts-expect-error test override
    globalThis.Worker = MockWorker;
  });

  it('converge offline local + remoto ao voltar online', async () => {
    const localHabitId = createTestHabit({
      name: 'Local Habit',
      time: 'Morning',
      goalType: 'check'
    });
    HabitService.setStatus(localHabitId, '2024-01-01', 'Morning', 1);
    state.lastModified = 1000;

    const { apiFetch } = await import('./api');
    const { persistStateLocally } = await import('./persistence');

    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        lastModified: '2000',
        core: 'coreEnc',
        'logs:2024-01': 'logsEnc'
      })
    } as any);

    const { fetchStateFromCloud } = await import('./cloud');
    await fetchStateFromCloud();

    expect(persistStateLocally).toHaveBeenCalled();
    const mergedState = vi.mocked(persistStateLocally).mock.calls[0][0] as ReturnType<typeof getPersistableState>;

    const mergedIds = mergedState.habits.map(h => h.id);
    expect(mergedIds).toContain(localHabitId);
    expect(mergedIds).toContain('remote-habit');

    expect(mergedState.monthlyLogs.has(`${localHabitId}_2024-01`)).toBe(true);
    expect(mergedState.monthlyLogs.has('remote-habit_2024-01')).toBe(true);
  });

  it('deve carregar mudanças remotas mesmo com timestamp local maior', async () => {
    const localHabitId = createTestHabit({
      name: 'Local Ahead Habit',
      time: 'Morning',
      goalType: 'check'
    });
    HabitService.setStatus(localHabitId, '2024-01-01', 'Morning', 1);
    state.lastModified = 9999999999999;

    const { apiFetch } = await import('./api');
    const { persistStateLocally } = await import('./persistence');

    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        lastModified: '1000',
        core: 'coreOlderEnc',
        'logs:2024-01': 'logsOlderEnc'
      })
    } as any);

    const { fetchStateFromCloud } = await import('./cloud');
    await fetchStateFromCloud();

    expect(persistStateLocally).toHaveBeenCalled();
    const mergedState = vi.mocked(persistStateLocally).mock.calls[0][0] as ReturnType<typeof getPersistableState>;

    const mergedIds = mergedState.habits.map(h => h.id);
    expect(mergedIds).toContain(localHabitId);
    expect(mergedIds).toContain('remote-older-habit');
    expect(mergedState.monthlyLogs.has(`${localHabitId}_2024-01`)).toBe(true);
    expect(mergedState.monthlyLogs.has('remote-older-habit_2024-01')).toBe(true);
  });
});

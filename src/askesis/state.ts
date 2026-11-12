
/**
 * @license
 * SPDX-License-Identifier: MIT
*/

/**
 * @file state.ts
 * @description Definição do Estado Global e Estruturas de Dados (Single Source of Truth).
 */

import { getTodayUTCIso, parseUTCIsoDate, toUTCIsoDateString, logger } from './utils';
import { CACHE_HABIT_APPEARANCE_DAYS, CACHE_STREAKS_YEARS } from './constants';

// --- TYPES & INTERFACES ---

export type StoicVirtue = 'Wisdom' | 'Courage' | 'Justice' | 'Temperance';
export type StoicLevel = 1 | 2 | 3;
export type StoicDiscipline = 'Desire' | 'Action' | 'Assent';
export type GovernanceSphere = 'Biological' | 'Structural' | 'Social' | 'Mental';
export type HabitNature = 'Addition' | 'Subtraction';
export type HabitMode = 'scheduled' | 'attitudinal';

export interface HabitPhilosophy {
  readonly sphere: GovernanceSphere;
  readonly level: StoicLevel;
  readonly virtue: StoicVirtue;
  readonly discipline: StoicDiscipline;
  readonly nature: HabitNature;
  readonly conscienceKey: string;
  readonly stoicConcept: string;
  readonly masterQuoteId: string;
}

export type Frequency =
    | { readonly type: 'daily' }
    | { readonly type: 'interval'; readonly unit: 'days' | 'weeks'; readonly amount: number }
    | { readonly type: 'specific_days_of_week'; readonly days: readonly number[] };

export interface HabitDayData {
    goalOverride?: number;
    note?: string;
}

export type HabitDailyInstances = Partial<Record<TimeOfDay, HabitDayData>>;

export interface HabitDailyInfo {
    instances: HabitDailyInstances;
    dailySchedule: TimeOfDay[] | undefined;
}

export interface HabitGoal { 
    readonly type: 'pages' | 'minutes' | 'check'; 
    readonly total?: number; 
    readonly unitKey?: string;
}

export interface HabitSchedule {
    readonly startDate: string;
    endDate?: string; 
    readonly icon: string;
    readonly color: string;
    readonly goal: HabitGoal;
    readonly philosophy?: HabitPhilosophy;
    readonly name?: string;
    readonly subtitle?: string;
    readonly nameKey?: string;
    readonly subtitleKey?: string;
    readonly mode?: HabitMode;
    readonly times: readonly TimeOfDay[];
    readonly frequency: Frequency;
    readonly scheduleAnchor: string;
}

export interface Habit {
    readonly id: string;
    createdOn: string; 
    graduatedOn?: string; 
    deletedOn?: string; // LOGICAL DELETION (Tombstone)
    deletedName?: string;
    scheduleHistory: HabitSchedule[];
}

export interface DailyStoicDiagnosis {
    readonly level: StoicLevel;
    readonly themes: readonly string[];
    readonly timestamp: number;
}

export interface QuoteDisplayState {
    readonly currentId: string;
    readonly displayedAt: number;
    readonly lockedContext: string;
}

export interface SyncLog {
    time: number;
    msg: string;
    type: 'success' | 'error' | 'info';
}

/**
 * Um objetivo secundário em curso, concluído ou abandonado.
 *
 * `days` guarda as DATAS em que houve avanço, não um contador: o merge da nuvem
 * escolhe um vencedor por `lastModified` e descartaria o número do outro
 * aparelho, enquanto um conjunto de datas se une sem perda (mesma garantia que
 * `monthlyLogs` já tem). Guardar datas também é o que torna possível cobrar os
 * dias PERDIDOS: o avanço líquido sai da comparação entre o calendário e este
 * conjunto, sem nenhum contador para dessincronizar.
 *
 * Abandonar grava lápide em vez de remover o registro, senão a união com o
 * outro aparelho ressuscitaria o objetivo (mesma razão de `deletedOn` no hábito).
 */
export interface QuestRecord {
    /** Id do catálogo, ou `custom:<uuid>` para objetivos criados pelo usuário. */
    readonly id: string;
    readonly startedOn: string;
    days: string[];
    /**
     * Início da tentativa em curso; ausente significa `startedOn`.
     *
     * O avanço líquido conta dias marcados MENOS dias perdidos desde aqui, então
     * retomar um objetivo que caducou precisa de um marco novo. Zerar `days`
     * faria o mesmo efeito na barra, mas apagaria XP já ganho e o grau andaria
     * para trás — o que este motor não permite. A janela se move; o histórico
     * fica. No merge vale a tentativa MAIS RECENTE.
     */
    attemptFrom?: string;
    completedOn?: string;
    abandonedOn?: string;
    /**
     * Anotações por dia: data ISO → texto, como a nota do cartão de hábito.
     *
     * Objeto por data e não uma nota só pelo mesmo motivo de `days`: o merge une
     * chave por chave e nenhum aparelho apaga o que o outro escreveu offline. Uma
     * string única viveria e morreria com o vencedor do `lastModified`.
     */
    notes?: Record<string, string>;
    /** Apenas para objetivos personalizados; o do catálogo vem por chave i18n. */
    readonly customTitle?: string;
    readonly customTarget?: number;
}

export interface DaySummary {
    total: number;
    completed: number;
    snoozed: number;
    pending: number;
    completedPercent: number;
    snoozedPercent: number;
    showPlusIndicator: boolean;
}

export interface AppState {
    readonly version: number;
    lastModified: number; 
    readonly habits: readonly Habit[];
    readonly dailyData: Record<string, Record<string, HabitDailyInfo>>;
    readonly archives: Record<string, string | Uint8Array>; 
    readonly dailyDiagnoses: Record<string, DailyStoicDiagnosis>;
    readonly notificationsShown: string[];
    readonly pending21DayHabitIds: string[];
    readonly pendingConsolidationHabitIds: string[];
    readonly quoteState?: QuoteDisplayState;
    readonly hasOnboarded: boolean;
    readonly syncLogs: SyncLog[];
    readonly quests: QuestRecord[];
    monthlyLogs: Map<string, bigint>; // Bitmask Storage
    
    // AI Quota & Caching
    aiDailyCount: number;
    aiQuotaDate: string;
    lastAIContextHash: string | null;
}

export interface HabitTemplate {
    icon: string;
    color: string;
    mode?: HabitMode;
    times: TimeOfDay[];
    goal: HabitGoal;
    frequency: Frequency;
    name?: string;
    nameKey?: string;
    subtitleKey?: string;
    philosophy?: HabitPhilosophy;
}

export interface PredefinedHabit extends HabitTemplate {
    nameKey: string;
    subtitleKey: string;
    isDefault?: boolean;
}

// --- CONSTANTS ---
export const APP_VERSION = 12; // Bump version for the progression/quests module
export const STREAK_SEMI_CONSOLIDATED = 21;
export const STREAK_CONSOLIDATED = 66;
export const MAX_HABIT_NAME_LENGTH = 50;
export const AI_DAILY_LIMIT = 4;

export const HABIT_STATE = {
    NULL: 0,
    DONE: 1,
    DEFERRED: 2,
    DONE_PLUS: 3
} as const;

export const PERIOD_OFFSET: Record<TimeOfDay, number> = {
    'Morning': 0,
    'Afternoon': 3,
    'Evening': 6
};

export const FREQUENCIES: { labelKey: string, value: Frequency }[] = [
    { labelKey: 'freqDaily', value: { type: 'daily' } },
    { labelKey: 'freqSpecificDaysOfWeek', value: { type: 'specific_days_of_week', days: [] } },
    { labelKey: 'freqEvery', value: { type: 'interval', unit: 'days', amount: 2 } }
];

export const STREAK_LOOKBACK_DAYS = 730;

export const TIMES_OF_DAY = ['Morning', 'Afternoon', 'Evening'] as const;
export type TimeOfDay = typeof TIMES_OF_DAY[number];

export const LANGUAGES = [
    { code: 'pt', nameKey: 'langPortuguese' },
    { code: 'en', nameKey: 'langEnglish' },
    { code: 'es', nameKey: 'langSpanish' }
] as const;
export type Language = typeof LANGUAGES[number];

// --- APPLICATION STATE ---
export const state: {
    version: number;
    habits: Habit[];
    lastModified: number;
    dailyData: Record<string, Record<string, HabitDailyInfo>>;
    archives: Record<string, string | Uint8Array>;
    dailyDiagnoses: Record<string, DailyStoicDiagnosis>;
    unarchivedCache: Map<string, Record<string, Record<string, HabitDailyInfo>>>;
    streaksCache: Map<string, Map<string, number>>;
    habitAppearanceCache: Map<string, Map<string, boolean>>;
    scheduleCache: Map<string, Map<string, HabitSchedule | null>>;
    activeHabitsCache: Map<string, Array<{ habit: Habit; schedule: TimeOfDay[] }>>;
    daySummaryCache: Map<string, DaySummary>;
    selectedDate: string;
    activeLanguageCode: Language['code'];
    pending21DayHabitIds: string[];
    pendingConsolidationHabitIds: string[];
    notificationsShown: string[];
    hasOnboarded: boolean;
    syncLogs: SyncLog[];
    quests: QuestRecord[];
    quoteState?: QuoteDisplayState;
    aiState: 'idle' | 'loading' | 'completed' | 'error';
    aiReqId: number;
    hasSeenAIResult: boolean;
    lastAIResult: string | null;
    lastAIError?: string;
    syncState: 'syncInitial' | 'syncSaving' | 'syncSynced' | 'syncError';
    initialSyncDone: boolean; // PROTEÇÃO DE BOOT
    fullCalendar: { year: number; month: number; };
    uiDirtyState: { calendarVisuals: boolean; habitListStructure: boolean; };
    monthlyLogs: Map<string, bigint>;
    editingHabit?: { isNew: boolean; habitId?: string; originalData?: Habit; formData: HabitTemplate; targetDate: string };
    confirmAction: (() => void) | null;
    confirmEditAction: (() => void) | null;
    /**
     * Alvo da nota aberta. Hábito tem horário; objetivo secundário não tem, e é
     * o campo presente que diz de qual dos dois se trata.
     */
    editingNoteFor:
        | { habitId: string; date: string; time: TimeOfDay }
        | { questId: string; date: string }
        | null;
    pendingHabitTime: TimeOfDay | null;
    calendarDates: string[];
    // AI Quota Fields
    aiDailyCount: number;
    aiQuotaDate: string;
    lastAIContextHash: string | null;
} = {
    version: APP_VERSION,
    habits: [],
    lastModified: 0,
    dailyData: {},
    archives: {},
    dailyDiagnoses: {},
    unarchivedCache: new Map(),
    streaksCache: new Map(),
    habitAppearanceCache: new Map(),
    scheduleCache: new Map(),
    activeHabitsCache: new Map(),
    daySummaryCache: new Map(),
    selectedDate: getTodayUTCIso(),
    activeLanguageCode: 'pt',
    pending21DayHabitIds: [],
    pendingConsolidationHabitIds: [],
    notificationsShown: [],
    hasOnboarded: false,
    syncLogs: [],
    quests: [],
    aiState: 'idle',
    aiReqId: 0,
    hasSeenAIResult: true,
    lastAIResult: null,
    syncState: 'syncInitial',
    initialSyncDone: false, // Inicia como falso até o fetch cloud completar
    fullCalendar: { year: new Date().getUTCFullYear(), month: new Date().getUTCMonth() },
    uiDirtyState: { calendarVisuals: true, habitListStructure: true },
    monthlyLogs: new Map(),
    confirmAction: null,
    confirmEditAction: null,
    editingNoteFor: null,
    pendingHabitTime: null,
    calendarDates: [],
    aiDailyCount: 0,
    aiQuotaDate: getTodayUTCIso(),
    lastAIContextHash: null
};

/**
 * Caches indexados por hábito e data. Datas em ISO 8601 ordenam lexicograficamente,
 * então comparar strings basta para decidir o que descartar.
 */
type DateKeyedCache = Map<string, Map<string, unknown>>;

function dropDateKeys(cache: DateKeyedCache, shouldDrop: (dateISO: string) => boolean, pruneEmpty = false) {
    cache.forEach((dateMap, habitId) => {
        dateMap.forEach((_, dateISO) => {
            if (shouldDrop(dateISO)) dateMap.delete(dateISO);
        });
        if (pruneEmpty && dateMap.size === 0) cache.delete(habitId);
    });
}

/**
 * Extrai o estado atual para um formato serializável (JSON-safe para sync).
 */
export function getPersistableState(): AppState {
    return {
        version: APP_VERSION,
        lastModified: state.lastModified,
        habits: state.habits,
        dailyData: state.dailyData,
        archives: state.archives,
        dailyDiagnoses: state.dailyDiagnoses,
        notificationsShown: state.notificationsShown,
        pending21DayHabitIds: state.pending21DayHabitIds,
        pendingConsolidationHabitIds: state.pendingConsolidationHabitIds,
        quoteState: state.quoteState,
        hasOnboarded: state.hasOnboarded,
        syncLogs: state.syncLogs,
        quests: state.quests,
        monthlyLogs: state.monthlyLogs,
        aiDailyCount: state.aiDailyCount,
        aiQuotaDate: state.aiQuotaDate,
        lastAIContextHash: state.lastAIContextHash
    };
}

/**
 * BOOT LOCK PROTECTION: durante o boot usamos timestamp incremental simples;
 * depois do sync, o relógio real, para garantir o Last-Write-Wins do merge.
 *
 * Vive aqui, e não junto das ações de hábito, porque toda mutação persistida
 * precisa dele — inclusive as de objetivos secundários, que não passam por
 * `_notifyChanges`.
 */
export function bumpLastModified() {
    if (!state.initialSyncDone) {
        state.lastModified = state.lastModified + 1;
    } else {
        state.lastModified = Math.max(Date.now(), (state.lastModified || 0) + 1);
    }
    bumpStateGeneration();
}

/**
 * Contador de gerações do estado, para memoizações caras derivadas dos dados
 * (o grau, por exemplo).
 *
 * Existe porque `lastModified` NÃO serve de chave: reset, import e volta da
 * nuvem podem reinstalar um timestamp já visto, e o cache devolveria um valor
 * calculado sobre outros dados. Este número só cresce.
 */
let _stateGeneration = 0;

export function getStateGeneration(): number {
    return _stateGeneration;
}

export function bumpStateGeneration(): void {
    _stateGeneration++;
}

export function clearActiveHabitsCache() {
    state.activeHabitsCache.clear();
}

export function clearScheduleCache() {
    state.scheduleCache.clear();
}

export function clearAllCaches() {
    bumpStateGeneration();
    state.streaksCache.clear();
    state.scheduleCache.clear();
    state.activeHabitsCache.clear();
    state.unarchivedCache.clear();
    state.habitAppearanceCache.clear();
    state.daySummaryCache.clear();
}

export function invalidateCachesForDateChange(dateISO: string) {
    state.daySummaryCache.delete(dateISO);
    state.activeHabitsCache.delete(dateISO);
    // Um streak é uma corrida de dias consecutivos terminando na data lida, então
    // mudar o dia D altera o streak de D e de TODOS os dias posteriores. Apagar só
    // a chave D deixava a UI mostrando streaks obsoletos para as datas seguintes
    // até um reload — visível ao editar/desmarcar um dia passado.
    dropDateKeys(state.streaksCache, (key) => key >= dateISO);
    // Aparência e agenda dependem apenas da própria data (frequência e
    // scheduleHistory), nunca do status registrado — invalidação pontual O(1) por hábito basta.
    state.habitAppearanceCache.forEach(dateMap => dateMap.delete(dateISO));
    state.scheduleCache.forEach(dateMap => dateMap.delete(dateISO));
}

export function getHabitDailyInfoForDate(dateISO: string): Record<string, HabitDailyInfo> {
    if (!state.dailyData[dateISO]) {
        state.dailyData[dateISO] = {};
    }
    return state.dailyData[dateISO];
}

export function ensureHabitDailyInfo(dateISO: string, habitId: string): HabitDailyInfo {
    const dayData = getHabitDailyInfoForDate(dateISO);
    if (!dayData[habitId]) {
        dayData[habitId] = { instances: {}, dailySchedule: undefined };
    }
    return dayData[habitId];
}

export function ensureHabitInstanceData(dateISO: string, habitId: string, time: TimeOfDay): HabitDayData {
    const habitInfo = ensureHabitDailyInfo(dateISO, habitId);
    if (!habitInfo.instances[time]) {
        habitInfo.instances[time] = {};
    }
    return habitInfo.instances[time]!;
}

/**
 * Rolling window: descarta entradas anteriores ao corte para evitar memory leak
 * em sessões longas. Só falha em log — cache podado é otimização, não correção.
 */
function pruneBefore(name: string, cache: DateKeyedCache, shiftCutoff: (date: Date) => void): void {
    try {
        const cutoff = parseUTCIsoDate(getTodayUTCIso());
        shiftCutoff(cutoff);
        const cutoffDate = toUTCIsoDateString(cutoff);
        dropDateKeys(cache, (dateISO) => dateISO < cutoffDate, true);
    } catch (error) {
        logger.warn(`[Cache] Error pruning ${name}:`, error);
    }
}

export function pruneHabitAppearanceCache(): void {
    pruneBefore('habitAppearanceCache', state.habitAppearanceCache,
        (date) => date.setUTCDate(date.getUTCDate() - CACHE_HABIT_APPEARANCE_DAYS));
}

export function pruneStreaksCache(): void {
    pruneBefore('streaksCache', state.streaksCache,
        (date) => date.setUTCFullYear(date.getUTCFullYear() - CACHE_STREAKS_YEARS));
}

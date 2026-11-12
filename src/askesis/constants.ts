/**
 * @license
 * SPDX-License-Identifier: MIT
*/

/**
 * @file constants.ts
 * @description Constantes globais de comportamento (timings/limites).
 */

export const NETWORK_DEBOUNCE_MS = 500;
export const INTERACTION_DELAY_MS = 50;

export const CALENDAR_INITIAL_BUFFER_DAYS = 15;
export const CALENDAR_MAX_DOM_NODES = 200;

export const CALENDAR_SCROLL_THRESHOLD_PX = 350;
export const CALENDAR_BASE_BATCH_SIZE = 15;
export const CALENDAR_TURBO_BATCH_SIZE = 30;
export const CALENDAR_TURBO_TIME_WINDOW_MS = 1500;

export const QUOTE_COLLAPSE_DEBOUNCE_MS = 120;

/**
 * Dias à frente de hoje que recebem frase pré-calculada para o lembrete.
 * Precisa acompanhar DAYS_AHEAD em services/notificationCard.ts.
 */
export const NOTIFICATION_QUOTE_DAYS = 5;

/** Espera antes de recarregar quando o boot falha, e teto do fetch inicial da nuvem. */
export const BOOT_RELOAD_DELAY_MS = 500;
export const BOOT_SYNC_TIMEOUT_MS = 5000;
export const LANG_LOAD_TIMEOUT_MS = 5000;
export const SYNC_ENABLE_RETRY_MS = 500;
export const SYNC_COPY_FEEDBACK_MS = 1500;
export const SYNC_INPUT_FOCUS_MS = 100;
export const CALENDAR_LONG_PRESS_MS = 500;

/**
 * --- PROGRESSÃO (GRAU E XP) ---
 *
 * A curva é linear no incremento: o grau N custa BASE + (N-1)*STEP. Com estes
 * números, quem cumpre 3 hábitos por dia chega ao grau 6 em um mês, ao 25 em
 * cerca de um ano e ao 100 em torno de uma década — a escada inteira é
 * alcançável, ao contrário do protótipo, em que zerar o catálogo parava no grau
 * 25 e as duas patentes mais altas eram inatingíveis por construção.
 */
export const GRADE_XP_BASE = 120;
export const GRADE_XP_STEP = 30;
export const MAX_GRADE = 100;

/** XP por instância de hábito concluída, e o extra de quem superou a meta. */
export const XP_PER_COMPLETION = 10;
export const XP_PER_OVERACHIEVEMENT = 5;

export const QUEST_MAX_ACTIVE = 3;
/**
 * Acima disto a barra do objetivo deixa de ser dividida e volta a ser contínua.
 * Num filete de ~280px, 31 divisões já dão ~9px cada; as 90 do desafio
 * trimestral dariam 3px, menos que o próprio corte entre elas — viraria ruído
 * em vez de contagem.
 */
export const QUEST_MAX_SEGMENTS = 31;
/**
 * Piso do avanço líquido: abaixo dele o objetivo sai do slot.
 *
 * O avanço soma um dia marcado e desconta um dia perdido, então -1 é o primeiro
 * valor que só se alcança perdendo mais do que se fez. Quem nunca marcou some
 * depois de um único dia inteiro de silêncio — é o que libera o slot para algo
 * que a pessoa vá de fato fazer. Baixar para -2 dá um dia de tolerância a mais.
 */
export const QUEST_FAILURE_FLOOR = -1;
/** Prêmio de maestria somado ao XP do objetivo quando ele fecha. */
export const QUEST_MASTERY_BONUS = 0.2;
/**
 * Piso do XP por avanço — rede contra um item mal calibrado, não regra de preço.
 *
 * Era 10, e a 10 nenhum desafio de trinta dias conseguia valer menos de 300 XP:
 * o piso passava por cima do `xp` do catálogo e estourava o teto da leva por
 * conta própria. Em 5 ele volta a ser o que devia ser — garantia de que um passo
 * nunca arredonda para zero. Nenhum item do catálogo o alcança hoje.
 */
export const QUEST_MIN_STEP_XP = 5;
/** Objetivo personalizado tem XP derivado do alvo — o usuário não cunha o próprio. */
export const CUSTOM_QUEST_XP_PER_DAY = 25;
export const CUSTOM_QUEST_MAX_TARGET = 365;
export const CUSTOM_QUEST_MAX_TITLE_LENGTH = 60;
/** Teto da nota de um dia num objetivo; o mesmo que a nota do hábito aceita. */
export const QUEST_NOTE_MAX_LENGTH = 500;

export const HAPTIC_PATTERNS = {
	selection: 8,
	light: 12,
	medium: 20,
	heavy: 40,
	success: [15, 50, 15],
	error: [40, 60, 15]
} as const;

export const SWIPE_ACTION_THRESHOLD = 10;
export const SWIPE_BLOCK_CLICK_MS = 150;

export const DRAG_SCROLL_ZONE_PX = 80;
export const DRAG_MAX_SCROLL_SPEED = 15;
export const DRAG_DROP_INDICATOR_GAP = 4;

export const CLOUD_SYNC_DEBOUNCE_MS = 2000;
export const CLOUD_SYNC_LOG_MAX_ENTRIES = 50;
export const CLOUD_SYNC_LOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const CLOUD_HASH_CACHE_MAX_ENTRIES = 2000;
export const CLOUD_WORKER_TIMEOUT_MS = 15000;
export const CLOUD_WORKER_TIMEOUT_PER_256KB_MS = 4000;
export const CLOUD_WORKER_MAX_TIMEOUT_MS = 45000;

export const CACHE_HABIT_APPEARANCE_DAYS = 90;
export const CACHE_STREAKS_YEARS = 1;

export const ARCHIVE_DAYS_THRESHOLD = 90;

export const ARCHIVE_IDLE_FALLBACK_MS = 5000;

export const API_TIMEOUT_MS = 12000;
export const API_MAX_RETRIES = 2;
export const API_RETRY_DELAY_MS = 500;

export const QUOTE_WEIGHTS = {
	AI_MATCH: 50,
	SPHERE_MATCH: 40,
	RECOVERY: 35,
	PERFORMANCE: 30,
	MOMENTUM: 25,
	TIME_OF_DAY: 15,
	VIRTUE_ALIGN: 10,
	RECENTLY_SHOWN: -100
} as const;

export const QUOTE_MIN_DISPLAY_DURATION_MS = 20 * 60 * 1000;
export const QUOTE_TRIUMPH_ENTER = 0.80;
export const QUOTE_TRIUMPH_EXIT = 0.70;
export const QUOTE_STRUGGLE_ENTER = 0.25;
export const QUOTE_STRUGGLE_EXIT = 0.15;
export const QUOTE_HISTORY_LOOKBACK = 10;
export const QUOTE_HISTORY_GOOD_THRESHOLD = 0.5;

/**
 * @license
 * SPDX-License-Identifier: MIT
*/

/**
 * @file data/quests.ts
 * @description Catálogo estático de Objetivos Secundários (dados, sem lógica).
 *
 * Só chaves i18n aqui: o app é trilíngue com guardrail de paridade, e texto
 * literal neste arquivo apareceria em português para quem escolheu inglês.
 *
 * `xp` é escrito à mão, mas não é solto: o TOTAL de cada leva é calibrado para
 * caber no teto dela (ver `TIER_XP_CEILINGS`). Antes os valores eram generosos e
 * o teto descartava três quartos deles — o cartão prometia "+53 XP/dia" e
 * entregava zero depois do corte. Agora o corte é uma rede de segurança, não o
 * mecanismo: limpar uma leva rende quase exatamente o que o teto permite.
 *
 * A conta de cada item é `alvo × passo + 20% de maestria`, com `xp` divisível
 * pelo alvo para o passo (`getQuestStepXp`) ser exato. Consequência inevitável da
 * regra dos tetos: o XP POR DIA cai nas levas altas (25/dia no grau 1, 8/dia nos
 * desafios de trinta dias), porque o teto de uma leva é fixo enquanto os dias
 * dela crescem dez vezes. O que cresce por leva é o valor de cada objetivo
 * (25 → 112 → 210 → 288).
 *
 * O XP de objetivos personalizados, esse sim, é derivado — ver
 * `CUSTOM_QUEST_XP_PER_DAY`.
 *
 * ESCADA DE DURAÇÃO: o mesmo tema reaparece mais longo na leva seguinte, e é
 * essa repetição que faz a melhora ser sistemática em vez de avulsa. Alongar-se
 * três dias no grau 1 é um teste; trinta dias no grau 10 é um hábito. Por isso
 * as durações crescem por leva e não se misturam:
 *
 *   grau  1 →  1 a 3 dias      (provar que dá)
 *   grau  5 →  3 a 7 dias      (aguentar uma semana)
 *   grau 10 →  7 a 14 dias     (atravessar a desistência)
 *   grau 15 → 21 a 30 dias     (virar rotina)
 *   grau 20 → 30 a 100 dias    (virar quem você é)
 *
 * Os graus das levas são espaçados de cinco em cinco porque o TETO DE XP de cada
 * leva é o grau logo abaixo da leva seguinte (ver `TIER_XP_CEILINGS`): limpar a
 * leva 1 leva ao grau 4, a leva 5 ao 9, a leva 10 ao 14. Levas coladas (1 e 3,
 * como eram antes) deixariam o teto da primeira em 120 XP — os doze objetivos de
 * abertura valeriam quatro dias de hábito, e o incentivo viraria enfeite.
 */

export interface QuestCatalogItem {
    readonly id: string;
    /** Grau mínimo para que o objetivo possa ocupar um slot. */
    readonly reqGrade: number;
    /** Dias (ou marcos) de avanço até a conclusão. */
    readonly target: number;
    readonly xp: number;
    /**
     * Dias esperados entre um avanço e o seguinte; ausente significa diário.
     *
     * É o que impede a regressão de matar um objetivo de ritmo semanal: "revisão
     * semanal" só deve um avanço a cada sete dias, e cobrá-lo todo dia o
     * derrubaria antes da primeira revisão. Serve também de fôlego para tarefas
     * de uma sentada só ("carta ao seu eu futuro"), que ninguém faz no impulso
     * de aceitar.
     */
    readonly cadence?: number;
    readonly titleKey: string;
    readonly descKey: string;
}

export const QUEST_CATALOG: readonly QuestCatalogItem[] = [
    // --- GRAU 1: de um a três dias. Provar a si mesmo que dá. ---
    { id: 'realMeal', reqGrade: 1, target: 1, xp: 25, titleKey: 'questRealMealTitle', descKey: 'questRealMealDesc' },
    { id: 'sunrise', reqGrade: 1, target: 1, xp: 25, titleKey: 'questSunriseTitle', descKey: 'questSunriseDesc' },
    { id: 'noSpend', reqGrade: 1, target: 1, xp: 25, titleKey: 'questNoSpendTitle', descKey: 'questNoSpendDesc' },
    { id: 'digitalPurge', reqGrade: 1, target: 1, xp: 25, titleKey: 'questDigitalPurgeTitle', descKey: 'questDigitalPurgeDesc' },
    { id: 'noSugarDay', reqGrade: 1, target: 1, xp: 25, titleKey: 'questNoSugarDayTitle', descKey: 'questNoSugarDayDesc' },
    { id: 'silentPhone', reqGrade: 1, target: 1, xp: 25, titleKey: 'questSilentPhoneTitle', descKey: 'questSilentPhoneDesc' },
    { id: 'stretch', reqGrade: 1, target: 3, xp: 39, titleKey: 'questStretchTitle', descKey: 'questStretchDesc' },
    { id: 'walk', reqGrade: 1, target: 3, xp: 39, titleKey: 'questWalkTitle', descKey: 'questWalkDesc' },
    { id: 'screenFreeHour', reqGrade: 1, target: 3, xp: 39, titleKey: 'questScreenFreeHourTitle', descKey: 'questScreenFreeHourDesc' },
    { id: 'waterFirst', reqGrade: 1, target: 3, xp: 39, titleKey: 'questWaterFirstTitle', descKey: 'questWaterFirstDesc' },
    { id: 'stairs', reqGrade: 1, target: 3, xp: 39, titleKey: 'questStairsTitle', descKey: 'questStairsDesc' },
    { id: 'gratitude', reqGrade: 1, target: 3, xp: 39, titleKey: 'questGratitudeTitle', descKey: 'questGratitudeDesc' },

    // --- GRAU 5: uma semana inteira. Aguentar o tédio do meio. ---
    { id: 'procrastination', reqGrade: 5, target: 1, xp: 55, cadence: 3, titleKey: 'questProcrastinationTitle', descKey: 'questProcrastinationDesc' },
    { id: 'apology', reqGrade: 5, target: 1, xp: 55, cadence: 3, titleKey: 'questApologyTitle', descKey: 'questApologyDesc' },
    { id: 'offline', reqGrade: 5, target: 3, xp: 39, titleKey: 'questOfflineTitle', descKey: 'questOfflineDesc' },
    { id: 'sleep', reqGrade: 5, target: 7, xp: 112, titleKey: 'questSleepTitle', descKey: 'questSleepDesc' },
    { id: 'coldShower', reqGrade: 5, target: 7, xp: 112, titleKey: 'questColdShowerTitle', descKey: 'questColdShowerDesc' },
    { id: 'reading', reqGrade: 5, target: 7, xp: 112, titleKey: 'questReadingTitle', descKey: 'questReadingDesc' },
    { id: 'deepWork', reqGrade: 5, target: 7, xp: 112, titleKey: 'questDeepWorkTitle', descKey: 'questDeepWorkDesc' },
    { id: 'noComplaint', reqGrade: 5, target: 7, xp: 112, titleKey: 'questNoComplaintTitle', descKey: 'questNoComplaintDesc' },
    { id: 'noAlcohol', reqGrade: 5, target: 7, xp: 112, titleKey: 'questNoAlcoholTitle', descKey: 'questNoAlcoholDesc' },
    { id: 'earlyRise', reqGrade: 5, target: 7, xp: 112, titleKey: 'questEarlyRiseTitle', descKey: 'questEarlyRiseDesc' },
    { id: 'noSnooze', reqGrade: 5, target: 7, xp: 112, titleKey: 'questNoSnoozeTitle', descKey: 'questNoSnoozeDesc' },
    { id: 'silence', reqGrade: 5, target: 7, xp: 112, titleKey: 'questSilenceTitle', descKey: 'questSilenceDesc' },

    // --- GRAU 10: duas semanas. Atravessar a hora de desistir. ---
    { id: 'declutter', reqGrade: 10, target: 3, xp: 48, cadence: 3, titleKey: 'questDeclutterTitle', descKey: 'questDeclutterDesc' },
    { id: 'weeklyReview', reqGrade: 10, target: 4, xp: 64, cadence: 7, titleKey: 'questWeeklyReviewTitle', descKey: 'questWeeklyReviewDesc' },
    { id: 'spendLog', reqGrade: 10, target: 7, xp: 112, titleKey: 'questSpendLogTitle', descKey: 'questSpendLogDesc' },
    { id: 'noSugarWeek', reqGrade: 10, target: 7, xp: 112, titleKey: 'questNoSugarWeekTitle', descKey: 'questNoSugarWeekDesc' },
    { id: 'strengthSessions', reqGrade: 10, target: 12, xp: 180, cadence: 3, titleKey: 'questStrengthSessionsTitle', descKey: 'questStrengthSessionsDesc' },
    { id: 'meditation', reqGrade: 10, target: 14, xp: 210, titleKey: 'questMeditationTitle', descKey: 'questMeditationDesc' },
    { id: 'journal', reqGrade: 10, target: 14, xp: 210, titleKey: 'questJournalTitle', descKey: 'questJournalDesc' },
    { id: 'firstRun', reqGrade: 10, target: 14, xp: 210, titleKey: 'questFirstRunTitle', descKey: 'questFirstRunDesc' },
    { id: 'studyDaily', reqGrade: 10, target: 14, xp: 210, titleKey: 'questStudyDailyTitle', descKey: 'questStudyDailyDesc' },
    { id: 'sunlight', reqGrade: 10, target: 14, xp: 210, titleKey: 'questSunlightTitle', descKey: 'questSunlightDesc' },
    { id: 'sideProject', reqGrade: 10, target: 14, xp: 210, titleKey: 'questSideProjectTitle', descKey: 'questSideProjectDesc' },

    // --- GRAU 15: um mês. O ponto em que deixa de ser esforço. ---
    { id: 'futureLetter', reqGrade: 15, target: 1, xp: 60, cadence: 7, titleKey: 'questFutureLetterTitle', descKey: 'questFutureLetterDesc' },
    { id: 'teaching', reqGrade: 15, target: 4, xp: 80, cadence: 7, titleKey: 'questTeachingTitle', descKey: 'questTeachingDesc' },
    { id: 'fasting', reqGrade: 15, target: 4, xp: 80, cadence: 7, titleKey: 'questFastingTitle', descKey: 'questFastingDesc' },
    { id: 'training', reqGrade: 15, target: 30, xp: 240, titleKey: 'questTrainingTitle', descKey: 'questTrainingDesc' },
    { id: 'wholeFood', reqGrade: 15, target: 30, xp: 240, titleKey: 'questWholeFoodTitle', descKey: 'questWholeFoodDesc' },
    { id: 'emergencyFund', reqGrade: 15, target: 30, xp: 240, titleKey: 'questEmergencyFundTitle', descKey: 'questEmergencyFundDesc' },
    { id: 'budget', reqGrade: 15, target: 30, xp: 240, titleKey: 'questBudgetTitle', descKey: 'questBudgetDesc' },
    { id: 'meditationMonth', reqGrade: 15, target: 30, xp: 240, titleKey: 'questMeditationMonthTitle', descKey: 'questMeditationMonthDesc' },
    { id: 'coldMonth', reqGrade: 15, target: 30, xp: 240, titleKey: 'questColdMonthTitle', descKey: 'questColdMonthDesc' },
    { id: 'dawnMonth', reqGrade: 15, target: 30, xp: 240, titleKey: 'questDawnMonthTitle', descKey: 'questDawnMonthDesc' },
    { id: 'screenFreeNights', reqGrade: 15, target: 30, xp: 240, titleKey: 'questScreenFreeNightsTitle', descKey: 'questScreenFreeNightsDesc' },
    { id: 'socialFast', reqGrade: 15, target: 30, xp: 240, titleKey: 'questSocialFastTitle', descKey: 'questSocialFastDesc' },

    // --- GRAU 20: de um mês a cem dias. Já não é desafio, é identidade. ---
    { id: 'mentorship', reqGrade: 20, target: 12, xp: 240, cadence: 7, titleKey: 'questMentorshipTitle', descKey: 'questMentorshipDesc' },
    { id: 'forgiveness', reqGrade: 20, target: 30, xp: 300, titleKey: 'questForgivenessTitle', descKey: 'questForgivenessDesc' },
    { id: 'quarterly', reqGrade: 20, target: 90, xp: 900, titleKey: 'questQuarterlyTitle', descKey: 'questQuarterlyDesc' },
    { id: 'halfMarathon', reqGrade: 20, target: 90, xp: 900, titleKey: 'questHalfMarathonTitle', descKey: 'questHalfMarathonDesc' },
    { id: 'finishedWork', reqGrade: 20, target: 90, xp: 900, titleKey: 'questFinishedWorkTitle', descKey: 'questFinishedWorkDesc' },
    { id: 'vice100', reqGrade: 20, target: 100, xp: 1000, titleKey: 'questVice100Title', descKey: 'questVice100Desc' }
] as const;

/**
 * Graus que abrem uma leva de objetivos, em ordem crescente.
 *
 * Derivado do catálogo em vez de escrito à mão: no protótipo esta lista era uma
 * constante `[1, 3, 5, 10, 15]` paralela ao catálogo, e acrescentar uma leva
 * exigia lembrar de editar os dois lugares.
 */
export const QUEST_TIERS: readonly number[] =
    Array.from(new Set(QUEST_CATALOG.map(q => q.reqGrade))).sort((a, b) => a - b);

const CATALOG_BY_ID = new Map(QUEST_CATALOG.map(q => [q.id, q]));

export function getQuestCatalogItem(id: string): QuestCatalogItem | undefined {
    return CATALOG_BY_ID.get(id);
}

/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file data/aiThemes.ts
 * @description Vocabulário de temas oferecido à IA na análise estoica.
 *
 * NÃO É TEXTO DE INTERFACE. São identificadores que a IA devolve e que o
 * quoteEngine compara com `quote.metadata.tags` para dar boost. Vivendo nos
 * arquivos de locale, foram traduzidos em pt/es e o boost morreu em silêncio:
 * os temas em português jamais casavam com as tags, que são inglesas.
 *
 * `satisfies readonly StoicTag[]` faz o compilador recusar qualquer tema que não
 * exista como tag — a classe inteira de erro deixa de ser possível.
 */

import type { StoicTag } from './quotes';

export const AI_THEMES = [
    'action', 'resilience', 'control', 'time', 'gratitude', 'discipline', 'temperance',
    'nature', 'learning', 'humility', 'reality', 'suffering', 'focus', 'virtue', 'death',
    'anxiety', 'community', 'perception', 'change', 'wisdom', 'perspective',
    'responsibility', 'reflection', 'duty', 'rest', 'consistency', 'presence', 'fate',
    'simplicity', 'healing', 'mindset', 'life', 'love', 'laziness', 'preparation',
    'prudence', 'peace', 'courage', 'confidence', 'growth', 'character', 'solitude',
    'justice', 'silence', 'optimism', 'creativity', 'passion', 'reason', 'history',
    'wealth', 'happiness', 'leadership', 'truth', 'freedom', 'acceptance', 'integrity',
    'minimalism', 'purpose', 'legacy', 'fear', 'belief', 'identity', 'practice',
    'authenticity', 'example', 'desire', 'habit', 'listening', 'values', 'criticism',
    'urgency', 'patience', 'strength', 'honor', 'essentialism', 'flow', 'health', 'hope',
    'speech', 'body', 'mindfulness', 'friendship', 'anger', 'kindness', 'chaos', 'judgment'
] as const satisfies readonly StoicTag[];

/** Lista pronta para interpolar no prompt ({theme_list}). */
export const AI_THEMES_PROMPT_LIST = AI_THEMES.join(', ');

/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file listeners/modals/aiHandlers.ts
 * @description Handlers de interação para modais de IA.
 */

import { state } from '../../state';
import { ui } from '../../render/ui';
import { openModal, renderAINotificationState } from '../../render';
import { sanitizeHtmlToFragment } from '../../render/dom';
import { performAIAnalysis, consumeAndFormatCelebrations } from '../../services/habitActions';
import { t } from '../../i18n';
import { simpleMarkdownToHTML, escapeHTML, triggerHaptic, logger } from '../../utils';

export const handleAiEvalClick = async () => {
    if (state.aiState === 'loading' || ui.aiModal.classList.contains('visible') || ui.aiOptionsModal.classList.contains('visible')) {
        return;
    }

    triggerHaptic('light');

    if (!navigator.onLine) {
        try {
            const { STOIC_QUOTES } = await import('../../data/quotes');
            const offlineQuotes = STOIC_QUOTES.filter(q =>
                q.metadata.tags.includes('control')
                || q.metadata.tags.includes('acceptance')
                || q.metadata.tags.includes('perception')
            );
            const sourceArray = offlineQuotes.length > 0 ? offlineQuotes : STOIC_QUOTES;
            const randomQuote = sourceArray[Math.floor(Math.random() * sourceArray.length)];
            const lang = state.activeLanguageCode as 'pt'|'en'|'es';
            const quoteText = escapeHTML(randomQuote.original_text[lang]);
            const author = escapeHTML(t(randomQuote.author));

            const message = `
                <div class="offline-header">
                    <h3 class="offline-title">${escapeHTML(t('aiOfflineTitle'))}</h3>
                    <p class="offline-desc">${escapeHTML(t('aiOfflineMessage'))}</p>
                </div>
                <div class="offline-quote-box">
                    <blockquote class="offline-quote-text">
                        "${quoteText}"
                    </blockquote>
                    <div class="offline-quote-author">
                        — ${author}
                    </div>
                </div>
            `;
            const fragment = sanitizeHtmlToFragment(message);
            ui.aiResponse.replaceChildren(fragment);
            openModal(ui.aiModal);
        } catch (e) {
            logger.error('Failed to load offline quote', e);
        }
        return;
    }

    let message = '';

    const allCelebrations = consumeAndFormatCelebrations();

    if (allCelebrations) {
        message = simpleMarkdownToHTML(allCelebrations);
        renderAINotificationState();
    } else if ((state.aiState === 'completed' || state.aiState === 'error') && !state.hasSeenAIResult && state.lastAIResult) {
        message = simpleMarkdownToHTML(state.lastAIResult);
    }

    if (message) {
        const fragment = sanitizeHtmlToFragment(message);
        ui.aiResponse.replaceChildren(fragment);
        openModal(ui.aiModal, undefined, () => {
            state.hasSeenAIResult = true;
            renderAINotificationState();
        });
    } else {
        openModal(ui.aiOptionsModal);
    }
};

export const handleAiOptionsClick = (e: MouseEvent) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('.ai-option-btn');
    if (!button) return;
    triggerHaptic('light');
    const analysisType = button.dataset.analysisType as 'monthly' | 'quarterly' | 'historical';
    performAIAnalysis(analysisType);
};

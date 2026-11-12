/**
 * @license
 * SPDX-License-Identifier: MIT
*/

/**
 * @file render.ts
 * @description Orquestrador de Renderização (View Orchestrator / Facade).
 */

import { state, LANGUAGES, getStateGeneration } from './state';
import { parseUTCIsoDate, toUTCIsoDateString, addDays, getTodayUTCIso, createDebounced, escapeHTML } from './utils';
import { pushToOneSignal, getLocalPushOptIn } from './services/push';
import { QUOTE_COLLAPSE_DEBOUNCE_MS, NOTIFICATION_QUOTE_DAYS } from './constants';
import { ui } from './render/ui';
import { t, setLanguage, formatDate } from './i18n'; 
import { UI_ICONS } from './render/icons';
import type { Quote } from './data/quotes';
import { selectBestQuote } from './services/quoteEngine';
import { calculateDaySummary } from './services/selectors';
import { setNotificationQuotes } from './services/notificationCard';
import { persistNotificationCard } from './services/persistence';
import { APP_EVENTS, emitRequestAnalysis } from './events';

// Importa os renderizadores especializados
import { setTextContent, updateReelRotaryARIA, setTrustedSvgContent } from './render/dom';
import { renderCalendar } from './render/calendar';
import { renderHabits } from './render/habits';
import { renderProgression } from './render/progression';
import { setupManageModal, refreshEditModalUI, renderLanguageFilter, showConfirmationModal } from './render/modals';

// Re-exporta tudo para manter compatibilidade
export * from './render/dom';
export * from './render/calendar';
export * from './render/calendarGrid';
export * from './render/habits';
export * from './render/modals';
export * from './render/progression';

/**
 * Monitor de Sincronização: Abre um diálogo com o histórico técnico de operações.
 * Essencial para o usuário validar se o "outro sistema" recebeu os dados.
 */
export function openSyncDebugModal() {
    const logs = state.syncLogs || [];
    if (logs.length === 0) {
        return showConfirmationModal("Nenhum log de sincronização disponível ainda.", () => {}, { title: "Monitor de Sync", hideCancel: true });
    }

    const logHtml = logs.slice().reverse().map(log => {
        const time = new Date(log.time).toLocaleTimeString();
        const color = log.type === 'error' ? '#ff6b6b' : (log.type === 'success' ? '#27ae60' : 'var(--text-secondary)');
        // SECURITY FIX: Escape log.msg to prevent XSS via crafted sync error messages
        const safeMsg = escapeHTML(log.msg);
        return `<div style="font-family:monospace; font-size:11px; padding:6px 0; border-bottom:1px solid var(--border-color); color:${color}">
            <span style="opacity:0.5">[${time}]</span> ${safeMsg}
        </div>`;
    }).join('');

    const containerHtml = `
        <div style="max-height: 300px; overflow-y: auto; padding-right: 10px;">
            ${logHtml}
        </div>
    `;

    showConfirmationModal(containerHtml, () => {}, { 
        title: "Monitor de Sincronização", 
        confirmText: "Fechar",
        hideCancel: true,
        allowHtml: true
    });
}

// --- HELPERS STATE ---
let _lastTitleDate: string | null = null;
let _lastTitleLang: string | null = null;
let _cachedQuoteState: { id: string, contextKey: string } | null = null;
let _cachedRefToday: string | null = null;
let _cachedYesterdayISO: string | null = null;
let _cachedTomorrowISO: string | null = null;

const OPTS_HEADER_DESKTOP: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', timeZone: 'UTC' };
const OPTS_HEADER_ARIA: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' };
const OPTS_HEADER_MOBILE_NUMERIC: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', timeZone: 'UTC' };

function _ensureRelativeDateCache(todayISO: string) {
    if (_cachedRefToday !== todayISO) {
        _cachedRefToday = todayISO;
        const todayDate = parseUTCIsoDate(todayISO);
        _cachedYesterdayISO = toUTCIsoDateString(addDays(todayDate, -1));
        _cachedTomorrowISO = toUTCIsoDateString(addDays(todayDate, 1));
    }
}

function _updateHeaderTitle() {
    if (_lastTitleDate === state.selectedDate && _lastTitleLang === state.activeLanguageCode) return;
    const todayISO = getTodayUTCIso();
    _ensureRelativeDateCache(todayISO);
    const selected = state.selectedDate;
    let titleKey: string | null = null;
    if (selected === todayISO) titleKey = 'headerTitleToday';
    else if (selected === _cachedYesterdayISO) titleKey = 'headerTitleYesterday';
    else if (selected === _cachedTomorrowISO) titleKey = 'headerTitleTomorrow';

    let desktopTitle: string, mobileTitle: string;
    const date = parseUTCIsoDate(selected);
    const numericDateStr = formatDate(date, OPTS_HEADER_MOBILE_NUMERIC);
    
    if (titleKey) {
        const localizedTitle = t(titleKey);
        desktopTitle = localizedTitle;
        mobileTitle = (selected === todayISO) ? localizedTitle : numericDateStr;
    } else {
        mobileTitle = numericDateStr;
        desktopTitle = formatDate(date, OPTS_HEADER_DESKTOP);
    }
    
    setTextContent(ui.headerTitleDesktop, desktopTitle);
    setTextContent(ui.headerTitleMobile, mobileTitle);
    ui.headerTitle.setAttribute('aria-label', formatDate(date, OPTS_HEADER_ARIA));

    ui.navArrowPast.classList.toggle('hidden', !(selected < todayISO));
    ui.navArrowFuture.classList.toggle('hidden', !(selected > todayISO));

    // Em telas mobile, adiciona classe para ajustar espaçamento quando a data
    // selecionada for hoje ou no passado. Isso ativa a regra CSS que dobra o gap.
    const headerEl = document.querySelector('.app-header') as HTMLElement | null;
    if (headerEl) {
        const isPastOrToday = selected <= todayISO;
        headerEl.classList.toggle('date-selected', isPastOrToday);
    }

    _lastTitleDate = selected;
    _lastTitleLang = state.activeLanguageCode;
}

function _renderHeaderIcons() {
    if (!ui.manageHabitsBtn.hasChildNodes()) setTrustedSvgContent(ui.manageHabitsBtn, UI_ICONS.settings);
    const defaultIconSpan = ui.aiEvalBtn.querySelector('.default-icon');
    if (defaultIconSpan && !defaultIconSpan.hasChildNodes()) setTrustedSvgContent(defaultIconSpan as HTMLElement, UI_ICONS.ai);
}

export function updateUIText() {
    const appNameHtml = t('appName');
    const appNameText = appNameHtml.replace(/<[^>]*>/g, '').trim();
    document.title = appNameText || 'Askesis';

    ui.fabAddHabit.setAttribute('aria-label', t('fabAddHabit_ariaLabel'));
    ui.manageHabitsBtn.setAttribute('aria-label', t('manageHabits_ariaLabel'));
    ui.aiEvalBtn.setAttribute('aria-label', t('aiEval_ariaLabel'));
    
    setTextContent(ui.exploreModal.querySelector('h2'), t('modalExploreTitle'));
    setTextContent(ui.createCustomHabitBtn, t('modalExploreCreateCustom'));
    setTextContent(ui.exploreModal.querySelector('.modal-close-btn'), t('closeButton'));
    setTextContent(ui.manageModalTitle, t('modalManageTitle'));
    setTextContent(ui.habitListTitle, t('modalManageHabitsSubtitle'));
    setTextContent(ui.labelLanguage, t('modalManageLanguage'));
    ui.languagePrevBtn.setAttribute('aria-label', t('languagePrev_ariaLabel'));
    ui.languageNextBtn.setAttribute('aria-label', t('languageNext_ariaLabel'));
    setTextContent(ui.labelSync, t('syncLabel'));
    setTextContent(ui.labelNotifications, t('modalManageNotifications'));
    setTextContent(ui.labelReset, t('modalManageReset'));
    setTextContent(ui.resetAppBtn, t('modalManageResetButton'));
    setTextContent(ui.manageModal.querySelector('.modal-close-btn'), t('cancelButton'));
    setTextContent(ui.labelPrivacy, t('privacyLabel'));
    setTextContent(ui.exportDataBtn, t('exportButton'));
    setTextContent(ui.importDataBtn, t('importButton'));
    setTextContent(ui.syncInactiveDesc, t('syncInactiveDesc'));
    setTextContent(ui.enableSyncBtn, t('syncEnable'));
    setTextContent(ui.enterKeyViewBtn, t('syncEnterKey'));
    setTextContent(ui.labelEnterKey, t('syncLabelEnterKey'));
    setTextContent(ui.cancelEnterKeyBtn, t('cancelButton'));
    setTextContent(ui.submitKeyBtn, t('syncSubmitKey'));
    setTextContent(ui.syncWarningText, t('syncWarning'));
    setTextContent(ui.keySavedBtn, ui.syncDisplayKeyView.dataset.context === 'view' ? t('closeButton') : t('syncKeySaved'));
    setTextContent(ui.syncActiveDesc, t('syncActiveDesc'));
    setTextContent(ui.viewKeyBtn, t('syncViewKey'));
    setTextContent(ui.disableSyncBtn, t('syncDisable'));
    setTextContent(ui.aiModal.querySelector('h2'), t('modalAITitle'));
    setTextContent(ui.aiModal.querySelector('.modal-close-btn'), t('closeButton'));
    setTextContent(ui.aiOptionsModal.querySelector('h2'), t('modalAIOptionsTitle'));
    
    const updateAiBtn = (type: string, titleKey: string, descKey: string) => {
        const btn = ui.aiOptionsModal.querySelector<HTMLElement>(`[data-analysis-type="${type}"]`);
        if (btn) {
            setTextContent(btn.querySelector('.ai-option-title'), t(titleKey));
            setTextContent(btn.querySelector('.ai-option-desc'), t(descKey));
        }
    };
    updateAiBtn('monthly', 'aiOptionMonthlyTitle', 'aiOptionMonthlyDesc');
    updateAiBtn('quarterly', 'aiOptionQuarterlyTitle', 'aiOptionQuarterlyDesc');
    updateAiBtn('historical', 'aiOptionHistoricalTitle', 'aiOptionHistoricalDesc');
    setTextContent(ui.confirmModal.querySelector('h2'), t('modalConfirmTitle'));
    setTextContent(ui.confirmModal.querySelector('.modal-close-btn'), t('cancelButton'));
    setTextContent(ui.confirmModalConfirmBtn, t('confirmButton'));
    setTextContent(ui.notesModal.querySelector('.modal-close-btn'), t('cancelButton'));
    setTextContent(ui.saveNoteBtn, t('modalNotesSaveButton'));
    ui.notesTextarea.placeholder = t('modalNotesTextareaPlaceholder');
    setTextContent(ui.iconPickerTitle, t('modalIconPickerTitle'));
    setTextContent(ui.iconPickerModal.querySelector('.modal-close-btn'), t('cancelButton'));
    setTextContent(ui.colorPickerTitle, t('modalColorPickerTitle'));
    setTextContent(ui.colorPickerModal.querySelector('.modal-close-btn'), t('cancelButton'));
    // Também estava fixo no HTML ("Salvar"), com a chave existindo sem uso.
    setTextContent(ui.editHabitSaveBtn, t('modalEditSaveButton'));

    const setBtnHtml = (btn: HTMLButtonElement, icon: string, text: string) => {
        const currentText = btn.textContent || '';
        const hasSingleTextNode = btn.childNodes.length === 1 && btn.firstChild?.nodeType === Node.TEXT_NODE;
        const expectedText = ` ${text}`;

        if (hasSingleTextNode && currentText === text) {
            setTrustedSvgContent(btn, icon);
            btn.append(document.createTextNode(expectedText));
            return;
        }

        if (currentText.trim() !== text || btn.childNodes.length < 2) {
            setTrustedSvgContent(btn, icon);
            btn.append(document.createTextNode(expectedText));
        }
    };
    setBtnHtml(ui.quickActionDone, UI_ICONS.check, t('quickActionMarkAllDone'));
    setBtnHtml(ui.quickActionSnooze, UI_ICONS.snoozed, t('quickActionMarkAllSnoozed'));
    setBtnHtml(ui.quickActionAlmanac, UI_ICONS.calendar, t('quickActionOpenAlmanac'));
    setTextContent(ui.noHabitsMessage, t('modalManageNoHabits'));
    if (state.editingHabit) refreshEditModalUI();
}

/**
 * Executa renderApp() dentro de uma View Transition nativa (se suportada).
 * O navegador captura um snapshot do DOM antes, aplica as mudanças, e anima
 * a transição via GPU usando os pseudo-elementos ::view-transition-*.
 * Em navegadores sem suporte, executa renderApp() normalmente (graceful degradation).
 */
export function viewTransitionRender(direction?: 'forward' | 'back') {
    if ('startViewTransition' in document) {
        const dir = direction || 'forward';
        document.documentElement.dataset.flipDir = dir;
        const vt = document.startViewTransition!(() => renderApp());
        vt.finished.then(() => { delete document.documentElement.dataset.flipDir; }).catch(() => { delete document.documentElement.dataset.flipDir; });
    } else {
        renderApp();
    }
}

/**
 * Já houve um render completo? No boot a resposta é não até o `init` terminar de
 * carregar o estado, e é isso que impede o `languageChanged` de desenhar a tela
 * com a lista ainda vazia — 31 células de calendário montadas para serem
 * descartadas no render seguinte.
 */
let hasRenderedOnce = false;

export function renderApp() {
    hasRenderedOnce = true;
    _renderHeaderIcons();
    _updateHeaderTitle();
    renderCalendar();
    renderHabits();
    _setupHabitEdgeFade();
    _scheduleHabitEdgeFadeUpdate();

    if ('scheduler' in window && window.scheduler) {
        window.scheduler.postTask(() => {
            renderAINotificationState();
            renderProgression();
            window.scheduler!.postTask(() => renderStoicQuote(), { priority: 'background' });
        }, { priority: 'user-visible' });
    } else {
        requestAnimationFrame(() => {
            renderAINotificationState();
            renderProgression();
            if ('requestIdleCallback' in window) requestIdleCallback(() => renderStoicQuote());
            else setTimeout(renderStoicQuote, 50);
        });
    }
    if (ui.manageModal.classList.contains('visible')) setupManageModal();
}

export function updateNotificationUI() {
    // Zero-deps: sem SDK, espelha permissão nativa + intenção local.
    if (typeof window === 'undefined' || typeof window.OneSignal === 'undefined') {
        const permission = (typeof Notification !== 'undefined' && Notification.permission) ? Notification.permission : 'default';
        const isDenied = permission === 'denied';
        const localOptIn = getLocalPushOptIn();
        const assumeEnabled = permission === 'granted' && localOptIn === true;
        ui.notificationToggle.checked = assumeEnabled;
        ui.notificationToggle.disabled = isDenied;
        ui.notificationToggleLabel.classList.toggle('disabled', isDenied);

        let statusKey = 'notificationStatusOptedOut';
        if (isDenied) statusKey = 'notificationStatusDisabled';
        else if (assumeEnabled) statusKey = 'notificationStatusEnabled';
        setTextContent(ui.notificationStatusDesc, t(statusKey));
        return;
    }

    pushToOneSignal((OneSignal: OneSignalLike) => {
        const isPushEnabled = !!OneSignal.User.PushSubscription.optedIn;
        const sdkPerm = OneSignal.Notifications.permission;
        const nativePerm = (typeof Notification !== 'undefined') ? Notification.permission : 'default';
        const localOptIn = getLocalPushOptIn();
        // SDK optedIn OU (permissão + intenção local). Opt-out explícito (local false) vence.
        const effectiveEnabled = localOptIn === false
            ? false
            : (isPushEnabled || (nativePerm === 'granted' && localOptIn === true));
        if (ui.notificationToggle.checked !== effectiveEnabled) ui.notificationToggle.checked = effectiveEnabled;
        const isDenied = nativePerm === 'denied' || sdkPerm === 'denied';
        if (ui.notificationToggle.disabled !== isDenied) {
            ui.notificationToggle.disabled = isDenied;
            ui.notificationToggleLabel.classList.toggle('disabled', isDenied);
        }
        let statusTextKey = 'notificationStatusOptedOut';
        if (isDenied) statusTextKey = 'notificationStatusDisabled';
        else if (effectiveEnabled) statusTextKey = 'notificationStatusEnabled';
        setTextContent(ui.notificationStatusDesc, t(statusTextKey));
    });
}

function initLanguageFilter() {
    const langNames = LANGUAGES.map(lang => t(lang.nameKey));
    ui.languageReel.replaceChildren(
        ...langNames.map(name => {
            const option = document.createElement('span');
            option.className = 'reel-option';
            option.textContent = name;
            return option;
        })
    );
    updateReelRotaryARIA(ui.languageViewport, LANGUAGES.findIndex(l => l.code === state.activeLanguageCode), langNames, 'language_ariaLabel');
}

export function renderAINotificationState() {
    const hasCelebrations = state.pending21DayHabitIds.length > 0 || state.pendingConsolidationHabitIds.length > 0;
    const hasUnseenResult = (state.aiState === 'completed' || state.aiState === 'error') && !state.hasSeenAIResult;
    ui.aiEvalBtn.classList.toggle('loading', state.aiState === 'loading');
    ui.aiEvalBtn.disabled = state.aiState === 'loading';
    ui.aiEvalBtn.classList.toggle('offline', !navigator.onLine);
    ui.aiEvalBtn.classList.toggle('has-notification', hasCelebrations || hasUnseenResult);
}

let _quoteCollapseListener: ((e: Event) => void) | null = null;
let _quoteCollapseScrollHandler: (() => void) | null = null;
let _habitEdgeFadeBound = false;
let _habitEdgeFadeFramePending = false;

function _applyHabitEdgeFadeState() {
    const container = ui.habitContainer;
    if (!container?.isConnected) return;

    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    const hasScrollableOverflow = maxScrollTop > 1;
    const showTopFade = hasScrollableOverflow && container.scrollTop > 1;
    const showBottomFade = hasScrollableOverflow && container.scrollTop < maxScrollTop - 1;

    container.classList.toggle('show-edge-fade-top', showTopFade);
    container.classList.toggle('show-edge-fade-bottom', showBottomFade);
}

function _scheduleHabitEdgeFadeUpdate() {
    if (_habitEdgeFadeFramePending) return;
    _habitEdgeFadeFramePending = true;

    requestAnimationFrame(() => {
        _habitEdgeFadeFramePending = false;
        _applyHabitEdgeFadeState();
    });
}

function _setupHabitEdgeFade() {
    if (_habitEdgeFadeBound) return;
    _habitEdgeFadeBound = true;

    ui.habitContainer.addEventListener('scroll', _scheduleHabitEdgeFadeUpdate, { passive: true });
    window.addEventListener('resize', _scheduleHabitEdgeFadeUpdate, { passive: true });
}

const _collapseExpandedQuote = () => {
    if (ui.stoicQuoteDisplay.querySelector('.quote-expanded')) {
        _cachedQuoteState = null;
        renderStoicQuote();
    }
};
function _setupQuoteAutoCollapse() {
    if (_quoteCollapseListener) return;
    _quoteCollapseListener = (e: Event) => {
        if ((e.target as HTMLElement).closest('.stoic-quote')) return;
        _collapseExpandedQuote();
    };
    _quoteCollapseScrollHandler = createDebounced(_collapseExpandedQuote, QUOTE_COLLAPSE_DEBOUNCE_MS);
    document.addEventListener('click', _quoteCollapseListener, { capture: true });
    ui.habitContainer.addEventListener('scroll', _quoteCollapseScrollHandler, { passive: true });
}

// LAZY CHUNK: data/quotes.ts é ~28% do bundle e nunca está no caminho crítico —
// renderStoicQuote só roda via requestIdleCallback/postTask(background). O dynamic
// import move esse peso para um chunk separado, carregado em paralelo após o boot.
let _quotes: readonly Quote[] | null = null;
let _quotesLoading: Promise<void> | null = null;

function ensureQuotesLoaded(): boolean {
    if (_quotes) return true;
    if (!_quotesLoading) {
        _quotesLoading = import('./data/quotes')
            .then(m => {
                _quotes = m.STOIC_QUOTES;
                renderStoicQuote();
            })
            .catch(() => {
                // Offline antes do chunk chegar: permite nova tentativa no próximo render.
                _quotesLoading = null;
            });
    }
    return false;
}

/**
 * Publica a adaptação de hoje e dos próximos dias para o cartão de notificação.
 *
 * A ADAPTAÇÃO é a versão curta, a mesma mostrada no card sem expandir. Isto vive
 * aqui, e não em notificationCard.ts, porque `data/quotes.ts` pesa ~87 KB e é
 * carregado sob demanda — importá-lo lá o traria para o grafo estático do boot.
 *
 * Os dias futuros existem para o lembrete sobreviver a uma ausência: o cartão
 * vale por dia UTC, e sem eles passar um dia sem abrir o app derrubava o texto
 * para o genérico. `selectBestQuote` só grava `state.quoteState` quando a data é
 * hoje, então calcular para datas futuras é livre de efeito colateral.
 *
 * A regravação é necessária: só abrir o app não dispara `saveState`.
 */
let _notificationQuotesCacheKey = '';
let _cachedFutureNotificationQuotes: { key: string; byDate: Record<string, string> } | null = null;

function publishNotificationQuotes(selectedForSelectedDate?: Quote) {
    if (!_quotes) return;

    const lang = state.activeLanguageCode as 'pt' | 'en' | 'es';
    const todayISO = getTodayUTCIso();
    const todayDiagLevel = state.dailyDiagnoses[todayISO]?.level ?? 1;
    const stateGen = getStateGeneration();
    const fullCacheKey = `${stateGen}|${todayISO}|${lang}|${todayDiagLevel}`;

    // Se a geração do estado, o dia de hoje e o idioma não mudaram (ex.: o usuário
    // apenas navegou entre datas no calendário ou o sync de nuvem terminou), os
    // cartões de notificação de hoje..hoje+5 já estão publicados e salvos.
    if (_notificationQuotesCacheKey === fullCacheKey) return;
    _notificationQuotesCacheKey = fullCacheKey;

    const today = parseUTCIsoDate(todayISO);
    let futureByDate: Record<string, string>;
    if (_cachedFutureNotificationQuotes && _cachedFutureNotificationQuotes.key === fullCacheKey) {
        futureByDate = _cachedFutureNotificationQuotes.byDate;
    } else {
        futureByDate = {};
        for (let offset = 1; offset <= NOTIFICATION_QUOTE_DAYS; offset++) {
            const dateISO = toUTCIsoDateString(addDays(today, offset));
            try {
                const quote = selectBestQuote(_quotes, dateISO);
                // Sem diagnóstico da IA para o dia (sempre o caso no futuro), nível 1.
                const level = state.dailyDiagnoses[dateISO]?.level ?? 1;
                const text = quote.adaptations[`level_${level}` as keyof typeof quote.adaptations]?.[lang];
                if (text) futureByDate[dateISO] = text;
            } catch {
                // Um dia sem frase apenas cai para o título de status; os demais seguem.
            }
        }
        _cachedFutureNotificationQuotes = { key: fullCacheKey, byDate: futureByDate };
    }

    const byDate: Record<string, string> = { ...futureByDate };
    try {
        const todayQuote = (selectedForSelectedDate && state.selectedDate === todayISO)
            ? selectedForSelectedDate
            : selectBestQuote(_quotes, todayISO);
        const text = todayQuote.adaptations[`level_${todayDiagLevel}` as keyof typeof todayQuote.adaptations]?.[lang];
        if (text) byDate[todayISO] = text;
    } catch {
        // Sem frase hoje: cai para o título de status.
    }

    setNotificationQuotes(byDate);
    void persistNotificationCard();
}

export function renderStoicQuote() {
    if (!ensureQuotesLoaded()) return;
    if (!state.dailyDiagnoses[state.selectedDate]) {
        emitRequestAnalysis(state.selectedDate);
    }
    const hour = new Date().getHours();
    const timeOfDay = hour < 12 ? 'Morning' : (hour < 18 ? 'Afternoon' : 'Evening');
    const summary = calculateDaySummary(state.selectedDate);
    const diagnosis = state.dailyDiagnoses[state.selectedDate];
    const userLevel = diagnosis ? diagnosis.level : 1;
    const performanceSig = `${summary.completed}/${summary.snoozed}/${summary.total}|${getStateGeneration()}|${userLevel}`;
    const currentContextKey = `${state.selectedDate}|${state.activeLanguageCode}|${timeOfDay}|${performanceSig}`;

    if (_cachedQuoteState && _cachedQuoteState.contextKey === currentContextKey) return;

    let selectedQuote: Quote;
    try {
        selectedQuote = selectBestQuote(_quotes!, state.selectedDate);
    } catch (e) {
        selectedQuote = _quotes![0];
    }

    _cachedQuoteState = { id: selectedQuote.id, contextKey: currentContextKey };
    const lang = state.activeLanguageCode as 'pt' | 'en' | 'es';
    const adaptationText = selectedQuote.adaptations[`level_${userLevel}` as keyof typeof selectedQuote.adaptations][lang];

    publishNotificationQuotes(selectedQuote);


    const container = ui.stoicQuoteDisplay;
    container.classList.remove('visible');
    container.replaceChildren();
    
    const adaptationSpan = document.createElement('span');
    adaptationSpan.className = 'quote-adaptation';
    adaptationSpan.textContent = adaptationText + ' ';
    
    const expander = document.createElement('button');
    expander.className = 'quote-expander';
    expander.textContent = '...';
    expander.setAttribute('aria-label', t('expandQuote'));

    expander.onclick = (e) => {
        e.stopPropagation();
        container.replaceChildren();
        const originalSpan = document.createElement('span');
        originalSpan.className = 'quote-expanded';
        originalSpan.style.fontStyle = 'italic';
        originalSpan.textContent = `"${selectedQuote.original_text[lang]}" — ${t(selectedQuote.author)}`;
        container.appendChild(originalSpan);
        _setupQuoteAutoCollapse();
        _scheduleHabitEdgeFadeUpdate();
    };

    container.appendChild(adaptationSpan);
    container.appendChild(expander);

    requestAnimationFrame(() => {
        if (!adaptationSpan.isConnected) return;
        const rects = adaptationSpan.getClientRects();
        let isSingleLine = rects.length === 1;
        if (rects.length > 1 && Math.abs(rects[rects.length - 1].top - rects[0].top) < 5) isSingleLine = true;
        container.style.justifyContent = isSingleLine ? 'flex-end' : 'flex-start';
        container.style.textAlign = isSingleLine ? 'right' : 'left';
        container.classList.add('visible');
        _scheduleHabitEdgeFadeUpdate();
    });
}

document.addEventListener(APP_EVENTS.languageChanged, () => {
    initLanguageFilter();
    renderLanguageFilter();
    updateUIText();
    if (ui.syncStatus) setTextContent(ui.syncStatus, t(state.syncState));
    // No boot este evento chega antes do estado sair do IndexedDB; o `init`
    // renderiza logo depois, com dados. Só a troca de idioma em uso precisa
    // redesenhar aqui.
    if (hasRenderedOnce) renderApp();
});

document.addEventListener(APP_EVENTS.habitsChanged, () => {
    if ('requestIdleCallback' in window) requestIdleCallback(() => renderStoicQuote());
    else setTimeout(renderStoicQuote, 1000);
});

export async function initI18n() {
    const savedLang = localStorage.getItem('habitTrackerLanguage');
    const browserLang = navigator.language.split('-')[0];
    let initialLang: 'pt' | 'en' | 'es' = (savedLang && ['pt', 'en', 'es'].includes(savedLang)) 
        ? savedLang as 'pt' | 'en' | 'es' 
        : (['pt', 'en', 'es'].includes(browserLang) ? browserLang as 'pt' | 'en' | 'es' : 'pt');
    await setLanguage(initialLang);
}

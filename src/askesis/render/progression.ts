/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file render/progression.ts
 * @description Barra de Grau (rodapé) e seção de Objetivos Secundários.
 *
 * [MAIN THREAD CONTEXT]:
 * Roda a cada `renderApp`, inclusive na navegação entre dias. A barra é
 * atualizada sempre (custa quatro escritas de texto e uma de largura), mas a
 * lista de objetivos só é reconstruída quando a assinatura muda — navegar de um
 * dia para o outro não mexe nos objetivos, e recriar os nós à toa mataria a
 * animação de progresso no meio.
 *
 * [SEM innerHTML]: todo nó sai de `el()`, então texto de usuário entra como nó
 * de texto por construção. O título de objetivo personalizado é o único texto
 * livre que chega aqui.
 */

import { state } from '../state';
import { ui } from './ui';
import { el, setTextContent, setTrustedHtmlFragment, setTrustedSvgContent } from './dom';
import { t, formatInteger, formatDate } from '../i18n';
import { getTodayUTCIso, triggerHaptic, logger, parseUTCIsoDate } from '../utils';
import { UI_ICONS } from './icons';
import { CSS_CLASSES } from './constants';
import { openModal, OPTS_NOTES } from './modals';
import { QUEST_MAX_ACTIVE, MAX_GRADE, QUEST_MAX_SEGMENTS } from '../constants';
import { QUEST_CATALOG, getQuestCatalogItem } from '../data/quests';
import type { QuestRecord } from '../state';
import {
    getProgression, getRankTier, getActiveQuests, getQuestNote,
    getVisibleCatalog, hasHiddenQuestTiers,
    getQuestTarget, getQuestProgress, getQuestNetProgress, getQuestStepXp, getCatalogStepXp,
    getQuestUnlockStatus, isQuestRegisteredForCycleOf, getCompletedQuestIds,
    type UnlockStatus
} from '../services/progression';

/** Grau desenhado por último, para detectar a subida sem guardá-la no estado. */
let lastRenderedGrade = 0;
/** XP total desenhado por último; -1 significa "ainda sem linha de base". */
let lastRenderedTotalXp = -1;
/** Assinatura da lista de objetivos já no DOM. */
let renderedQuestSignature = '';

// --- TEXTO ---

/** Título de um objetivo: chave do catálogo, ou o texto que o usuário escreveu. */
function getQuestTitle(quest: QuestRecord): string {
    const item = getQuestCatalogItem(quest.id);
    if (item) return t(item.titleKey);
    return quest.customTitle || t('questCustomFallbackTitle');
}

function describeLock(status: UnlockStatus): string {
    if (status.unlocked) return '';
    if (status.reason === 'grade') return t('questLockedGrade', { grade: status.requiredGrade });
    if (status.reason === 'later') return t('questLockedLater', { grade: formatInteger(status.tierGrade) });
    // `count` dirige o plural; é o que ainda disputa os slots com esta leva.
    return t('questLockedSlots', { count: status.pending, grade: formatInteger(status.tierGrade) });
}

// --- BARRA DE GRAU ---

function renderGradeBar() {
    const { grade, xpInGrade, xpForNext, totalXp } = getProgression();
    const rank = getRankTier(grade);
    const isMaxed = grade >= MAX_GRADE;

    setTextContent(ui.progression.gradeBadge, t('progressionGrade', { grade: formatInteger(grade) }));
    setTextContent(ui.progression.gradeRank, t(rank.key));
    setTextContent(
        ui.progression.gradeXp,
        isMaxed ? t('progressionMaxGrade') : `${formatInteger(xpInGrade)}/${formatInteger(xpForNext)}`
    );

    const percent = isMaxed ? 100 : Math.min(100, Math.floor((xpInGrade / xpForNext) * 100));
    ui.progression.gradeFill.style.width = `${percent}%`;

    const track = ui.progression.gradeTrack;
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuenow', String(percent));
    track.setAttribute('aria-label', t('progressionBar_ariaLabel', { grade: formatInteger(grade), rank: t(rank.key) }));

    // `lastRenderedGrade === 0` é o primeiro render da sessão: abrir o app não é
    // uma conquista, então só festeja quem subiu de grau com o app aberto.
    if (lastRenderedGrade > 0 && grade > lastRenderedGrade) {
        celebrateGradeUp();
    } else if (lastRenderedTotalXp >= 0 && totalXp > lastRenderedTotalXp) {
        // O ganho de XP não vira aviso de texto: a própria barra cresce e pulsa.
        // É onde o usuário já está olhando, e evita empilhar um cartaz a cada
        // marcação de hábito.
        pulseGradeGain();
    }

    lastRenderedGrade = grade;
    lastRenderedTotalXp = totalXp;
}

/** Reinicia uma animação CSS que pode já estar aplicada ao elemento. */
function restartAnimation(element: HTMLElement, className: string) {
    element.classList.remove(className);
    // Releitura forçada: sem ela o navegador agrupa remove+add num só estilo
    // computado e a animação não reinicia em ganhos seguidos.
    void element.offsetWidth;
    element.classList.add(className);
}

/**
 * Só movimento: a vibração é de quem tocou.
 *
 * A háptica mora na ação (marcar hábito, registrar avanço), não aqui. Vibrar no
 * render dava dois pulsos por toque — um do cartão, outro da barra que cresceu
 * em seguida.
 */
function pulseGradeGain() {
    restartAnimation(ui.progression.gradeTrack, 'is-gaining');
}

/**
 * Subida de grau: o selo e a barra reagem, e nada é escrito.
 *
 * A vibração forte é a exceção que se justifica — é o único evento raro o
 * bastante para merecer um sinal próprio, e não se lê na barra que a patente
 * mudou. O cartaz que anunciava a patente saiu: a conquista já está no selo, e
 * um pop-up por cima dela é a recompensa barata que este app existe para evitar.
 */
function celebrateGradeUp() {
    restartAnimation(ui.progression.gradeBadge, 'is-grade-up');
    restartAnimation(ui.progression.gradeTrack, 'is-gaining');
    triggerHaptic('success');
}

// --- OBJETIVOS ---

/**
 * O que a lista mostra, resumido — e é o LÍQUIDO que entra, não `days.length`.
 *
 * O avanço agora pode cair sozinho na virada do dia, sem que ninguém toque em
 * nada. Assinar pelo número de dias marcados deixaria a barra parada no valor de
 * ontem: quem não marcou anteontem nem ontem tem a mesma contagem de dias e o
 * mesmo "não registrei hoje", e a assinatura sairia idêntica.
 */
function questSignature(active: QuestRecord[], hasFreeSlot: boolean, today: string): string {
    // A nota entra na assinatura porque o ícone da gaveta muda quando ela existe.
    const activePart = active
        .map(q => [
            q.id,
            getQuestNetProgress(q),
            isQuestRegisteredForCycleOf(q, today) ? 1 : 0,
            getQuestNote(q, today) ? 1 : 0
        ].join(':'))
        .join('|');
    return `${activePart}#${hasFreeSlot ? 'livre' : ''}#${state.activeLanguageCode}#${getProgression().grade}`;
}

function buildIconBubble(icon: string, className: string): HTMLElement {
    const bubble = el('span', className);
    setTrustedSvgContent(bubble, icon);
    return bubble;
}

/**
 * Filete de progresso rente à base do cartão, dividido em tantas partes quantos
 * são os dias do objetivo — cada dia registrado acende uma.
 *
 * As divisões são desenhadas por `repeating-linear-gradient` sobre o filete, não
 * por um nó de DOM por dia: um objetivo de 30 dias custaria 30 elementos por
 * linha, três vezes na tela. `progress/target` cai sempre exatamente numa
 * fronteira, porque os dois são inteiros sobre o mesmo alvo.
 */
function buildProgressFill(progress: number, target: number): HTMLElement {
    const fill = el('div', 'quest-fill');
    fill.style.width = `${Math.min(100, (progress / target) * 100)}%`;

    const track = el('div', 'quest-progress', fill);
    if (target > 1 && target <= QUEST_MAX_SEGMENTS) {
        track.classList.add('is-segmented');
        track.style.setProperty('--quest-parts', String(target));
    }
    return track;
}

/**
 * Gaveta de swipe: painel absoluto atrás do conteúdo, com um botão só.
 *
 * Mesma anatomia e MESMAS classes do cartão de hábito (`swipe-delete-btn`,
 * `swipe-note-btn`), porque é o mesmo motor de gesto que as abre — arrastar para
 * a direita revela a lixeira à esquerda, para a esquerda revela a nota.
 */
function buildSwipeAction(side: 'left' | 'right', buttonClass: string, icon: string, action: string, questId: string, label: string): HTMLElement {
    const button = el('button', buttonClass);
    button.type = 'button';
    button.dataset.questAction = action;
    button.dataset.questId = questId;
    button.setAttribute('aria-label', label);
    setTrustedSvgContent(button, icon);
    return el('div', `quest-actions-${side}`, button);
}

/**
 * Uma linha com a anatomia do cartão de hábito, gestos incluídos.
 *
 * O corpo inteiro é o alvo do toque, como no cartão de hábito: não há botão de
 * "+" nem estado de adiado, só feito ou não feito, e tocar de novo desfaz. O
 * progresso não vem escrito por extenso — vira o filete dividido na base.
 */
function buildActiveQuestRow(quest: QuestRecord, today: string): HTMLElement {
    const target = getQuestTarget(quest);
    const progress = getQuestProgress(quest);
    const doneToday = isQuestRegisteredForCycleOf(quest, today);

    // Espelha o .completed-wrapper do cartão de hábito concluído. Não é botão: o
    // cartão todo é que recebe o toque.
    const control = buildIconBubble(UI_ICONS.check, `quest-done-wrapper${doneToday ? '' : ' is-empty'}`);
    control.setAttribute('aria-hidden', 'true');

    // Sem bolha de ícone: o raio já está no marcador da seção, e repeti-lo em
    // cada linha só empurrava o texto para a direita sem dizer nada de novo.
    // Nome e intervalo na MESMA linha; o nome trunca se faltar largura.
    const body = el(
        'div',
        'quest-row-body',
        el(
            'div',
            'quest-headings',
            el('span', 'quest-title', getQuestTitle(quest)),
            // `count` (= alvo) dirige o plural; done/total é que aparecem.
            el('span', 'quest-meta', t('questProgressDays', {
                count: target,
                done: formatInteger(progress),
                total: formatInteger(target)
            }))
        ),
        control
    );

    const content = el('div', 'quest-content-wrapper', body, buildProgressFill(progress, target));
    content.dataset.questAction = 'toggle';
    content.dataset.questId = quest.id;
    content.setAttribute('role', 'button');
    content.tabIndex = 0;
    content.setAttribute('aria-pressed', String(doneToday));
    content.setAttribute('aria-label', doneToday
        ? t('questRegisteredToday')
        : t('questRegister', { xp: formatInteger(getQuestStepXp(quest)) }));

    const row = el(
        'li',
        `quest-row${doneToday ? ' is-done-today' : ''}`,
        buildSwipeAction('left', CSS_CLASSES.SWIPE_DELETE_BTN, UI_ICONS.swipeDelete, 'delete', quest.id, t('questDelete_ariaLabel')),
        buildSwipeAction(
            'right',
            CSS_CLASSES.SWIPE_NOTE_BTN,
            getQuestNote(quest, today) ? UI_ICONS.swipeNoteHasNote : UI_ICONS.swipeNote,
            'note',
            quest.id,
            t('questNote_ariaLabel')
        ),
        content
    );
    row.dataset.questId = quest.id;
    return row;
}

/**
 * Slot livre: o mesmo convite do horário sem hábito.
 *
 * Antes vinha aqui uma sugestão nomeada com botão de ativar. Virou placeholder
 * por pedido, e o ganho é de coerência: um espaço vazio no app já significa
 * "toque para preencher", com a mesma moldura tracejada e a mesma seta. Quem
 * escolhe é o catálogo, que é onde a escolha de fato mora.
 */
function buildPlaceholderRow(): HTMLElement {
    const row = el(
        'li',
        'quest-placeholder',
        el('span', 'placeholder-arrow', '\u2192'),
        el('span', '', t('questsAddChallenge'))
    );
    row.dataset.questAction = 'open-picker';
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    return row;
}

function renderQuests() {
    const today = getTodayUTCIso();
    const active = getActiveQuests();
    const hasFreeSlot = active.length < QUEST_MAX_ACTIVE;

    // O marcador ocupa a mesma coluna de 30px dos ícones de manhã/tarde/noite e,
    // como eles, é só sinalização. Quem abre o catálogo é o rótulo ao lado —
    // alvo maior, óbvio, e sempre presente mesmo com os três slots ocupados.
    const marker = ui.progression.questsMarker;
    if (!marker.hasChildNodes()) setTrustedSvgContent(marker, UI_ICONS.bolt);
    setTextContent(ui.progression.questsTitle, t('questsTitle'));
    ui.progression.questsTitle.setAttribute('aria-label', t('questsOpenCatalog_ariaLabel'));

    const signature = questSignature(active, hasFreeSlot, today);
    if (signature === renderedQuestSignature) return;
    renderedQuestSignature = signature;

    // Um slot livre de cada vez: a seção é fixa e disputa altura com a lista de
    // hábitos, então mostra o próximo passo, não a fila inteira.
    const rows: HTMLElement[] = active.map(quest => buildActiveQuestRow(quest, today));
    if (hasFreeSlot) rows.push(buildPlaceholderRow());

    ui.progression.questsList.replaceChildren(...rows);
}

/**
 * Nota do dia num objetivo, no MESMO modal do hábito.
 *
 * Reaproveitar o modal é o ponto: o usuário já sabe o que esperar dali, e um
 * segundo modal com um textarea seria uma cópia com outro nome. O alvo vai em
 * `state.editingNoteFor`, e é a presença de `questId` (em vez de `habitId`) que
 * diz a `handleSaveNote` onde gravar. Sem horário no subtítulo: objetivo
 * secundário não tem turno.
 */
export function openQuestNotesModal(questId: string) {
    const quest = state.quests.find(item => item.id === questId);
    if (!quest) return;

    const today = getTodayUTCIso();
    state.editingNoteFor = { questId, date: today };

    setTextContent(ui.notesModalTitle, getQuestTitle(quest));
    setTextContent(ui.notesModalSubtitle, formatDate(parseUTCIsoDate(today), OPTS_NOTES));
    ui.notesTextarea.value = getQuestNote(quest, today);

    openModal(ui.notesModal, ui.notesTextarea, () => state.editingNoteFor = null);
}

// --- CATÁLOGO (modal) ---

function buildCatalogRow(
    item: typeof QUEST_CATALOG[number],
    completedIds: Set<string>,
    activeIds: Set<string>,
    slotsFull: boolean
): HTMLElement {
    const status = getQuestUnlockStatus(item.reqGrade);
    const isCompleted = completedIds.has(item.id);
    const isActive = activeIds.has(item.id);
    // Com os três slots ocupados o objetivo não é para agora, mesmo destravado.
    const isOutOfReach = slotsFull && !isCompleted && !isActive;

    // Nome e intervalo lado a lado na primeira linha; descrição na segunda; e a
    // ação numa terceira, alinhada à direita. Ao lado do texto, como estava, o
    // botão comprimia o nome até "Alongamento ...".
    const headingsLine = el(
        'div',
        'quest-headings',
        el('span', 'quest-title', t(item.titleKey)),
        el('span', 'quest-meta', t('questSuggestionMeta', { count: item.target, grade: formatInteger(item.reqGrade) }))
    );

    let action: HTMLElement;
    if (isCompleted) {
        action = el('span', 'quest-catalog-state quest-catalog-state--done', t('questCompleted'));
    } else if (isActive) {
        // Abandonar mora aqui: a linha do rodapé agora tem um controle só, como
        // o cartão de hábito, e não cabia um "×" ao lado do botão de registrar.
        const abandonBtn = el('button', 'quest-abandon-btn', t('questAbandon'));
        abandonBtn.type = 'button';
        abandonBtn.dataset.questAction = 'abandon';
        abandonBtn.dataset.questId = item.id;
        action = abandonBtn;
    } else if (status.unlocked) {
        const activateBtn = el('button', 'quest-activate-btn', t('questActivate', { xp: formatInteger(getCatalogStepXp(item.target, item.xp)) }));
        activateBtn.type = 'button';
        activateBtn.dataset.questAction = 'activate';
        activateBtn.dataset.questId = item.id;
        // Desabilitado em vez de avisado: o botão apagado já diz que não cabe, e
        // um clique que não faz nada não precisa de um cartaz explicando.
        activateBtn.disabled = isOutOfReach;
        action = activateBtn;
    } else {
        const locked = el('span', 'quest-catalog-state quest-catalog-state--locked', t('questLocked'));
        locked.title = describeLock(status);
        action = locked;
    }

    const stateClass = status.unlocked || isCompleted ? '' : ' is-locked';
    return el(
        'div',
        `quest-catalog-row${stateClass}${isOutOfReach ? ' is-out-of-reach' : ''}`,
        buildIconBubble(status.unlocked || isCompleted ? UI_ICONS.bolt : UI_ICONS.lock, 'quest-icon'),
        el(
            'div',
            'quest-catalog-body',
            headingsLine,
            el('span', 'quest-desc', t(item.descKey)),
            el('div', 'quest-catalog-actions', action)
        )
    );
}

/**
 * Linha de catálogo para um objetivo PERSONALIZADO em curso.
 *
 * Sem isto, um objetivo criado pelo usuário ficaria preso no slot para sempre:
 * abandonar só existe no catálogo, e o catálogo é montado a partir de
 * `QUEST_CATALOG`, onde um `custom:` nunca está.
 */
function buildCustomQuestRow(quest: QuestRecord): HTMLElement {
    const target = getQuestTarget(quest);

    const abandonBtn = el('button', 'quest-abandon-btn', t('questAbandon'));
    abandonBtn.type = 'button';
    abandonBtn.dataset.questAction = 'abandon';
    abandonBtn.dataset.questId = quest.id;

    return el(
        'div',
        'quest-catalog-row',
        buildIconBubble(UI_ICONS.bolt, 'quest-icon'),
        el(
            'div',
            'quest-catalog-body',
            el(
                'div',
                'quest-headings',
                el('span', 'quest-title', getQuestTitle(quest)),
                el('span', 'quest-meta', t('questProgressDays', {
                    count: target,
                    done: formatInteger(getQuestProgress(quest)),
                    total: formatInteger(target)
                }))
            ),
            el('span', 'quest-desc', t('questCustomDesc')),
            el('div', 'quest-catalog-actions', abandonBtn)
        )
    );
}

export function renderQuestCatalog() {
    const completedIds = getCompletedQuestIds();
    const activeQuests = getActiveQuests();
    const activeIds = new Set(activeQuests.map(q => q.id));
    const slotsFull = activeQuests.length >= QUEST_MAX_ACTIVE;
    // Personalizados em curso primeiro: são os que só existem aqui.
    const customRows = activeQuests
        .filter(quest => !getQuestCatalogItem(quest.id))
        .map(buildCustomQuestRow);

    setTextContent(ui.questPickerTitle, t('questPickerTitle'));
    setTextContent(ui.createCustomQuestBtn, t('questCreateCustom'));
    setTextContent(ui.questCustomTitleLabel, t('questCustomTitleLabel'));
    setTextContent(ui.questCustomTargetLabel, t('questCustomTargetLabel'));
    setTextContent(ui.questCustomConfirmBtn, t('questCustomConfirm'));
    setTextContent(ui.questPickerModal.querySelector('.modal-close-btn'), t('closeButton'));
    ui.questCustomTitleInput.placeholder = t('questCustomTitlePlaceholder');

    // Criar personalizado também não cabe com os slots cheios; apagar o botão
    // dispensa a recusa por escrito, que era o único uso do aviso de slots.
    ui.createCustomQuestBtn.disabled = slotsFull;
    if (slotsFull) ui.questCustomForm.classList.add('hidden');

    const catalogItems = getVisibleCatalog();
    const rows: HTMLElement[] = [
        ...customRows,
        ...catalogItems.map(item => buildCatalogRow(item, completedIds, activeIds, slotsFull))
    ];

    // O aviso do teto entra logo DEPOIS do último objetivo em curso: é ali que a
    // fila dos ocupados termina e a dos apagados começa, e a frase explica a
    // fronteira em vez de repetir a recusa a cada toque.
    //
    // A posição sai dos DADOS, não das classes das linhas: um objetivo concluído
    // também não fica apagado, e procurar "a última linha acesa" jogaria o aviso
    // depois de um concluído que viesse abaixo do último ativo.
    if (slotsFull) {
        let lastActive = customRows.length - 1;
        catalogItems.forEach((item, index) => {
            if (activeIds.has(item.id)) lastActive = customRows.length + index;
        });

        const limit = el('p', 'quest-catalog-limit', t('questSlotsLimit', { count: QUEST_MAX_ACTIVE }));
        rows.splice(lastActive + 1, 0, limit);
    }

    ui.questCatalogList.replaceChildren(...rows);

    // Aviso de fim de lista: explica por que o catálogo termina aqui, e só
    // aparece quando há mesmo leva guardada mais adiante.
    const hasMore = hasHiddenQuestTiers();
    setTextContent(ui.questCatalogNote, hasMore ? t('questCatalogMore') : '');
    ui.questCatalogNote.classList.toggle('hidden', !hasMore);
}

// --- ENTRADA ---

/**
 * O rodapé é regravado inteiro a cada `renderApp`; a lista de objetivos decide
 * sozinha se precisa mudar.
 */
export function renderProgression() {
    try {
        if (ui.progression.title) {
            // Mesma solução do rodapé anterior: o logotipo entra como imagem
            // porque a palavra "Askesis" quebrava a última letra em telas estreitas.
            const altText = (t('appName') || 'Askesis').replace(/<[^>]*>/g, '');
            setTrustedHtmlFragment(
                ui.progression.title,
                `<img src="assets/header-2.min.svg" alt="${altText}" class="progression-logo" width="160" height="40"/>`
            );
        }
        if (ui.progression.subtitle) {
            // Em telas estreitas o texto quebrava mal antes de "somatório"; o
            // <wbr> força o ponto de quebra ali. Vinha do rodapé antigo e foi
            // mantido tal e qual — por isso vai como fragmento, não como texto.
            const subtitle = t('appSubtitle');
            let subtitleHtml = subtitle;
            try {
                if (typeof window !== 'undefined' && window.matchMedia?.('(max-width:480px)').matches) {
                    subtitleHtml = subtitle.replace(/\bsomatório\b/gi, '<wbr>somatório');
                }
            } catch {
                subtitleHtml = subtitle;
            }
            setTrustedHtmlFragment(ui.progression.subtitle, subtitleHtml);
        }

        renderGradeBar();
        renderQuests();
    } catch (error) {
        logger.error('Failed to render progression:', error);
    }
}

/** Força a reconstrução da lista no próximo render (troca de idioma, import). */
export function invalidateQuestListCache() {
    renderedQuestSignature = '';
}

/**
 * Zera a linha de base do grau, sem comemorar o próximo render.
 *
 * O primeiro render acontece ANTES da hidratação do IndexedDB, com o estado
 * vazio — ou seja, no grau 1. Quando os dados chegam, o grau "sobe" de 1 para o
 * real, e sem isto abrir o app vibraria e piscaria o selo toda vez. Vale para
 * qualquer troca do estado inteiro: boot, import e volta da nuvem.
 */
export function resetGradeBaseline() {
    lastRenderedGrade = 0;
    lastRenderedTotalXp = -1;
}

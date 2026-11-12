/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file listeners/progression.ts
 * @description Interações da seção de Objetivos Secundários e do catálogo.
 *
 * Tudo por DELEGAÇÃO, com a intenção declarada em `data-quest-action`. O
 * protótipo usava `onclick="window.askesisGoalsModule…"` no markup, o que aqui
 * seria bloqueado pela CSP (`script-src 'self'`, sem `unsafe-inline`) e ainda
 * exigiria um objeto global. Delegar também sobrevive à reconstrução da lista:
 * o ouvinte fica no contêiner, que nunca é recriado.
 */

import { ui } from '../render/ui';
import { openModal, closeModal } from '../render/modals';
import { renderQuestCatalog, invalidateQuestListCache, openQuestNotesModal } from '../render/progression';
import { triggerHaptic } from '../utils';
import { APP_EVENTS, emitRenderApp } from '../events';
import {
    activateQuest, toggleQuestProgress, abandonQuest, createCustomQuest,
    type QuestActionResult
} from '../services/progression';

/**
 * Recusa que a tela não explica: uma vibração, e nada mais.
 *
 * Nenhuma delas é alcançável por um toque comum — com os slots cheios o botão
 * fica apagado, o objetivo bloqueado não tem botão, e o nome vazio marca o
 * próprio campo (ver `submitCustomQuest`). O que sobra são guardas contra
 * corrida: tocar num cartão que caducou à meia-noite ou fechou no outro aparelho
 * antes do repintar. Aí a vibração basta — um cartaz explicando um estado que já
 * não existe é pior que o silêncio.
 */
function reportFailure() {
    triggerHaptic('error');
}

/**
 * Único ponto que traduz o resultado do motor em háptica.
 *
 * Nada aqui vira palavra: a linha aparece, desaparece ou muda de estado, e é
 * isso que informa. Só as recusas falam, porque nelas a tela não muda.
 */
function reportResult(result: QuestActionResult) {
    if (!result.ok) {
        reportFailure();
        return;
    }

    invalidateQuestListCache();

    // A vibração é daqui, do toque, e não do render: enquanto a barra também
    // vibrava ao crescer, um único registro dava dois pulsos.
    triggerHaptic(result.completed ? 'success' : 'light');
}

function openQuestPicker() {
    renderQuestCatalog();
    ui.questCustomForm.classList.add('hidden');
    openModal(ui.questPickerModal);
}

function handleQuestAction(action: string, questId: string | undefined) {
    switch (action) {
        case 'open-picker':
            openQuestPicker();
            return;
        case 'toggle':
            if (questId) reportResult(toggleQuestProgress(questId));
            return;
        case 'note':
            if (questId) openQuestNotesModal(questId);
            return;
        // A lixeira da gaveta e o "Abandonar" do catálogo fazem a mesma coisa: o
        // objetivo sai do slot com lápide, guardando o XP e o histórico.
        case 'delete':
        case 'abandon':
            if (!questId) return;
            reportResult(abandonQuest(questId));
            // Abandonar pelo catálogo precisa repintar o estado da linha ("Em
            // curso" volta a ser "Ativar") com o modal ainda aberto.
            if (ui.questPickerModal.classList.contains('visible')) renderQuestCatalog();
            return;
        case 'activate':
            if (!questId) return;
            reportResult(activateQuest(questId));
            // O catálogo mostra estado por objetivo (ativo/concluído/bloqueado)
            // e precisa ser repintado com o modal ainda aberto. Ativar também
            // acontece a partir da sugestão no slot livre, com o modal fechado —
            // aí não há nada a repintar.
            if (ui.questPickerModal.classList.contains('visible')) renderQuestCatalog();
            return;
    }
}

function delegateQuestClicks(container: HTMLElement) {
    container.addEventListener('click', (event) => {
        const trigger = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-quest-action]');
        if (!trigger || !container.contains(trigger)) return;
        event.preventDefault();
        handleQuestAction(trigger.dataset.questAction!, trigger.dataset.questId);
    });
}

function submitCustomQuest() {
    const title = ui.questCustomTitleInput.value;
    const target = parseInt(ui.questCustomTargetInput.value, 10);

    const result = createCustomQuest(title, target);
    if (!result.ok) {
        // Slots cheios não é problema do nome: marcar o campo apontaria para o
        // único dado que estava certo. Vibra e para, como as outras recusas que
        // a tela não explica.
        if (result.reason !== 'invalidTitle') {
            reportFailure();
            return;
        }

        // O erro se marca onde ele acontece. `.shake` é o mesmo tremor vermelho
        // que o nome do hábito usa quando fica vazio (css/base.css) — o app já
        // tinha esta linguagem, e ela dispensa texto: cor e movimento não
        // precisam de tradução, e o campo aponta para si mesmo.
        const input = ui.questCustomTitleInput;
        triggerHaptic('error');
        input.classList.remove('shake');
        requestAnimationFrame(() => {
            input.classList.add('shake');
            input.addEventListener('animationend', () => input.classList.remove('shake'), { once: true });
        });
        input.focus();
        return;
    }

    ui.questCustomTitleInput.value = '';
    ui.questCustomForm.classList.add('hidden');
    invalidateQuestListCache();
    triggerHaptic('success');
    // Sem aviso: fechar o modal já revela a linha nova na lista.
    closeModal(ui.questPickerModal);
}

export function setupProgressionListeners() {
    // O contêiner inteiro, não só a lista: o rótulo da seção é o que abre o
    // catálogo, e com os três slots ocupados ele é a única porta.
    delegateQuestClicks(ui.questsContainer);
    delegateQuestClicks(ui.questCatalogList);

    ui.createCustomQuestBtn.addEventListener('click', () => {
        const form = ui.questCustomForm;
        form.classList.toggle('hidden');
        if (!form.classList.contains('hidden')) ui.questCustomTitleInput.focus();
    });

    ui.questCustomConfirmBtn.addEventListener('click', submitCustomQuest);
    ui.questCustomTitleInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') submitCustomQuest();
    });

    ui.questPickerModal.querySelector('.modal-close-btn')
        ?.addEventListener('click', () => closeModal(ui.questPickerModal));

    // A virada do dia reabre o botão de registrar sem exigir reload: a
    // assinatura da lista carrega o "já registrei hoje", e a data mudou.
    //
    // Invalidar não repinta sozinho, e setupMidnightLoop só emite o evento —
    // daí o render explícito. Se algum outro ouvinte já repintar na virada, o
    // custo é um render a mais por dia, barrado pelos flags de sujeira.
    document.addEventListener(APP_EVENTS.dayChanged, () => {
        invalidateQuestListCache();
        emitRenderApp();
    });
    document.addEventListener(APP_EVENTS.languageChanged, invalidateQuestListCache);
}

/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file OneSignalSDKWorker.js
 * @description Service worker de push OneSignal (escopo /onesignal/).
 *
 * Registrado pelo SDK com serviceWorkerPath: 'OneSignalSDKWorker.js' e
 * serviceWorkerParam: { scope: '/onesignal/' } — coexiste com sw.js (offline).
 */

/**
 * PERSONALIZAÇÃO LOCAL DO LEMBRETE
 *
 * O servidor manda uma campainha idêntica para todo mundo (o estado é E2E
 * cifrado; ele não sabe o que está pendente). Quem escreve o texto é este
 * worker, lendo o cartão que o app deixou no IndexedDB.
 *
 * ORDEM DOS LISTENERS — É O QUE FAZ ISTO FUNCIONAR:
 * O `importScripts` do SDK está no FIM do arquivo, de propósito. Listeners de
 * um mesmo evento correm na ordem de registro, então o nosso roda primeiro e
 * pode chamar `stopImmediatePropagation()`: o handler da OneSignal nunca é
 * invocado para o nosso lembrete, e existe UMA notificação — a nossa.
 *
 * A tentativa anterior era outra: deixar a OneSignal exibir a dela e trocar o
 * conteúdo depois (esperar a notificação aparecer na bandeja, fechar, publicar
 * a nossa). Isso é uma corrida contra o handler dela, e ela chegava a publicar
 * de novo depois do nosso `close()` — o usuário recebia as duas. Cortar a
 * propagação elimina a corrida em vez de tentar vencê-la.
 *
 * `removeEventListener` continua impossível (no SDK v16 o listener é uma função
 * anônima inline, sem referência exportada); por isso a saída é a ordem.
 *
 * COMO IDENTIFICAMOS O NOSSO PUSH:
 * Pelo marcador REMINDER_MARKER no payload cru (ver api/reminder.ts). Só ele
 * autoriza o desvio: um anúncio enviado pelo painel não o carrega, segue o
 * caminho normal da OneSignal e não é reescrito com texto de hábitos.
 *
 * O QUE SE PERDE AO PULAR O HANDLER DELES:
 * O relatório de entrega confirmada e o webhook `notification.willDisplay` do
 * lembrete. O clique continua íntegro: publicamos com o mesmo `data` que o SDK
 * montaria, e o `notificationclick` dele (que segue registrado) o consome.
 *
 * Requisito do iOS/Safari: todo push precisa virar notificação visível. Como
 * assumimos o controle, o caminho de erro NÃO pode sair calado — sem cartão
 * utilizável exibimos o texto genérico que veio no próprio payload.
 */
(function () {
    'use strict';

    /**
     * ATIVAÇÃO IMEDIATA.
     *
     * Sem isto, uma versão nova deste worker é instalada e fica em ESPERA
     * indefinidamente enquanto a antiga segue atendendo os pushes — o SDK da
     * OneSignal não chama `skipWaiting`, e o `sw.js` (que chama) é outro
     * registration. Na prática, correções aqui nunca chegavam ao aparelho.
     */
    self.addEventListener('install', function () {
        self.skipWaiting();
    });

    var REMINDER_MARKER = 'askesis-reminder';

    /** Absolutos: relativos resolveriam contra /onesignal/, que não tem assets. */
    var DEFAULT_ICON = '/icons/icon-192.svg';
    var DEFAULT_BADGE = '/icons/badge.svg';

    /** Último recurso: o push precisa virar notificação mesmo sem texto algum. */
    var FALLBACK_TITLE = 'Askesis';

    /**
     * Quando ligado, o motivo de NÃO personalizar vai na própria notificação.
     *
     * Existe porque logs de service worker só aparecem no DevTools, que não está
     * disponível no aparelho onde este fluxo é depurado — e porque a
     * personalização já regrediu várias vezes por causas diferentes. Fica no
     * código, desligado, em vez de ser reescrito a cada investigação.
     *
     * MANTER DESLIGADO em produção: ligado, um dia sem abrir o app entrega
     * "Askesis — diagnostico" ao usuário no lugar do lembrete.
     */
    var DIAGNOSTICO = false;

    // Espelha services/persistence.ts / services/notificationCard.ts.
    var DB_NAME = 'AskesisDB';
    var STORE_NAME = 'app_state';
    var CARD_KEY = 'askesis_notification_card';

    /**
     * O MESMO "hoje" que o app usa para nomear os cartões (`getTodayUTCIso`).
     *
     * Apesar do nome, aquele helper devolve a data do CALENDÁRIO LOCAL: ele monta
     * `Date.UTC(...)` a partir de `getFullYear/getMonth/getDate`, que são locais.
     * Um `toISOString().slice(0,10)` cru aqui daria a data UTC de verdade, e as
     * duas divergem sempre que o fuso empurra o relógio para o outro dia — em
     * Tóquio, o push das 23:00 UTC procuraria o cartão de ontem e cairia no
     * texto genérico todo santo dia. Em BRT elas coincidem nesse horário, que é
     * por que isso nunca apareceu aqui.
     */
    function todayUTCIso() {
        var d = new Date();
        return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10);
    }

    /**
     * Procura o marcador no payload CRU, sem supor onde o SDK o aninha.
     *
     * As versões anteriores liam caminhos específicos (`custom.a`, `data`,
     * `additionalData`, `topic`) e, quando erravam, o handler saía calado — o
     * lembrete chegava genérico sem qualquer pista do motivo. O servidor manda o
     * marcador em dois campos (`data.askesis` e `web_push_topic`), então buscar
     * a string no texto do payload acerta independentemente do aninhamento.
     */
    function isReminderPush(event) {
        try {
            return !!event.data && event.data.text().indexOf(REMINDER_MARKER) !== -1;
        } catch (e) {
            return false;
        }
    }

    /** Payload cru da OneSignal: `{ custom: { i, a, u }, title, alert, icon, badge }`. */
    function parsePayload(event) {
        try {
            return event.data.json() || {};
        } catch (e) {
            return {};
        }
    }

    /**
     * O `data` que o SDK anexaria à notificação (ver `Tt()` no bundle dele).
     *
     * Só os campos que os handlers de `notificationclick`/`notificationclose`
     * leem — é o que mantém o clique abrindo a URL e registrando o evento.
     */
    function oneSignalData(payload) {
        var custom = payload.custom || {};
        return {
            notificationId: custom.i,
            title: payload.title,
            body: payload.alert,
            additionalData: custom.a,
            launchURL: custom.u
        };
    }

    /** O texto genérico que o servidor mandou, usado quando o cartão não serve. */
    function genericText(payload) {
        return { title: payload.title || FALLBACK_TITLE, body: payload.alert || '' };
    }

    function openDB() {
        return new Promise(function (resolve, reject) {
            // Sem versão explícita: um worker mais antigo que o app dispararia
            // upgrade/bloqueio. Assim apenas anexamos à versão corrente.
            var req = indexedDB.open(DB_NAME);
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
            // Só ocorre se o banco ainda não existir (usuário nunca abriu o app).
            req.onupgradeneeded = function () { resolve(null); };
        });
    }

    /**
     * Lê o cartão do dia UTC corrente.
     *
     * O app grava uma LISTA — hoje e os próximos dias — para que um dia sem
     * abrir o Askesis não derrube o lembrete para o texto genérico.
     */
    function readCard() {
        return openDB().then(function (db) {
            if (!db || !db.objectStoreNames.contains(STORE_NAME)) return null;
            return new Promise(function (resolve) {
                var req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(CARD_KEY);
                req.onsuccess = function () { resolve(req.result || null); };
                req.onerror = function () { resolve(null); };
            }).then(function (stored) {
                db.close();
                if (!Array.isArray(stored)) return stored || null;

                var today = todayUTCIso();
                for (var i = 0; i < stored.length; i++) {
                    if (stored[i] && stored[i].date === today) return stored[i];
                }
                // Nenhum cartão cobre hoje: devolve o primeiro só para o
                // diagnóstico poder dizer de que dia ele era.
                return stored[0] || null;
            });
        });
    }

    /**
     * Motivo pelo qual o cartão não serve, ou null se estiver bom.
     *
     * O cartão só vale para o dia corrente em UTC — a mesma noção de "hoje" que
     * o app usa (`getTodayUTCIso`). Cartão de outro dia significa que o app não
     * foi aberto desde então: o texto genérico do servidor é mais honesto que
     * pendências velhas.
     */
    function cardProblem(card) {
        if (!card) return 'sem cartao no IndexedDB';
        if (!card.title || !card.body) return 'cartao incompleto';
        if (card.date !== todayUTCIso()) return 'cartao de ' + card.date + ', hoje-UTC e ' + todayUTCIso();
        return null;
    }

    /**
     * Decide o texto da notificação. NUNCA rejeita: como o handler da OneSignal
     * já foi curto-circuitado, uma rejeição aqui deixaria o push sem notificação
     * nenhuma — no iOS, isso custa a permissão.
     */
    function chooseText(payload) {
        return readCard().then(
            function (card) { return cardProblem(card) || card; },
            function (error) { return 'IndexedDB: ' + String(error); }
        ).then(function (result) {
            if (typeof result !== 'string') return { title: result.title, body: result.body };
            return DIAGNOSTICO ? { title: 'Askesis — diagnostico', body: result } : genericText(payload);
        });
    }

    self.addEventListener('push', function (event) {
        if (!isReminderPush(event)) return;

        // A partir daqui a notificação é nossa, inteira: o handler da OneSignal
        // (registrado depois, no importScripts) não chega a rodar.
        event.stopImmediatePropagation();

        var payload = parsePayload(event);

        event.waitUntil(
            chooseText(payload).then(function (text) {
                return self.registration.showNotification(text.title, {
                    body: text.body,
                    // Tag fixa: lembretes seguidos colapsam num só. `renotify`
                    // garante que o de hoje alerte mesmo com o de ontem parado
                    // na bandeja — do contrário a troca seria silenciosa.
                    tag: REMINDER_MARKER,
                    renotify: true,
                    icon: payload.icon || DEFAULT_ICON,
                    badge: payload.badge || DEFAULT_BADGE,
                    data: oneSignalData(payload)
                });
            }).catch(function () {
                // Só chega aqui se o próprio showNotification for recusado pelo
                // navegador; repetir a chamada não mudaria o resultado.
            })
        );
    });
})();

// Depois do nosso listener, de propósito — ver ORDEM DOS LISTENERS acima.
importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');

# Relatório de Maturidade por Arquivo (sem testes)

## Resumo Executivo

- O workspace mostra boa maturidade geral, com forte base de segurança no backend (`api/`) e boa cobertura de erros em serviços críticos.
- Pontos fortes: rate limit robusto, validações de payload, fallback seguro, uso consistente de Web Crypto e retries de rede.
- **Todos os 10 itens do ciclo de melhoria anterior foram concluídos** (março/2026): drag, swipe, modals, quotes, cards, sw.js, audit, metadata, testes.
- A modularização de `services/habitActions/*`, `services/dataMerge/*`, `listeners/modals/*` e agora `render/modalBuilders.ts` reduziu acoplamento em pontos críticos.
- Tipagem: `services/cloud.ts`, `services/sync.worker.ts`, `services/selectors.ts`, `services/migration.ts`, `data/predefinedHabits.ts`, `index.tsx` e `state.ts` zerados de `any`.
- `render/modals.ts` endurecido com `sanitizeHtmlToFragment()` — XSS via modal eliminado; `openEditModal` tipado como `Habit | HabitTemplate | null` (zero `any`); 13 `.textContent =` migrados para `setTextContent()` (API consistente); builders DOM extraídos para `render/modalBuilders.ts`.
- `services/crypto.ts` com 5 guards de validação de entrada em `decrypt()`.
- `listeners/drag.ts` refatorado: 5 helpers extraídos, `_onPointerUp` reduzido a 3 linhas; 6 testes de estado adicionados.
- `listeners/swipe.ts` refatorado: 4 helpers extraídos (`_startSwiping`, `_handleDetectingPhase`, `_requestSwipeRender`, `_installPostSwipeClickBlocker`); 3 testes adicionados.
- `services/analysis.ts` e `listeners/swipe.ts` com `catch` tipados como `unknown`; `listeners/swipe.ts` não possui mais `any` residuais.
- `render/calendar.ts`: 3 `.textContent =` em `renderFullCalendar` migrados para `setTextContent()`; `firstElementChild!` substituído por encadeamento opcional seguro.
- `scripts/dev-api-mock.js`: `KEY_HASH_RE` para validação de formato do header, `lastModified` validado como `number`, mensagem genérica em respostas 500.
- `sw.js`: `Promise.allSettled` no install + `SW_CACHE_VERSION = 'v2'` + guardrail de versioning.
- `types/global.d.ts` com `showFatalError` e `CSSTranslate` declarados na `interface Window`.
- `state.ts` com interface `DaySummary` exportada; `originalData` tipado como `Habit`.
- `render/calendar.ts`, `listeners/sync.ts` e `render/chart.ts` sem `innerHTML`; zero `any` confirmado.
- `listeners/cards.ts` sem `innerHTML`; timer de animação limpo via `WeakMap` (sem leak).
- `render/rotary.ts` e `render/chart.ts` sem `(window as any).CSSTranslate` — declarado em `global.d.ts`.
- `listeners/chart.ts` e `render/habits.ts` auditados: zero `any`, zero `innerHTML`.
- `render.ts` zerado de `any`: `Document.startViewTransition`, `scheduler`, `OneSignal` e `Notification.permission` declarados.
- `listeners/calendar.ts` e `services/badge.ts` auditados: zero `any`, zero `innerHTML`.
- `data/quotes.ts` com validação de schema formal via `data/quotes.test.ts` (ID únicos, enums, adaptações).
- `scripts/guardrail-audit.js` formaliza política de vulnerabilidades npm (HIGH/CRITICAL bloqueiam CI); integrado a `guardrail:all`.
- Performance está razoável: existem caches, debounce e agendamento; hot paths de DOM usam `setTrustedSvgContent` e `sanitizeHtmlToFragment`.
- Guardrails mantidos: `guardrail-security-html.js`, `guardrail-locales-parity.js`, `guardrail-audit.js`, `check-sw-manifest.js` — integrados ao CI via `guardrail:all`; removidos os 4 que cobriam riscos hipotéticos ou já obsoletos (dead-files, file-size, sw-cache-version, metadata-schema).

- Atualizações recentes (abril/2026): substituição do sanitizador caseiro por `DOMPurify` em `render/dom.ts`; adição de esqueleto de property-tests com `fast-check` (`tests/property/merge.property.test.ts`); regras ESLint para sinalizar `innerHTML`/`createContextualFragment`; refatoração em `render/habits.ts` para usar `setTrustedHtmlFragment` (sink seguro).

## Escala

- **L5 Excelente**: 86-100
- **L4 Maduro**: 76-85
- **L3 Sólido**: 66-75
- **L2 Em evolução**: 51-65
- **L1 Frágil**: 0-50

## Ponderação por arquivo

| Arquivo | Score | Nível | Justificativa |
| --- | ---: | --- | --- |
| api/_httpSecurity.ts | 89 | L5 Excelente | Rate limit híbrido, validação de origem/IP e fallback resiliente. |
| api/analyze.ts | 86 | L5 Excelente | Timeout, limites, CORS estrito e sanitização de erro bem tratados. |
| api/sync.ts | 85 | L4 Maduro | Validações fortes e concorrência otimista; fluxo Lua é complexo. |
| build.js | 78 | L4 Maduro | Script robusto; copia o app shell sem transformação por regex e valida presença do bundle. |
| constants.ts | 84 | L4 Maduro | Constantes centralizadas, sem lógica arriscada e boa legibilidade. |
| i18n.ts | 85 | L5 Excelente | Fallbacks, cache Intl e timeout; testes de fallback de locale (fetch 404, chave ausente, troca de idioma) adicionados. |
| index.css | 72 | L3 Sólido | Estilo pequeno e direto; baixo risco estrutural. |
| index.html | 70 | L3 Sólido | Estrutura simples; pouca lógica e risco moderado. |
| index.tsx | 76 | L4 Maduro | Boot resiliente; `(window as any)` eliminado via declaração em `global.d.ts`. |
| listeners.ts | 77 | L4 Maduro | Orquestração clara de eventos com debounce e proteções. |
| manifest.json | 78 | L4 Maduro | Configuração PWA direta e estável. |
| metadata.json | 75 | L3 Sólido | Configuração estável; schema simples validado pela própria sintaxe JSON. |
| package-lock.json | 74 | L3 Sólido | `guardrail-audit.js` bloqueia HIGH/CRITICAL em prod; deps sem vulnerabilidades conhecidas. |
| package.json | 80 | L4 Maduro | Configuração de projeto consistente e scripts claros. |
| render.ts | 78 | L4 Maduro | Zero `any`; `Document.startViewTransition`, `scheduler`, `OneSignal` declarados em `global.d.ts`. |
| state.ts | 82 | L4 Maduro | `DaySummary` interface exportada; `originalData` tipado como `Habit`; zero `any` no schema público. |
| sw.js | 80 | L4 Maduro | `Promise.allSettled` no install; `SW_CACHE_VERSION = 'v2'` com cache names versionados. |
| tsconfig.json | 83 | L4 Maduro | Configuração TypeScript estável e adequada ao projeto. |
| utils.ts | 76 | L4 Maduro | Utilitários robustos, sanitização e helpers performáticos. |
| vercel.json | 76 | L4 Maduro | Deploy config enxuta e sem riscos aparentes. |
| vitest.config.ts | 77 | L4 Maduro | Critérios de cobertura e timeout bem definidos. |
| css/base.css | 74 | L3 Sólido | Base consistente, baixo risco de manutenção. |
| css/calendar.css | 72 | L3 Sólido | Estilos específicos, complexidade moderada. |
| css/charts.css | 73 | L3 Sólido | Focado em visualização; manutenção média. |
| css/components.css | 72 | L3 Sólido | Organização razoável, sem sinais críticos. |
| css/forms.css | 72 | L3 Sólido | Escopo claro e pouca superfície de risco. |
| css/habits.css | 71 | L3 Sólido | Arquivo funcional, provável acoplamento com classes dinâmicas. |
| css/header.css | 74 | L3 Sólido | Simples e previsível para manutenção. |
| css/layout.css | 74 | L3 Sólido | Estrutura estável, risco baixo. |
| css/modals.css | 70 | L3 Sólido | Maior complexidade visual e acoplamento com JS. |
| css/variables.css | 80 | L4 Maduro | Tokens centralizados melhoram consistência e manutenção. |
| data/icons.ts | 83 | L4 Maduro | Repositório controlado de ícones com sanitização associada. |
| data/predefinedHabits.ts | 76 | L4 Maduro | Zero `any`; `HabitGoal` e `Frequency` tipados explicitamente. |
| data/quotes.ts | 78 | L4 Maduro | Schema validado via `quotes.test.ts`: IDs únicos, enums de virtue/discipline/sphere/coercion, 3 níveis de adaptação obrigatórios. |
| listeners/calendar.ts | 76 | L4 Maduro | Zero `any`, zero `innerHTML`; eventos bem definidos; fluxo de interação extenso. |
| listeners/cards.ts | 78 | L4 Maduro | Zero `innerHTML`; `replaceChildren` e `cloneNode`; timer de animação limpo via `WeakMap` — sem leak de `setTimeout`. |
| listeners/chart.ts | 76 | L4 Maduro | Zero `any`; `(window as any).CSSTranslate` eliminado; interações via pointer events sem leaks. |
| listeners/drag.ts | 78 | L4 Maduro | 5 helpers extraídos (`_isValidDropTarget`, `_resolveTargetCard`, `_setNoDropTarget`, `_buildReorderInfo`, `_executeDropAction`); `_onPointerUp` reduzido a 3 linhas; 6 testes de estado (drag.test.ts). |
| listeners/modals.ts | 76 | L4 Maduro | Handlers extraídos para aiHandlers, fullCalendarHandlers, formHandlers. |
| listeners/modals/aiHandlers.ts | 80 | L4 Maduro | `sanitizeHtmlToFragment` nos 2 paths; offline quote e online message seguros. |
| listeners/modals/fullCalendarHandlers.ts | 80 | L4 Maduro | Navegação bem encapsulada; navegateToDate privada. |
| listeners/modals/formHandlers.ts | 79 | L4 Maduro | Handlers de form/pickers bem isolados; validateAndFeedback privada. |
| listeners/swipe.ts | 78 | L4 Maduro | 4 helpers extraídos (`_startSwiping`, `_handleDetectingPhase`, `_requestSwipeRender`, `_installPostSwipeClickBlocker`); zero `any`; 3 testes (swipe.test.ts). |
| listeners/sync.ts | 76 | L4 Maduro | Zero `any`; `catch (unknown)` + `instanceof Error`; manipulação HTML via `textContent` e `escapeHTML`. |
| locales/en.json | 78 | L4 Maduro | Catálogo estruturado e consistente para runtime. |
| locales/es.json | 77 | L4 Maduro | Boa cobertura textual, manutenção manual inevitável. |
| locales/pt.json | 76 | L4 Maduro | Base principal estável, risco baixo de execução. |
| render/calendar.ts | 83 | L4 Maduro | Zero `innerHTML`; `setTextContent` consistente; `renderFullCalendar` extraído para `calendarGrid.ts`; arquivo mais enxuto. |
| render/calendarGrid.ts | 82 | L4 Maduro | Novo módulo extraído de `calendar.ts`; renderiza grade do calendário almanaque; `getTodayUTCIso()` consistente; zero `innerHTML`. |
| render/chart.ts | 76 | L4 Maduro | Zero `any` e zero `innerHTML`; SVG via `setAttribute`; `setTextContent` e `setTrustedHtmlFragment` usados. |
| render/constants.ts | 83 | L4 Maduro | Constantes de render bem isoladas e seguras. |
| render/dom.ts | 84 | L4 Maduro | `sanitizeHtmlToFragment` agora usa `DOMPurify` com blocklist explícita; único `innerHTML` interno é o parser sandbox. |
| render/habits.ts | 78 | L4 Maduro | Zero `any`, zero `innerHTML`; `setTrustedSvgContent` em todos os 10 sinks de ícone; `createContextualFragment` substituído por `setTrustedHtmlFragment` (sink seguro). |
| render/icons.ts | 79 | L4 Maduro | Catálogo central e coerente com sanitização de uso. |
| render/modalBuilders.ts | 83 | L4 Maduro | Novo módulo com 7 builders DOM puros extraídos de `modals.ts`; única dependência de `dom/icons/i18n/state`; zero `innerHTML`. |
| render/modals.ts | 83 | L4 Maduro | Zero `any`; `openEditModal` tipado como `Habit \| HabitTemplate \| null`; `setTextContent()` em todos os sinks; builders DOM movidos para `modalBuilders.ts`; arquivo 60+ linhas mais enxuto. |
| render/rotary.ts | 77 | L4 Maduro | Zero `any`; `(window as any).CSSTranslate` eliminado; interação via pointer events bem estruturada. |
| render/ui.ts | 77 | L4 Maduro | Registro lazy de referências DOM; getters cacheados com `Object.defineProperty`. |
| scripts/dev-api-mock.js | 80 | L4 Maduro | `KEY_HASH_RE` valida formato do header; `lastModified` validado como `number`; 500 sem expor `e.message`. |
| scripts/guardrail-audit.js | 78 | L4 Maduro | Política formal: HIGH/CRITICAL → bloqueio CI; MODERATE → janela 30 dias; separa deps produção vs dev. Adicionado `scripts/check-sw-manifest.js` e `guardrail:sw-manifest` para validação de precache Workbox. |
| scripts/guardrail-locales-parity.js | 78 | L4 Maduro | Valida paridade de chaves entre `pt.json`, `en.json` e `es.json`; detecta tipos divergentes e placeholders `{var}` ausentes. |
| services/HabitService.ts | 82 | L4 Maduro | Lógica bitmask sólida e foco claro de responsabilidade. |
| services/analysis.ts | 78 | L4 Maduro | `catch (e: unknown)` em todos os paths assíncronos; tratamento de erro robusto. |
| services/api.ts | 84 | L4 Maduro | Timeout, retries e hash de chave bem implementados. |
| services/badge.ts | 78 | L4 Maduro | `NavigatorWithBadging` interface local; zero `any`; falha silênciosa bem documentada. |
| services/cloud.ts | 83 | L4 Maduro | Zero `any`; DecryptedCore type guard; erro tipado com instanceof. |
| services/crypto.ts | 86 | L5 Excelente | AES-GCM/PBKDF2 correto; 5 guards de validação de entrada em `decrypt()`. |
| services/dataMerge.ts | 86 | L4 Maduro | Barrel estável para API pública; merge modular em `services/dataMerge/*`. Esqueleto de property-tests adicionado em `tests/property/merge.property.test.ts` (fast-check). |
| services/habitActions.ts | 84 | L4 Maduro | Barrel estável para API pública; lógica modular em `services/habitActions/*`. |
| services/migration.ts | 80 | L4 Maduro | Zero `any`; `Object.assign` para campos `readonly`; parâmetro `unknown`. |
| services/persistence.ts | 81 | L4 Maduro | Persistência resiliente com debounce e fallback adequados; testes para `pruneOrphanedDailyData` (2) e debounce de `saveState` (2) adicionados. |
| services/quoteEngine.ts | 80 | L4 Maduro | Zero `any`; 5 novos testes cobrindo urgência noturna, stickiness break e imutabilidade de `state.quoteState` em datas históricas. |
| services/selectors.ts | 79 | L4 Maduro | Zero `any`; `source` tipado; 6 novos testes para `getEffectiveScheduleForHabitOnDate` e `calculateHabitStreak` com frequências não-diárias. |
| services/sync.worker.ts | 80 | L4 Maduro | Zero `any`; isRecord() guard; payloads tipados. |
| types/global.d.ts | 85 | L4 Maduro | `showFatalError`, `CSSTranslate`, `Document.startViewTransition` e `ViewTransition` declarados; sem `any`. |

## Top 10 — Ciclo Anterior (concluído em março/2026)

| # | Arquivo | Status | O que foi feito |
| --- | --- | --- | --- |
| 1 | listeners/drag.ts | ✅ Concluído | 5 helpers extraídos; `_onPointerUp` → 3 linhas; complexidade ciclomática reduzida |
| 2 | listeners/swipe.ts | ✅ Concluído | 4 helpers extraídos; `_handleDetectingPhase` com early-return |
| 3 | render/modals.ts | ✅ Concluído | 7 builders DOM extraídos para `render/modalBuilders.ts` |
| 4 | data/quotes.ts | ✅ Concluído | `quotes.test.ts` valida schema completo do catálogo |
| 5 | listeners/cards.ts | ✅ Concluído | Timer de animação limpo via `WeakMap` |
| 6 | sw.js | ✅ Concluído | `SW_CACHE_VERSION = 'v2'`; versioning nos cache names |
| 7 | package-lock.json | ✅ Concluído | `guardrail-audit.js` com política formal de severidade integrada a `guardrail:all` |
| 8 | metadata.json | ✅ Concluído | Schema estável; guardrail removido por cobrir risco hipotético |
| 9 | listeners/drag.ts | ✅ Concluído | 6 testes de estado em `drag.test.ts` |
| 10 | services/quoteEngine.ts | ✅ Concluído | 5 novos testes: urgência noturna, stickiness break, imutabilidade histórica |

## Ciclo 2 — Oportunidades de melhoria (concluído)

| # | Arquivo | Status | O que foi feito |
| --- | --- | --- | --- |
| 1 | tests/scenario-test-5 | ✅ Concluído | 10 testes E2E: streak diário, quebra, multi-turno, `specific_days_of_week`, `interval`, graduação |
| 2 | services/selectors.ts | ✅ Concluído | 6 novos testes: `getEffectiveScheduleForHabitOnDate` (3) + streak não-diário (3) |
| 3 | services/persistence.ts | ✅ Concluído | 4 novos testes: `pruneOrphanedDailyData` (2) + debounce de `saveState` (2) |
| 4 | render/calendar.ts | ✅ Concluído | `renderFullCalendar` extraído para `render/calendarGrid.ts`; barrel `render.ts` atualizado |
| 5 | i18n.ts | ✅ Concluído | 4 testes de fallback: chave ausente, fetch 404 gracioso, interpolação pós-troca, pluralização EN |

---
Obs.: Esta ponderação é heurística e orientada a priorização prática, não substitui threat model formal.

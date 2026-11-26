# Arquitetura do Produto — Askesis (`src/askesis/`)

Decisões e restrições técnicas reais do Askesis, lidas automaticamente pelo `./aegis brief` e validadas pelo `./aegis verify-contract` / `./aegis check`.

> **Formato:** `- \`ID\` [hard|default]: regra objetiva` (`hard` = obrigatório/expor conflito · `default` = padrão/deliberar exceção).

## Regras

- `PRODUCT-BOUNDARY` [hard]: Alterar apenas código/testes de produto em `src/askesis/`; proibido editar arquivos protegidos (`package.json`, `vercel.json`, `eslint.config.mjs`, `vitest.config.ts`, `tsconfig*.json`, `scripts/*`) ou o harness sem exceção humana.
- `VANILLA-TS` [default]: Vanilla TypeScript e Web APIs nativas (DOM, IndexedDB, Web Worker, Web Crypto); sem frameworks UI nem novas dependências sem aprovação humana.
- `LOCAL-FIRST-E2E` [hard]: Dados do usuário residem no dispositivo (IndexedDB); sync em nuvem é opt-in com criptografia E2E (AES-GCM no Web Worker) e zero envio de texto plano, PII ou telemetria de hábitos/notas.
- `NO-UNSAFE-HTML` [hard]: Proibido atribuir `innerHTML`, `insertAdjacentHTML` ou `createContextualFragment` em sinks sensíveis (`ui.aiResponse`, `ui.confirmModalText`, `ui.syncWarningText`); usar DOMPurify + `replaceChildren` ou `textContent`.
- `BITMASK-SPLIT-STATE` [default]: Preservar estado centralizado em `state.ts` com modelo bitmask-first e persistência split (core + logs); evitar re-renderizações globais e manter tarefas CPU-bound (crypto/merge) no Web Worker.
- `DETERMINISTIC-TIME` [hard]: Lógica pura de domínio/merge/streaks deve aceitar timestamp/data por parâmetro explícito; evitar dependência implícita de `Date.now()` / `new Date()` sem argumentos em regras testáveis.
- `STRICT-TYPES` [hard]: Tipagem estrita (`tsconfig.app.json` + `tsconfig.test.json`), sem `any` nem `@ts-ignore` injustificado; falhas e conflitos explícitos sem `catch` vazio.
- `GUARDRAILS-AND-LOCALES` [hard]: Manter paridade estrita entre `locales/{pt,en,es}.json` (chaves, plurais e placeholders), manter `__WB_MANIFEST`/`precacheAndRoute` em `sw.js`, e não desabilitar guardrails.
- `PARSIMONY` [default]: Reusar módulos existentes (`services/habitActions/*`, `services/dataMerge/*`, `selectors.ts`); rejeitar factories, builders, singletons ou abstrações especulativas.

# 📦 BACKUP 2: Histórico Completo de Commits e Mudanças do Briefing e Meta-Pipeline

Este documento registra em detalhes todos os commits descartados após o ponto de restauração `a6db43a`, incluindo suas descrições completas, explicações **ELI5** (*Explain Like I'm 5*), alterações exatas de código e uma seção especial com **Commits que Precisam Ser Estudados**.

---

## 🧭 Ponto de Restauração & Estado do Repositório
* **Commit Base de Rollback:** `a6db43a` — `docs: synchronize summary.md, README.md, and README.pt-BR.md with 5-pillar ecosystem, zero-token bypass, and auto-squash architecture`
* **Data do Rollback:** 25 de Agosto de 2026
* **Branch Atual:** `main` (apontando diretamente para `a6db43a`)

---

# 🔍 SEÇÃO ESPECIAL: Commits que Precisam Ser Estudados

Esta seção destaca as inovações arquiteturais, lições aprendidas e bugs sutis resolvidos nos commits recentes para referência futura e reincorporação modular:

### 1. `9dc5f47` — Parser de Tipos Genéricos com Contagem de Profundidade de Parênteses/Colchetes (`split_top_level`)
* **Por que estudar:** O parser Awk do injetor de mutação mecânica quebrava ao lidar com tipos como `Map<string, bigint>` ou `Record<string, { id: number }>` porque fazia divisão simples por vírgula. A solução implementada em `scripts/lib/mutation_helpers.sh` faz o rastreamento do nível de aninhamento de `<`, `>`, `{`, `}`, `[`, `]`, `(`, `)` permitindo dividir parâmetros de métodos sem quebrar tipos genéricos de TypeScript.
* **Arquivo chave:** [`scripts/lib/mutation_helpers.sh`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/mutation_helpers.sh) e teste `scripts/substrates/test/test_mutation_preflight.sh`.

### 2. `3a66317` — Injeção Dinâmica de Construtor e Inferência de Tipos AST TypeScript
* **Por que estudar:** Eliminou o acoplamento de código estático (hardcoded) nas sondas metamórficas de teste. O harness passou a analisar a seção `## Briefing` e as declarações de tipo `type Foo = { ... }`, gerando dinamicamente instâncias válidas de classes e estruturas com dados sintéticos determinísticos em tempo de execução via Node.js.
* **Arquivo chave:** [`scripts/lib/mechanical_scans.sh`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/mechanical_scans.sh).

### 3. `ccbd28b` — Sondas Metamórficas Universais e Correção de Escrita de Saldo
* **Por que estudar:** Implementou as 3 sondas metamórficas fundamentais:
  1. *Descarte de valor não-positivo:* transações `<= 0n` não debitam e não geram taxas.
  2. *Invariância de permutação:* `[t1, t2]` e `[t2, t1]` geram exatamente o mesmo débito acumulado quando a taxa é congelada no início do lote.
  3. *Invariância de partição:* dividir um lote em dois preserva a conservação contábil.
  Além disso, resolveu o bug contábil em que o motor esquecia de salvar o saldo das contas no Map persistente `this._balances`.
* **Arquivo chave:** `scripts/substrates/test/test_metamorphic_probes.sh` e `src/settlementEngine.ts`.

### 4. `a1b94b8` & `ae78ec9` — Inversão de Escala Semântica e Filtro de Divisão Inteira
* **Por que estudar:** Otimização de custos e latência de LLM: só ativa chamadas a modelos cognitivos se o diff contiver divisão inteira (`/`) combinada com tipos `bigint` e termos de risco de domínio (taxa, balance, quota). O regex foi blindado para remover comentários `//` e strings literais `./path.js`, eliminando falsos positivos.
* **Arquivo chave:** [`scripts/lib/mechanical_scans.sh`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/mechanical_scans.sh).

### 5. `8514133` — Modularização Arquitetural em `demand.sh`
* **Por que estudar:** Exemplo limpo de refatoração KISS: separou a responsabilidade de interpretar/ancorar a demanda (`scripts/lib/demand.sh`) da responsabilidade de julgar e executar o tribunal (`scripts/lib/mechanical_scans.sh`), reduzindo o acoplamento entre os modos de Discovery/Forensics e Validation.
* **Arquivo chave:** [`scripts/lib/demand.sh`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/demand.sh).

---

# 📋 PARTE 1: Tabela Resumida dos 23 Commits Descartados (pós-`a6db43a`)

| # | Hash | Data/Hora | Assunto |
|---|---|---|---|
| 1 | `b53de4e` | 2026-08-24 21:06:43 | aegis: issue#305 task 1/2 SettlementEngine |
| 2 | `eca9fda` | 2026-08-25 00:21:34 | refactor: remove SettlementEngine and stale verdicts, add policy gate regression test suite |
| 3 | `5012e50` | 2026-08-25 00:27:32 | aegis: issue#306 task 1/2 SettlementEngine |
| 4 | `ff639aa` | 2026-08-25 00:42:50 | fix(agentic): harden agentic verdict lifecycle, bound verification, policy holes detection, and runtime purge |
| 5 | `47379ce` | 2026-08-25 00:49:56 | feat(adversarial): reinforce zero-rate exemption guard, dynamic rate scaling, and universal boundary falsification tests |
| 6 | `0be97a5` | 2026-08-25 10:33:53 | refactor(mechanical_scans): clean legacy aliases, optimize in-memory RAM json building, and generalize fidelity target hints |
| 7 | `8514133` | 2026-08-25 10:53:52 | refactor(lib): modularize discovery/forensics into demand.sh and slim down mechanical_scans to core tribunal |
| 8 | `932f8b8` | 2026-08-25 10:55:40 | refactor: remove SettlementEngine implementation and its export from index.ts |
| 9 | `be140a3` | 2026-08-25 11:05:41 | aegis: issue#307 SettlementEngine |
| 10 | `0c14b57` | 2026-08-25 11:17:04 | fix(settlementEngine): harden zero-amount discard, rate bounds validation, zero-GC batch view, and ceil rounding |
| 11 | `3c47060` | 2026-08-25 11:32:04 | feat(harness): implement metamorphic probe invariants, adversarial epistemic isolation, and undeclared policy axes |
| 12 | `a1b94b8` | 2026-08-25 11:35:42 | feat(harness): implement semantic escalation inversion, decisions schema, and unjudged ledger status |
| 13 | `46cbda0` | 2026-08-25 12:19:03 | refactor: remove settlementEngine and its associated exports from index.ts |
| 14 | `ebdc056` | 2026-08-25 12:44:05 | aegis: issue#308 SettlementEngine |
| 15 | `ae78ec9` | 2026-08-25 14:28:08 | fix(harness): eliminate no-ops in metamorphic probes, scope integer division regex, and record cognitive ledger metrics |
| 16 | `9827dc7` | 2026-08-25 14:34:34 | refactor: remove SettlementEngine implementation and its export from index |
| 17 | `9a2bc22` | 2026-08-25 14:41:28 | aegis: issue#309 SettlementEngine |
| 18 | `ccbd28b` | 2026-08-25 16:04:06 | fix(harness): make the metamorphic probe general, wire its findings, and settle state |
| 19 | `cc67201` | 2026-08-25 16:27:38 | fix: improve metamorphic probe reliability by validating execution completion and refining CSV list formatting |
| 20 | `3a66317` | 2026-08-25 17:05:04 | refactor: dynamic module constructor injection based on demand briefing and signature analysis |
| 21 | `ee8f25c` | 2026-08-25 17:05:26 | refactor: remove SettlementEngine module and clean up index exports |
| 22 | `a20eba3` | 2026-08-25 17:31:15 | aegis: issue#310 SettlementEngine |
| 23 | `9dc5f47` | 2026-08-25 18:31:14 | fix: implement bracket-aware splitting in mutation injector to support generic types correctly |

---

# 📖 PARTE 2: Detalhamento Técnico & ELI5 dos 23 Commits Descartados

#### 1. Commit `b53de4e` — `aegis: issue#305 task 1/2 SettlementEngine`
* **Data/Hora:** `2026-08-24 21:06:43 -0300`
* **ELI5:** Criação do primeiro protótipo do motor de liquidação financeira na Issue #305.
* **O Que Mudou:** Criou `src/settlementEngine.ts` (61 linhas) e adicionou seu re-export em `src/index.ts`.

#### 2. Commit `eca9fda` — `refactor: remove SettlementEngine and stale verdicts, add policy gate regression test suite`
* **Data/Hora:** `2026-08-25 00:21:34 -0300`
* **ELI5:** Criou uma bateria de testes rigorosos para garantir que nenhuma política de segurança seja burlada.
* **O Que Mudou:** Criou `scripts/substrates/test/test_policy_gates.sh` (161 linhas) e limpou vereditos temporários antigos.

#### 3. Commit `5012e50` — `aegis: issue#306 task 1/2 SettlementEngine`
* **Data/Hora:** `2026-08-25 00:27:32 -0300`
* **ELI5:** Recriação do motor de liquidação na Issue #306 com o novo harness de políticas ativado.
* **O Que Mudou:** Gerou `src/settlementEngine.ts` (56 linhas) e exportou em `src/index.ts`.

#### 4. Commit `ff639aa` — `fix(agentic): harden agentic verdict lifecycle, bound verification, policy holes detection, and runtime purge`
* **Data/Hora:** `2026-08-25 00:42:50 -0300`
* **ELI5:** Ensinou a IA a não deixar "buracos" nas regras e a apagar arquivos de rascunho após a análise.
* **O Que Mudou:** Em `scripts/lib/briefing.sh` e `run_aegis.sh`: Validação de decisões completas e purge seguro de runtime.

#### 5. Commit `47379ce` — `feat(adversarial): reinforce zero-rate exemption guard, dynamic rate scaling, and universal boundary falsification tests`
* **Data/Hora:** `2026-08-25 00:49:56 -0300`
* **ELI5:** Garantiu que taxa 0% não cobre nada e que limites extremos de números inteiros sejam testados pelo adversário.
* **O Que Mudou:** Em `src/settlementEngine.ts` e `scripts/lib/mechanical_scans.sh`: Guarda explícita para `appliedFeeBps === 0 ? 0n : ...`.

#### 6. Commit `0be97a5` — `refactor(mechanical_scans): clean legacy aliases, optimize in-memory RAM json building, and generalize fidelity target hints`
* **Data/Hora:** `2026-08-25 10:33:53 -0300`
* **ELI5:** Acelerou o robô de validação fazendo-o processar tudo na memória RAM.
* **O Que Mudou:** Em `scripts/lib/mechanical_scans.sh`: Otimizou a construção de JSONs e removeu aliases obsoletos.

#### 7. Commit `8514133` — `refactor(lib): modularize discovery/forensics into demand.sh and slim down mechanical_scans to core tribunal`
* **Data/Hora:** `2026-08-25 10:53:52 -0300`
* **ELI5:** Organizou o código separando "entender o que fazer" (`demand.sh`) de "julgar o código" (`mechanical_scans.sh`).
* **O Que Mudou:** Criou `scripts/lib/demand.sh` (390 linhas) e enxugou `scripts/lib/mechanical_scans.sh`.

#### 8. Commit `932f8b8` — `refactor: remove SettlementEngine implementation and its export from index.ts`
* **Data/Hora:** `2026-08-25 10:55:40 -0300`
* **ELI5:** Limpeza de arquivos antes do teste da Issue #307.
* **O Que Mudou:** Deletou `src/settlementEngine.ts` e seu re-export.

#### 9. Commit `be140a3` — `aegis: issue#307 SettlementEngine`
* **Data/Hora:** `2026-08-25 11:05:41 -0300`
* **ELI5:** Recriação completa do SettlementEngine na Issue #307.
* **O Que Mudou:** Criou `src/settlementEngine.ts` (115 linhas) com processamento de lotes e interfaces completas.

#### 10. Commit `0c14b57` — `fix(settlementEngine): harden zero-amount discard, rate bounds validation, zero-GC batch view, and ceil rounding`
* **Data/Hora:** `2026-08-25 11:17:04 -0300`
* **ELI5:** Blindou o motor financeiro contra transações zeradas, taxas inválidas e arredondamentos desonestos.
* **O Que Mudou:** Em `src/settlementEngine.ts`: `RangeError('out_of_range')` no construtor, fórmula `ceil` com base 10.000 BPS e descarte de valores `<= 0n`.

#### 11. Commit `3c47060` — `feat(harness): implement metamorphic probe invariants, adversarial epistemic isolation, and undeclared policy axes`
* **Data/Hora:** `2026-08-25 11:32:04 -0300`
* **ELI5:** Criou os primeiros testes metamórficos (ex: se inverter a ordem do lote, o saldo final tem que bater).
* **O Que Mudou:** Em `scripts/lib/mechanical_scans.sh`: Adicionou a primeira versão da sonda metamórfica.

#### 12. Commit `a1b94b8` — `feat(harness): implement semantic escalation inversion, decisions schema, and unjudged ledger status`
* **Data/Hora:** `2026-08-25 11:35:42 -0300`
* **ELI5:** Fez o sistema só gastar chamadas de IA caros se detectar risco semântico real ou divisão de inteiros.
* **O Que Mudou:** Em `scripts/lib/mechanical_scans.sh`: Implementou o algoritmo de decisão de escalada de IA.

#### 13. Commit `46cbda0` — `refactor: remove settlementEngine and its associated exports from index.ts`
* **Data/Hora:** `2026-08-25 12:19:03 -0300`
* **ELI5:** Limpeza de arquivos antes da Issue #308.
* **O Que Mudou:** Deletou `src/settlementEngine.ts` (129 linhas).

#### 14. Commit `ebdc056` — `aegis: issue#308 SettlementEngine`
* **Data/Hora:** `2026-08-25 12:44:05 -0300`
* **ELI5:** Geração do motor de liquidação na Issue #308 pelo Aider substrate.
* **O Que Mudou:** Recriou `src/settlementEngine.ts` (130 linhas) e ajustou `scripts/substrates/aider/invoke.sh`.

#### 15. Commit `ae78ec9` — `fix(harness): eliminate no-ops in metamorphic probes, scope integer division regex, and record cognitive ledger metrics`
* **Data/Hora:** `2026-08-25 14:28:08 -0300`
* **ELI5:** Evitou falsos alarmes no detector de divisões e registrou métricas cognitivas.
* **O Que Mudou:** Em `scripts/lib/mechanical_scans.sh`: Regex limpa comentários e requer `bigint` antes de soar alarme de divisão.

#### 16. Commit `9827dc7` — `refactor: remove SettlementEngine implementation and its export from index`
* **Data/Hora:** `2026-08-25 14:34:34 -0300`
* **ELI5:** Limpeza para a Issue #309.
* **O Que Mudou:** Deletou `src/settlementEngine.ts` (130 linhas).

#### 17. Commit `9a2bc22` — `aegis: issue#309 SettlementEngine`
* **Data/Hora:** `2026-08-25 14:41:28 -0300`
* **ELI5:** Geração do motor na Issue #309 com getters de volume e total debitado.
* **O Que Mudou:** Recriou `src/settlementEngine.ts` (121 linhas).

#### 18. Commit `ccbd28b` — `fix(harness): make the metamorphic probe general, wire its findings, and settle state`
* **Data/Hora:** `2026-08-25 16:04:06 -0300`
* **ELI5:** Consertou um bug onde o motor esquecia de salvar o novo saldo após a cobrança e tornou as sondas matemáticas universais.
* **O Que Mudou:** Em `src/settlementEngine.ts`: Persistência em `this._balances.set(tx.accountId, nextBalance)`. Criou `scripts/substrates/test/test_metamorphic_probes.sh` (231 linhas).

#### 19. Commit `cc67201` — `fix: improve metamorphic probe reliability by validating execution completion and refining CSV list formatting`
* **Data/Hora:** `2026-08-25 16:27:38 -0300`
* **ELI5:** Garantiu que os testes reportem explicitamente que terminaram com sucesso e não falhem em silêncio.
* **O Que Mudou:** Em `scripts/lib/mechanical_scans.sh`: Inclusão de marcadores `METAMORPHIC_OK` e correção de imports CSV.

#### 20. Commit `3a66317` — `refactor: dynamic module constructor injection based on demand briefing and signature analysis`
* **Data/Hora:** `2026-08-25 17:05:04 -0300`
* **ELI5:** Fez o sistema analisar o texto da demanda e inferir automaticamente como instanciar qualquer classe sem código hardcoded.
* **O Que Mudou:** Em `scripts/lib/mechanical_scans.sh`: Parser AST em TypeScript para instanciar tipos dinamicamente a partir da seção `## Briefing`.

#### 21. Commit `ee8f25c` — `refactor: remove SettlementEngine module and clean up index exports`
* **Data/Hora:** `2026-08-25 17:05:26 -0300`
* **ELI5:** Limpeza antes da Issue #310.
* **O Que Mudou:** Deletou `src/settlementEngine.ts` (166 linhas).

#### 22. Commit `a20eba3` — `aegis: issue#310 SettlementEngine`
* **Data/Hora:** `2026-08-25 17:31:15 -0300`
* **ELI5:** Geração do motor na Issue #310 com validação de taxas e campos privados tipados.
* **O Que Mudou:** Recriou `src/settlementEngine.ts` (108 linhas) e adicionou `balanceOf()`.

#### 23. Commit `9dc5f47` — `fix: implement bracket-aware splitting in mutation injector to support generic types correctly`
* **Data/Hora:** `2026-08-25 18:31:14 -0300`
* **ELI5:** Ensinou o gerador de código a não quebrar tipos complexos que usam colchetes ou sinais de maior/menor como `Map<string, bigint>`.
* **O Que Mudou:** Em `scripts/lib/mutation_helpers.sh`: Função `split_top_level()` que faz contagem de profundidade de parênteses, chaves e colchetes `<>`, `{}`, `[]`, `()` para separar parâmetros sem corromper tipos genéricos em TypeScript. Criou testes em `scripts/substrates/test/test_mutation_preflight.sh`.

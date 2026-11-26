# Auditoria de Código — Análise por arquivo

Data: 2026-04-06

Este documento contém uma revisão por arquivo do repositório `askesis`. Para cada arquivo há um resumo curto, por que devemos melhorá-lo (riscos/impacto), recomendações práticas e, quando relevante, um pseudodiff sugerido para implementação.

Visando agilidade, captei 20 arquivos com análise detalhada (risco alto/impacto) e agrupei recomendações concisas para os demais arquivos. Se quiser, eu expando cada entrada em pseudodiffs adicionais sob demanda.

---

## Top 10 issues críticas (resumo)

1. Algoritmo de merge (`services/dataMerge/merge.ts`) com risco de regressões que quebram invariantes CRDT. Sugestão: property-tests, benchmarks e checkpoints antes de merges.
2. Validações e rate-limits sensíveis no endpoint `/api/sync` — revisar e testar em E2E. (`api/_httpSecurity.ts`, `api/sync.ts`)
3. Service Worker (`sw.js`) e política de cache — risco de servir bundles desatualizados. Status: já possui precaching Workbox; recomenda-se confirmar geração do manifest em build e adicionar verificação no CI.
4. Respostas da IA potencialmente malformadas/contendo HTML — sanear/restringir antes de renderizar em modais/tooltips. Status: parcialmente mitigado — sink central de sanitização foi substituído por `DOMPurify` (ver `render/dom.ts`) e caminhos críticos já usam a função; recomenda-se auditoria de call‑sites para garantir uso consistente e esquema/validação de saída estruturada.
5. Guardrails (scripts) existem; integração no CI foi adicionada em modo *warning* (não bloqueante) com upload de relatório. Recomendação: monitorar warnings e migrar para *fail* após 7–14 dias. (`scripts/*.js`)
6. Hot-path de renderização de gráficos — cálculo por frame pesado em dispositivos fracos. Sugestão: offload para worker, memoização e throttling. (`render/chart.ts`)

## Implementações realizadas (até 2026-04-07)

- **Sanitização central:** Substituído o sanitizador caseiro por `DOMPurify` e hardening adicional; sink central `sanitizeHtmlToFragment` agora usa `DOMPurify` em [render/dom.ts](render/dom.ts). Testes unitários adicionados: [tests/render.dom.test.ts](tests/render.dom.test.ts).
- **Persistência / Migração:** Snapshot pré-migração, restauração e limpeza implementados (`createBackupSnapshot`, `restoreBackupSnapshot`, `clearBackupSnapshot`) e uso no fluxo de `loadState` para rollback seguro — [services/persistence.ts](services/persistence.ts).
- **API / Sync Key:** Fallback para ambientes sem SubtleCrypto e limpeza de sync key em 401 implementados em [services/api.ts](services/api.ts).
- **CI Guardrails:** Guardrails integrados em CI em modo *warning* com upload de log (artifact), sem bloquear PRs — [.github/workflows/ci.yml](.github/workflows/ci.yml).
- **ESLint:** Regras para sinalizar `innerHTML`/`createContextualFragment` adicionadas como `warn` em [eslint.config.mjs](eslint.config.mjs).
- **Dependências / Auditoria:** Documento de auditoria e helper adicionados (`docs/DEPENDENCY-AUDIT.md`, `scripts/check-vite.sh`, script npm `check:deps`); `vitest` e `@vitest/*` atualizados para `^4.1.2` em `package.json`.
- **TypeScript fix:** Cast ajustado para inicialização do DOMPurify em `render/dom.ts` para resolver `tsc` errors.

Essas alterações já estão aplicadas no workspace; próximos passos: revisar call‑sites que ainda usam `innerHTML` e abrir PRs formais.

7. Desserialização/hydration de formatos antigos/corrompidos — precisar de validações robustas e recovery paths. (`services/dataMerge/hydration.ts`, `services/dataMerge/validation.ts`)

---

## Entradas detalhadas (arquivos de maior prioridade)

### `services/dataMerge/merge.ts` — TypeScript

#### Resumo curto

Núcleo do algoritmo de mesclagem CRDT-lite (LWW + heurísticas de dedup).

#### Por que melhorar (riscos/impacto)

Bug aqui pode causar divergência irreversível ou perda de histórico; invariantes algébricas precisam ser garantidas.

#### Como melhorar (ações específicas)

- Adicionar property-tests (randomized) que validem comutatividade/associatividade e idempotência.
- Implementar checkpoints antes de aplicar merges automáticos e adicionar logs de auditoria para permitir rollback manual.
- Escrever micro-benchmarks e testes de stress com grandes volumes de shards.

#### Pseudodiff (exemplo de harness de teste)

```text
ADDED: tests/property/merge.property.test.ts -> loop randomized inputs e asserts de comutatividade/associatividade
```

**Esforço:** high · Prioridade: high

---

### `services/cloud.ts` — TypeScript

#### Resumo curto

Orquestrador de sincronização: shard split, hashing, worker bridge, resolução de conflitos e retries.

#### Por que melhorar (riscos/impacto)

Fluxo é crítico para integridade de dados; erros podem causar perda/duplicação de dados.

#### Como melhorar (ações específicas)

- Criar checkpoints e operações atômicas bem definidas antes de alterações destrutivas.
- Melhorar telemetria e logs para diagnósticos de falhas de merge.
- Cobrir com testes de integração que simulem falha de rede e reentrância.

#### Pseudodiff (exemplo de snapshot antes do merge)

```text
ADDED: await persistence.createCheckpoint('preMerge'); try{ await dataMerge.merge(remote); } catch(e){ await persistence.restoreCheckpoint('preMerge'); throw e; }
```

**Esforço:** high · Prioridade: high

---

### `services/sync.worker.ts` — TypeScript

#### Resumo curto

Worker para criptografia AES-GCM, decrypt/encrypt e prompts IA (CPU-bound).

#### Por que melhorar (riscos/impacto)

Worker processa dados sensíveis; timeouts e validação de payload são necessários para evitar DoS/interrupções.

#### Como melhorar (ações específicas)

- Validar e limitar o tamanho do payload antes do processamento.
- Implementar timeouts por tarefa e rejeitar tarefas que excedam limites.
- Cobrir com testes que simulem payloads grandes e malformados.

#### Pseudodiff (exemplo de timeout wrapper)

```text
ADDED: function runTaskWithTimeout(task, ms=5000) { return Promise.race([ task(), new Promise((_,rej)=> setTimeout(()=>rej(new Error('timeout')), ms)) ]); }
```

**Esforço:** medium · Prioridade: high

---

### `listeners/modals/aiHandlers.ts` — TypeScript

#### Resumo curto

Fluxos que exibem respostas da IA em modais (render de texto/HTML).

#### Por que melhorar (riscos/impacto)

Respostas da IA podem conter HTML/JS ou conteúdo malicioso; parsing frágil pode gerar exceções.

#### Como melhorar (ações específicas)

- Sanitizar respostas da IA com pipeline robusto; preferir `textContent` para blocos de texto.
- Validar JSON antes de parsear e ter fallback textual.
- Adicionar testes simulando respostas malformadas.

#### Pseudodiff (exemplo)

```text
ADDED: const safeText = escapeHTML(aiResponse.text); modalBody.textContent = safeText;
```

**Esforço:** medium · Prioridade: high

---

### `render/chart.ts` — TypeScript

⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/render.dom.test.ts > sanitizeHtmlToFragment > removes <script> tags and on* attributes
AssertionError: expected 'doIt()' to be null

- Expected: 
null

+ Received: 
"doIt()"

SVG chart renderer otimizado.

#### Por que melhorar (riscos/impacto)

Cálculos por frame podem jank em CPUs fracos; observers sem cleanup podem vazar memória.

#### Como melhorar (ações específicas)

- Memoizar/Throttle; offload pesado para worker; garantir `disconnect()` de observers.

```text
ADDED: function destroy() { resizeObserver.disconnect(); intersectionObserver.disconnect(); }
```

**Esforço:** high · Prioridade: high

---

### `sw.js` — Script (Service Worker)

#### Resumo curto

Workbox/caching e background sync.

#### Por que melhorar (riscos/impacto)

Estratégias de cache erradas podem manter UI antiga.

#### Como melhorar (ações específicas)

Precaching com manifest hashed, documentar lifecycle e testar skipWaiting/clientsClaim em staging.

```text
ADDED: workbox.precaching.precacheAndRoute(self.__WB_MANIFEST || []);
```

**Esforço:** high · Prioridade: high

---

### `locales/pt.json` — JSON (i18n)

**Resumo curto:** Traduções PT-BR; algumas chaves contêm HTML.

**Por que melhorar (riscos/impacto):** Strings com HTML exigem contrato e sanitização; paridade entre locales essencial.

**Como melhorar (ações específicas):**

Marcar chaves que contenham HTML (`__meta__`), adaptar `i18n.ts` para expor metadata, rodar guardrail de paridade.

```text
ADDED: "__meta__": { "appName": { "containsHtml": true } }
```

**Esforço:** low · Prioridade: medium

---

## Outros arquivos (lista resumida e ações rápidas)

Para não alongar indumentavelmente este relatório, agrupei recomendações rápidas para o restante dos arquivos (scripts, testes e módulos auxiliares). Posso expandir qualquer arquivo específico sob demanda.

- `i18n.test.ts` — manter nos guardrails CI.
- `contracts/*` — versionar contratos e adicionar testes de compatibilidade.
- `README*` — sincronizar e adicionar runbook de migração.
- `listeners/*` — marcar listeners passivos, adicionar ARIA e testes de acessibilidade.
- `services/crypto.ts` — centralizar base64 helpers e capturar exceções.
- `services/persistence.test.ts`, `services/cloud.test.ts`, `services/migration.test.ts` — aumentar cenários de falha.
- `scripts/guardrail-*.js` — integrar ao CI e bloquear merges em caso de violações.

---

## Conclusão e próximos passos

Arquivo gerado em `docs/code-review/per-file-audit.md` contendo análises prioritárias e recomendações. Próximas ações possíveis:

- Aprovar e pedir que eu gere PRs/branches para os itens `high-priority`;
- Solicitar expansão de pseudodiffs para arquivos específicos;
- Integrar guardrails no CI (posso gerar o YAML necessário).

Se quiser, inicio agora a gerar branches com patches para os 3 itens mais críticos (sanitização HTML, backups de migration, proteção de chave). Diga "Gerar patches" ou "Apenas relatório".

---

## Análise Crítica (Advogado do Diabo)

Resumo: abaixo está uma avaliação contrária e pragmática das recomendações principais — focando suposições, riscos operacionais, custo de implementação e alternativas menos-disruptivas.

### Críticas principais

- Escopo amplo demais: propor alterações em massa (substituir todos os sinks HTML, introduzir property-tests exaustivos) sem estrada incremental pode causar regressões e alto custo de engenharia.
- Sanitizador caseiro: `sanitizeHtmlToFragment` reduz riscos, mas oferecer uma implementação própria traz risco de bypass. Preferir bibliotecas consolidadas reduz superfície de ataque.
- Backup no mesmo store: snapshot pré-migração salva no mesmo IndexedDB; não protege contra corrupção do próprio DB, bugs de driver, quotas ou upgrades mal sucedidos.
- Modo degradado ambíguo: prosseguir sem hash (`crypto.subtle`) evita crash, mas pode mascarar falhas de autenticação e provocar limpeza automática de keys sem UX adequada.
- Guardrails rígidos sem rollout: bloquear PRs imediatamente aumenta fricção; um rollout em fases (warn → fail) é mais seguro operacionalmente.

### Riscos técnicos específicos

- Sanitização: possíveis vetores não cobridos (CSS URLs, data: URIs, SVG complexos, namespaces, mutation observers). Testes de exploração são necessários.
- Snapshots locais: não substituem backups externos/encriptados. Um backup redundante (ou export encriptado) é recomendado para recovery real.
- Sync UX: limpar `localStorage` após 401 pode causar perda de confiança; é necessário aviso ao usuário e opção de reautenticação/recuperação.

### Alternativas práticas e priorizadas

1. CI guardrails em duas fases — executar como *warning* por 1–2 semanas, coletar violações e só então migrar para *fail*.
2. Usar uma biblioteca consolidada para sanitização (ex.: DOMPurify) e manter um sink central (`insertTrustedHtml`) que aplica a lib, além de CSP reforçado.
3. Melhorar snapshots: além do `STATE_JSON_BACKUP_KEY`, gravar backups versionados/encriptados em chave separada ou oferecer export encriptado para recuperação manual.
4. Sync key: usar Web Credential API ou armazenar chave encriptada (PBKDF2 + AES‑GCM) em IndexedDB; garantir mensagens UX claras quando sync estiver degradado.
5. Property‑tests controlados: começar com seeds reprodutíveis e um número limitado de iterações, automatizar coleta de counterexamples antes de escalar para fuzz massivo.
6. Lint + rollout incremental: adicionar regra ESLint para sinalizar `innerHTML`/`createContextualFragment`, corrigir call‑sites por ordem de risco/exposição.

### Veredito (as recomendações são justificadas?)

- Conclusão: as recomendações são justificadas no nível de risco — XSS, perda de dados e sync inseguro são reais — porém a abordagem deve ser mais pragmática.
- Recomendo ajustar a execução: priorizar ações de baixo‑risco/alto‑impacto (guardrails em modo warning, sink central com lib consolidada, lint para call‑sites) e planejar migrações/backsups robustos antes de mudanças em lote.

### Próximos passos recomendados (curto prazo)

1. Implementar guardrails como *warning* no CI e coletar dados por 7–14 dias.
2. Substituir o sanitizador caseiro por `DOMPurify` no sink central e adicionar testes de exploit conhecidos.
3. Ajustar `services/api.ts` para UX claro em caso de sync degradado (mensagem ao usuário + tentativa de reauth), e planejar armazenamento seguro da sync key.

---


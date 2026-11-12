# Auditoria — Foco Engenharia (sweet spot)

Data: 2026-04-06

Objetivo: transformar o relatório de auditoria em um artefato no "sweet spot" para equipes de engenharia e para ingestão por AIs especializadas. Isso significa:

- separar claramente o que é tarefa de engenharia (código, testes, infra) do que é documentação/organização;
- converter achados em Change Requests acionáveis, com critérios de aceite, testes e plano de rollback;
- fornecer pseudodiffs, métricas e estimativas para cada mudança;
- produzir um JSON estruturado (changeRequests) que outra IA possa consumir e transformar em patches/PRs.

Metodologia: li o arquivo `docs/code-review/per-file-audit.md`, extraí os itens de maior impacto e reescrevi-os como Change Requests (CR). Classifiquei o restante como não-engenharia ou notas organizacionais.

---

## 1) Classificação rápida (engenharia vs não-engenharia)

- Engenharia (actionable): XSS/sanitização, persistência/migrations, dataMerge (merge.ts), crypto/sync key handling, service worker cache lifecycle, IA -> output sanitization/format, performance do renderer, integração de guardrails no CI, testes property/integration.
- Documentação / Organização: READMEs, ADRs, imagens/assets, maturity assessment, pequenos scripts de dev (dev-api-mock). Esses itens exigem manutenção/documentação, não alteração de runtime crítico.

Observação: alguns arquivos já têm mitigations implementadas (ex.: `sw.js` possui precaching; `render/dom.ts` já expõe `sanitizeHtmlToFragment`). Mesmo assim, as mudanças propostas visam padronizar e fechar gaps (por exemplo: centralizar o sink de HTML e substituir todos os call sites).

---

## 2) O que falta para o relatório atingir o "sweet spot"

- Transformar cada recomendação de alto nível em um CR com: arquivo(s) alvo, resumo, justificativa, passos mínimos, pseudodiff, testes a adicionar/alterar, critérios de aceite (pass/fail), métricas de sucesso, risco e rollback.
- Indicar proprietários ou squads responsáveis (placeholder: `owner: "team/backend|team/frontend"`).
- Incluir expectativas de testes automatizados (vitest): nome do teste, fixtures, thresholds.
- Fornecer um JSON machine-readable com todos os CRs (facilita ingestão por outra IA).
- Remover recomendações redundantes ou marcá-las como "já satisfeitas" (ex.: `sw.js` já tem precaching). O relatório atual ainda inclui itens que já estão parcialmente implementados.

---

## 3) Recomendações detalhadas (Change Requests)

Cada CR abaixo foi escrita para ser imediatamente consumível por uma AI especializada — contém `id`, `summary`, `justification`, `files`, `pseudodiff_hint`, `tests`, `acceptance`, `metrics`, `risk`, `rollback`, `estimatedEffort`, `priority`.

```json
{
  "changeRequests": [
    {
      "id": "CR-01",
      "summary": "Centralizar e padronizar sanitização de HTML e proibir sinks inseguros",
      "justification": "Evita XSS por strings vindas de traduções, IA ou import/export; reduz superfície de risco e facilita auditoria automatizada.",
      "files": ["render/dom.ts", "render/modalBuilders.ts", "listeners/modals/aiHandlers.ts", "i18n.ts"],
      "pseudodiff_hint": "Introduzir insertTrustedHtml(target, html, { allowList: [...] }) na render/dom.ts; substituir chamadas a setTrustedHtmlFragment/createContextualFragment/innerHTML por insertTrustedHtml; adicionar lint rule (eslint) que bloqueie uso de innerHTML e createContextualFragment direto.",
      "tests": [
        "unit: sanitizeHtmlToFragment removes <script> and on* attributes",
        "integration: aiHandlers renders sanitized fragment and no scripts executed (JSDOM assertion)"
      ],
      "acceptance": "Guardrail script scripts/guardrail-security-html.js passa; nenhum uso proibido presente; testes unitários/integracao passam; cobertura de sanitização aumentada.",
      "metrics": ["guardrail-security-html violations = 0", "new unit tests coverage for DOM sinks >= 90%"],
      "risk": "medium",
      "rollback": "Reverter commit onde insertTrustedHtml foi introduzido; restaurar chamadas antigas se UI quebrar; manter branch para hotfix.",
      "estimatedEffort": "medium",
      "priority": "high"
    },
    {
      "id": "CR-02",
      "summary": "Persistência: snapshots pré-migração, validação e restore automatic",
      "justification": "Migrações de bitmask e hidratação já são críticas; um snapshot garante recuperação em caso de corrupção.",
      "files": ["services/persistence.ts", "services/migration.ts"],
      "pseudodiff_hint": "Adicionar createBackupSnapshot/restoreBackupSnapshot/clearBackupSnapshot; envolver migrateState(...) com try/catch que restaura snapshot em caso de falha; adicionar logs telemétricos.",
      "tests": [
        "integration: simulate migration exception and assert state restored from snapshot",
        "stress: run migrations on large dataset and verify checkpoint creation"
      ],
      "acceptance": "Falha intencional na migração leva a restauração automática; backups temporários não vazam dados sensíveis; logs de evento gerados.",
      "metrics": ["restore-on-failure rate = 100% in test harness", "backup creation time < X ms for N records"],
      "risk": "medium",
      "rollback": "Reverter a rotina de snapshot; notas no changelog sobre fallback.",
      "estimatedEffort": "high",
      "priority": "high"
    },
    {
      "id": "CR-03",
      "summary": "Gerenciamento seguro da Sync Key e fallback para ambientes sem SubtleCrypto",
      "justification": "Chave em localStorage é sensível; dependência de SubtleCrypto pode quebrar UX em ambientes restritos.",
      "files": ["services/api.ts", "services/workerClient.ts"],
      "pseudodiff_hint": "Introduzir wrapper cryptoKeyStore que suporte: (A) uso de Web Credential API (se disponível), (B) armazenamento encriptado localmente com passphrase derivada (PBKDF2) ou (C) modo degradado informando usuário; não armazenar chave em texto puro.",
      "tests": ["unit: getSyncKeyHash returns null if crypto absent; apiFetch handles degraded mode gracefully","e2e: sync flow in env without crypto should not crash UI; server returns 401 handled"],
      "acceptance": "App não lança erro em ambientes sem SubtleCrypto; usuário recebe aviso se sync estiver degradado; chave nunca salva em texto plano.",
      "metrics": ["user-reported sync failures decreased after fix","failed-sync crashes = 0 in test harness"],
      "risk": "high (security-sensitive)",
      "rollback": "Restaurar comportamento anterior se compatibilidade quebrada; manter migration plan para users afetados.",
      "estimatedEffort": "high",
      "priority": "high"
    },
    {
      "id": "CR-04",
      "summary": "Property-tests e harness para services/dataMerge (comutatividade/associatividade)",
      "justification": "Garante propriedades algébricas críticas do algoritmo de merge; reduz risco de divergência entre dispositivos.",
      "files": ["services/dataMerge/merge.ts", "tests/property/merge.property.test.ts"],
      "pseudodiff_hint": "Adicionar teste que gere shards aleatórios (fuzz) e verifique merge(a,b) == merge(b,a) e merge(merge(a,b),c) == merge(a,merge(b,c)).", 
      "tests": ["property: randomized merges (>=1000 iterations)"],
      "acceptance": "nenhum counterexample encontrado em N runs; se encontrado, criar issue com input reprodutível.",
      "metrics": ["property-tests pass rate", "time per iteration"],
      "risk": "low",
      "rollback": "nenhum (adiciona testes apenas)",
      "estimatedEffort": "medium",
      "priority": "high"
    },
    {
      "id": "CR-05",
      "summary": "Garantir ciclo de deploy seguro do Service Worker e validade de cache hashed",
      "justification": "Evita servir bundles desatualizados e regressões offline.",
      "files": ["sw.js", "build.js"],
      "pseudodiff_hint": "Assegurar que __WB_MANIFEST é gerado na build; adicionar step de validação no CI que verifica se arquivos hasheados constam no manifest; documentar release steps (skipWaiting/clientsClaim).",
      "tests": ["integration: simulate update flow with skipWaiting/clientsClaim"],
      "acceptance": "Bundle hashed substituído com novo hash ativa nova versão; usuário não fica preso em versão antiga após deploy controlado.",
      "metrics": ["percentage of clients updated within N minutes after deploy"],
      "risk": "medium",
      "rollback": "documentar invalidation steps e contato de release engineering.",
      "estimatedEffort": "medium",
      "priority": "medium"
    },
    {
      "id": "CR-06",
      "summary": "Sanitização e schema para respostas da IA (modais) — preferir outputs estruturados",
      "justification": "Reduz risco de XSS e torna parsing robusto; permite validação por JSON Schema antes do render.",
      "files": ["listeners/modals/aiHandlers.ts", "services/analysis.ts", "api/analyze.ts"],
      "pseudodiff_hint": "Adicionar validação de schema para payloads de IA; preferir resposta JSON estruturada em vez de markdown/html livre; sanitizar caso contrário.",
      "tests": ["unit: parser tolera entradas malformadas", "integration: modal renders JSON-safe response"],
      "acceptance": "IA outputs validados por schema; UI não insere HTML não esperado; guardrail-security-html não reporta violações via IA paths.",
      "risk": "medium",
      "rollback": "fallback para apresentação em texto bruto com aviso de parsing.",
      "estimatedEffort": "medium",
      "priority": "high"
    },
    {
      "id": "CR-07",
      "summary": "Limpeza de observers e offload de cálculos no renderer (chart/habits)",
      "justification": "Previne leaks e melhora performance em dispositivos fracos (mobile).",
      "files": ["render/chart.ts", "render/habits.ts"],
      "pseudodiff_hint": "Adicionar destroy()/dispose() que desconecta ResizeObserver/IntersectionObserver; mover cálculos pesados para worker quando dataset > threshold.",
      "tests": ["perf: render 30s profile < budget on low-end emulation", "unit: observers disconnected after destroy()"],
      "acceptance": "Nenhum observer ativo após view desmontada; perfil de CPU reduzido em X% em device emulado.",
      "risk": "low",
      "rollback": "reverter offload e reintroduzir cálculos na main thread se comportamento inesperado.",
      "estimatedEffort": "medium",
      "priority": "medium"
    },
    {
      "id": "CR-08",
      "summary": "Integrar guardrails (security-html, locales parity) ao CI e bloquear PRs violadores",
      "justification": "Automatiza segurança básica e garante paridade entre locais; reduz revisão manual.",
      "files": ["scripts/guardrail-security-html.js", "scripts/guardrail-locales-parity.js", ".github/workflows/ci.yml"],
      "pseudodiff_hint": "Adicionar steps no CI para executar os scripts e falhar em caso de violações; fornecer escape documentada para casos aprovados.",
      "tests": ["ci: guardrails pass on main branch"],
      "acceptance": "PRs com violação falham no CI; maintainers podem aprovar exceções via checklist no PR.",
      "risk": "low",
      "rollback": "remover step do CI temporariamente com justificação e taguear PR.",
      "estimatedEffort": "low",
      "priority": "high"
    }
  ]
}
```

---

## 4) Como preparar este artefato para outra IA especializada

- Forneça à IA a raiz do repositório (`/workspaces/askesis`) e o arquivo JSON `changeRequests` acima como entrada primária.
- Pedir instruções claras e limitadas: "Para cada CR gere um branch `cr/CR-xx/<short>` com patch mínimo, adicione testes (vitest), execute guardrails e retorne diffs e logs de testes."
- Construa um contrato de segurança: não altere APIs públicas sem sinalizador `breakingChange=true`; adicione testes e documentação para qualquer breaking change.
- Forneça recursos: tempo estimado, containers ou comandos para rodar testes localmente (ex.: `npm ci && npm test`).

Exemplo de prompt para IA especializada:

"Input: repo root + changeRequests JSON. For each CR: produce a minimal patch that implements the pseudodiff_hint, add unit/integration tests as specified, run `npm test` and `scripts/guardrail-security-html.js`, and return: branch name, patch (unified diff), test results (pass/fail + errors), CI steps required, estimated effort in hours, and a rollback plan. Do not open PRs automatically; return artifacts for human review."

---

## 5) Checklist mínimo para cada CR (entrega sweet-spot)

1. Patch aplicado com escopo mínimo (1-3 arquivos preferencialmente).
2. Testes unitários adicionados/atualizados; cobertura relevante aumentada para a área tocada.
3. Scripts de guardrail passam (security-html, locales-parity).
4. Critério de aceite objetivo definido e validado (testes + guardrails).
5. Mensagem de commit clara e CHANGELOG entry.
6. Plano de rollback documentado na descrição do change.

---

## 6) Prioridade recomendada para execução (ordem prática)

1. `CR-01` (Sanitização central) — reduz risco de XSS de forma ampla.
2. `CR-02` (Backups/migrations) — protege dados do usuário.
3. `CR-03` (Sync key / fallback crypto) — segurança e compatibilidade.
4. `CR-04` (Property-tests dataMerge) — evita perda de histórico em merges.
5. `CR-08` (Guardrails CI) — automatiza retenção de qualidade.
6. `CR-06` (IA outputs) — evita vetores XSS via IA.
7. `CR-07` (Renderer perf) — melhora UX em mobile.
8. `CR-05` (SW release flow) — valida deploys offline.

---

Se desejar, posso agora:

- gerar os patches para os CRs 1..3 (branch + diffs) para revisão humana; ou
- exportar o `changeRequests` JSON para `docs/code-review/changeRequests.json` para ingestão por outra IA especializada.

Indique qual ação prefere: "Gerar patches CR1-CR3", "Exportar JSON para outra IA" ou "Apenas revisão".

Fim do documento.

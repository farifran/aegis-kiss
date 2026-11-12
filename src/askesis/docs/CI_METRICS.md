**Métricas CI mínimas — como coletar e usar**

Objetivo: medir progresso e impacto das mudanças L3→L4 com métricas simples e acionáveis.

- **Tempo CI (por workflow/job)**: usar o tempo total do run do GitHub Actions (UI) ou adicionar marcações no job (`date +%s`) e calcular delta. Ganho: identificar regressões de performance no pipeline.

- **Número de avisos de linter**: configurar upload de artefacto com saída do linter (por exemplo `stylelint --formatter json > stylelint.json`) e contar entradas. Ganho: quantificar dívida técnica e priorizar PRs que removem avisos.

- **Regressões abertas (PRs)**: usar o filtro de issues/PRs com label `regression` e contar no dashboard (GitHub search API) semanalmente. Ganho: medir impacto real no produto.

Exemplos rápidos

1) Medir tempo localmente (rápido):
```bash
# time the guardrail step
SECONDS=0; date +%s > /tmp/start && npm run guardrail:l3-l4; date +%s > /tmp/end; echo "delta=$(( $(cat /tmp/end) - $(cat /tmp/start) ))s";
```

2) Coleta no CI (recomendado): adicionar etapas no workflow para salvar saídas de linter e `guardrail` como artefatos (já presente em `ci.yml` para guardrails). Use `jq` para contar avisos:
```bash
jq '.results | length' stylelint.json
```

Como usar essas métricas
- Priorizar PRs que reduzem avisos linter graves primeiro.
- Investigar aumentos de tempo CI por mudança e otimizar (caching, mover checks para nightly).
- Tratar regressões abertas com label e objetivo de 7 dias para resolução.

Observação: esta é uma abordagem pragmática — não é um sistema de observabilidade completo, mas entrega sinais suficientes para priorizar trabalho incremental.

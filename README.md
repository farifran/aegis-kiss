# Aegis KISS

Ferramenta **local-first para IDEs com agentes de IA** que reduz desperdício de tokens e evita alucinação/sobre-engenharia fazendo localmente tudo o que é mecânico (0 tokens, milissegundos):

1. **Antes da IA pensar (`./aegis brief`):** analisa `src/` via TypeScript Compiler API, ranqueia símbolos/arquivos relevantes (com léxico bilíngue e *Directory Anchor Fallback*) e gera `.harness/runtime/brief.md` compacto — evitando 5–10 buscas cegas no chat da IDE.
2. **Antes de codar (`./aegis verify-contract`):** valida mecanicamente o contrato curto `.harness/runtime/contract.md` (caminhos reais, faixas `src/arquivo.ts:Ln-Lm`, fronteira `src/`, zero `[PENDENTE]`, cenários `Dado / Quando / Então`).
3. **Depois da implementação autorizada (`./aegis check`):** verifica `git diff` contra o escopo do contrato + `tsc --noEmit` + `eslint` + 20 regras `ast-grep` ([static_gate.sh](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/substrates/static_gate.sh)) + testes reais de produto, devolvendo saída ultra-compacta para o chat.

---

## Fluxo na IDE (4 Passos)

```bash
# 1. Gerar briefing compacto de src/ (0 tokens)
./aegis brief "Sua demanda em linguagem natural"
# ou a partir de uma issue do GitHub / arquivo local:
./aegis --issue 42
./aegis --issue caminho/para/issue.md

# 2. Na IDE: o agente lê .harness/runtime/brief.md, pergunta apenas lacunas
#    materiais (se houver) e escreve .harness/runtime/contract.md (~1 página).

# 3. Validar o contrato mecanicamente (0 tokens)
./aegis verify-contract

# 4. Após sua aprovação explícita e implementação dos testes + código:
./aegis check
```

### Outros comandos e modo rápido

```bash
# Modo rápido para bugs triviais (trava de escopo em src/ sem precisar de contract.md)
./aegis check --allow src/risk/velocity_guard.ts

# Hook de pré-edição para IDEs (exit 0 só se o caminho estiver em src/ e autorizado)
./aegis guard-path src/risk/velocity_guard.ts

./aegis status          # Estado atual de brief, contract.md e frescor de src/
./aegis clean           # Limpa .harness/runtime/ (preserva src/ e lexicon.json)
./aegis help            # Lista opções (--json, --files, --allow, --allow-outside, --skip-diff)
```

*(Opcional — `git pre-commit` hook automático apenas quando houver contrato ativo:)*
```bash
# em .git/hooks/pre-commit:
[ -f .harness/runtime/contract.md ] && ./aegis check
```

---

## Formato Esperado de `.harness/runtime/contract.md`

Um contrato enxuto de ~1 página contendo:
- `## Escopo` (o que entra, o que fica de fora e o que foi podado por KISS)
- `## Arquivos` (caminhos em `src/` autorizados; marque arquivos novos com `[novo]`)
- `## Decisões` (escolhas humanas tomadas, se houve ambiguidade)
- `## Casos de prova` (ao menos 2 cenários `Dado / Quando / Então` cobrindo sucesso e falha/limite)

---

## Estrutura do Projeto

- [`aegis`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/aegis) / [`scripts/ide_gateway.sh`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/ide_gateway.sh) / [`scripts/aegis_cli.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/aegis_cli.mjs): entrada CLI enxuta.
- [`scripts/lib/workspace_skeleton.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/workspace_skeleton.mjs): extrator AST TypeScript oficial (assinaturas públicas, tipos, constantes e linhas, sem corpos).
- [`scripts/lib/workspace_observer.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/workspace_observer.mjs): varredura segura de `src/`, cache de skeleton e frescor por digest.
- [`scripts/lib/source_evidence.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/source_evidence.mjs) + [`.harness/config/lexicon.json`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/.harness/config/lexicon.json): ranking por afinidade AST + léxico bilíngue + recorte de cabeçalhos e janelas.
- [`scripts/lib/topography.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/topography.mjs): mapa topográfico panorâmico (`< 4 KB`) sob silêncio léxico em repositórios grandes.
- [`scripts/lib/brief_renderer.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/brief_renderer.mjs): montagem de cobertura de evidência e renderização de `brief.md`.
- [`scripts/lib/contract_verifier.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/contract_verifier.mjs): verificação mecânica de `contract.md` e referências `path:Ln-Lm`.
- [`scripts/lib/product_checker.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/product_checker.mjs) + [`scripts/substrates/static_gate.sh`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/substrates/static_gate.sh): verificação pós-implementação (`git diff`, `tsc`, `eslint`, 20 regras `ast-grep`, testes de produto).

## Scripts NPM

```bash
npm test                     # Suíte de testes do Aegis (skeleton, intake, discovery e CLI)
npm run aegis:verify-structure  # tsc + eslint + static_gate.sh sobre src/
npm run aegis:bench          # Mede tamanho e latência do brief.md nos 11 cenários D1..D11
```

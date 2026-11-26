# Aegis KISS

Ferramenta **local-first para IDEs com agentes de IA** que reduz desperdício de tokens e bloqueia alucinação, deriva de escopo e sobre-engenharia executando localmente tudo o que é mecânico (0 tokens, milissegundos):

1. **Antes da IA pensar (`./aegis brief`):** analisa o código via TypeScript Compiler API, ranqueia símbolos/arquivos relevantes (léxico bilíngue, *Directory Anchor Fallback*, janelas por bloco AST inteiro, imports diretos de 1 salto incluindo `paths` do `tsconfig.json`, e chamadores via AST real sem falsos positivos em comentários/strings) e gera `.harness/runtime/brief.md` compacto e numerado por linha — evitando 5–10 buscas cegas no chat.
2. **Antes de codar (`./aegis verify-contract`):** valida mecanicamente o contrato curto `.harness/runtime/contract.md` (seções obrigatórias, fronteira `src/`, zero `[PENDENTE]`, cenários `Dado / Quando / Então`, existência física de `src/arquivo.ts:Ln-Lm` e presença do símbolo citado na linha).
3. **Depois da implementação autorizada (`./aegis check`):** vigia **todo o `git status`** garantindo fronteira estrita em `src/` (bloqueando alterações não autorizadas inclusive em `eslint.config.js`, `tsconfig.json`, `package.json`, `scripts/*`), roda `tsc --noEmit`, `eslint`, 20 regras `ast-grep` ([static_gate.sh](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/substrates/static_gate.sh)) e **exige testes reais em `src/**/*.test.*`** cobrindo os cenários (`AC-*`) do contrato, devolvendo saída ultra-compacta para o chat.

---

## Fluxo na IDE (4 Passos)

```bash
# 1. Gerar briefing compacto e numerado do código local (0 tokens)
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

### Modo rápido, hooks de IDE e outros comandos

```bash
# Modo rápido para bugs triviais (trava de escopo em src/ sem precisar de contract.md)
./aegis check --allow src/risk/velocity_guard.ts

# Exceção humana explícita para arquivo fora de src/ (ex.: migration ou package.json)
./aegis check --allow-outside package.json

# Hook de pré-edição para IDEs (exit 0 só se o caminho estiver em src/ e autorizado, ou for contract.md)
./aegis guard-path src/risk/velocity_guard.ts

# Estado, limpeza e ajuda
./aegis status          # Estado atual de brief, contract.md e frescor de src/
./aegis clean           # Limpa .harness/runtime/ (preserva src/ e lexicon.json)
./aegis help            # Lista opções (--json, --files, --allow, --allow-outside, --skip-diff)
```

*(Opcional — `git pre-commit` hook automático apenas quando houver contrato ativo:)*
```bash
# em .git/hooks/pre-commit:
[ -f .harness/runtime/contract.md ] && ./aegis check
```

*(Opcional — repositórios cuja raiz de código não seja `src/`: o Aegis autodetecta `app/` e `lib/` quando `src/` não existe, ou aceita `AEGIS_SRC_DIRS=src,packages/core/src`.)*

---

## Formato Esperado de `.harness/runtime/contract.md`

Um contrato enxuto de ~1 página contendo:
- `## Escopo` (o que entra, o que fica de fora e o que foi podado por KISS)
- `## Arquivos` (caminhos em `src/` autorizados; marque arquivos novos com `[novo]`)
- `## Decisões` (escolhas humanas tomadas, se houve ambiguidade)
- `## Casos de prova` (ao menos 2 cenários `Dado / Quando / Então` cobrindo sucesso e falha/limite; IDs como `AC-1`, `AC-2` passam a ser cobrados automaticamente nos testes pelo `./aegis check`)

---

## Estrutura do Projeto

- [`aegis`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/aegis) / [`scripts/ide_gateway.sh`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/ide_gateway.sh) / [`scripts/aegis_cli.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/aegis_cli.mjs): entrada CLI enxuta.
- [`scripts/lib/workspace_skeleton.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/workspace_skeleton.mjs): extrator AST TypeScript oficial (assinaturas públicas, compactação de `const` gigantes, imports reais e linhas de identificadores via AST).
- [`scripts/lib/workspace_observer.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/workspace_observer.mjs): varredura segura (anti-symlink, skip de arquivos `> 256 KB`, multi-raiz `src`/`app`/`lib`), cache de skeleton e frescor por digest.
- [`scripts/lib/source_evidence.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/source_evidence.mjs) + [`.harness/config/lexicon.json`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/.harness/config/lexicon.json): ranking por afinidade AST + léxico bilíngue + preservação de cabeçalhos e janelas por bloco AST inteiro.
- [`scripts/lib/topography.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/topography.mjs): mapa topográfico panorâmico (`< 4 KB`) sob silêncio léxico em repositórios grandes.
- [`scripts/lib/brief_renderer.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/brief_renderer.mjs): cobertura de evidência, 1-hop imports (incluindo `tsconfig.json` `paths`), chamadores via AST e renderização numerada de `brief.md`.
- [`scripts/lib/contract_verifier.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/contract_verifier.mjs): verificação mecânica de `contract.md`, referências `path:Ln-Lm`, símbolos nas linhas citadas e extração de `AC-*`.
- [`scripts/lib/path_guard.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/path_guard.mjs): validador de permissão de caminho para hooks de pré-edição de IDEs (`./aegis guard-path`).
- [`scripts/lib/product_checker.mjs`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/lib/product_checker.mjs) + [`scripts/substrates/static_gate.sh`](file:///Users/rafaelfarias/Documents/IDE/aegis%20kiss/scripts/substrates/static_gate.sh): verificação pós-implementação (fronteira estrita `src/` sobre todo o `git status`, `tsc`, `eslint`, 20 regras `ast-grep`, testes obrigatórios e cobertura `AC-*`).

## Scripts NPM

```bash
npm test                        # Suíte de testes do Aegis (skeleton, intake, discovery, guard e CLI)
npm run aegis:verify-structure  # tsc + eslint + static_gate.sh sobre src/
npm run aegis:check             # Atalho para ./aegis check
npm run aegis:bench             # Mede tamanho e latência do brief.md em cenários de referência
```

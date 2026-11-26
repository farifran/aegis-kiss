# Aegis KISS

**Harness local-first para IDEs com agentes de IA.** Ele realiza uma busca local, determinística e enxuta do repositório para facilitar o trabalho da IA e reduzir alucinações; combina disciplina de execução ([`AGENTS.md`](AGENTS.md)) e restrições técnicas do software ([`ARCHITECTURE.md`](ARCHITECTURE.md)) mantendo o contexto limpo e com menor degradação (*context rot*); e impõe verificações e limites mecânicos locais (0 tokens, milissegundos) para estruturar a colaboração humano–IA em torno de escopo, arquitetura e provas executáveis — preservando a revisão humana como juiz final da lógica.

1. **Antes da IA pensar (`./aegis brief`):** analisa o código via TypeScript Compiler API, injeta integralmente as regras compactas de [`ARCHITECTURE.md`](ARCHITECTURE.md) (1 linha por regra: ex. sem framework, SQLite, bitmask, centavos inteiros, tempo determinístico), ranqueia símbolos/arquivos relevantes (léxico bilíngue, *Directory Anchor Fallback*, janelas por bloco AST inteiro, imports diretos de 1 salto incluindo `paths` do `tsconfig.json`, e chamadores via AST real) e gera `.harness/runtime/brief.md` compacto, numerado por linha e com isolamento de fences Markdown — evitando 5–10 buscas cegas no chat.
2. **Antes de codar (`./aegis verify-contract`):** valida mecanicamente o contrato curto `.harness/runtime/contract.md` (seções obrigatórias, fronteira unificada sobre as raízes de produto sem arquivos fora de `src/` nem diretórios genéricos, regras `hard` de `ARCHITECTURE.md` como `DETERMINISTIC-TIME`, zero `[PENDENTE]`, cenários `Dado / Quando / Então`, existência física de `path:Ln-Lm` e presença do símbolo citado na linha) e grava o selo de integridade `.harness/runtime/contract-verified.json` exigido pelo `./aegis guard-path`.
3. **Depois da implementação autorizada (`./aegis check`):** vigia **todo o `git status`** (`--porcelain -z -uall`, anti-symlink, origem e destino em renames e *fail-closed* sem git, `contract.md` ou `--allow`) garantindo fronteira estrita nas raízes de produto (bloqueando alterações não autorizadas inclusive em `eslint.config.js`, `tsconfig.json`, `package.json`, `scripts/*` e edição/exclusão de testes alheios), roda `tsc --noEmit`, `eslint` type-aware (incluindo `DETERMINISTIC-TIME`, `only-throw-error`, `no-duplicate-imports`, `no-eval`, `no-explicit-any`), verificações estáticas puras em Node/AST (imports não declarados respeitando `tsconfig.json` `paths` + scanner de segredos hardcoded), executa toda a suíte em `src/**/*.test.*` e **exige casos ativos (`test()`/`it()`/`t.test()`, sem callbacks ou `describe` vazios, comentários, `.skip` nem `{ skip/todo: true }`) nos arquivos de teste adicionados/modificados** cobrindo os cenários (`AC-*` com *word-boundary*) do contrato, devolvendo saída ultra-compacta para o chat.

---

## Governança em 3 Camadas (`AGENTS.md` + `ARCHITECTURE.md` + Harness)

Em vez de misturar postura do agente, regras de arquitetura do software e comandos de build em um único arquivo gigante (`.cursorrules` / `CLAUDE.md`) e torcer para o modelo se auto-regular, o Aegis separa a governança em **3 camadas complementares**:

| Camada | Arquivo / Superfície | Papel no Sistema | Inspiração |
| :--- | :--- | :--- | :--- |
| **1. Disciplina Cognitiva** | [`AGENTS.md`](AGENTS.md) | Governa *como* a IA pensa e age: pensar antes de codar, evidência sobre suposição, simplicidade (KISS), perguntar só lacunas materiais e exigir provas `Dado / Quando / Então` antes de tocar `src/`. | `andrej-karpathy-skills` (*Think Before Coding*, *Simplicity First*, *Surgical Changes*, *Goal-Driven Execution*) |
| **2. Restrições do Software** | [`ARCHITECTURE.md`](ARCHITECTURE.md) | Define *o que este projeto específico permite, exige ou proíbe* (`hard` vs. `default`): ex. sem framework / native-first, SQLite, bitmask, centavos inteiros, imutabilidade, tempo determinístico. Lido dinamicamente pelo `./aegis brief` sem espelho JSON. | [DietrichGebert/ponytail](https://github.com/dietrichgebert/ponytail) (*native-first*, reuso, zero sobre-engenharia, código mínimo suficiente) |
| **3. Verificação Mecânica** | `./aegis` + [`eslint.config.js`](eslint.config.js) | Impõe de forma determinística (0 tokens) o que texto de prompt sozinho não garante: contexto AST exato, bloqueio *fail-closed* de edição fora de `src/`, `tsc`, `eslint` type-aware, checagem AST de imports/segredos e vínculo obrigatório contrato ↔ testes ativos (`AC-*`). | Análise estática local + fronteira de execução |

### Por que essa separação funciona melhor na IDE

- **Prompts menores e melhor aproveitamento de KV-Cache:** [`AGENTS.md`](AGENTS.md) permanece curto (23 linhas) e invariante entre tarefas, maximizando cache de prefixo na IDE; o contexto específico de `src/` e as regras pertinentes de [`ARCHITECTURE.md`](ARCHITECTURE.md) entram sob demanda no `brief.md`.
- **Regras do projeto compactas e sempre presentes:** [`ARCHITECTURE.md`](ARCHITECTURE.md) usa formato telegráfico de 1 linha por regra (`- \`ID\` [hard|default]: ...`), pesando ~180 tokens no total para injetar **100%** das restrições do software no `brief.md` sem heurística nem falsos negativos. Regras `hard` impedem violações silenciosas; regras `default` abrem deliberação explícita com o humano quando a demanda pede exceção.
- **Fim da auto-regulação cega:** diretrizes como *Karpathy* e *PonyTail* melhoram muito o raciocínio do modelo, mas em prompt puro continuam probabilísticas. O harness fecha o ciclo cobrando mecanicamente escopo (`git status`), análise estática (`tsc` + `eslint` + AST) e provas executáveis (`src/**/*.test.*`).
- **Workflow objetivo para o desenvolvedor:** além de impor limites à IA, o fluxo (`brief` → contrato curto → `check`) estrutura como o dev conduz o agente — trocando tentativa e erro (*vibe coding*) por deliberação explícita de ambiguidades antes do código e liberando a revisão humana do trabalho mecânico para focar apenas em design e lógica de negócio.
- **Portabilidade entre projetos e IDEs (em evolução):** [`AGENTS.md`](AGENTS.md) e o CLI operam de forma agnóstica à IDE, separando as regras específicas do produto em [`ARCHITECTURE.md`](ARCHITECTURE.md) (e opcionalmente [`.harness/config/lexicon.json`](.harness/config/lexicon.json)). Hoje o harness ainda roda acoplado ao repositório; a meta de distribuição é empacotá-lo como ferramenta instalável (CLI reutilizável entre repositórios sem copiar `scripts/`).

---

## Fluxo na IDE (4 Passos)

```bash
# 1. Gerar briefing compacto e numerado do código local + lente de ARCHITECTURE.md (0 tokens)
./aegis brief "Sua demanda em linguagem natural"
# ou a partir de uma issue do GitHub / arquivo local:
./aegis --issue 42
./aegis --issue caminho/para/issue.md

# 2. Na IDE: o agente lê .harness/runtime/brief.md, pergunta apenas lacunas
#    materiais ou conflitos arquiteturais (se houver) e escreve .harness/runtime/contract.md (~1 página).

# 3. Validar o contrato mecanicamente (0 tokens)
./aegis verify-contract

# 4. Após sua aprovação explícita e implementação dos testes + código:
./aegis check
```

### Modo rápido, hooks de IDE e outros comandos

```bash
# Modo rápido para bugs triviais (trava de escopo em src/ sem precisar de contract.md)
./aegis check --allow src/meu_modulo.ts

# Exceção humana explícita para arquivo fora de src/ (ex.: migration ou package.json)
./aegis check --allow-outside package.json

# Hook de pré-edição para IDEs (exit 0 só para contract.md ou caminho em src/ autorizado via --allow ou contract.md já validado por verify-contract)
./aegis guard-path src/meu_modulo.ts

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

*(Opcional — repositórios cuja raiz de código não seja `src/`: o Aegis autodetecta `app/` e `lib/` quando `src/` não existe, ou aceita `AEGIS_SRC_DIRS=src,packages/core/src`, propagando as mesmas raízes para [`eslint.config.js`](eslint.config.js).)*

---

## Formato Esperado de `.harness/runtime/contract.md`

Um contrato enxuto de ~1 página contendo:
- `## Escopo` (o que entra, o que fica de fora e o que foi podado por KISS)
- `## Arquivos` (caminhos em `src/` autorizados; marque arquivos novos com `[novo]`)
- `## Decisões` (escolhas humanas tomadas, se houve ambiguidade ou exceção arquitetural)
- `## Casos de prova` (ao menos 2 cenários `Dado / Quando / Então` cobrindo sucesso e falha/limite; IDs como `AC-1`, `AC-2` passam a ser cobrados automaticamente nos testes pelo `./aegis check`)

---

## Estrutura do Projeto

- [`aegis`](aegis) / [`scripts/aegis_cli.mjs`](scripts/aegis_cli.mjs): entrada CLI única e enxuta.
- [`scripts/lib/architecture_rules.mjs`](scripts/lib/architecture_rules.mjs): leitor enxuto (~50 LOC) das regras de 1 linha em `ARCHITECTURE.md` para injeção no `brief.md` e verificação de regras `hard` no `verify-contract`.
- [`scripts/lib/workspace_skeleton.mjs`](scripts/lib/workspace_skeleton.mjs): extrator AST TypeScript oficial (assinaturas públicas, compactação de `const` gigantes, aliases de `tsconfig.json`, imports reais, linhas de identificadores e casos de teste ativos via AST).
- [`scripts/lib/workspace_observer.mjs`](scripts/lib/workspace_observer.mjs): varredura segura (anti-symlink real, bloqueio de diretórios de governança, skip de arquivos `> 256 KB`, multi-raiz `src`/`app`/`lib`), cache de skeleton e frescor por digest.
- [`scripts/lib/source_evidence.mjs`](scripts/lib/source_evidence.mjs) + [`.harness/config/lexicon.json`](.harness/config/lexicon.json): ranking por afinidade AST + léxico bilíngue + preservação de cabeçalhos e janelas por bloco AST inteiro.
- [`scripts/lib/topography.mjs`](scripts/lib/topography.mjs): mapa topográfico panorâmico (`< 4 KB`) sob silêncio léxico em repositórios grandes.
- [`scripts/lib/brief_renderer.mjs`](scripts/lib/brief_renderer.mjs): cobertura de evidência, lente arquitetural, 1-hop imports (incluindo `tsconfig.json` `paths`), chamadores via AST e renderização numerada de `brief.md` com cercas Markdown dinâmicas.
- [`scripts/lib/contract_verifier.mjs`](scripts/lib/contract_verifier.mjs): verificação mecânica de `contract.md`, referências `path:Ln-Lm`, símbolos nas linhas citadas, fronteira de governança, regras `hard` e extração de `AC-*`.
- [`scripts/lib/path_guard.mjs`](scripts/lib/path_guard.mjs): validador *fail-closed* e anti-symlink para hooks de pré-edição de IDEs (`./aegis guard-path`).
- [`scripts/lib/product_checker.mjs`](scripts/lib/product_checker.mjs) + [`eslint.config.js`](eslint.config.js): verificação pós-implementação (fronteira estrita *fail-closed* sobre todo o `git status -z -uall` incluindo renames, `tsc`, `eslint` type-aware, checagem AST de imports/segredos, testes ativos obrigatórios e cobertura `AC-*`).

## Scripts NPM

```bash
npm test                        # Suíte de testes isolados do harness (skeleton, intake, discovery, guard e CLI)
npm run aegis:verify-structure  # tsc + eslint + verificações estáticas AST sobre src/
npm run aegis:check             # Atalho para ./aegis check
```

## Notas de Manutenção e Simplificação Futura (Backlog)

- **Distribuição instalável e `./aegis init` (portabilidade):** empacotar o Aegis como CLI instalável (ex.: pacote `npm`/`npx`) que entra no repositório do projeto (e não o contrário), reutilizando `node_modules`, `tsconfig`, `eslint` e runner de testes já existentes do produto. O `./aegis init` deve autodetectar `package.json` (runner `vitest`/`jest`/`bun`/`node --test`, scripts de `typecheck`/`lint` e `protectedPaths`) para gerar `.harness/config/project.json` sem copiar `scripts/` nem fundir configs manualmente. O Aegis **não** deve rodar `npm install` por conta própria (preserva determinismo e zero rede oculta), mas pode emitir aviso *pre-flight* de 1 linha no `./aegis status`/`./aegis check` se `node_modules` do projeto estiver ausente.
- **Poda potencial do motor de ranking (`source_evidence.mjs`, ~860 LOC):** [`scripts/lib/source_evidence.mjs`](scripts/lib/source_evidence.mjs) é o maior arquivo do harness e concentra heurísticas de IDF, stemmer de 4 letras e janelas AST. Após coletar dados reais em um projeto de 50–300 arquivos, avaliar se o ganho de tokens/precisão sobre busca nativa da IDE compensa sua complexidade; se não compensar, substituir por um `brief` muito menor (regras de `ARCHITECTURE.md` + índice/skeleton enxuto) ou manter apenas o núcleo de governança (`verify-contract` + `guard-path` + `check`).
- **Enxugar `collectDirectCallers` (`brief_renderer.mjs`):** hoje re-parseia via TypeScript AST todos os arquivos observados a cada `./aegis brief` (contornando o cache de `workspace_skeleton.json`). Em repositórios maiores, ou passa a ser cacheado/incremental ou pode ser removido se a IDE/LSP já cobrir navegação de chamadores melhor.
- **Reavaliar `.harness/config/lexicon.json` e `topography.mjs`:** se o projeto real operar em um único idioma ou sem silêncio léxico recorrente, o léxico manual e o mapa topográfico podem ser removidos sem perda funcional.
- **Desacoplar runner de testes e `ARCHITECTURE.md`:** permitir configurar o comando de testes do produto (Vitest, Jest, Bun, etc., em vez de fixar `node --import tsx --test`) e, se surgir necessidade real, adicionar diretivas declarativas curtas em `ARCHITECTURE.md` (ex.: `forbid-import`) + regras ESLint nativas (`explicit-module-boundary-types`, bloqueio de `Date()`/`performance.now()`).
- **Novos ajustes de intake/discovery:** manter o harness congelado até o uso no projeto real apontar fricção concreta (ex.: `tsconfig.json` com `"extends"`, extração de frames de stacktrace em `--issue` ou leitura via `stdin`).

---

## Referências e Inspirações

- **[DietrichGebert/ponytail](https://github.com/dietrichgebert/ponytail):** disciplina *native-first*, reuso do código/stdlib existente e código mínimo suficiente refletida em [`ARCHITECTURE.md`](ARCHITECTURE.md) e nas regras AST.
- **`andrej-karpathy-skills`:** princípios pragmáticos de engenharia com LLMs (*Think Before Coding*, *Simplicity First*, *Surgical Changes* e *Goal-Driven Execution*) refletidos em [`AGENTS.md`](AGENTS.md) e verificados mecanicamente pelo harness.

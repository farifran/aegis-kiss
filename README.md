# Aegis KISS

**Harness local-first para IDEs com agentes de IA.** Ele realiza uma busca local, determinística e enxuta do repositório para facilitar o trabalho da IA e reduzir alucinações; combina disciplina de execução ([`AGENTS.md`](AGENTS.md)) e restrições técnicas do software ([`ARCHITECTURE.md`](ARCHITECTURE.md)) mantendo o contexto limpo e com menor degradação (*context rot*); e impõe verificações e limites mecânicos locais (0 tokens, milissegundos) para estruturar a colaboração humano–IA em torno de escopo, arquitetura e provas executáveis — preservando a revisão humana como juiz final da lógica.

1. **Antes da IA pensar (`./aegis brief`):** analisa o código via TypeScript Compiler API, injeta integralmente as regras compactas de [`ARCHITECTURE.md`](ARCHITECTURE.md) (1 linha por regra: ex. sem framework, SQLite, bitmask, centavos inteiros, tempo determinístico), ranqueia símbolos/arquivos relevantes (léxico bilíngue, *Directory Anchor Fallback*, janelas por bloco AST inteiro, imports diretos de 1 salto incluindo `paths` do `tsconfig.json`, e chamadores via AST real) e gera `.harness/runtime/brief.md` compacto e numerado por linha — evitando 5–10 buscas cegas no chat.
2. **Antes de codar (`./aegis verify-contract`):** valida mecanicamente o contrato curto `.harness/runtime/contract.md` (seções obrigatórias, fronteira `src/`, regras `hard` de `ARCHITECTURE.md` como `DETERMINISTIC-TIME`, zero `[PENDENTE]`, cenários `Dado / Quando / Então`, existência física de `src/arquivo.ts:Ln-Lm` e presença do símbolo citado na linha).
3. **Depois da implementação autorizada (`./aegis check`):** vigia **todo o `git status`** garantindo fronteira estrita em `src/` (bloqueando alterações não autorizadas inclusive em `eslint.config.js`, `tsconfig.json`, `package.json`, `scripts/*`), roda `tsc --noEmit`, `eslint`, 21 regras `ast-grep` ([static_gate.sh](scripts/substrates/static_gate.sh), incluindo `no-implicit-clock` para `Date.now()`/`new Date()`) e **exige testes reais em `src/**/*.test.*`** cobrindo os cenários (`AC-*`) do contrato, devolvendo saída ultra-compacta para o chat.

---

## Governança em 3 Camadas (`AGENTS.md` + `ARCHITECTURE.md` + Harness)

Em vez de misturar postura do agente, regras de arquitetura do software e comandos de build em um único arquivo gigante (`.cursorrules` / `CLAUDE.md`) e torcer para o modelo se auto-regular, o Aegis separa a governança em **3 camadas complementares**:

| Camada | Arquivo / Superfície | Papel no Sistema | Inspiração |
| :--- | :--- | :--- | :--- |
| **1. Disciplina Cognitiva** | [`AGENTS.md`](AGENTS.md) | Governa *como* a IA pensa e age: pensar antes de codar, evidência sobre suposição, simplicidade (KISS), perguntar só lacunas materiais e exigir provas `Dado / Quando / Então` antes de tocar `src/`. | `andrej-karpathy-skills` (*Think Before Coding*, *Simplicity First*, *Surgical Changes*, *Goal-Driven Execution*) |
| **2. Restrições do Software** | [`ARCHITECTURE.md`](ARCHITECTURE.md) | Define *o que este projeto específico permite, exige ou proíbe* (`hard` vs. `default`): ex. sem framework / native-first, SQLite, bitmask, centavos inteiros, imutabilidade, tempo determinístico. Lido dinamicamente pelo `./aegis brief` sem espelho JSON. | [DietrichGebert/ponytail](https://github.com/dietrichgebert/ponytail) (*native-first*, reuso, zero sobre-engenharia, código mínimo suficiente) |
| **3. Verificação Mecânica** | `./aegis` + `.harness/enforcement/rules/` | Impõe de forma determinística (0 tokens) o que texto de prompt sozinho não garante: contexto AST exato, bloqueio de edição fora de `src/`, 21 regras `ast-grep`, `tsc`, `eslint` e vínculo obrigatório contrato ↔ testes (`AC-*`). | Análise estática local + fronteira de execução |

### Por que essa separação funciona melhor na IDE

- **Prompts menores e melhor aproveitamento de KV-Cache:** [`AGENTS.md`](AGENTS.md) permanece curto (~28 linhas) e invariante entre tarefas, maximizando cache de prefixo na IDE; o contexto específico de `src/` e as regras pertinentes de [`ARCHITECTURE.md`](ARCHITECTURE.md) entram sob demanda no `brief.md`.
- **Regras do projeto compactas e sempre presentes:** [`ARCHITECTURE.md`](ARCHITECTURE.md) usa formato telegráfico de 1 linha por regra (`- \`ID\` [hard|default]: ...`), pesando ~180 tokens no total para injetar **100%** das restrições do software no `brief.md` sem heurística nem falsos negativos. Regras `hard` impedem violações silenciosas; regras `default` abrem deliberação explícita com o humano quando a demanda pede exceção.
- **Fim da auto-regulação cega:** diretrizes como *Karpathy* e *PonyTail* melhoram muito o raciocínio do modelo, mas em prompt puro continuam probabilísticas. O harness fecha o ciclo cobrando mecanicamente escopo (`git status`), qualidade AST (`static_gate.sh`) e provas executáveis (`src/**/*.test.*`).
- **Workflow objetivo para o desenvolvedor:** além de impor limites à IA, o fluxo (`brief` → contrato curto → `check`) estrutura como o dev conduz o agente — trocando tentativa e erro (*vibe coding*) por deliberação explícita de ambiguidades antes do código e liberando a revisão humana do trabalho mecânico para focar apenas em design e lógica de negócio.
- **Portabilidade entre projetos e IDEs:** [`AGENTS.md`](AGENTS.md) e o CLI funcionam igual em qualquer IDE; para adaptar o Aegis a outro software, basta atualizar as regras do produto em [`ARCHITECTURE.md`](ARCHITECTURE.md) (e opcionalmente [`.harness/config/lexicon.json`](.harness/config/lexicon.json)).

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
- `## Decisões` (escolhas humanas tomadas, se houve ambiguidade ou exceção arquitetural)
- `## Casos de prova` (ao menos 2 cenários `Dado / Quando / Então` cobrindo sucesso e falha/limite; IDs como `AC-1`, `AC-2` passam a ser cobrados automaticamente nos testes pelo `./aegis check`)

---

## Estrutura do Projeto

- [`aegis`](aegis) / [`scripts/ide_gateway.sh`](scripts/ide_gateway.sh) / [`scripts/aegis_cli.mjs`](scripts/aegis_cli.mjs): entrada CLI enxuta.
- [`scripts/lib/architecture_rules.mjs`](scripts/lib/architecture_rules.mjs): leitor enxuto (~50 LOC) das regras de 1 linha em `ARCHITECTURE.md` para injeção no `brief.md` e verificação de regras `hard` no `verify-contract`.
- [`scripts/lib/workspace_skeleton.mjs`](scripts/lib/workspace_skeleton.mjs): extrator AST TypeScript oficial (assinaturas públicas, compactação de `const` gigantes, imports reais e linhas de identificadores via AST).
- [`scripts/lib/workspace_observer.mjs`](scripts/lib/workspace_observer.mjs): varredura segura (anti-symlink, skip de arquivos `> 256 KB`, multi-raiz `src`/`app`/`lib`), cache de skeleton e frescor por digest.
- [`scripts/lib/source_evidence.mjs`](scripts/lib/source_evidence.mjs) + [`.harness/config/lexicon.json`](.harness/config/lexicon.json): ranking por afinidade AST + léxico bilíngue + preservação de cabeçalhos e janelas por bloco AST inteiro.
- [`scripts/lib/topography.mjs`](scripts/lib/topography.mjs): mapa topográfico panorâmico (`< 4 KB`) sob silêncio léxico em repositórios grandes.
- [`scripts/lib/brief_renderer.mjs`](scripts/lib/brief_renderer.mjs): cobertura de evidência, lente arquitetural, 1-hop imports (incluindo `tsconfig.json` `paths`), chamadores via AST e renderização numerada de `brief.md`.
- [`scripts/lib/contract_verifier.mjs`](scripts/lib/contract_verifier.mjs): verificação mecânica de `contract.md`, referências `path:Ln-Lm`, símbolos nas linhas citadas, regras `hard` e extração de `AC-*`.
- [`scripts/lib/path_guard.mjs`](scripts/lib/path_guard.mjs): validador de permissão de caminho para hooks de pré-edição de IDEs (`./aegis guard-path`).
- [`scripts/lib/product_checker.mjs`](scripts/lib/product_checker.mjs) + [`scripts/substrates/static_gate.sh`](scripts/substrates/static_gate.sh): verificação pós-implementação (fronteira estrita `src/` sobre todo o `git status`, `tsc`, `eslint`, 21 regras `ast-grep`, testes obrigatórios e cobertura `AC-*`).

## Scripts NPM

```bash
npm test                        # Suíte de testes do Aegis (skeleton, intake, discovery, guard e CLI)
npm run aegis:verify-structure  # tsc + eslint + static_gate.sh sobre src/
npm run aegis:check             # Atalho para ./aegis check
npm run aegis:bench             # Mede tamanho e latência do brief.md em cenários de referência
```

---

## Referências e Inspirações

- **[DietrichGebert/ponytail](https://github.com/dietrichgebert/ponytail):** disciplina *native-first*, reuso do código/stdlib existente e código mínimo suficiente refletida em [`ARCHITECTURE.md`](ARCHITECTURE.md) e nas regras AST.
- **`andrej-karpathy-skills`:** princípios pragmáticos de engenharia com LLMs (*Think Before Coding*, *Simplicity First*, *Surgical Changes* e *Goal-Driven Execution*) refletidos em [`AGENTS.md`](AGENTS.md) e verificados mecanicamente pelo harness.

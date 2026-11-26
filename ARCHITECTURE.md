# Arquitetura Técnica do Projeto

Este documento define as fronteiras e regras técnicas ativas para o produto em `src/` e para o harness local do Aegis.

## Fronteiras do Repositório

- **Produto (`src/`):** todo o código de produto reside em `src/`. Uma demanda de produto não altera o harness (`.harness/`, `scripts/`).
- **Runtime transitório (`.harness/runtime/`):** armazena apenas artefatos temporários de trabalho (`brief.md`, `brief-meta.json`, `contract.md`, `workspace_skeleton.json`). Não é fonte de verdade do produto.
- **Configuração local (`.harness/config/lexicon.json`):** léxico opcional de termos de domínio (`termo_negócio -> termo_código`) para descoberta determinística.
- **Core 100% local e determinístico:** o harness opera offline, sem rede nem provedores de LLM externos. A cognição ocorre no agente da própria IDE; a mecânica (AST, ranking, validação física, lint, typecheck, `ast-grep` e testes) roda localmente a custo zero de tokens.

## Regras Arquiteturais Ativas

### 1. Fronteira de Produto (`ARCH-PRODUCT-BOUNDARY` — hard)
Demandas de produto observam e citam exclusivamente `src/` (e seus testes). Caminhos externos ou sensíveis (`/etc/`, `../`, `.harness/`, `scripts/`) são proibidos como alvos de produto.

### 2. Parcimônia (`ARCH-PARSIMONY` — default)
Dependências externas, persistência, concorrência, factories, builders ou camadas extras só são admitidos quando um requisito observável justificar seu custo. A recomendação padrão é sempre a menor arquitetura suficiente.

### 3. Tipagem Estrita e Módulos Pequenos (`ARCH-STRICT-EXPLICIT-MODULES` — default)
Código TypeScript em `src/` usa tipagem estrita, funções com retorno explícito e APIs claras, sem `as any`, `@ts-ignore` ou supressões permissivas que escondam defeitos (verificado por `tsc`, `eslint` e `static_gate.sh`).

### 4. Falhas Explícitas (`ARCH-FAILURE-EXPLICIT` — hard)
Nenhuma falha relevante pode desaparecer silenciosamente (`catch` vazio, descarte silencioso ou truncamento implícito). Operações com estado ou efeito externo devem expor resultado, erro explícito, estado preservado ou rollback verificável.

### 5. Tempo Determinístico (`ARCH-DETERMINISTIC-TIME` — hard)
Comportamentos dependentes de tempo devem receber referência temporal explícita ou fonte reproduzível. Não acoplar lógica de domínio a `Date.now()` implícito sem autorização explícita.

### 6. Interface Pública e Transições Claras (`ARCH-PUBLIC-INTERFACE` — hard)
Funções públicas devem definir entradas, saídas, precedência de guardas e falhas observáveis. Detalhes internos continuam livres enquanto preservarem o contrato e os testes.

### 7. Verificação Real Pós-Implementação (`ARCH-EXECUTABLE-PROOF` — hard)
Contrato aprovado não comprova código correto. Toda implementação autorizada só fecha após passar no `./aegis check` (escopo no `git diff` + `tsc` + `eslint` + `static_gate.sh` + testes executáveis dos cenários `Dado / Quando / Então`).

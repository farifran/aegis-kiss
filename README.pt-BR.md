Idioma: [English](README.md) | [Português (Brasil)](README.pt-BR.md)

# Aegis Harness

Execução com soberania do runtime para engenharia de software assistida por IA.

O Aegis transforma uma demanda de código em um pipeline delimitado, inspecionável e composto por múltiplos modos. O runtime decide quais evidências são expostas, qual motor executa cada fase, quais arquivos podem ser alterados e se o patch candidato está pronto para promoção. Os modelos raciocinam estritamente sobre a carga útil (payload) que recebem; o Git é a única memória duradoura do projeto.

É um harness baseado prioritariamente em shell script, e não uma extensão de IDE ou um agente autônomo genérico. O Aider é utilizado como motor de mutação, enquanto o ciclo de vida, os perfis de evidência, as validações e os relatórios de resultados pertencem integralmente ao Aegis.

---

## Por que utilizar o Aegis

Ferramentas de código baseadas em IA geram alterações rapidamente, mas um fluxo de engenharia em produção exige respostas operacionais precisas:

- **Limite de Evidências:** O que o modelo teve permissão para visualizar?
- **Isolamento de Mutação:** Quais arquivos ele foi autorizado a modificar?
- **Alinhamento de Intenção:** O patch atendeu à demanda original e aos critérios de aceitação sem expandir o escopo?
- **Validações Determinísticas:** As verificações estáticas, compilação em TypeScript, linters, testes e análise adversária passaram?
- **Soberania Humana:** O operador pode inspecionar e aprovar o patch exato antes que ele faça parte do histórico do projeto?

O Aegis impõe esses limites de forma determinística em tempo de execução e registra cada decisão como artefatos de protocolo e histórico no Git.

---

## Arquitetura de Governança em 3 Camadas

O Aegis mantém uma separação estrita entre cognição do modelo, bloqueios mecânicos via AST e regras de código da aplicação:

1. **[`AGENTS.md`](AGENTS.md) — Contrato de Cognição do Modelo:** Governa a mente do modelo (como raciocinar a partir de evidências, ser direto, eliminar conversa fiada, não inventar fatos não expostos e seguir o KISS).
2. **`.harness/enforcement/rules/` — Portão Mecânico via AST:** Governa os bloqueios automatizados da máquina (regras de `ast-grep`). A máquina impede deterministicamente o código ruim (ex: uso de `any`, `eval`, promises não tratadas, exceções genéricas) via `npm run aegis:sanity` antes de qualquer revisão humana.
3. **[`src/ARCHITECTURE.md`](src/ARCHITECTURE.md) — Convenções da Aplicação Alvo:** O local exclusivo e autoritativo para o estilo de código da aplicação, convenções de nomenclatura (`kebab-case`), importações ESM NodeNext em TypeScript, fórmulas de escala para `BigInt`, encapsulamento estrito e padrões do PonyTail para o código fonte em `src/`.

---

## Princípios Cognitivos & Disciplina Karpathy

O Aegis opera sob um contrato constitucional definido no arquivo [`AGENTS.md`](AGENTS.md), inspirado nas regras pragmáticas de programação de Andrej Karpathy:

1. **RUNTIME AUTHORITY:** Interpretar apenas a autoridade explicitamente delegada pelo runtime. Não presumir permissões, conhecimento oculto do repositório, intenção ou estado além das capacidades e evidências fornecidas.
2. **EVIDENCE DISCIPLINE (Think Before Coding):** Raciocinar estritamente com base nas evidências expostas pelo runtime. Validar premissas explicitamente; nunca inventar fatos, preencher lacunas com especulação ou adivinhar contexto ausente.
3. **KISS & SURGICAL MUTATION (Simplicity First):** Preferir implementações explícitas, locais e determinísticas. Evitar superengenharia, abstrações especulativas, comportamentos ocultos ou generalização prematura. Realizar alterações mínimas e cirúrgicas.
4. **DIRECT PROTOCOL EMISSION:** Emitir artefatos técnicos estruturados e concisos, sem preâmbulos conversacionais, conversa fiada ou prosa desnecessária.
5. **ERROR & TYPE DISCIPLINE:** Garantir correção estrita de tipos, respeitar leis da linguagem, tratar edge cases explicitamente e evitar efeitos colaterais ou novas exportações não solicitadas.

---

## Gráfico de Execução e Modos

O pipeline padrão de mutação é executado em fases delimitadas:

```text
demanda
  │
  ├──► intake / fit check      (Expansão 8B via Supervisor + planejador de micro-unidades)
  ├──► discovery               (Apenas mecânico: lacunas e evidências necessárias)
  ├──► forensics               (Mecânico por padrão: seleção de arquivos alvo)
  ├──► repair                  (Mutação delimitada via Aider sob isolamento de caminho)
  ├──► optimize                (Conselho via LLM bruto: máximo de 1 ciclo de refinamento)
  ├──► adversarial             (Análise semântica adversária via LLM bruto)
  ├──► validation              (Tribunal mecânico: alinhamento de tokens/exportações)
  └──► promotion / commit gate (Portão de commit humano ou aprovação pendente)
```

### Visão Geral dos Modos do Pipeline

| Modo | Propósito | Motor Padrão | Contrato de Skill |
|---|---|---|---|
| `discovery` | Identificar lacunas no código, sondas e evidências necessárias | **Mecânico do runtime apenas** (sem LLM) | Mecânico `demand.sh` |
| `forensics` | Selecionar o menor conjunto de arquivos alvo para mutação | Mecânico por padrão; LLM em ambiguidades | `.skills/forensics.md` |
| `repair` | Produzir um patch candidato delimitado | Substrato de mutação Aider | `.skills/repair.md` |
| `optimize` | Sugerir uma melhoria comprovada ou prosseguir | LLM bruto (apenas conselho; sem edições) | `.skills/optimize.md` |
| `adversarial` | Desafiar premissas semânticas e casos de borda | LLM bruto (análise adversária) | `.skills/adversarial.md` |
| `validation` | Decidir se o patch atende à demanda e aos critérios | Tribunal mecânico (LLM opcional) | `.skills/validation.md` |

---

## Superfície de Capacidades Ativas

Os manipuladores de capacidade estão localizados em `scripts/capabilities/` e são registrados em `.harness/config.sh`:

| Capacidade | Manipulador | Propósito |
|---|---|---|
| `filesystem.list_tree` | `filesystem/list_tree.sh` | Inspeção da estrutura de diretórios |
| `filesystem.read` | `filesystem/read_file.sh` | Leitura de conteúdo de arquivos autorizados |
| `filesystem.search_symbol` | `filesystem/search_symbol.sh` | Busca delimitada de símbolos (`git grep`) |
| `git.status` | `git/git_status.sh` | Estado do repositório Git |
| `git.diff` | `git/git_diff.sh` | Inspeção de alterações preparadas / não preparadas |
| `runtime.layer0_facts` | `runtime/layer0_facts.sh` | Fatos fundamentais do runtime |
| `runtime.attention_seed` | `runtime/attention_seed.sh` | Definição de semente de atenção |
| `runtime.demand_anchors` | `runtime/demand_anchors.sh` | Materialização de âncoras da demanda |
| `typescript.check` | `typescript_check.sh` | Verificação do compilador TypeScript |
| `eslint.check` | `eslint_check.sh` | Verificação de qualidade estática via ESLint |
| `test.run` | `test_runner.sh` | Execução da suíte de testes automatizados |

---

## Guia Rápido (Quick Start)

### Pré-requisitos

- **Sistema Base:** Bash, Git, `jq`, `curl`, Python 3
- **Ambiente Node.js:** Node.js (v18+) e `npm`
- **Motor de Mutação (para reparações):** [Aider](https://aider.chat/) instalado e disponível no `$PATH`
- **Endpoint de LLM:** Endpoint compatível com a API da OpenAI (ex: OpenAI, vLLM, Ollama, etc.)
- **Fluxos do GitHub (opcional):** GitHub CLI (`gh`) para fluxos de intake baseados em `--issue`

### Instalação

Clone o repositório e instale as dependências do npm:

```bash
git clone https://github.com/farifran/aegis-kiss.git
cd "aegis kiss"
npm install
```

### Configuração do Ambiente

Crie o arquivo `.harness/local.env` (ignorado pelo Git) para configurar as credenciais do modelo e endpoints:

```bash
# Obrigatório: Credenciais da API compatível com OpenAI
OPENAI_API_BASE="https://seu-endpoint-compativel-openai/v1"
OPENAI_API_KEY="sua-chave-de-api"
OPENAI_MODEL_READONLY_COGNITION="nome-do-seu-modelo"

# Opcional: Modelo dedicado para a fase de mutação com Aider
# AEGIS_AIDER_MODEL="seu-modelo-de-mutacao"
```

Os pontos de entrada da CLI carregam o arquivo `.harness/local.env` automaticamente.

---

## Referência da CLI do Operador (`./aegis`)

O script `./aegis` é a interface principal para operadores.

### 1. Inspeção de Contexto Somente Leitura (`context`)

Inspecione o estado do alvo, detalhes da branch, limpeza da árvore de trabalho e histórico de commits gerenciados de forma offline e sem consumir tokens de LLM:

```bash
./aegis context --target src
```

### 2. Execução de Tarefas (`go`)

Execute o pipeline completo desde a recepção da demanda até a mutação, validação e o portão de commit humano:

```bash
# Executar um objetivo com alvo explícito e token de aceitação
./aegis go \
  --goal "Create the requested utility in src/index.ts" \
  --target src/index.ts \
  --accept requestedUtility

# Executar ou retomar uma issue do GitHub (dividida automaticamente em micro-unidades se estruturada)
./aegis go --issue 123

# Forçar a reexecução de um índice de tarefa específico em uma issue (reabre a tarefa K [x] -> [ ])
./aegis go --issue 123 --force-task 2

# Ignorar o intake estrito caso necessário
./aegis go "fix typo in src/index.ts" --relaxed
```

---

## ⚡ Topologia de KV-Cache & Economia de Tokens

O Aegis implementa uma **Arquitetura de Prefixo Compartilhado a partir do Byte 0** em ambos os seus substratos (Aider e Raw LLM). Ao posicionar os invariantes estáticos (`AGENTS.md` + `src/ARCHITECTURE.md` + `Pocket Map`) iniciando exatamente no byte 0 de cada prompt, o Aegis alcança uma eficiência massiva de reuso de cache (KV-Cache) entre modos e reentradas do pipeline:

| Passo / Fase | Modo Executado | Substrato / Motor | O que entra no Prompt da API | Estado do KV-Cache | Taxa Estimada de Cache Hit |
|---|---|---|---|---|---|
| **1. Investigação** | `discovery` | Raw / Shell | 100% Mecânico em Shell | N/A (Não chama LLM) | 🟢 **N/A (0 tokens)** |
| **2. Investigação** | `forensics` | Raw / Shell | 100% Mecânico em Shell | N/A (Não chama LLM) | 🟢 **N/A (0 tokens)** |
| **3. Mutação 1** | `repair` *(1ª vez)* | Aider CLI | Topo Congelado + Tarefa Original + Forensics | **Criando Cache do Aider** | 🆕 **0%** (Grava o topo do Aider no servidor) |
| **4. Revisão 1** | `optimize` *(1ª vez)* | Raw LLM | Topo Congelado + Diff $C_1$ gerado pelo `repair` | **Criando Cache da Revisão** | 🟡 **~60% Hit** (Reaproveita Byte 0 do topo) |
| **5. Revisão 1** | `adversarial` *(1ª vez)* | Raw LLM | Topo Congelado + Diff $C_1$ (Idêntico ao passo 4) | ⚡ **HIT TOTAL DA REVISÃO!** | ⚡ **95% - 100% Cache Hit** (Lê topo + Diff $C_1$ a custo 0) |
| **6. Reentrada** | `repair` *(2ª vez / Refinamento)* | Aider CLI | Topo Congelado (Idêntico ao passo 3) + *[Feedback do Optimize na Zona Ao Vivo]* | ⚡ **HIT TOTAL DO AIDER!** | ⚡ **~100% Cache Hit no Topo** (Lê os ~3.500 tokens do topo a custo 0) |
| **7. Revisão 2** | `optimize` *(2ª vez)* | Raw LLM | Topo Congelado + Novo Diff $C_2$ | **Atualizando Cache do Diff** | 🟡 **~60% Hit** (Reaproveita o topo imutável) |
| **8. Revisão 2** | `adversarial` *(2ª vez)* | Raw LLM | Topo Congelado + Novo Diff $C_2$ (Idêntico ao passo 7) | ⚡ **HIT TOTAL DA REVISÃO!** | ⚡ **95% - 100% Cache Hit** (Lê topo + Novo Diff $C_2$ a custo 0) |
| **9. Validação** | `validation` | Raw / Shell | Tribunal Mecânico (`npm run aegis:sanity`) | N/A (Não chama LLM) | 🟢 **N/A (0 tokens)** |

### Pilares de Eficiência:
- **Modos Mecânicos a 0 Tokens:** `discovery`, `forensics` e `validation` rodam deterministicamente em shell por padrão.
- **Reentradas de Mutação:** Voltar ao `repair` com erros do compilador ou sugestões de otimização preserva 100% do cabeçalho congelado do Aider em cache.
- **Pares de Revisão:** O `adversarial` alcança ~100% de cache hit sobre o `optimize` porque ambos avaliam exatamente o mesmo diff candidato $C_n$ sob o mesmo prefixo no byte 0.

---

## Observabilidade & Métricas

Após a execução, o Aegis gera relatórios estruturados de resultados em `.harness/runtime/`:

```bash
# 1. Visualizar o relatório final do resultado do pipeline
cat .harness/runtime/last_outcome.json | jq .

# 2. Inspecionar decisões de intenção, alinhamento e tribunal de validação
jq -c 'select(.kind == "intent" or .kind == "alignment" or .kind == "validation")' \
  .harness/runtime/pipeline_metrics.jsonl

# 3. Analisar uso de tokens, eficiência de cache de prompt e orçamentos de contexto
jq -c 'select(.kind == "cache" or .kind == "tokens" or .kind == "pipeline_budget")' \
  .harness/runtime/pipeline_metrics.jsonl
```

---

## Desenvolvimento & Testes

Execute os comandos de verificação do projeto para validar os contratos do harness:

```bash
npm run aegis:sanity
npm run aegis:test:fast
npm run aegis:test
npm run aegis:full
```

---

## Mapa do Repositório

```text
.
├── aegis                     # CLI Principal do Operador: intake, fit, lote, portão de commit
├── run_aegis.sh              # Driver de baixo nível para pipelines de mutação/leitura
├── runtime_aegis.sh          # Orquestrador soberano do runtime e ciclo de reentrada
├── run_aegis_loop.sh         # Executor de loop de demandas delimitado
├── AGENTS.md                 # Constituição carregada nos preâmbulos de LLM/Aider
├── README.md                 # Documentação em Inglês
├── README.pt-BR.md           # Documentação em Português
├── summary.md                # Mapa detalhado do repositório e referência de arquitetura
├── package.json              # Scripts de teste e dependências do projeto
├── .skills/                  # Contratos dos modos (forensics, repair, optimize, adversarial, validation)
├── .harness/
│   ├── config.sh             # Registros de motores, orçamentos, provedores e perfis de evidência
│   ├── enforcement/          # Regras estáticas e proteção de caminhos
│   └── runtime/              # Handover epistêmico, métricas, último resultado
├── scripts/
│   ├── execute_mode.sh       # Executador da VM do protocolo
│   ├── fit_check_demand.sh   # Verificação de encaixe e divisor mecânico de micro-unidades
│   ├── capabilities/         # Manipuladores de capacidades (filesystem, git, typescript, eslint, test)
│   ├── lib/                  # Bibliotecas principais (demand, evidence, artifact_protocol, run_outcome)
│   ├── runtime/              # Aplicação de diff candidato e promoção
│   └── substrates/           # LLM bruto, substrato Aider, portões e testes
├── src/                      # Playground de mutação para código TypeScript alvo
└── tasks/                    # Exemplos de tarefas de demanda estruturadas
```

---

## Trabalhos Relacionados e Créditos

- **Andrej Karpathy:** O Aegis adapta os princípios pragmáticos de engenharia de software de Karpathy ("Pense Antes de Codificar", "Simplicidade em Primeiro Lugar", "Saída Técnica Direta" e "Verificação de Erros Estrita") diretamente em seu contrato de cognição constitucional ([`AGENTS.md`](AGENTS.md)).
- **[PonyTail](https://github.com/dietrichgebert/ponytail) (por Dietrich Gebert):** Inspiração para as convenções de código limpo, suporte a APIs nativas (Native-First), funções puras, encapsulamento estrito e módulos atômicos documentadas em [`src/ARCHITECTURE.md`](src/ARCHITECTURE.md).
- **[Aider](https://aider.chat/):** Utilizado como substrato de mutação delimitada para edições de código.
- **[Headroom](https://github.com/headroomlabs-ai/headroom):** Inspiração para a arquitetura de zonas congeladas/vivas de prompt e disciplina de poda de orçamento de contexto.
- **[LMCache](https://github.com/LMCache/LMCache):** Inspiração para conceitos de cache em nível de payload.

---

## Licença

Consulte [`LICENSE.md`](LICENSE.md).

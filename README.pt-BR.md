Idioma: [English](README.md) | [Português (Brasil)](README.pt-BR.md)

# Aegis Harness 🛡️

> **Harness Soberano e Determinístico para Engenharia de Software Assistida por IA**

![AST Enforced](https://img.shields.io/badge/AST--Enforced-ast--grep-blue)
![KV-Cache](https://img.shields.io/badge/KV--Cache-Byte--0%20prefixo%20est%C3%A1vel-yellowgreen)
![Zero Regressions](https://img.shields.io/badge/Quality-Zero%20Regressions-brightgreen)
![KISS Architecture](https://img.shields.io/badge/Architecture-KISS%20Shell-orange)

**Aegis** transforma demandas de código em um **pipeline autônomo, inspecionável e delimitado em 6 estágios** (`discovery` ➔ `forensics` ➔ `build` ➔ `optimize` ➔ `adversarial` ➔ `validation`). Diferente de extensões genéricas de IDE, o Aegis é um **motor de governança determinístico** que bloqueia código inválido via AST, eleva o reuso de código de LLMs para **Red Teaming de Design de Sistema e Invariantes de Estado**, mantém **71% de cada prompt do substrato raw byte a byte idêntico desde o Byte 0** (medido) para que um prefix cache do provedor possa reaproveitá-lo, e garante **que apenas patches 100% testados e alinhados à arquitetura cheguem ao Git**.

---

## ⚡ Quickstart em 30 Segundos

```bash
# 1. Clonar e Instalar
git clone https://github.com/farifran/aegis-kiss.git && cd "aegis kiss" && npm install

# 2. Configurar Chaves (.harness/local.env)
echo 'OPENAI_API_KEY="sua-chave-api"' > .harness/local.env
echo 'OPENAI_MODEL_READONLY_COGNITION="gemini-3.6-flash"' >> .harness/local.env

# 3. Executar uma Demanda
./aegis "Crie utilitário em src/index.ts" --target src/index.ts --accept minhaFuncao
```

---

## 📦 Dependências

O `npm install` cobre apenas o toolchain TypeScript (`typescript`, `eslint`,
`@ast-grep/cli`, … — veja `package.json`). O runtime também exige os seguintes
itens no seu `PATH`:

| Dependência | Necessária? | Usada para |
|---|---|---|
| **bash** (≥ 4) | ✅ | Runtime do harness (`set -Eeuo pipefail`) |
| **git** | ✅ | Única memória durável; diff/status e gate de commit |
| **curl** | ✅ | Requisições HTTP ao provedor (substrato `raw`) |
| **jq** | ✅ | Evidência JSON, handover, métricas, prompts |
| **node** + **npm** | ✅ | Toolchain `tsc`, `eslint`, `ast-grep` |
| **Aider CLI** (`aider`) | ✅ *(mutação)* | Substrato `build` — `AEGIS_AIDER_BIN` (padrão `.venv/bin/aider`, auto-detectado no `PATH`) |
| **python3** | ⚪ opcional | Sanitizador mecânico de TS + scripts de probe de cache |
| **gh** (GitHub CLI) | ⚪ opcional | Apenas intake de demanda `--issue N` |
| Ollama / vLLM / LM Studio | ⚪ opcional | Provedor de inferência local |

Instale o **Aider** para o pipeline de mutação (instale no venv do repositório
para que o padrão `.venv/bin/aider` do `AEGIS_AIDER_BIN` resolva, ou deixe-o no
seu `PATH`):

```bash
python3 -m venv .venv && .venv/bin/pip install aider-chat
```

O Aider é necessário apenas no `build`; os modos somente-leitura (`discovery` /
`forensics` / `validation`) funcionam sem ele.

---

## 🌐 Integração Multi-Cliente & Modos de Inferência

O Aegis suporta **dois modos principais de execução** em qualquer ambiente de desenvolvimento:

### 1. 💻 Execução Via CLI Direto (Operador Humano)
- **Experiência Interativa em TTY**: Pede confirmação e abre o assistente interativo (`./aegis setup`) se as chaves ou modelos não estiverem configurados.
- **Modelos Locais & Cloud APIs**: Conecta a servidores de inferência local (Ollama, vLLM, LM Studio) ou APIs na nuvem (NVIDIA Integrate, OpenAI, Anthropic, Gemini, DeepSeek).
- **Seleção Flexível de Modelos**:
  - **Modelo Único Global**: Defina `AEGIS_MODEL_DEFAULT="meta/llama-3.1-8b-instruct"` (ou `ollama/llama3.1:8b`) para usar um único modelo em todas as etapas.
  - **Modelos Especializados por Tarefa/Modo**: Sobrescreva estágios específicos com modelos dedicados:
    - `AEGIS_SUPERVISOR_MODEL`: Expansão da demanda no Intake & geração da Issue (ex.: `deepseek-ai/deepseek-v4-flash-0731`; default = modelo de briefing)
    - `AEGIS_AIDER_MODEL` / `AEGIS_MUTATION_MODEL`: Mutação e edição de código no Aider (`build`)
    - `AEGIS_MODEL_ADVERSARIAL`: Red-teaming e falsificação adversária (`adversarial`)
    - `AEGIS_MODEL_VALIDATION`: Tribunal de validação estática (`validation`)
  - **Knobs de confiabilidade do supervisor**: `AEGIS_BRIEFING_MAX_TOKENS` (default `2048`),
    `AEGIS_BRIEFING_MAX_ATTEMPTS` (default `2`), `AEGIS_BRIEFING_TIMEOUT_SEC`
    (default `90`). Um gate de qualidade re-tenta Briefings estruturalmente
    válidos mas degenerados (álgebra auto-cancelante, declarações duplicadas).

### 2. 🤖 Handover via Assistente de IA (Antigravity, Claude Code, Codex, OpenCode, Cursor, Windsurf)
- **Detecção Automática de Ambiente Agêntico**: O Aegis detecta automaticamente assistentes via `aegis_is_agentic_execution` (`ANTIGRAVITY_AGENT`, `CLAUDE_CODE`, `CODEX_AGENT`, `OPENCODE_AGENT`, `CURSOR_AGENT`, `WINDSURF_AGENT`, flags `--agent` / `--agentic` ou subshells não-TTY).
- **Execução Não-Bloqueante & Silenciosa**: Desativa prompts interativos de TTY, emitindo JSON limpo e estruturado (`pending_assistant.json`) e devolvendo o controle diretamente ao assistente com 0 tokens de overhead externo.

| Cliente / Ambiente | Modo de Execução | Comando / Fluxo |
|---|---|---|
| 💻 **Aegis CLI Direto** | Operador Humano (Interativo) | `./aegis "sua demanda" --target src/...` ou `./aegis <N>` |
| 🛸 **Antigravity IDE / Codex** | Assistente de IA (Não-bloqueante) | Execução em background via `run_command` ou subshell |
| 🤖 **Claude Code / OpenCode / Cursor** | Assistente de IA (Handover Silencioso) | `./aegis "sua demanda"` dentro do assistente |

---

## 🏛️ Síntese Arquitetural: Os 6 Pilares do Aegis

O Aegis sintetiza 6 grandes projetos open-source em uma engrenagem única e determinística:

| Pilar | Papel no Aegis | Benefício Prático Mensurável |
|---|---|---|
| 🧠 **Karpathy** | Constituição Cognitiva no Byte 0 ([`AGENTS.md`](AGENTS.md)). | Se a LLM alucinar, o tribunal de intenção reprova a saída. |
| 😈 **Advogado do Diabo** | Falsificador Adversário de Invariantes ([`.skills/adversarial.md`](.skills/adversarial.md)). | Interroga invariantes de não-negatividade (`bits <= 0n`), desvios de relógio NTP e falhas de borda com a **Lei Estrita Anti-Sobre-Engenharia (KISS)** (correções cirúrgicas de 1 linha). |
| 📐 **PonyTail** | Diretrizes em [`src/ARCHITECTURE.md`](src/ARCHITECTURE.md) + Regras de AST. | Garante NodeNext ESM, `readonly`, `BigInt` e zero `any`. |
| ✂️ **Headroom** | Orçamento Epistêmico de 32KB com proteção de âncoras. | Poda arquivos irrelevantes sem apagar a causa raiz do bug. |
| ⚡ **LMCache** | Prompt mantido byte a byte idêntico desde o Byte 0 (`AGENTS.md` + `src/ARCHITECTURE.md` + contrato da skill + manifesto de capacidades). | **71% do prompt medido como byte-estável** entre execuções repetidas — acima do mínimo de 1.024 tokens que um prefix cache exige. |
| 🛡️ **Semgrep** | Scanner estático de segurança SAST no `static_gate.sh`. | Bloqueia a promoção no Git de falhas OWASP ou injeções. |

---

## 🧪 Oráculo Comportamental: Validação Mecânica de Semântica (P2)

O Intake expande uma demanda pelo modelo **supervisor** em um Briefing
estruturado que carrega uma seção executável **`## Behavior`** — asserts de
regressão que o coder precisa satisfazer:

```text
- window slides at the boundary and resets count
   exports: RateLimiter
   prelude: const r = new RateLimiter(1, 1000)
   prelude: r.allow(0n)
   assert: r.allow(1000n) === true && r.windowStart === 1000n
```

`fit_check.sh` carrega `## Behavior` para cada demanda de micro-unidade; o **gate
de behavior** mecânico (`aegis_mechanical_behavior_gate` em `demand.sh`) parseia
os itens, escopa cada assert para a unidade dona do **primeiro export listado**
(imports = união dos exports referenciados) e executa com
`node --experimental-strip-types`. Um assert falho emite um finding
`behavior_failure` (severidade alta, `supported_by_evidence: true`) que a
`validation` converte em veredito duro `rejected` com `build_feedback` — ou
seja, um candidato que implementa a API mas viola a semântica pretendida
**não pode** ser promovido. Isso fecha o buraco do "validado mas semanticamente
errado".

Asserts ancoram tempo no getter exportado `windowStart` (nunca números absolutos
ou sleeps de relógio real), mantendo o oráculo determinístico. Verificado no
benchmark RateLimiter: um candidato errado-mas-API-correto que o pipeline antigo
aceitava (issue #183) agora é rejeitado com findings em todas as unidades
relevantes.

**Benchmark (braço D, demanda vaga + Aegis).** Com o brief do supervisor + o
oráculo comportamental, o oráculo de 12 verificações
(`verify_rate_limiter.ts`) sobe de **0/12 (8B puro)** para **12/12**,
igualando os braços de demanda estruturada.

---

## ⚡ Topologia de KV-Cache & Economia de Tokens

O Aegis ordena todo prompt para que a parte invariante venha primeiro:
constituição, diretrizes de arquitetura, contrato da skill e manifesto de
capacidades no Byte 0, depois um marcador `LIVE ZONE`, depois tudo que muda a
cada execução. Um prefix cache do provedor só consegue reaproveitar bytes até o
primeiro que diverge — essa ordenação é o mecanismo inteiro.

**O que está medido.** Duas execuções `forensics` da mesma demanda, capturadas
no fio e tokenizadas com `o200k_base`:

| | tokens |
|---|---|
| Prompt completo do substrato raw | 2.435 |
| **Prefixo idêntico desde o Byte 0 entre as duas runs** | **1.718 (71%)** |
| — system message (constituição + arquitetura + skill) | 1.059 |
| — user message até a primeira divergência | 659 |
| Mínimo do provedor para o prefix cache engajar | 1.024 |

O prefixo passa do limiar com folga. Os 29% restantes são o handover
epistêmico, que carrega o próprio timestamp e legitimamente muda a cada ciclo.

**O que não está medido.** *Se o provedor de fato reaproveita.* Nenhum endpoint
que reporte cache foi exercitado ainda — o endpoint NVIDIA atual devolve `null`
em `cached_tokens`, então `cached_prompt_tokens` no `pipeline_metrics.jsonl`
nunca foi outra coisa senão nulo. Até essa execução acontecer, o teto honesto é
aritmética, não benchmark:

| Se o cache disparar | Economia no custo de **input** |
|---|---|
| Provedor cobra input cacheado com 50% de desconto | ~35% |
| Provedor cobra input cacheado com 75% de desconto | ~53% |

Tokens de output nunca são cacheados e custam várias vezes a taxa de input,
então a economia na conta cheia é materialmente menor que qualquer um dos dois
números. Qualquer alegação acima dessa faixa não tem lastro em evidência neste
repositório.

| Mode | Substrato / Motor | O que entra no Prompt da API | Situação do prefixo |
|---|---|---|---|
| **`discovery`** | Shell Mecânico | 100% mecânico em shell | 🟢 **N/A (0 tokens)** |
| **`forensics`** | Shell Mecânico (só resíduo LLM) | Topo congelado + evidências | 📏 **71% byte-estável (medido)** |
| **`build`** | Aider CLI | Topo congelado + demanda + evidências | ❓ **Não medido** *(o Aider monta o próprio prompt)* |
| **`optimize`** | Raw LLM | Topo congelado + diff $C_1$ | ❓ **Não medido** *(mesmo montador do `forensics`)* |
| **`adversarial`** | Raw LLM | Topo congelado + diff $C_1$ *(profundidade `low\|medium\|paranoid`)* | ❓ **Não medido** *(contrato de skill maior ⇒ topo congelado maior)* |
| **`validation`** | Shell Mecânico | Tribunal Mecânico (`npm run aegis:sanity`) | 🟢 **N/A (0 tokens)** |

---

## 🚦 Portão de Qualidade & Comandos Rápidos

```bash
# 1. Executar uma nova demanda (Intake + Fit + Pipeline)
./aegis "Crie TokenBucket em src/tokenBucket.ts"

# 2. Retomar uma issue existente
./aegis 207

# 3. Consolidar commits atômicos em 1 commit limpo para PR
./aegis squash 207

# 4. Inspecionar estado offline (0 tokens)
./aegis context --target src

# 5. Rodar tribunal estático (AST grep + ESLint + TS)
npm run aegis:sanity

# 6. Executar suíte de testes do harness
npm run aegis:test:fast
```

---

## 📜 Licença & Créditos

Veja [`LICENSE.md`](LICENSE.md). Inspirado nos trabalhos de Andrej Karpathy, Dietrich Gebert (PonyTail), Aider, Headroom, LMCache, Semgrep e Tree-sitter.

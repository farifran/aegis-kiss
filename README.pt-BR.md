Idioma: [English](README.md) | [Português (Brasil)](README.pt-BR.md)

# Aegis Harness 🛡️

> **Harness Soberano e Determinístico de Contenção para Engenharia de Software Assistida por IA**

![AST Enforced](https://img.shields.io/badge/AST--Enforced-ast--grep-blue)
![KV-Cache](https://img.shields.io/badge/KV--Cache-Byte--0%20prefix%20stable-yellowgreen)
![Zero Regressions](https://img.shields.io/badge/Quality-Zero%20Regressions-brightgreen)
![KISS Architecture](https://img.shields.io/badge/Architecture-KISS%20Shell-orange)

O **Aegis** transforma demandas de código em um **pipeline autônomo e auditável de 6 estágios** (`discovery` ➔ `forensics` ➔ `build` ➔ `optimize` ➔ `adversarial` ➔ `validation`). Diferente de extensões genéricas de IDE, o Aegis é um **motor de governança determinístico** que bloqueia mecanicamente código ruim via AST, eleva revisões de código de simples sintaxe para **Red-Teaming de Design de Sistema e Ciclo de Vida de Estado**, mantém **71% de cada prompt do substrato raw byte a byte idêntico a partir do Byte 0** para reaproveitamento em cache de prefixo do provedor, e garante que **apenas patches 100% testados e alinhados à arquitetura cheguem ao Git**.

---

## ⚡ Início Rápido em 30 Segundos

```bash
# 1. Clonar e Instalar
git clone https://github.com/farifran/aegis-kiss.git && cd "aegis kiss" && npm install

# 2. Configurar Credenciais (.harness/local.env)
echo 'OPENAI_API_KEY="sk-..."' > .harness/local.env
echo 'OPENAI_MODEL_READONLY_COGNITION="gemini-2.5-flash"' >> .harness/local.env

# 3. Executar uma Demanda
./aegis "Create TokenBucket in src/tokenBucket.ts" --target src/tokenBucket.ts --accept TokenBucket
```

---

## 📦 Dependências

O `npm install` cobre o ecossistema TypeScript (`typescript`, `eslint`,
`@ast-grep/cli`, … — veja o `package.json`). O runtime também requer as
seguintes ferramentas instaladas no seu `PATH`:

| Dependência | Obrigatória? | Finalidade |
|---|---|---|
| **bash** (≥ 4) | ✅ | Runtime do harness (`set -Eeuo pipefail`) |
| **git** | ✅ | Única memória durável; diff/status e portão de commit |
| **curl** | ✅ | Requisições HTTP para provedores (substrato `raw`) |
| **jq** | ✅ | Evidências JSON, handover, métricas e prompts |
| **node** + **npm** | ✅ | Toolchain `tsc`, `eslint`, `ast-grep` e gate de execução de behavior |
| **Aider CLI** (`aider`) | ✅ *(mutação)* | Substrato `build` — `AEGIS_AIDER_BIN` (padrão `.venv/bin/aider`, detectado via `PATH`) |
| **python3** | ⚪ opcional | Sanitizador mecânico de TS + scripts de sonda de cache |
| **gh** (GitHub CLI) | ⚪ opcional | Apenas para intake via `--issue N` |
| Ollama / vLLM / LM Studio | ⚪ opcional | Provedores locais de inferência |

Instale o **Aider** para o pipeline de mutação (no venv do repositório para que o
padrão `AEGIS_AIDER_BIN=.venv/bin/aider` funcione automaticamente, ou no `PATH`
global):

```bash
python3 -m venv .venv && .venv/bin/pip install aider-chat
```

O Aider é necessário apenas no modo `build`; os modos de leitura (`discovery` /
`forensics` / `validation`) rodam sem ele.

---

## 🌐 Integração Multi-Cliente & Modos de Inferência

O Aegis suporta **dois modos primários de execução** em qualquer ambiente:

### 1. 💻 Execução Direta via CLI (Operador Humano)
- **Experiência TTY Interativa**: Solicita confirmação e abre configuração guiada (`./aegis setup`) caso chaves de API não estejam configuradas.
- **LLMs Locais e APIs Cloud**: Conecta a servidores locais (Ollama, vLLM, LM Studio) ou endpoints em nuvem (NVIDIA Integrate, OpenAI, Anthropic, Gemini, DeepSeek).
- **Seleção Flexível de Modelos**:
  - **Modelo Global Único**: Defina `AEGIS_MODEL_DEFAULT="meta/llama-3.1-8b-instruct"` (ou `ollama/llama3.1:8b`) para usar o mesmo modelo em todos os estágios.
  - **Modelos Dedicados por Estágio**:
    - `AEGIS_SUPERVISOR_MODEL`: Expansão de demanda e geração de schema JSON (`.skills/briefing.md`)
    - `AEGIS_AIDER_MODEL` / `AEGIS_MUTATION_MODEL`: Mutação de código no Aider (`build`)
    - `AEGIS_MODEL_ADVERSARIAL`: Red-teaming e falsificação (`adversarial`)
    - `AEGIS_MODEL_VALIDATION`: Alinhamento estático no tribunal (`validation`)
  - **Controles de Confiabilidade do Supervisor**: `AEGIS_BRIEFING_MAX_TOKENS`
    (padrão `2048`), `AEGIS_BRIEFING_MAX_ATTEMPTS` (padrão `2`),
    `AEGIS_BRIEFING_TIMEOUT_SEC` (padrão `90`). Um gate de qualidade retenta
    Briefings válidos que apresentem degenerações (álgebra autocancelada,
    declarações duplicadas).

### 2. 🤖 Handover para Assistentes de IA (Antigravity, Claude Code, Codex, OpenCode, Cursor, Windsurf)
- **Detecção Automática do Ambiente**: O Aegis identifica assistentes via `aegis_is_agentic_execution` (`ANTIGRAVITY_AGENT`, `CLAUDE_CODE`, `CODEX_AGENT`, `OPENCODE_AGENT`, `CURSOR_AGENT`, `WINDSURF_AGENT`, flags `--agent` / `--agentic` ou subshells não-TTY).
- **Execução Não-Bloqueante & Silenciosa**: Desativa prompts interativos de terminal, emite JSON estruturado (`pending_assistant.json`) e devolve o controle diretamente ao assistente com 0 tokens de overhead externo.

| Cliente / Ambiente | Modo de Execução | Fluxo / Comando |
|---|---|---|
| 💻 **CLI Direta do Aegis** | Operador Humano (Interativo) | `./aegis "sua demanda" --target src/...` ou `./aegis <N>` |
| 🛸 **Antigravity IDE / Codex** | Pair-Programmer Agêntico (Não-bloqueante) | Execução em background via `run_command` ou terminal |
| 🤖 **Claude Code / OpenCode / Cursor** | Assistente Agêntico (Handover Silencioso) | `./aegis "sua demanda"` dentro do prompt do assistente |

---

## 🏛️ Síntese Arquitetural: Os 6 Pilares do Aegis

O Aegis unifica 6 grandes princípios de engenharia de software em um único harness determinístico:

| Pilar | Papel no Aegis | Benefício Prático Mensurável |
|---|---|---|
| 🧠 **Karpathy** | Constituição Cognitiva no Byte 0 ([`AGENTS.md`](AGENTS.md)). | Se a LLM alucinar, o tribunal de intenção reprova a saída. |
| 😈 **Advogado do Diabo** | Falsificador Adversário de Invariantes ([`.skills/adversarial.md`](.skills/adversarial.md)). | Interroga invariantes de não-negatividade (`bits <= 0n`), desvios de relógio NTP e falhas de borda com a **Lei Estrita Anti-Sobre-Engenharia (KISS)** (correções cirúrgicas de 1 linha). |
| 📐 **PonyTail** | Diretrizes em [`ARCHITECTURE.md`](ARCHITECTURE.md) + Regras de AST. | Garante NodeNext ESM, `readonly`, `BigInt` e zero `any`. |
| ✂️ **Headroom** | Orçamento Epistêmico de 32KB com proteção de âncoras. | Poda arquivos irrelevantes sem apagar a causa raiz do bug. |
| ⚡ **LMCache** | Prompt mantido byte a byte idêntico desde o Byte 0 (`AGENTS.md` + `ARCHITECTURE.md` + contrato da skill + manifesto de capacidades). | **71% do prompt medido como byte-estável** entre execuções repetidas — acima do mínimo de 1.024 tokens que um prefix cache exige. |
| 🛡️ **Semgrep** | Scanner estático de segurança SAST no `static_gate.sh`. | Bloqueia a promoção no Git de falhas OWASP ou injeções. |

---

## 🧪 Supervisor Briefing & Oráculo Comportamental: Validação em 2 Níveis

O Intake expande a demanda através do modelo **supervisor** em um Briefing JSON
estruturado com base no contrato canônico ([`.skills/briefing.md`](.skills/briefing.md)):

```json
{
  "goal": "Create src/slidingWindowLimiter.ts and src/index.ts implementing a sliding window rate limiter",
  "targets": ["src/slidingWindowLimiter.ts", "src/index.ts"],
  "exports": [ ... ],
  "behavior": [
    {
      "desc": "Accepts requests up to limit and rejects beyond it",
      "exports": ["SlidingWindowLimiter"],
      "prelude": ["const limiter = new SlidingWindowLimiter(2, 1000)"],
      "assert": "limiter.tryAcquire() === true && limiter.tryAcquire() === true && limiter.tryAcquire() === false"
    }
  ]
}
```

### Portão de Qualidade em 2 Níveis:
1. **Compilação TypeScript em Memória (`tsc`)**: `aegis_briefing_typecheck_json` materializa o schema em um módulo temporário e roda `tsc --noEmit` contra o `tsconfig.json` do repositório. Tipos desconhecidos ou membros faltantes são rejeitados e corrigidos antes do coder model receber a demanda.
2. **Execução Real em Runtime Node.js**: Os asserts em `behavior[]` são compilados e executados em tempo real pelo Node.js (`node unit.js`), provando a correção matemática e a validade lógica do código em execução.

---

## 🔄 Loop Automatizado de Melhoria do Briefing

O Aegis inclui um loop automatizado para testar e calibrar a qualidade do prompt do supervisor contra 30 demandas em prosa real:

```bash
# Executar a suíte padrão (Lote A: algoritmos, caches, máquinas de estado)
npm run aegis:test:briefing-loop

# Executar Lote B (frontend e contratos de erro assíncronos)
AEGIS_BRIEFING_LOOP_DEMANDS=scripts/substrates/test/probes/briefing_demands_b.jsonl npm run aegis:test:briefing-loop

# Executar Lote C (estruturas avançadas, DAGs, parsers binários, mutexes)
AEGIS_BRIEFING_LOOP_DEMANDS=scripts/substrates/test/probes/briefing_demands_c.jsonl npm run aegis:test:briefing-loop
```

Defeitos são automaticamente registrados e classificados em `.harness/runtime/briefing_loop_report.jsonl`.

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
| **Prefixo idêntico no Byte 0 em ambas as execuções** | **1.718 (71%)** |
| — mensagem de sistema (constituição + arquitetura + skill) | 1.059 |
| — mensagem de usuário até a primeira divergência | 659 |
| Mínimo do provedor para ativar o prefix cache | 1.024 |

| Modo | Substrato / Motor | Estrutura do Payload do Prompt | Status do Prefixo |
|---|---|---|---|
| **`discovery`** | Shell Mecânico | 100% mecânico no shell | 🟢 **N/A (0 tokens)** |
| **`forensics`** | Shell Mecânico (LLM apenas residual) | Cabeçalho congelado + evidência | 📏 **71% byte-estável (medido)** |
| **`build`** | Aider CLI | Cabeçalho congelado + demanda + evidência | ❓ **Não medido** *(Aider monta o próprio prompt)* |
| **`optimize`** | Raw LLM | Cabeçalho congelado + diff $C_1$ | ❓ **Não medido** *(mesmo montador do `forensics`)* |
| **`adversarial`** | Raw LLM | Cabeçalho congelado + diff $C_1$ *(profundidade `low\|medium\|paranoid`)* | ❓ **Não medido** *(contrato maior de skill)* |
| **`validation`** | Shell Mecânico | Tribunal mecânico (`npm run aegis:sanity`) | 🟢 **N/A (0 tokens)** |

---

## 🚦 Portões de Qualidade & Comandos Rápidos

```bash
# 1. Executar uma nova demanda (Intake + Fit + Pipeline)
./aegis "Create TokenBucket in src/tokenBucket.ts"

# 2. Retomar uma issue existente
./aegis 207

# 3. Consolidar micro-commits em 1 commit limpo para PR
./aegis squash 207

# 4. Inspecionar contexto offline (0 tokens)
./aegis context --target src

# 5. Executar tribunal estático (AST grep + ESLint + TS)
npm run aegis:sanity

# 6. Executar suíte rápida de regressão
npm run aegis:test:fast

# 7. Executar matriz completa de 39 testes
npm run aegis:test
```

---

## 📜 Licença & Créditos

Veja [`LICENSE.md`](LICENSE.md). Inspirado por Andrej Karpathy, Dietrich Gebert (PonyTail), Aider, Headroom, LMCache, Semgrep e Tree-sitter.

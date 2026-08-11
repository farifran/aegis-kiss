Idioma: [English](README.md) | [Português (Brasil)](README.pt-BR.md)

# Aegis Harness 🛡️

> **Harness Soberano e Determinístico para Engenharia de Software Assistida por IA**

![AST Enforced](https://img.shields.io/badge/AST--Enforced-ast--grep-blue)
![KV-Cache](https://img.shields.io/badge/KV--Cache-Byte--0-green)
![Zero Regressions](https://img.shields.io/badge/Quality-Zero%20Regressions-brightgreen)
![KISS Architecture](https://img.shields.io/badge/Architecture-KISS%20Shell-orange)

O **Aegis** transforma demandas de código em um **pipeline autônomo, delimitado e auditável em 6 estágios** (`discovery` ➔ `forensics` ➔ `repair` ➔ `optimize` ➔ `adversarial` ➔ `validation`). Diferente de extensões genéricas de IDE, o Aegis é uma **máquina de governança determinística** que barra códigos ruins via AST, otimiza o consumo de tokens em até 98% via KV-Cache no Byte 0 e garante que **apenas patches 100% testados e alinhados cheguem ao Git**.

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

## 🌐 Integração Multi-Cliente & Cenários de Inferência

O Aegis roda de forma transparente em qualquer ambiente de desenvolvimento:

| Cliente / Ambiente | Como Funciona | Comando / Fluxo |
|---|---|---|
| 💻 **Aegis CLI Direto** | Operação manual direta no terminal com APIs oficiais na nuvem (OpenAI, Anthropic, Gemini, DeepSeek). | `./aegis "sua demanda" --target src/...` |
| 🤖 **Claude Code / Open Code** | O assistente invoca o Aegis via terminal interno, usando o tribunal do Aegis para evitar regressões. | `./aegis "sua demanda"` dentro do Claude Code |
| 🛸 **Antigravity / IDE Assistants** | Assistentes de pair-programming na IDE disparam execuções do Aegis via `run_command` em background. | Inspeciona métricas em `pipeline_metrics.jsonl` |
| ⚡ **Inferência Híbrida (vLLM + LiteLLM)** | Roteia mutações iterativas para GPU local ($0/token) e análises complexas para a nuvem. | `litellm --config .harness/litellm.config.yaml` |

<details>
<summary><b>🛠️ Passo a Passo para Configurar vLLM Local + LiteLLM Proxy Router</b></summary>

1. **Subir vLLM (GPU Local):** `vllm serve Qwen/Qwen2.5-Coder-32B-Instruct --port 8000`
2. **Subir LiteLLM Router:** `litellm --config .harness/litellm.config.yaml --port 4000`
3. **Apontar Aegis:** Adicionar `OPENAI_API_BASE="http://localhost:4000/v1"` em `.harness/local.env`.
</details>

---

## 🏛️ Síntese Arquitetural: Os 6 Pilares do Aegis

O Aegis sintetiza 6 grandes projetos open-source em uma engrenagem única e determinística:

| Pilar | Papel no Aegis | Benefício Prático Mensurável |
|---|---|---|
| 🧠 **Karpathy** | Constituição Cognitiva no Byte 0 ([`AGENTS.md`](AGENTS.md)). | Se a LLM alucinar, o tribunal de intenção reprova a saída. |
| 📐 **PonyTail** | Diretrizes em [`src/ARCHITECTURE.md`](src/ARCHITECTURE.md) + Regras de AST. | Garante NodeNext ESM, `readonly`, `BigInt` e zero `any`. |
| ✂️ **Headroom** | Orçamento Epistêmico de 32KB com proteção de âncoras. | Poda arquivos irrelevantes sem apagar a causa raiz do bug. |
| ⚡ **LMCache** | Prefixo estático de 4.356 bytes gravado a partir do Byte 0. | **50% a 98% de economia de tokens** na API da LLM. |
| 🛡️ **Semgrep** | Scanner estático de segurança SAST no `static_gate.sh`. | Bloqueia a promoção no Git de falhas OWASP ou injeções. |
| 🌳 **Tree-sitter** | Extração de escopo esquelético (`AEGIS_READ_SKELETAL=auto`). | **60% a 90% de poda de tokens** em arquivos secundários. |

---

## ⚡ Topologia de KV-Cache & Economia de Tokens

| Modo | Substrato / Motor | O que entra no Prompt da API | Taxa Estimada de Cache Hit |
|---|---|---|---|
| **`discovery`** | Shell Mecânico | 100% Mecânico em Shell | 🟢 **N/A (0 tokens)** |
| **`forensics`** | Shell Mecânico | 100% Mecânico em Shell | 🟢 **N/A (0 tokens)** |
| **`repair` (1ª vez)** | Aider CLI | Topo Congelado + Demanda + Evidências | 🆕 **0%** *(Grava o topo do Aider no servidor)* |
| **`optimize` (1ª vez)** | Raw LLM | Topo Congelado + Diff $C_1$ do `repair` | 🟡 **~60% Hit** *(Reaproveita o Byte 0 congelado)* |
| **`adversarial` (1ª vez)**| Raw LLM | Topo Congelado + Diff $C_1$ (Idêntico ao optimize)| ⚡ **95% - 100% Cache Hit** *(Lê topo + Diff a custo ~0)*|
| **`repair` (Reentrada)**| Aider CLI | Topo Congelado + *[Feedback na Zona Ao Vivo]* | ⚡ **~100% Header Hit** *(Lê o topo a custo ~0)* |
| **`validation`** | Shell Mecânico | Tribunal Mecânico (`npm run aegis:sanity`) | 🟢 **N/A (0 tokens)** |

---

## 🚦 Portão de Qualidade & Comandos Rápidos

```bash
# 1. Inspecionar estado offline (0 tokens)
./aegis context --target src

# 2. Rodar tribunal estático (AST grep + ESLint + TS)
npm run aegis:sanity

# 3. Executar suíte de testes do harness
npm run aegis:test:fast
```

---

## 📜 Licença & Créditos

Veja [`LICENSE.md`](LICENSE.md). Inspirado nos trabalhos de Andrej Karpathy, Dietrich Gebert (PonyTail), Aider, Headroom, LMCache, Semgrep e Tree-sitter.

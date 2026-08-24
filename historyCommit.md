# 📜 Histórico Unificado de Commits e Evolução do Aegis (`historyCommit.md`)

Este documento consolida toda a evolução arquitetural, decisões de engenharia, histórico de commits, testes de benchmark e avanços implementados no **Aegis** desde as versões iniciais até o estado canônico atual na branch principal (`main`).

---

## 🧭 1. Resumo Executivo da Evolução (ELI5 — *Explain Like I'm 5*)

O **Aegis** evoluiu de um harness multi-linguagem genérico para um **sistema cirúrgico de engenharia de software de alta precisão e hardware-aligned**:

1. **Foco 100% em TypeScript & Hardware KISS:**
   - Eliminou abstrações especulativas e adotou física de tempo monotônico $O(1)$ (`bigint`), arrays lineares e zero alocações em hot paths.
2. **Pre-Intake Discovery & Forensics (16 KB):**
   - Antes de iniciar qualquer planejamento, o sistema investiga o workspace completo sem pontos cegos, mapeando arquivos, tipos, interfaces e barrels.
3. **Supervisor de Briefing com Auto-Cura e Decisões Arquiteturais:**
   - Formula perguntas interativas para alinhamento obrigatório com o operador antes de criar tarefas, auto-curando erros de compilação em memória RAM com o compilador real (`tsc`).
4. **Bypass Mecânico de Zero Tokens:**
   - Quando o operador aceita as opções recomendadas pelo supervisor, o Aegis reutiliza o schema em memória com 0 chamadas extras de IA (0 tokens e 0ms de latência).
5. **Setup Wizard Modular em 5 Pilares (`./aegis setup`):**
   - Suporte unificado tanto no terminal TTY quanto no IDE para Assistentes Nativos (Antigravity/Claude Code/Cursor), Modelos Cloud (OpenAI/Gemini/Anthropic), Modelos Abertos (NVIDIA GLM/DeepSeek/Groq), Modelos Locais (Ollama/vLLM) e Modo Híbrido.
6. **Tribunal Mecânico e Auto-Squash Automático:**
   - Validação determinística de $O(1)$ e falsificação comportamental via asserções de runtime reais.
   - Consolidação automática de micro-tarefas num único commit limpo de feature ao concluir a issue.

---

## 📊 2. Matriz Histórica Consolidada de Commits

| Bloco / Fase | Escopo | Descrição & Avanços Principais |
| :--- | :--- | :--- |
| **Fase 1: Fundação KISS**<br>`a14a481` .. `3a4f345` | `core`, `rules` | Foco estrito em TypeScript, eliminação de `enum`/`any`, regras estritas de NodeNext e invariantes constitucionais (`AGENTS.md`). |
| **Fase 2: Concepção & Briefing**<br>`5bddbee` .. `88d6a1e` | `briefing.sh`, `.skills` | 7º Invariante de Hardware, benchmark multi-nível (Lvl 1 a 10) com 100% de precisão, streaming curl em RAM e feedback cirúrgico do `tsc`. |
| **Fase 3: Desafios Extremos**<br>`f6558c3` .. `adfeeb1` | `test/`, `skills` | Aprovação 100% nos benchmarks de alta complexidade (Stack VM, Bloom Filter, KD-Tree, Lock-free SPSC Ring Buffer, RAFT, MVCC). |
| **Fase 4: Lapidação & Modularização**<br>`f16faf3` .. `c2076b7` | `demand.sh`, `mutation` | Modularização de `demand.sh` (de 4.4k para 780 linhas) em `mutation_helpers.sh` e `mechanical_scans.sh`, unificação de AST e desacoplamento de atalhos mecânicos. |
| **Fase 5: Governança & Zero-Token Bypass**<br>`0fde087` .. `5a91291` | `briefing.sh`, `aegis` | Portão de perguntas de alinhamento arquitetural obrigatório, persistência de `preliminary_briefing_schema.json` e bypass mecânico com 0 tokens ao confirmar recomendados. |
| **Fase 6: Wizard em 5 Pilares & Auto-Squash**<br>`2e6c08b` .. `e6c49e5` | `aegis`, `pipeline` | Novo Wizard `./aegis setup` com desacoplamento de papéis (Supervisor vs. Coder), integração nativa no IDE e Auto-Squash automático de issues concluídas. |

---

## 🔍 3. Detalhamento dos Commits Canônicos Recentes

### 1. `5a91291` — Zero-Token Mechanical Bypass no Briefing
* **O Que Fez:** Criou a detecção determinística `aegis_briefing_answers_are_recommended`. Quando o operador aceita o recomendado, o Aegis faz bypass da 2ª chamada de IA reutilizando o schema pré-validado em RAM.
* **Ganho:** Economia de ~2.750 tokens e redução de latência de 4s para 0ms.

### 2. `2e6c08b` & `f641740` — Setup Wizard em 5 Pilares
* **O Que Fez:** Reescreveu `./aegis setup` com taxonomia clara:
  1. *Assistentes Nativos de IDE* (Antigravity, Claude Code, Cursor, OpenCode).
  2. *Modelos Proprietários / Cloud* (OpenAI, Anthropic, Gemini, Grok).
  3. *Modelos Abertos & Open Weights* (NVIDIA GLM-5.2, DeepSeek Direct, Moonshot Kimi, Groq).
  4. *Modelos Locais & Offline* (Ollama, vLLM, LM Studio).
  5. *Modo Híbrido* (Briefing no IDE e Coder na API, ou vice-versa).
* **Ganho:** Reuso inteligente de chaves de API e acionamento automático no IDE via `PENDING_SETUP_CONFIG`.

### 3. `e6c49e5` — Auto-Squash Automático & Remoção do Subcomando Manual
* **O Que Fez:** Tornou o squash de micro-tarefas automático e incondicional no fechamento do lote da issue, gerando um único commit de feature limpo e removendo o comando obsoleto `./aegis squash`.
* **Ganho:** Histórico de Git 100% limpo, legível e livre de poluição intermediária.

---

## 🏛️ 4. Invariantes de Engenharia Vigentes

1. **Constituição Karpathy (`AGENTS.md`):** Mutações mínimas e cirúrgicas, evidência empírica antes de codificar, simplicidade estrita (KISS).
2. **Hardware-Aligned Physics:** Fórmulas fechadas $O(1)$, zero loops no hot path, zero alocações na heap durante métodos de alta frequência.
3. **Strict TypeScript & NodeNext:** Importações relativas com extensão `.js`, campos privados isolados via `getters`, zero uso de `any` ou `@ts-ignore`.
4. **Tribunal Soberano:** O compilador real e os testes unitários em Node.js são a única autoridade de aceitação de código.

# Brief para revisão externa — Experimento de teto de decode (Aegis)

**Propósito deste documento:** submeter o desenho de um experimento a crítica adversarial por outro modelo, **antes** de gastar tokens rodando. O que eu quero não é validação: quero que o desenho seja atacado. As seções 7 e 8 listam as fraquezas que eu já identifiquei; presumo que existam outras.

**Data:** 2026-08-21 · **Repo:** `aegis kiss` · **Branch:** `fix/keep-candidate-refine-materialize` · **Estado:** experimento construído e validado offline, **nunca executado**.

---

## 1. Contexto do sistema (para leitor sem contexto prévio)

**Aegis** é um harness de containment para engenharia de software assistida por IA. Não é uma extensão de IDE — é um motor de governança determinístico escrito em Bash (~30k linhas), sem dependências além de `bash`, `git`, `curl`, `jq`, `node`.

Propriedades relevantes para este experimento:

- **Pipeline de 6 estágios:** `discovery` → `forensics` → `build` → `optimize` → `adversarial` → `validation`.
- **Dois substratos distintos.** Estágios de análise usam o *raw substrate* (HTTP direto ao provedor via `curl`, prompt montado pelo harness). O estágio `build` usa a **Aider CLI**, que monta o próprio prompt e é opaca ao harness.
- **Filosofia:** o LLM é não-confiável; portões mecânicos decidem. `validation` roda sem LLM por padrão (`AEGIS_VALIDATION_LLM=0`). A constituição do projeto (`AGENTS.md`) exige KISS, disciplina de evidência e mutação cirúrgica.
- **Economia de contexto:** teto fixo de 32KB, prompt ordenado para manter prefixo byte-estável (71% medido) visando cache de prefixo do provedor.
- **Oráculo mecânico existente:** `.harness/benchmark/verify_rate_limiter.ts`, 12 asserts que verificam uma classe `RateLimiter` gerada (capacidade, refill, rollover de janela, backoff, boundary, e re-export no barrel). Documentado como tendo ido de 0/12 (modelo 8B cru) para 12/12 com o harness.

**Tetos de decode.** O harness limita `max_tokens` por modo, em `resolve_raw_max_tokens` (`scripts/substrates/raw/prompt.sh:356`):

| modo | teto | origem |
|---|---|---|
| default | 4096 | `.harness/config.sh:199` |
| discovery | 1024 | config |
| forensics | 1024 | config |
| adversarial | 1024 | config |
| validation | 512 | config |
| optimize | 768 | **apenas inline no prompt.sh:373** |

Justificativa registrada em `.harness/config.sh:197`:

> "Prefer the per-mode caps below for the hot readonly path: short JSON artifacts must not pay full decode budgets (adversarial was 84s → 12s at 1024)."

Ou seja: o teto foi apertado para comprar latência, e o ganho é grande (7x num estágio).

---

## 2. A hipótese

O ganho de latência é grátis **se e somente se** o teto corta verbosidade e nunca corta raciocínio.

O resultado do *global workspace* da Anthropic (J-Space / J-Lens, 2026) sugere que essa condição pode não valer. Achados relevantes:

- Existe um subespaço de ativações internas ("J-space", <10% da atividade) que carrega conceitos verbalizáveis antes de aparecerem na saída.
- Passos intermediários de problemas multi-etapa aparecem nesse espaço, **na ordem**.
- Com o J-space suprimido, o modelo continua falando fluentemente e faz inferência automática — mas **degrada especificamente em raciocínio interno complexo**.

Se o ato de produzir tokens é o substrato do raciocínio intermediário, então **"limitar a saída" e "limitar o pensamento" podem ser o mesmo botão**. O Aegis aperta esse botão agressivamente e por toda parte, incluindo em prompts que instruem terseness máxima — `scripts/substrates/raw/prompt.sh:14`:

> "MINIMAL FORENSICS (LLM residual only): emit ONLY status + mutation_candidates[{id,reason}]."

**Predição falsificável:** em tetos apertados, a qualidade do artefato final cai **sem que haja truncamento**. Se a queda vier acompanhada de truncamento, a hipótese não é necessária — é só resposta cortada.

**Nota de honestidade epistêmica:** o J-Space é ferramenta de caixa-branca (precisa dos pesos e do Jacobiano do unembedding). O Aegis fala HTTP com provedores fechados. **Não é possível observar o J-space aqui.** A hipótese é usada apenas como fonte de uma predição comportamental testável de fora. Isto é analogia motivadora, não medição do mecanismo.

---

## 3. O discriminador

Sem distinguir "acabou a cota" de "raciocinou pior", o número final é ininterpretável — as duas causas exigem correções opostas.

O provedor sempre reportou isso (`finish_reason: "length"` em APIs OpenAI-compatíveis; `stop_reason: "max_tokens"` na Anthropic). **O harness nunca registrou.** Foi a primeira mudança feita.

Matriz de decisão:

| resultado | leitura | ação |
|---|---|---|
| braço apertado pior, **com** truncamento | resposta cortada | subir teto; hipótese não testada |
| braço apertado pior, **sem** truncamento | o teto moldou a resposta sem cortá-la | **resultado que interessa** |
| todos empatados | tetos atuais não custam nada | fechar a questão; ganho de latência é grátis |

---

## 4. Método como construído

- **Unidade:** uma execução completa do pipeline sobre um demand fixo.
- **Variável independente:** teto de decode (3 braços).
- **Variável dependente:** score no oráculo de 12 checks.
- **Covariáveis registradas:** `finish_reason` por chamada, prompt/completion/cached tokens, wall time, exit code, quais modos truncaram.
- **Controles:** temperatura 0; mesmo modelo; mesmo demand; worktree resetada ao mesmo commit antes de cada execução; `.harness/runtime/` limpo entre execuções.
- **Reps:** 2 por braço (padrão), configurável.

**Braços:**

| var | tight | default | loose |
|---|---|---|---|
| `..._MAX_TOKENS` | 1024 | *(4096)* | 8192 |
| `..._DISCOVERY` | 256 | *(1024)* | 4096 |
| `..._FORENSICS` | 256 | *(1024)* | 4096 |
| `..._ADVERSARIAL` | 256 | *(1024)* | 4096 |
| `..._VALIDATION` | 128 | *(512)* | 2048 |
| `..._OPTIMIZE` | 192 | *(768)* | 3072 |
| `AEGIS_BRIEFING_MAX_TOKENS` | 512 | *(2048)* | 8192 |

O braço `default` é vazio de propósito: herda a config publicada, então o controle é o que o repo realmente roda hoje.

**Demand padrão** nomeia explicitamente os exports que o oráculo testa (classe `RateLimiter` com construtor/`allow`/`reset`/`windowStart`/`remaining`, mais `estimateBackoffMs`, mais re-export no barrel). Escolha deliberada: isolar o teto como única variável, em vez de misturar com vagueza do pedido.

---

## 5. Mudanças feitas no repositório

1. **`scripts/substrates/raw/provider.sh`** — `finish_reason` adicionado à métrica de tokens (aceita ambos os formatos de API).
2. **`.harness/benchmark/decode_ceiling_experiment.sh`** — o runner (novo).
3. `package.json` — `aegis:bench:decode-ceiling`.
4. `.gitignore` — diretório de saída (senão a 2ª execução vê a 1ª como árvore suja e se recusa a rodar).

Guardas do runner: recusa árvore suja (faz `git reset --hard`), recusa branch principal, exige API key, `--dry-run`, confirmação interativa, e **aborta na 1ª execução se `llm_calls == 0`**.

---

## 6. Achados durante a construção

### 6.1 O harness tem um modo em que parece rodar e não chama modelo nenhum

`--agent` (ou qualquer uma de ~30 variáveis de ambiente de assistente: `CLAUDE_CODE`, `CURSOR_AGENT`, `CODEX_AGENT`, …) ativa `AEGIS_AGENTIC=1`. Comentário em `aegis:1070`:

> "Agentic detection is global: whenever an AI assistant drives the run, AEGIS_AGENTIC=1 disables internal LLM cognition (supervisor expand/split, forensics, adversarial) regardless of API-key presence."

Consequências: `briefing.sh:580` retorna `agentic_requires_schema_json`; `briefing.sh:753` desliga o supervisor split. **Zero chamadas ao provedor.**

A primeira versão do runner usava `--agent` para evitar prompts de TTY — teria produzido uma tabela limpa medindo nada. Corrigido forçando `AEGIS_AGENTIC=0` (único curto-circuito, `aegis:994`) e adicionando o abort em `llm_calls == 0`.

**Ponto meta, relevante para revisão:** um harness cujo propósito é disciplina de evidência tinha um estado silencioso "rodei sem cognição" que nenhuma métrica distinguia. Só a contagem de chamadas de provedor separa os dois — e ela não era coletada.

### 6.2 Ausência de `finish_reason` (§3)

### 6.3 `AEGIS_RAW_SUBSTRATE_MAX_TOKENS_OPTIMIZE` é inalcançável

Os substratos rodam sob `run_with_isolated_base_env`, que faz **`env -i`** (ambiente zerado) mais uma allowlist explícita. A allowlist do raw substrate (`scripts/execute_mode.sh:555-559`) encaminha DEFAULT, DISCOVERY, FORENSICS, ADVERSARIAL, VALIDATION — **não OPTIMIZE**. E OPTIMIZE também não existe em `.harness/config.sh`.

Logo `resolve_raw_max_tokens` sempre cai no default inline 768 para `optimize`, independente do ambiente. **A linha OPTIMIZE dos meus braços é inerte.** Não corrigi — é um achado sobre o harness, não sobre o experimento, e mexer nisso mudaria o sistema sob teste.

### 6.4 A suíte de testes rápida está quebrada no HEAD

Commit `f7b6a4f` apagou três scripts de teste e deixou as entradas no `package.json`. Como a cadeia usa `&&`, `npm run aegis:test:fast` morre no 2º elo e ~19 testes nunca rodam. Verificado: todos os que existem passam individualmente. Relevante porque o runner do experimento faz `git reset --hard` em loop — a rede de segurança deveria estar funcionando antes disso.

---

## 7. Ameaça principal à validade (a que mais quero atacada)

**Os tetos que o experimento varia não controlam o estágio que escreve o código.**

O oráculo pontua o código. O código é escrito pela **Aider** no estágio `build`. A allowlist da Aider (`scripts/execute_mode.sh:574-604`) **não contém nenhum teto de tokens** — ela recebe modelo, binário, timeouts, formato de edição, mas nada de `max_tokens`. O README já registra: *"Aider owns its own prompt assembly"*.

Então a cadeia causal real é:

```
BRIEFING_MAX_TOKENS ──► supervisor expand ──► Briefing + Behavior asserts ──┐
                                                                            ├──► Aider escreve código ──► ORÁCULO
_DISCOVERY/_FORENSICS ──► handover epistêmico ─────────────────────────────┘         (decode NÃO controlado)
                                                                            
_ADVERSARIAL/_VALIDATION ──► review pós-hoc ──► rejeição/rebuild ──────────►
_OPTIMIZE ──► (inerte, §6.3)
```

Duas leituras possíveis, e eu não sei qual está certa:

- **Leitura favorável:** isto é *exatamente* o teste certo. A hipótese J-Space é sobre raciocínio, não sobre comprimento de saída. Os estágios cujo teto eu controlo *são* os estágios de pensar; a Aider é o escriba. O experimento pergunta: estrangular o pensamento degrada o artefato?
- **Leitura desfavorável:** o caminho é longo e indireto demais. Um resultado nulo seria evidência fraca (a variável pode simplesmente não propagar), e um resultado positivo não localizaria a causa entre 6 estágios movidos simultaneamente.

**Pergunta para o revisor:** qual leitura procede, e o desenho deveria ser mudado para variar um estágio por vez?

---

## 8. Outras ameaças que já identifiquei

1. **Os tetos podem não ser binding.** Os prompts de forensics/discovery exigem JSON curtíssimo. Se a saída típica é ~200 tokens contra teto de 1024, então `default` e `loose` são indistinguíveis por construção, e só `tight` (256) chega perto de restringir. Isso reduziria o experimento a **uma** comparação informativa, não três. *Correção provável: rodar uma execução default primeiro, medir `completion_tokens` real por modo, e só então calibrar os braços relativos à distribuição observada.*

2. **n minúsculo.** 2 reps. Temperatura 0, mas provedores não são bit-determinísticos. Nenhum teste estatístico está previsto; a leitura seria por inspeção. Provavelmente insuficiente para diferenças pequenas.

3. **7 variáveis movidas de uma vez por braço.** Um resultado positivo não localiza o estágio culpado.

4. **Efeito de teto no oráculo.** O demand nomeia os exports explicitamente e o baseline documentado é 12/12. Se todos os braços saturarem em 12/12, o instrumento não tem poder discriminatório. Uma tarefa mais difícil, ou o demand vago do "arm D" original, teria mais headroom — ao custo de introduzir uma segunda variável.

5. **Tarefa única.** Um rate limiter. Generalização para outras classes de demand é injustificada a partir daqui.

6. **O braço `default` não é um controle limpo** no sentido usual: ele herda tetos que já diferem entre si por modo (1024/512/768). Os braços não são multiplicações uniformes de um baseline uniforme.

7. **Modo agêntico e chave de API** produzem execuções silenciosamente vazias (§6.1). Mitigado por guarda, mas o modo de falha existe.

8. **`cached_prompt_tokens` sempre `null`** no endpoint NVIDIA usado. Efeitos de cache de prefixo do provedor sobre latência/custo não são observáveis, então wall time mistura fatores.

9. **O pipeline pode fazer retry/rebuild** (`build_feedback`, quality gate do briefing com `AEGIS_BRIEFING_MAX_ATTEMPTS`). Um braço apertado pode gerar mais tentativas e chegar ao mesmo score gastando mais — o score sozinho esconderia isso. Tokens e wall time são registrados, mas contagem de retries não é.

10. **Não testei o caminho de execução real.** Tudo validado offline: parsing do oráculo em 4 cenários, ambas as agregações jq contra dados sintéticos e arquivo vazio, extração de `finish_reason` nos dois formatos, e as guardas. A execução end-to-end nunca rodou.

---

## 9. Perguntas específicas para o revisor

1. A §7 invalida o experimento ou é o desenho correto? Se inválido, qual é o desenho mínimo que testaria a hipótese sem reescrever o harness?
2. A ameaça 8.1 (tetos não-binding) deveria bloquear a execução? A calibração prévia proposta resolve, ou introduz viés de seleção?
3. Dado o custo por execução, existe um desenho mais eficiente em amostras — escada de um fator por vez, staircase adaptativo, ou variar só `BRIEFING_MAX_TOKENS` (o único no caminho causal direto)?
4. O oráculo de 12 checks é o instrumento certo? É binário demais por assert e pode saturar. Existe uma medida graduada melhor a partir dos artefatos que o pipeline já produz?
5. A analogia J-Space está sendo esticada além do que sustenta? A predição comportamental da §2 realmente decorre do achado, ou eu construí um experimento razoável em cima de uma motivação que não o implica?
6. Existe uma explicação alternativa mais simples para qualquer resultado positivo que eu venha a obter — algo que eu deveria pré-registrar como confound antes de rodar?
7. O que deveria ser pré-registrado (critério de parada, limiar de efeito, condição de descarte) para eu não racionalizar o resultado depois?

---

## 10. Inventário para reprodução

| arquivo | papel |
|---|---|
| `.harness/benchmark/decode_ceiling_experiment.sh` | runner |
| `.harness/benchmark/verify_rate_limiter.ts` | oráculo, 12 asserts |
| `scripts/substrates/raw/prompt.sh:356` | `resolve_raw_max_tokens` |
| `scripts/substrates/raw/provider.sh:~60` | métrica de tokens + `finish_reason` |
| `scripts/execute_mode.sh:~540` | `run_with_isolated_base_env` + allowlists |
| `scripts/lib/briefing.sh:515,580,753` | teto do supervisor; gates agênticos |
| `aegis:994,1070` | detecção agêntica |
| `.harness/config.sh:197-215` | tetos publicados |

```bash
bash .harness/benchmark/decode_ceiling_experiment.sh --dry-run
bash .harness/benchmark/decode_ceiling_experiment.sh --arms default --reps 1 --yes   # smoke
npm run aegis:bench:decode-ceiling                                                    # matriz completa
```

Saída: `.harness/benchmark/decode_ceiling/<timestamp>/` — `results.jsonl` (uma linha por execução), `summary.md` (agregado por braço), `<arm>-<rep>.log`, `<arm>-<rep>.metrics.jsonl`.

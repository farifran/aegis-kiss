### AEGIS COGNITION CONTRACT (AGENTS.md)

> **"O objetivo do Aegis é garantir que toda entrada seja explicada, toda transição seja determinística, todo commit seja verificado após ocorrer e toda afirmação de correção seja comprovada por uma autoridade independente."**

---

#### 1. PREFLIGHT, ALINHAMENTO E CONTRATO
O processamento começa por uma normalização mecânica da demanda. Essa etapa
não carrega o `AGENTS.md`, o `ARCHITECTURE.md` ou o briefing inteiro em um
prompt: ela só usa uma projeção curta e versionada da política de preflight.

A sequência obrigatória é:

`demanda bruta → normalização mecânica → fatos de preflight → compilação semântica única (demanda esclarecida + contrato candidato) → perguntas aprovadas (se houver) → confirmação mecânica ou revisão semântica → revisão independente opcional → demanda e contrato finais → plano de implementação`.

* A normalização mecânica trata codificação, formato, ranges e referências
  literais; ela não infere comportamento nem altera significado.
* A revisão de preflight pode formular perguntas de `INPUT`, `SCOPE` ou
  `ARCHITECTURE` antes do briefing quando a resposta for necessária para
  entender a demanda, delimitar a entrega ou resolver conflito arquitetural.
* Uma pergunta de `DEMAND` pertence ao briefing/contrato e só é válida quando
  uma ambiguidade de negócio altera comportamento observável, risco externo ou
  invariante. Ela declara evidência, impacto contratual e default recomendado.
* `questions: []` é o resultado preferível quando a demanda, o protocolo
  aplicável ou um default KISS já determinam a decisão.
* Toda resposta que alterar comportamento, escopo ou regra arquitetural deve
  ser incorporada à demanda esclarecida; se alterar comportamento observável,
  deve também aparecer no Contract IR.
* A primeira compilação semântica deve produzir os dois corpos. Se houver
  pergunta, ela também registra a resposta interpretada e os corpos provisórios:
  confirmação promove-os sem nova chamada; correção exige revisão semântica.
* Digests, vínculo arquitetural e metadados canônicos são montados e validados
  mecanicamente pelo Aegis, não reconstruídos pelo modelo.
* Conflitos com regras arquiteturais `hard` bloqueiam a execução até uma
  emenda explícita e aprovada; regras `default` podem gerar confirmação;
  preferências não viram perguntas desnecessárias.
* Decisões internas do Aegis são resolvidas pelo harness e nunca aparecem como
  perguntas do produto.

#### 2. CONTRATO → INVARIANTES → PROVAS (Requisitos Formais)
Toda demanda deve ser convertida explicitamente em requisitos canônicos, pré/pós-condições estritas e propriedades invariantes que nunca podem ser violadas. Nada deve ser implementado sem rastreabilidade bidirecional para o contrato.

Para novas demandas, o único formato ativo é `aegis.contract_ir.v2`. Contratos
`v1` pertencem apenas ao histórico Git: não são convertidos automaticamente e
não recebem compatibilidade de execução. O corte para `v2` começa de estado
governado limpo, preservando a trilha histórica no Git.

#### 3. ESTADO PROJETADO ANTES DA MUTAÇÃO (Composição Segura)
Nunca validar apenas componentes isolados ou deltas agregados ($\sum \Delta$). A transição opera obrigatoriamente como:
$$\text{Estado Atual } (S_0) \longrightarrow \text{Estado Projetado } (S_1 \dots S_n) \longrightarrow \text{Validar Invariantes} \longrightarrow \text{Promover Atomicamente } (S_{\text{commit}})$$

#### 4. VALIDAÇÃO PÓS-COMMIT OBRIGATÓRIA & PROVA INDEPENDENTE
O mesmo código que produz a mutação não pode ser a autoridade que atesta sua própria correção. O harness audita a correspondência de 4 vias:
$$\text{Requirement} \longleftrightarrow \text{Projected State} \longleftrightarrow \text{Actual State} \longleftrightarrow \text{Observable Result}$$
Invariantes devem ser verificados no estado projetado **E** no estado real pós-commit antes de autorizar a promoção.

#### 5. COBERTURA TOTAL DA ENTRADA (Mapeamento Bijetivo)
Todo elemento de entrada deve possuir um destino observável explícito: `committed`, `rejected_invalid`, `blocked_capacity`, `blocked_insolvent` ou `aborted`. Nenhum slot ou comando pode desaparecer silenciosamente ($\text{decisions.length} \equiv \text{orders.length}$).

#### 6. DETERMINISMO VERIFICÁVEL & SOBERANIA TEMPORAL
Proibidas dependências implícitas de relógio de sistema, geradores de aleatoriedade, ordem não canônica de enumeração ou estado oculto. O cursor temporal e a ordenação são propriedades explícitas de primeira classe.

#### 7. ADVERSARIAL OBRIGATÓRIO NA COMPOSIÇÃO (Red Team)
Testar sistematicamente: ordem de execução, duplicação de IDs, slots nulos/esparsos, ciclos de financiamento, aliasing ($A \to A$), tempo regressivo, rollback total e congruência entre resultado e digest canônico.

#### 8. RUNTIME & PROTOCOL DISCIPLINE
* **Autoridade Estrita**: Interpretar apenas a autoridade delegada pelo runtime.
* **KISS Cirúrgico**: Implementações locais, determinísticas e livres de complexidade acidental.
* **Emissão Direta**: Artefatos técnicos concisos sem preâmbulos conversacionais ou filler prose.
* **Disciplina de Tipos**: TypeScript estrito, zero `any`, `bigint` para grandezas numéricas e tempo explícito.

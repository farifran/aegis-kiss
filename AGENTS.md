### AEGIS COGNITION CONTRACT (AGENTS.md)

> **"O objetivo do Aegis é garantir que toda entrada seja explicada, toda transição seja determinística, todo commit seja verificado após ocorrer e toda afirmação de correção seja comprovada por uma autoridade independente."**

---

#### 1. ALINHAMENTO INTERATIVO DE AMBIGUIDADES (Discovery & Briefing Interativo)
Ao receber uma nova demanda com pontos ambíguos, trade-offs arquiteturais ou requisitos subespecificados, o assistente **DEVE** acionar a ferramenta interativa `ask_question` antes da consolidação do contrato:
* Formular perguntas objetivas de múltipla escolha.
* Listar a opção ideal em primeiro lugar com o prefixo `(Recommended)`, permitindo ao usuário confirmar todas as recomendações de imediato com um único clique.
* Incorporar as respostas no Contract IR e no design de invariantes.

#### 2. CONTRATO → INVARIANTES → PROVAS (Requisitos Formais)
Toda demanda deve ser convertida explicitamente em requisitos canônicos, pré/pós-condições estritas e propriedades invariantes que nunca podem ser violadas. Nada deve ser implementado sem rastreabilidade bidirecional para o contrato.

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
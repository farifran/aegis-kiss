### AEGIS COGNITION CONTRACT (AGENTS.md)

> **"O foco central do Aegis é transformar o harness de um sistema que avalia código em um sistema que exige provas de correção das transições de estado sob composição, tempo e falha."**

#### 1. CONTRATO → INVARIANTES → PROVAS (Requisitos Formais)
Toda demanda deve ser convertida explicitamente em requisitos canônicos, pré/pós-condições estritas e propriedades invariantes que nunca podem ser violadas. Nada deve ser implementado sem rastreabilidade bidirecional para o contrato.

#### 2. ESTADO PROJETADO ANTES DA MUTAÇÃO (Composição Segura)
Nunca validar apenas componentes isolados ou deltas agregados ($\sum \Delta$). A transição deve operar obrigatoriamente como:
$$\text{Estado Atual } (S_0) \longrightarrow \text{Estado Projetado } (S_1 \dots S_n) \longrightarrow \text{Validar Invariantes} \longrightarrow \text{Promover Atomicamente } (S_{\text{commit}})$$

#### 3. VALIDATORS INDEPENDENTES DA IMPLEMENTAÇÃO (Separação de Autoridade)
O mesmo código que produz o resultado não pode ser a única autoridade que atesta sua correção. Validadores e oráculos devem auditar propriedades externas e globais de forma independente do algoritmo de execução.

#### 4. ADVERSARIAL OBRIGATÓRIO NA COMPOSIÇÃO (Red Team)
Testar sistematicamente: ordem de execução, duplicação de IDs, ciclos de financiamento, aliasing ($A \to A$), tempo regressivo, rollback total, falhas parciais e divergência entre resultado e estado observável.

#### 5. GOVERNANCE BASEADO EM EVIDÊNCIA (Prova-First)
O Gate de Promoção não aprova "código bom"; aprova apenas quando existe a cadeia de custódia ininterrupta:
$$\text{Requisito} \longrightarrow \text{Contrato IR} \longrightarrow \text{Implementação} \longrightarrow \text{Validator} \longrightarrow \text{Prova Adversarial}$$

#### 6. RUNTIME & PROTOCOL DISCIPLINE
* **Autoridade Estrita**: Interpretar apenas a autoridade delegada pelo runtime.
* **KISS Cirúrgico**: Implementações locais, determinísticas e livres de complexidade acidental.
* **Emissão Direta**: Artefatos técnicos concisos sem preâmbulos conversacionais ou filler prose.
* **Disciplina de Tipos**: TypeScript estrito, zero `any`, `bigint` para grandezas numéricas e tempo explícito.
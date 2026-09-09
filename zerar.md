# Plano de Limpeza e Isolamento: zerar.md

---

## 1. Objetivo deste Documento
Este documento detalha **o que será apagado (zerado)** e **o que será preservado** nesta branch (`experiment/issue-centric-flow`).

O objetivo é isolar completamente o escopo, removendo o lixo burocrático e as estruturas legadas que atrapalham o desenvolvimento, permitindo que a nova funcionalidade simbiótica da **Issue-Contrato Única** seja construída e testada de forma cirúrgica e sem distrações.

---

## 2. O que Será APAGADO / ZERADO (Lista de Limpeza)

### 2.1. Schemas JSON Legados a Deletar
Estes esquemas foram criados para validar artefatos intermediários da antiga burocracia de demanda crua. Devem ser excluídos fisicamente:

1. ❌ `governance/schemas/normalized-demand.v2.schema.json`
   *(Schema que definia os parágrafos de texto, ranges de bytes e referências do prompt cru).*
2. ❌ `governance/schemas/clarified-demand.v2.schema.json`
   *(Schema intermediário que embrulhava a demanda com a tabela de cobertura).*
3. ❌ `governance/schemas/clarified-demand-body.v2.schema.json`
   *(Sub-schema complementar da demanda clarificada).*

*Economia direta:* **155 linhas de schemas JSON deletadas.**

---

### 2.2. Funções e Blocos de Código a Deletar em `scripts/lib/preflight_core.mjs`
1. ❌ **Função `normalizeDemand()` antiga:**
   Remover a lógica que gerava o array `units: [{ id: 'UNIT-0001', kind: 'paragraph', range: { startByte, endByte } }]`.
2. ❌ **Lógica de `extractUnits()` e `paragraphUnits()`:**
   Remover toda a matemática de calcular byte-offsets em loops de texto.
3. ❌ **Lógica de `extractReferences()` pontual por regex:**
   Remover a extração por expressões regulares no prompt que tentavam adivinhar arquivos, pois agora o **Discovery da Camada 0** cuida disso de forma nativa e completa na memória.
4. ❌ **Função `executionId()` atrelada ao `normalizedDemandDigest`:**
   A identidade de execução passa a ser calculada a partir do `commitBase` e do `issueDigest` (ou `contractDigest`).

*Economia direta:* **~270 linhas de código deletadas.**

---

### 2.3. Blocos de Código a Deletar em `scripts/finalize_preflight.mjs`
Este arquivo tem hoje mais de 1.000 linhas. As seguintes rotinas serão limpas:
1. ❌ **Funções `unitIdsInEnvelope()` e `requireIndexes()`:**
   Checagens que garantiam que todo índice de unidade tinha que aparecer em um requisito.
2. ❌ **Função `hasVerbatimUnitEvidence()`:**
   A rotina que forçava a IA a fazer copia-e-cola de palavras exatas do prompt cru para provar que a evidência era textual.
3. ❌ **Montagem de `inputCoverage`:**
   A tabela que mapeava cada `UNIT-NNNN` para um `disposition` (`REQUIREMENT` / `CONTEXT` / `REJECTED_INVALID`).
4. ❌ **Verificação cruzada de digest de envelope no preflight final:**
   Remover o bloqueio `preflight_context_digest_mismatch` que quebrava o fluxo quando a demanda bruta sofria qualquer variação de formatação.

*Economia direta:* **~350 linhas de código deletadas.**

---

### 2.4. Simplificações em `scripts/ide_gateway.sh`
1. ❌ **Eliminar o loop que exigia reenviar a mesma string de demanda em cada subcomando:**
   Hoje, o comando obriga a passar `"Pessoal, a operação precisa..."` repetidamente no `finalize`, no `continue` e no `review`. Isso é eliminado: a esteira passa a operar sobre o rascunho da Issue ativa no diretório de runtime.
2. ❌ **Remover subcomandos redundantes:**
   Substituir chamadas fragmentadas por um fluxo coeso: `./aegis draft` $\to$ `./aegis approve`.

*Economia direta:* **~100 linhas de código de shell script deletadas.**

---

### 2.5. O Diretório de Produto (`src/`) Fica 100% Zerado
* Toda e qualquer implementação de regras de negócio anteriores (como o barramento de ordens, `ledger.ts`, `isolation.ts`, etc.) **não pertence ao Aegis** e deve ser zerada.
* O diretório `src/` fica como uma **folha em branco**, contendo apenas o ponto de entrada inicial vazio:
  ```typescript
  // src/index.ts
  export {};
  ```
* Isso garante que a nova esteira seja testada em um ambiente puro e sem herança de código anterior.

---

## 3. O que Será PRESERVADO e MANTIDO INTACTO (A Infraestrutura do Aegis)

Preservamos exclusivamente os **mecanismos de governança e infraestrutura do Aegis** que garantem a segurança matemática do sistema:

| Componente Preservado | Arquivo / Localização | Por que é mantido? |
| :--- | :--- | :--- |
| **Portões Estáticos (Static Gate)** | `scripts/substrates/static_gate.sh`, `npm run aegis:*` | Banimento absoluto de ponto flutuante, `Date.now()` e alocações de GC em hot-paths. |
| **Ponto de Entrada Canônico** | `src/index.ts` | Ponto de exportação nominal inicial vazio sob padrão ESM estrito (`.js`). |
| **Auditoria Red Team (7 Classes)** | `scripts/formal_promotion_authorization.sh` | Validador adversarial de atomicidade, tempo, limites e continuidade. |
| **Recibos Criptográficos de Commit** | `.git/aegis/precommit_receipt.json` e hooks do Git | Garantia de que nenhum commit entra no repositório sem prova formal prévia. |
| **Constituição e Políticas** | `AGENTS.md`, `governance/policies/` | Leis do projeto (`ARCH-FAILURE-EXPLICIT`, `ARCH-DETERMINISTIC-TIME`). |
| **Motor de Discovery da Camada 0** | `scripts/lib/preflight_core.mjs` (`discoverRepository`) | Varredura em memória da árvore Git (`git ls-tree`), que agora se torna a fonte exclusiva de fatos. |


---

## 4. O Estado Enxuto Alvo da Branch

Ao final da limpeza nesta branch experimental:

1. **Estrutura de Arquivos Limpa:**
   * A pasta `governance/schemas/` terá apenas os schemas necessários (`issue-spec.v1`, `contract-ir.v3`, `reviewer-execution.v1`, etc.).
   * Os scripts do harness terão cerca de **1.000 linhas a menos**, tornando a manutenção extremamente simples.
2. **Ciclo de Teste Isolado:**
   * Poderemos executar um teste completo:
     ```bash
     # 1. Gerar o rascunho simbiótico da Issue a partir de um prompt informal:
     ./aegis "liquidação de ordens em memória com taxa e isolamento"

     # 2. Inspecionar o contract.md gerado na IDE (com opções recomendadas pré-selecionadas).

     # 3. Aprovar em 1 clique:
     ./aegis approve

     # 4. Rodar as provas e o commit com status PROVEN.
     ```
3. **Segurança de Reversão:**
   * Como tudo está documentado aqui, podemos podar sem medo. Se precisarmos de qualquer referência da implementação antiga, a branch `main` continua intocada a um `git checkout main` de distância.

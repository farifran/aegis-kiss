# Demanda de Modernização: Paradigma Simbiótico Issue-Centric (Single Root of Authority)

---

## 1. Identificação e Propósito da Branch
* **Branch de Trabalho:** `experiment/issue-centric-flow`
* **Branch Alvo de Fusão:** `main`
* **Objetivo:** Substituir a esteira burocrática de congelamento prematuro de texto cru e fatiamento em `UNITs` (legado) por um fluxo de **alta simbiose entre Humano e Inteligência Artificial**, onde a **Issue-Contrato Unificada** é a primeira e única raiz criptográfica de autoridade do sistema.

Este documento serve como a **especificação formal da mudança** e como **guia de justificativa de fusão (Merge Rationale)** para quando esta funcionalidade estiver 100% provada e pronta para ser incorporada à `main`.

---

## 2. O Problema da `main` que Estamos Substituindo

Na branch `main`, o Aegis original sofre de rigidez artificial na entrada:
1. **Superstição do Prompt Cru:** O sistema congela o texto inicial do usuário no primeiro segundo (`normalizedDemandDigest`), tratando um rascunho de chat cheio de ruído como documento sagrado.
2. **Fatiamento em `UNITs`:** Quebra o texto em `UNIT-0001`..`UNIT-NNNN`, calcula byte-offsets e amarra cada cláusula a coordenadas de caracteres. Se uma quebra de linha `\r\n` mudar para `\n`, o digest quebra e força `./aegis --clean`.
3. **Duplicação Estrutural:** Existem quatro representações para a mesma coisa: `normalizedDemand`, `preflightDecision`, `clarifiedDemand` e `contractIR`.
4. **Consulta Mecânica Redundante:** Executa regexes pontuais para tentar achar caminhos de arquivos e depois executa o Discovery completo.

---

## 3. O Novo Paradigma: Simbiose Humano-IA com Geração Otimista

O novo fluxo estabelece uma divisão de trabalho inteligente entre a IA e o ser humano:

$$\text{Prompt Informal} + \text{Discovery (RAM)} \longrightarrow \text{Inferência Proativa da IA} \longrightarrow \text{Aprovação Humana (1 Clique)} \longrightarrow \mathbf{HASH\ RAIZ\ ÚNICO}$$

### 3.1. O Trabalho Pesado da IA (Proativo & Pré-Cozinhado)
A IA não espera passivamente nem bombardeia o usuário com perguntas em branco. Ela atua em 5 camadas simultâneas:
1. **Tolerância a Ruído e Correção Semântica:** Interpreta prompts com gírias, erros gramaticais, ortografia torta ou escrita incompleta, extraindo a real intenção de negócio.
2. **Filtro Anti-Sobre-engenharia (`AGENTS.md`):** Se o usuário pedir padrões inflados (*factories*, *event-emitters*, injeção de dependência complexa), a IA reescreve a proposta aplicando o princípio KISS / Dumb Code Rule (Protocolo Karpathy).
3. **Filtro Arquitetural (`ARCHITECTURE.md`):** Se o prompt pedir más práticas (*"coloquem capturas silenciosas para a esteira nunca falhar"*), a IA aplica `ARCH-FAILURE-EXPLICIT` e já formata a Issue exigindo resultados de erro explícitos.
4. **Seleção Otimista de Decisões Recomendadas (*Pre-baking*):** Para cada bifurcação de negócio aberta (ex: taxas, janelas de tempo, critérios de quarentena), a IA **já escolhe a melhor alternativa técnica recomendada e já constrói a Issue completa assumindo essa escolha**.
5. **Emissão de Cards de Decisão:** As perguntas não são bloqueios; são cards com a opção ótima já pré-marcada (*pre-checked*).

### 3.2. A Experiência do Humano (Diretor Executivo)
* **Caminho Feliz (90% das vezes):** O humano lê o resumo executivo, vê que as escolhas pré-selecionadas fazem sentido e aperta **`Enter`** (aprovação em 1 clique, ~5 segundos).
* **Caminho de Ajuste (10% das vezes):** Se quiser mudar uma decisão (ex: taxa fixa em vez de escalonada), ele altera a alternativa no seletor. A IA aplica um patch instantâneo na Issue e o humano confirma.

---

## 4. A Unificação: Issue e Contrato São a Mesma Coisa

A Issue e o Contrato deixam de ser dois conceitos separados e tornam-se **duas projeções da mesma estrutura**:

| Projeção | Formato / Destino | Para que serve? |
| :--- | :--- | :--- |
| **Face Humana (`issue.md`)** | Markdown elegante na IDE | Leitura limpa, checkboxes de requisitos, escopo visual de arquivos e facilidade de edição. |
| **Face Máquina (`contract.json`)** | JSON canônico determinístico do Aegis | Tipagem formal, invariantes, IDs de falha e geração do hash imutável (`contractDigest`). |

O **Hash Raiz Único** do projeto é gerado no momento do aceite da Issue-Contrato. Nada antes disso precisa ser assinado.

---

## 5. Fase 3 — Discovery na memória RAM

O **Discovery mecânico** observa exclusivamente `src/`, com limites explícitos de arquivos, entradas e bytes. Ele lê cada arquivo regular uma vez, mantém o texto somente em RAM e persiste apenas:

1. manifesto canônico com caminho, tamanho real, classificação e SHA-256;
2. digest único do snapshot observado;
3. entradas ignoradas, como links simbólicos;
4. evidência lexical limitada à primeira ocorrência de cada termo.

A evidência lexical é apenas uma pista textual. Ela não afirma compreender regras de negócio, detectar vulnerabilidades, provar código morto nem estabelecer relações semânticas. Antes da assinatura, o snapshot de `src/` é recalculado; qualquer mudança invalida o preflight e exige um novo Discovery.

Os caminhos mantêm a identidade nativa dos arquivos: barras invertidas só são convertidas no Windows. Controles direcionais Unicode invisíveis são rejeitados para impedir nomes visualmente enganosos no contrato.

O resultado mecânico possui uma única fonte persistida: `.harness/runtime/preflight.json`. Não existe uma cópia em Markdown; a face humana será produzida somente para o contrato que precisará de revisão.

### Interface da deliberação semântica

O Preflight completo permanece como evidência do Harness. `./aegis --semantic-request` produz em RAM somente a projeção útil ao raciocínio:

- `intent`;
- estado estrutural do Discovery;
- caminhos dos arquivos textuais observados;
- caminhos indisponíveis e seus motivos (`BINARY`, `INVALID_UTF8` ou `SYMLINK`);
- estado e truncamento da evidência lexical;
- termo e caminho de cada correspondência lexical.
- trechos limitados dos arquivos correspondentes, marcados explicitamente como evidência não confiável e nunca como instruções;
- constituição estruturada em `governance/constitution.json`, autenticada contra `AGENTS.md` e acompanhada de seu digest canônico;
- política arquitetural estruturada em `governance/architecture.policy.json`, autenticada contra `ARCHITECTURE.md` e acompanhada de todas as regras aplicáveis;
- schema JSON completo e estrito que define a resposta esperada da IA, acompanhado de identificador e digest.

Não são enviados à IA metadados da captura, contadores, tamanhos, hashes de arquivos, termos sem correspondência, números de linha, `sourceSnapshotDigest` ou `preflightDigest`. As projeções JSON são as únicas representações consumidas semanticamente; qualquer divergência em relação aos documentos humanos bloqueia o fluxo. A saída da IA é obrigada a repetir o `contextDigest` calculado sobre constituição, intenção, Discovery, política e eventual revisão humana, além de seguir o documento completo de `aegis.semantic_draft.v1`. Respostas de outro contexto são rejeitadas. Intenção, digests, caminhos observados, seleção recomendada e `implementationAuthorized: false` são acrescentados mecanicamente pelo Harness no contrato v3.

O rascunho declara explicitamente sua interpretação, revisão de complexidade e revisão de riscos. Sobre-engenharia detectada deve produzir alternativas mais simples; vulnerabilidades e riscos recebem categoria, nível, mitigação e requisitos afetados. Conflitos arquiteturais podem chegar ao Wizard quando vinculados a uma decisão, mas somente uma alternativa compatível ou uma emenda já aprovada pode sustentar o contrato final.

Cada requisito contém um caso `HAPPY_PATH` e pelo menos um caso `FAILURE` ou `BOUNDARY`. Esses casos especificam provas falsificáveis, mas não apontam para executores nem autorizam a criação de scripts. Uma escolha diferente da recomendada retorna `SEMANTIC_RECOMPILATION_REQUIRED`; a resolução humana é incorporada à próxima requisição e requisitos, riscos e casos de aceitação devem ser recompilados antes da assinatura.

---

## 6. Critérios de Aceite para Fusão (Merge Checklist com a `main`)

Esta branch só será integrada de volta na `main` quando cumprir 100% dos seguintes requisitos:

- [ ] **Adaptador de IA Ponta a Ponta:** Um provedor externo consome a interface semântica e devolve `aegis.semantic_draft.v1`.
- [ ] **Aprovação Atômica em 1 Clique:** Confirmar a Issue gera o `contractDigest` canônico diretamente.
- [ ] **Eliminação de UNITs:** Zero fatiamento de parágrafos e zero erro de `normalized_demand_digest_mismatch`.
- [ ] **Discovery delimitado e verificável:** Conteúdo analisado em RAM, manifesto canônico persistido e snapshot de `src/` reconferido antes da assinatura.
- [ ] **Preservação da Segurança:** schema estrito, validação referencial, política arquitetural autenticada e zero alteração em `src/` durante todo o fluxo.

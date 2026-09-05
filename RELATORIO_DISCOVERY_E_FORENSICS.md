# Relatório — evolução de Discovery e Forensics no Aegis

## Objetivo

Definir uma arquitetura que combine a descoberta adaptativa do IDE com uma
base determinística, pequena e auditável do Aegis. O objetivo não é recriar o
CLI antigo, nem criar um segundo IDE: é reduzir busca repetitiva e tornar
exploração, escopo e promoção mais reproduzíveis.

Este documento separa fatos observados no histórico do repositório de decisões
propostas. Não assume métricas de tempo ou tokens que ainda não foram medidas.

## Resumo executivo

O Aegis percorreu três desenhos distintos:

```text
CLI anterior
→ Discovery determinístico amplo → Forensics → mutação/validação

Intake anterior
→ Mini Aegis focado em targets → contexto grande para supervisor

Estado atual
→ IDE descobre e interpreta → Aegis governa contrato, provas e promoção
```

O estado atual eliminou duplicação de ferramentas e chamadas remotas do CLI,
mas transferiu toda a escolha de descoberta ao modelo do IDE. A proposta é
recuperar somente uma camada zero mecânica, efêmera e orientada pela demanda:

```text
demanda → Discovery determinístico em memória → IDE → contrato →
Forensics determinístico por contrato/diff → provas e receipt
```

O IDE continua responsável por significado, investigação profunda e decisões
de produto. O Aegis passa a fornecer fatos repetíveis, limites e uma trilha de
evidência para essas decisões.

---

## 1. De onde viemos

### 1.1. Mini Aegis de intake

O Mini Aegis histórico (`scripts/lib/mini_aegis.sh`, removido no commit
`90e6c1b`) era um preparador de contexto para o intake. Ele recebia targets
previamente escolhidos, adicionava um entrypoint convencional quando existente
e retornava:

- existência e tamanho dos targets;
- exports TypeScript extraídos por regex;
- trecho de até 16 KiB por arquivo;
- uma topologia superficial dos primeiros arquivos TS/JS rastreados pelo Git.

Depois, o sintetizador incluía demanda, snippets e documentos de governança em
um handover textual para o supervisor.

```text
target já escolhido
→ Mini Aegis
→ texto grande de contexto
→ supervisor remoto ou handover ao IDE
```

#### Vantagens

- obtenção local e determinística de fatos básicos;
- fornecia algum contexto inicial sem o supervisor procurar arquivos às cegas;
- identificava arquivos novos e um barrel convencional;
- podia operar sem chamada de modelo durante a coleta.

#### Desvantagens

- não era orientado pela demanda ao selecionar targets: recebia um alvo já
  definido;
- era específico de TS/JS e de padrões simples de export;
- lia o conteúdo inteiro antes de truncar o snippet de 16 KiB; portanto a
  alegação de leitura limitada não era verdadeira para arquivos grandes;
- a topologia era cortada por posição, não por relevância;
- o handover injetava snippets e documentos inteiros no prompt, aumentando o
  consumo de tokens do supervisor;
- não era forensics: não executava testes, não analisava diffs nem provava
  causalidade de falhas.

O Mini era uma boa primitiva de coleta, mas não uma autoridade suficiente para
descoberta completa ou para interpretar a demanda.

### 1.2. Discovery e Forensics do pipeline completo

O pipeline anterior era:

```text
discovery → forensics → mutation → optimize → adversarial → validation
```

#### Discovery anterior

O modo `discovery` era mecânico e não carregava uma skill em modelo. O envelope
de evidências incluía, entre outros:

- anchors extraídos da demanda;
- listagem da árvore;
- estado/handover do runtime;
- `runtime.layer0_facts`;
- `runtime.attention_seed`.

O `Layer 0` aplicava sinais determinísticos: entrypoints declarados, relações
de import, churn recente do Git e ressonância lexical entre a demanda e nomes
ou conteúdo de arquivos. O resultado era um handover com candidatos de atenção,
não autorização para editar.

#### Forensics anterior

O modo `forensics` recebia o handover do Discovery e produzia
`mutation_candidates` ou `inconclusive`. Seu perfil usava anchors da demanda,
handover e busca de símbolos; leituras adicionais de arquivos eram limitadas.
Quando os anchors eram inequívocos, havia um caminho mecânico. Quando não eram,
o sistema podia acionar um modelo remoto para interpretar o resultado.

```text
fatos do Discovery
→ candidato de mutação justificado, ou INCONCLUSIVE
→ somente então mutation
```

#### Vantagens

- a demanda influenciava a descoberta, não apenas um target manual;
- havia separação de responsabilidades: encontrar, justificar, alterar,
  desafiar e validar;
- o handover tornava a transição entre fases observável;
- `INCONCLUSIVE` podia bloquear mutação sem evidência suficiente;
- boa parte dos fatos era local, repetível e sem tokens de modelo;
- havia limites de leituras e reuso de algumas evidências dentro do pipeline.

#### Desvantagens

- o Discovery podia varrer o repositório amplamente: censo Git, busca de
  imports, busca lexical e churn de commits; isso não é custo adequado para
  toda demanda simples;
- parte do Layer 0 assumia TypeScript/JavaScript, `package.json`, `tsconfig`
  e padrões específicos de import;
- Forensics deixava de ser puramente determinístico quando recorria a um modelo;
- handovers, payloads, caches de runtime e múltiplos subprocessos aumentavam
  complexidade, I/O e superfície de falha;
- cache de evidência entre execuções contradiz a política desejada de explorar
  novamente cada nova demanda;
- a palavra “forensics” cobria também heurística e interpretação, não somente
  fatos verificáveis.

### 1.3. Conclusão sobre a versão anterior

O pipeline completo tinha a melhor ideia arquitetural: separar descoberta de
interpretação e exigir evidência antes de mutar. Ele não deve ser restaurado
literalmente porque carregava custo, acoplamento ao CLI/Aider e pressupostos de
linguagem que conflitam com um harness universal e KISS.

---

## 2. Onde estamos: IDE + Aegis atual

Hoje o IDE faz discovery e forensics de forma adaptativa. As operações são
mecânicas (`listar`, `buscar`, `ler`, `executar`), mas o modelo decide qual é o
próximo passo, que consulta fazer, que resultado é relevante e quando parar.

O gateway atual do Aegis registra a demanda, verifica contrato/provas e cria o
receipt de promoção. Ele não executa o pipeline antigo de Discovery/Forensics.

```text
IDE
→ discovery, leitura, interação, edição, execução e interpretação

Aegis atual
→ proveniência da demanda, contrato, provas, receipt e promoção
```

### Vantagens do estado atual

- o IDE lê precisamente as linhas necessárias e muda a exploração conforme a
  evidência real aparece;
- não há segundo codificador, supervisor CLI ou fluxo TTY concorrendo com o
  IDE;
- elimina o grande handover textual e a duplicação de discovery;
- erros de compilação e testes são investigados imediatamente pelo mesmo agente
  que pode corrigir o código;
- o core atual é menor, mais fácil de entender e de manter.

### Desvantagens do estado atual

- a escolha da sequência de discovery é guiada pelo modelo, portanto não é
  reproduzível apenas com demanda e snapshot;
- resultados de ferramentas entram no contexto do modelo e consomem tokens;
- não há uma primeira lista canônica de candidatos/anchors vinculável ao
  contrato;
- duas execuções podem explorar arquivos diferentes antes de chegar à mesma
  conclusão;
- uma análise posterior tem menos evidência mecânica para explicar por que o
  primeiro arquivo foi investigado;
- o Aegis não dispõe de um `INCONCLUSIVE` determinístico antes da mutação.

O IDE é superior para interpretação semântica e casos ambíguos. A ausência de
uma camada factual anterior é a lacuna que a proposta deve preencher.

---

## 3. Proposta: Discovery e Forensics determinísticos, efêmeros e complementares

### 3.1. Princípio de autoridade

```text
Aegis mecânico
→ fatos, limites, hashes, candidatos e estados explícitos

IDE
→ significado, investigação semântica, contrato candidato e implementação

Aegis formal
→ confronto contrato/estado/provas, receipt e promoção
```

Um scanner não pode afirmar que um arquivo é “a causa” de um problema. Ele pode
afirmar, por exemplo, que um arquivo contém um símbolo citado na demanda, que é
um entrypoint declarado, que aparece no diff ou que tem uma relação de import
observável. A conclusão semântica permanece no IDE.

### 3.2. Novo Discovery de camada zero

O gatilho é uma nova demanda. Ele acontece antes do briefing preliminar e antes
de qualquer pergunta ao usuário, em conformidade com a sequência constitucional:

```text
demanda bruta
→ Discovery mecânico em memória
→ briefing preliminar no IDE
→ contrato candidato
→ revisão independente, se aplicável
→ perguntas aprovadas, se restarem ambiguidades reais
```

Entradas canônicas:

- texto bruto da demanda e seu digest;
- target explicitamente fornecido, quando existir;
- snapshot do worktree e versão do scanner;
- orçamento explícito de arquivos, bytes, consultas e tempo.

Saída canônica, limitada e ordenada:

```json
{
  "schema": "aegis.discovery.v1",
  "status": "CANDIDATES|UNKNOWN|INCOMPLETE|NOT_APPLICABLE",
  "demandDigest": "...",
  "worktreeDigest": "...",
  "candidates": [
    {
      "path": "src/example.ts",
      "reasons": ["explicit_path", "filename_match"],
      "confidence": "mechanical_candidate"
    }
  ],
  "limits": { "files": 0, "bytes": 0, "queries": 0 }
}
```

Regras:

- não ler conteúdo por padrão;
- priorizar caminhos e símbolos explicitamente presentes na demanda;
- usar ranking lexical simples e versionado apenas como sugestão;
- não escolher target por autoridade;
- não incluir snippets, documentos de governança ou prompts;
- retornar `UNKNOWN` se os sinais não justificarem candidato;
- devolver o JSON pela saída da própria execução e descartá-lo quando o processo
  terminar.

Esse JSON ocupa um orçamento pequeno de contexto quando o IDE o recebe. A
economia não é “zero tokens”: elimina-se um segundo modelo e dumps grandes, mas
o IDE ainda precisa ler os fatos enviados e investigar semanticamente.

### 3.3. Novo Forensics determinístico

Forensics deve ocorrer depois que o IDE propõe o contrato e antes de promover
uma mutação relevante. Ele não pergunta “o que o usuário quis dizer”; confronta
as afirmações do contrato com fatos locais:

```text
Contrato candidato + targets declarados + estado do Git + diff + resultados
determinísticos de ferramentas
→ PROVEN | DISPROVEN | UNPROVEN | NOT_APPLICABLE
```

Exemplos universais de fatos que ele pode verificar:

- targets do contrato existem, são seguros e correspondem ao escopo real;
- arquivos alterados pertencem ao escopo declarado;
- entradas citadas não desaparecem silenciosamente;
- o diff validado é o diff que será promovido;
- typecheck, lint e testes declarados foram executados com resultado explícito;
- o resultado é `UNPROVEN` quando não há autoridade ou prova aplicável.

Testes de domínio, WAL, benchmark, caos ou blockchain não entram no core. Eles
são provas do projeto selecionadas pelo contrato e perfil (`fast`, `targeted`,
`release`, `forensic`).

### 3.4. Ciclo de vida em memória

```text
início de ./aegis "demanda"
→ dados de Discovery e Forensics vivem na RAM do processo
→ JSON limitado é devolvido ao IDE
→ processo termina
→ fatos exploratórios desaparecem
```

Não deve existir cache implícito entre demandas. Uma demanda nova exige nova
exploração, mesmo se o repositório não mudou.

Há uma exceção deliberada: contrato ativo, registro de provas e receipt precisam
ser duráveis. Eles governam a implementação e o commit; se existissem apenas em
memória, o hook de commit não poderia verificar a promoção posteriormente.

---

## 4. Por que esta é uma evolução

| Dimensão | CLI anterior | IDE atual | Proposta |
| --- | --- | --- | --- |
| Descoberta inicial | Determinística, mas ampla e acoplada | Semântica e adaptativa, mas dependente do modelo | Determinística, pequena e entregue ao IDE |
| Forensics | Parcialmente mecânico; podia chamar modelo | Interpretativo no próprio IDE | Mecânico para fatos/escopo; IDE para significado |
| Tokens | Supervisor, prompts e contexto grandes | Ferramentas e resultados entram no contexto | Pequeno JSON factual; sem segundo supervisor |
| Determinismo | Alto em partes, menor nas transições/modelo | Baixo na sequência de exploração | Alto para fatos e gates; explícito onde há interpretação |
| Universalidade | Viés TS/JS e CLI | Boa capacidade semântica | Core neutro; adaptadores por projeto |
| Reexecução | Runtime e cache complexos | Não há trilha inicial canônica | Mesmo input/snapshot produz mesmo relatório |
| Limpeza | Muitos artefatos/caches | Core limpo | Fatos efêmeros; só governança permanece |

Não há ganho honesto garantido de tempo sem benchmark. A hipótese testável é
que o primeiro passo mecânico reduzirá buscas e leituras desnecessárias no IDE,
sobretudo em repositórios médios/grandes. O orçamento rígido impede que a
otimização vire uma varredura cara em demandas simples.

---

## 5. Estado atual do projeto e adaptações necessárias

O projeto atual já possui um gateway IDE minimalista e a governança de
contrato/provas/receipt. Há também, neste worktree, uma implementação ainda não
commitada de `scripts/evidence_inventory.sh` e do comando `aegis evidence`.
Ela é uma primitiva segura de inventário por caminhos explícitos, mas não é a
proposta final porque:

- é chamada separadamente, não pelo intake da demanda;
- guarda cache em `.harness/runtime/mechanical_inventory.json`;
- permite reuso entre comandos, enquanto a política proposta exige descarte ao
  fim de cada demanda;
- não extrai anchors nem sugere candidatos a partir da demanda.

Ela pode ser reaproveitada somente pela parte de limites, segurança de caminhos,
leitura parcial e testes. Seu cache transitório deve ser removido ou restrito a
uma única execução, não preservado entre demandas.

### Sequência recomendada de implementação

1. **Definir o schema e o orçamento de `aegis.discovery.v1`.**
   Fixar estados, ordenação, versão do algoritmo, limites e digest. Não iniciar
   pela heurística; iniciar pela interface verificável.

2. **Criar o scanner efêmero.**
   Ele recebe demanda/target, coleta anchors, faz censo limitado e retorna JSON
   para `stdout`. Sem escrita em `.harness/runtime/`, sem cache entre comandos e
   sem modelo.

3. **Integrar ao intake, não às perguntas.**
   `./aegis "demanda"` produz proveniência e Discovery na mesma execução. O IDE
   usa a saída antes do briefing; a Constituição continua sendo a fonte das
   perguntas, não o scanner.

4. **Manter o IDE como investigador.**
   O resultado deve conter caminhos e razões, não conteúdo. O IDE abre apenas
   os candidatos necessários com suas ferramentas nativas.

5. **Adicionar Forensics formal mínimo.**
   Após o contrato candidato, validar coerência entre demanda, targets, diff,
   estado do Git e provas declaradas. O resultado deve distinguir `PROVEN`,
   `DISPROVEN`, `UNPROVEN` e `NOT_APPLICABLE`.

6. **Vincular somente digests ao contrato/receipt.**
   Caso a demanda exija rastreabilidade, guardar digest e versão do scanner;
   não guardar dumps de Discovery nem logs brutos no `src` ou no core.

7. **Criar testes de propriedades e benchmarks do harness.**
   Cobrir determinismo, ordenação, limites, caminhos com espaços, symlinks,
   repositórios sem `src`, monorepos, ausência de candidatos e invalidação por
   snapshot. Medir tempo, memória, bytes emitidos e tokens de contexto antes e
   depois em amostras representativas.

8. **Remover a infraestrutura antiga definitivamente.**
   Não restaurar `raw_llm`, Aider, worktrees descartáveis, prompt synthesis ou
   cache de sete dias como dependência do caminho IDE.

## Critério de aceitação da evolução

Uma implementação estará pronta quando puder demonstrar:

```text
mesma demanda + mesmo worktree + mesma versão
→ mesmo Discovery JSON

novo comando/demanda
→ nenhuma evidência exploratória anterior reaproveitada

sem candidato confiável
→ UNKNOWN, não alvo inventado

contrato/diff divergentes
→ UNPROVEN ou DISPROVEN, não promoção

demanda simples
→ orçamento pequeno, nenhum segundo modelo e nenhum artefato persistente
```

Esse desenho é uma evolução porque preserva a eficiência semântica do IDE,
recupera o determinismo útil do Aegis antigo e reduz a complexidade que tornou
o pipeline CLI lento e difícil de manter.

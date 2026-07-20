entry.md# Estratégias para Otimização do Aegis com Modelos Menores (8B)

Este documento reúne caminhos e técnicas para melhorar a confiabilidade, a precisão e a taxa de sucesso do pipeline do Aegis Harness quando operando com modelos de linguagem menores (como o Llama-3.1-8b-instruct). As soluções são categorizadas pelo nível de intervenção e acompanhadas por considerações de integração para uma adoção paulatina.

---

## Índice
1. [Nível 1: Validação e Feedback do Ambiente (Determinístico)](#nível-1-validação-e-feedback-do-ambiente-determinístico)
2. [Nível 2: Limitação e Pruning de Contexto (Foco)](#nível-2-limitação-e-pruning-de-contexto-foco)
3. [Nível 3: Engenharia de Prompt e Estruturação de LLM](#nível-3-engenharia-de-prompt-e-estruturação-de-llm)
4. [Nível 4: Fluxo de Trabalho e Orquestração](#nível-4-fluxo-de-trabalho-e-orquestração)
5. [Considerações para Integração Paulatina](#considerações-para-integração-paulatina)

---

## Nível 1: Validação e Feedback do Ambiente (Determinístico)

### 1.1 Exigir Testes Unitários no Fluxo (TDD)
* **Conceito**: Forçar a escrita ou atualização de testes unitários para a funcionalidade antes ou durante a fase de reparação.
* **Por que funciona**: Modelos fracos falham em simular a execução mental da lógica. Quando um teste concreto roda (`test.run`) e falha, o erro prático gerado serve como um guia inequívoco para a próxima iteração de reparo.

### 1.2 Validação Estrita do Compilador (`tsconfig.json` e ESLint)
* **Conceito**: Habilitar checagens estritas no compilador TypeScript (como `noImplicitAny`, `noUnusedLocals`, `strictNullChecks`).
* **Por que funciona**: Impede que o modelo escreva códigos que dependam de imports inexistentes ou com tipagem incoerente. O compilador barra a alteração antes que ela chegue às fases de execução.

### 1.3 Verificadores Programáticos Estáticos (Linter Customizado)
* **Conceito**: Criar regras simples de verificação no gate de validação usando `grep` ou ferramentas como `ast-grep` (ex: bloquear imports de pacotes não declarados no `package.json`).
* **Por que funciona**: É 100% determinístico, rápido e não consome tokens de LLM para identificar violações de regras estruturais simples.

### 1.4 Sanity Check Dinâmico (Execução em Sandbox)
* **Conceito**: Adicionar uma etapa que tenta carregar/importar dinamicamente o arquivo gerado em um processo isolado e executar uma chamada básica para testar se ele trava (loop infinito) ou lança exceções imediatas.
* **Por que funciona**: Detecta bugs de runtime críticos que passam pelo compilador TypeScript (como comparações erradas de timestamps e loops infinitos).

### 1.5 Auto-Correção via Ferramentas (Auto-fix)
* **Conceito**: Rodar `eslint --fix` ou `prettier --write` no arquivo alterado imediatamente após a fase de `Repair`.
* **Por que funciona**: Resolve problemas triviais de estilo, formatação e imports não utilizados de forma automatizada, evitando que a validação falhe por motivos estéticos simples.

---

## Nível 2: Limitação e Pruning de Contexto (Foco)

### 2.1 Redução e Limpeza de Contexto (Context Pruning)
* **Conceito**: Filtrar e limitar os metadados do repositório enviados para o modelo de 8B (como encolher o "pocket map" e a lista de arquivos disponíveis).
* **Por que funciona**: Modelos pequenos sofrem de "perda de atenção" quando expostos a contextos longos ou múltiplos caminhos de arquivos irrelevantes, o que os induz a tentar editar arquivos que não deveriam.

### 2.2 Workspace Few-Shot (Códigos de Referência)
* **Conceito**: Manter no repositório um ou dois arquivos de exemplo com padrões perfeitos (ex: como usar `BigInt` nativo ou como estruturar uma classe de utilitários).
* **Por que funciona**: Modelos 8B são excelentes em imitar estruturas e estilos de código existentes no ambiente de trabalho. Se houver um bom exemplo, eles o seguirão.

---

## Nível 3: Engenharia de Prompt e Estruturação de LLM

### 3.1 Exemplos Few-Shot nos Prompts dos Substratos
* **Conceito**: Adicionar exemplos estáticos de "entrada -> saída esperada" diretamente nos arquivos de prompt dos substratos (`raw_llm.sh` e `aider_substrate.sh`).
* **Por que funciona**: Evita que o modelo precise deduzir regras complexas a partir de descrições abstratas. Exemplos claros de JSON de validação corretos reduzem a taxa de malformação de artefatos.

### 3.2 Cadeia de Pensamento Forçada (Chain of Thought - CoT)
* **Conceito**: Instruir o modelo a escrever primeiro uma seção de raciocínio passo a passo (ex: `<thinking> ... </thinking>`) antes de gerar o JSON ou código final.
* **Por que funciona**: Modelos menores performam significativamente melhor quando têm espaço para decompor o problema antes de começar a escrever o resultado definitivo.

### 3.3 Saídas Estruturadas via API (Structured Outputs)
* **Conceito**: Configurar a chamada de inferência no substrato para usar o formato estruturado do provedor (`response_format: { type: "json_object" }`).
* **Por que funciona**: Garante que o modelo nunca quebre o parser de JSON ao esquecer de fechar chaves ou adicionar texto extra fora dos delimitadores.

### 3.4 Temperatura Determinística (T = 0.0)
* **Conceito**: Definir a temperatura de geração como `0.0` (ou o mais próximo possível) para todas as chamadas de código e validação.
* **Por que funciona**: Reduz a variação de respostas e foca a decodificação nos tokens mais prováveis, o que diminui alucinações matemáticas e lógicas.

---

## Nível 4: Fluxo de Trabalho e Orquestração

### 4.1 Micro-Mutações (Passos Incrementais)
* **Conceito**: Quebrar solicitações complexas em tarefas menores solicitadas sequencialmente.
* **Por que funciona**: É mais fácil para um modelo de 8B executar 4 alterações pequenas e focadas com sucesso do que tentar resolver um problema complexo e multifacetado de uma só vez.

### 4.2 Roteamento Inteligente de Modelos (Ensemble)
* **Conceito**: Usar modelos de 8B apenas para as fases mais leves (`Discovery`, `Optimize`) e chavear para um modelo ligeiramente superior nas fases críticas (`Repair`, `Validation`).
* **Por que funciona**: Equilibra custo e tempo de execução, garantindo inteligência máxima onde é mais necessário.

### 4.3 Auto-Correção Local no Substrato
* **Conceito**: Se o parser falhar ao processar a resposta do LLM, o próprio script do substrato pode fazer uma nova chamada rápida solicitando que o modelo corrija a formatação do JSON, sem estourar um erro fatal no harness.
* **Por que funciona**: Reduz o desperdício de tempo reiniciando todo o pipeline do zero apenas por um detalhe de formatação.

---

## Considerações para Integração Paulatina

Para implementar essas estratégias sem desestabilizar o harness atual, sugere-se a seguinte ordem de adoção:

### Fase 1: Otimizações de Engine (Sem mexer no código-fonte)
* **O que fazer**: 
  1. Fixar a temperatura em `0.0` nas chamadas da API.
  2. Implementar `eslint --fix` logo após a fase de `Repair`.
* **Risco**: Zero. Apenas melhora o comportamento padrão do sistema.

### Fase 2: Validação Determinística (Melhoria de feedback)
* **O que fazer**:
  1. Configurar o ESLint e o TypeScript do projeto para rejeitarem de forma estrita imports inválidos e tipos ausentes.
  2. Adicionar o script do gate de validação para copiar a mensagem literal do erro do compilador.
* **Risco**: Baixo. Vai aumentar a taxa de rejeições de candidatos ruins, forçando o Aider a tentar mais vezes com feedbacks melhores.

### Fase 3: Engenharia de Prompts e CoT
* **O que fazer**:
  1. Adicionar exemplos Few-Shot nos prompts do `raw_llm.sh` para as fases de `Forensics`, `Adversarial` e `Validation`.
  2. Incluir a exigência da tag `<thinking>` nos prompts do modelo.
* **Risco**: Médio. Exige monitorar se o modelo de 8B vai respeitar o delimitador de pensamento sem quebrar os parsers.

### Fase 4: Orquestração e Roteamento (Mudanças estruturais)
* **O que fazer**:
  1. Implementar roteamento por modelo no `.harness/config.sh` (ex: delegar validações críticas para modelos maiores).
  2. Implementar auto-correção local de JSON no script do substrato.
* **Risco**: Alto. Altera a lógica de controle de fluxo do harness. Deve ser testado isoladamente.

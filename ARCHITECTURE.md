# Arquitetura técnica do projeto

Este documento define a arquitetura técnica permitida para o código e para os
artefatos persistentes deste repositório. Ele não é um prompt de modelo, manual
do fluxo operacional nem contrato de uma demanda: o preflight recebe somente a
projeção estruturada em `governance/architecture.policy.json`.

## Fronteiras permitidas

- O produto reside em `src/`; uma demanda `PRODUCT` não altera o harness.
- O estado semântico persistente, quando necessário, reside unicamente em
  `.harness/state/semantic-state.json`.
- O runtime do harness é transitório em `.harness/runtime/`; não é fonte de
  verdade nem artefato de produto.
- Ao processar e assinar uma demanda, o harness pode observar e citar caminhos
  de produto no contrato, mas não pode criar, editar ou apagar esses caminhos.
  Assinar um contrato não autoriza sua implementação.
- O core usa execução local, determinística e sem dependência de rede ou de
  provedores de modelo. Compiladores, linters e provas são adaptadores locais.
- A atribuição local de adaptadores humanos/IA reside em
  `.harness/config/roles.json`, é ignorada pelo Git e nunca contém segredos.
  Chaves de API pertencem exclusivamente a variáveis de ambiente ou ao
  chaveiro do sistema. Essa atribuição não autoriza implementação.

## Forma técnica preferida

- TypeScript estrito, módulos pequenos e APIs explícitas.
- Dependências mínimas; não introduzir persistência, concorrência, camadas ou
  extensibilidade sem requisito, invariante ou prova que as justifique.
- Todo comportamento observável deve possuir estado e resultado explícitos;
  detalhes internos continuam livres para evoluir enquanto preservarem o
  contrato e as provas.

## Regras arquiteturais ativas

As cláusulas abaixo são a fonte humana das regras estruturadas. Alterar uma
delas exige atualizar a política estruturada no mesmo commit; divergência
entre ambos bloqueia o preflight.

### ARCH-PRODUCT-BOUNDARY — hard

Uma demanda de produto observa e cita exclusivamente `src/` como fonte do
produto, e requisitos de produto não podem alterar o harness.

Aplica-se a demandas de produto e a referências a caminhos do produto.

### ARCH-HARNESS-STATE — hard

O estado semântico persistente do harness reside em
`.harness/state/semantic-state.json`; dados transitórios residem em
`.harness/runtime/`. A atribuição local de adaptadores reside em
`.harness/config/roles.json`, não contém segredos e nunca é fonte de verdade
do produto.

Aplica-se a mudanças ou decisões sobre estado e runtime do harness.

### ARCH-LOCAL-DETERMINISTIC-CORE — hard

O core mecânico opera localmente, de forma determinística e sem dependência de
rede ou de um provedor de modelo. Integrações externas pertencem a adaptadores.

Aplica-se a mudanças no core do harness e a integrações com provedores.

### ARCH-STRICT-EXPLICIT-MODULES — default

Código TypeScript usa tipagem estrita, módulos pequenos e APIs explícitas, sem
supressões permissivas que escondam falhas ou contratos públicos.

Aplica-se a demandas que imponham forma técnica TypeScript.

### ARCH-PARSIMONY — default

Dependências, persistência, concorrência, camadas e pontos de extensão só são
admitidos quando um requisito observável justificar seu custo. A alternativa
recomendada deve ser a menor arquitetura suficiente.

Aplica-se quando a demanda solicita dependências ou complexidade estrutural.

### ARCH-FAILURE-EXPLICIT — hard

Nenhuma falha relevante pode desaparecer silenciosamente; a operação deve
expor resultado, erro explícito, estado preservado ou rollback verificável.

Aplica-se a operações com estado ou efeito externo.

### ARCH-DETERMINISTIC-TIME — hard

Comportamento que depende de tempo deve receber uma referência temporal
explícita ou usar uma fonte reproduzível. O relógio do sistema não pode alterar
o resultado de forma implícita; uma exceção requer emenda arquitetural
aprovada.

Aplica-se a comportamento dependente de tempo. `Date.now()` é uma referência
proibida enquanto não houver emenda aprovada.

## Evolução da política

O Contract IR calcula localmente quais regras são aplicáveis e exige avaliação
semântica somente dessas regras. Conflitos com regras `hard` são correções
obrigatórias e nunca viram opções do Wizard. Regras `default` só podem pedir
confirmação quando uma exigência observável e explícita do usuário deixar uma
escolha material; complexidade apenas sugerida é podada automaticamente.
Preferências não criam perguntas. Regras de negócio, invariantes e provas de
uma demanda pertencem ao contrato dela, não a este documento.

## Sinais mecânicos conservadores

Referências explícitas na própria demanda também ativam a regra correspondente,
mesmo se o modelo omitir um contexto. A política distingue sinais comuns de
revisão (`reviewReferences`) de sinais de possível conflito
(`forbiddenReferences`). A ocorrência literal não decide o veredito — ela pode
estar negada ou citada como exemplo —, mas não pode desaparecer do contrato e
exige um parecer adversarial vinculado à regra.

`src/`, caminhos do Harness, TypeScript e relógio são sinais conservadores de
contexto. `AbstractCycleResolver`, injeção dinâmica de dependências, `factories`
e decoradores ativam parcimônia e tornam obrigatório o parecer adversarial.
`any`, `@ts-ignore`, `try/catch`, `catch` vazio e `Date.now` são
referências proibidas. A lista é deliberadamente curta: protege cláusulas
universais sem tentar substituir interpretação semântica por um dicionário de
domínio.

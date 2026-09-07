# Arquitetura técnica do projeto

Este documento define a arquitetura técnica permitida para o código e para os
artefatos persistentes deste repositório. Ele não é um prompt de modelo, manual
do fluxo operacional nem contrato de uma demanda: o preflight recebe somente a
projeção estruturada em `governance/architecture.policy.json`.

## Fronteiras permitidas

- O produto reside em `src/`; uma demanda `PRODUCT` não altera o harness.
- O estado semântico persistente, quando necessário, reside unicamente em
  `src/.aegis/semantic-state.json`.
- O runtime do harness é transitório em `.harness/runtime/`; não é fonte de
  verdade nem artefato de produto.
- O core usa execução local, determinística e sem dependência de rede ou de
  provedores de modelo. Compiladores, linters e provas são adaptadores locais.

## Forma técnica preferida

- TypeScript estrito, módulos pequenos e APIs explícitas.
- Dependências mínimas; não introduzir persistência, concorrência, camadas ou
  extensibilidade sem requisito, invariante ou prova que as justifique.
- Todo comportamento observável deve possuir estado e resultado explícitos;
  detalhes internos continuam livres para evoluir enquanto preservarem o
  contrato e as provas.

## Regras arquiteturais ativas

As duas cláusulas abaixo são a fonte humana das regras estruturadas. Alterar
uma delas exige atualizar a política estruturada no mesmo commit; divergência
entre ambos bloqueia o preflight.

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

O Contract IR avalia todas as regras ativas para cada demanda. Regras `hard`
bloqueiam conflito; regras `default` podem pedir confirmação; preferências não
devem criar perguntas. Regras de negócio, invariantes e provas de uma demanda
pertencem ao contrato dela, não a este documento.

# Briefing e implementação

Use esta fase somente após a persistência de
`src/.aegis/semantic-state.json`. Esse registro contém a demanda esclarecida,
o Contract IR e as provas ativas; não existe segunda compilação de contrato.

Use a constituição em `AGENTS.md` ao transformar o contrato em plano e código.
O IDE pode investigar os arquivos necessários, mas deve manter cada decisão
ligada a requisito, comportamento, invariante ou prova já autorizados.

Antes de editar, resuma de forma curta:

1. os paths autorizados que serão criados, alterados ou aposentados;
2. o comportamento e as invariantes que cada mudança atende;
3. as provas que deverão demonstrar a entrega.

Não crie escopo, requisito, prova ou arquitetura paralelos. Se a investigação
mostrar que o contrato é insuficiente, volte para revisão semântica em vez de
decidir silenciosamente durante a mutação.

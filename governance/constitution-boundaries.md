# Fronteiras da constituição

`AGENTS.md` contém princípios de julgamento, não um protocolo de execução.
`constitution.json` entrega as mesmas cinco regras à IA, com IDs estáveis.
Ao alterar os princípios, sincronize os textos, incremente a versão e atualize
o digest de origem. O teste de saída semântica verifica igualdade das regras;
o carregador também verifica o digest do Markdown.

As responsabilidades operacionais continuam nos componentes existentes:

- `scripts/lib/semantic_gateway.mjs`: instruções de preenchimento do parecer,
  índices, campos opcionais e planos de efeitos das alternativas.
- `governance/schemas/`: formatos e campos obrigatórios.
- `scripts/lib/semantic_closure.mjs`: verificações estruturais de fechamento.
- `scripts/lib/prepared_effects.mjs` e `semantic_contract_lifecycle.mjs`:
  aplicação e validação dos efeitos escolhidos.
- `scripts/lib/semantic_request.mjs`: carregamento e integridade da constituição.

Nenhum validador foi removido para encurtar a constituição. Validação estrutural
não prova por si só correção semântica. A IA continua responsável por identificar
ambiguidades observáveis e propor critérios pertinentes, sem impor um catálogo
de convenções a toda demanda.

Não atualize assinaturas ou vínculos de contratos antigos silenciosamente para
a nova constituição. Eles preservam a versão histórica; uma nova deliberação
deve usar a política vigente e seguir as validações normais.

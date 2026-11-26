# Arquitetura do Produto

Decisões e restrições técnicas deste software (`src/`), lidas automaticamente pelo `./aegis brief`.

> **Formato:** cada bullet abaixo é uma regra ativa — `hard` (obrigatório; respeitar ou expor conflito ao humano) · `default` (padrão do projeto; deliberar com o humano se a demanda exigir exceção). Ao levar o Aegis para outro projeto, edite apenas estas linhas.

## Regras

- `PRODUCT-BOUNDARY` [hard]: Código e testes apenas em `src/`; proibido ler ou alterar arquivos fora de `src/`.
- `NO-FRAMEWORK` [default]: TypeScript puro em memória; sem frameworks, ORMs ou banco sem aprovação humana.
- `STRICT-TYPES` [hard]: Tipagem estrita, retorno explícito em APIs públicas e dados `readonly`; sem `any` nem `@ts-ignore`.
- `INTEGER-CENTS` [hard]: Valores monetários apenas em centavos inteiros seguros (`Number.isSafeInteger`), sem float.
- `FAILURE-EXPLICIT` [hard]: Sem `catch` vazio ou descarte silencioso; expor erro, precedência de guardas, preservação ou rollback.
- `DETERMINISTIC-TIME` [hard]: Tempo sempre por parâmetro explícito; proibido `Date.now()` ou `new Date()` sem argumentos.
- `PARSIMONY` [default]: Sem factories, builders, event buses, singletons ou camadas extras quando função simples basta.

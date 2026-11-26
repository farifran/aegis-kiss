# Arquitetura do Produto

Decisões e restrições técnicas deste software (`src/`), lidas automaticamente pelo `./aegis brief` e validadas pelo `./aegis verify-contract` / `./aegis check`.

> **Como preencher:** mantenha 1 linha por regra ativa no formato `- \`ID\` [hard|default]: descrição objetiva`.
> - `hard`: obrigatório — respeitar ou expor conflito explicitamente ao humano.
> - `default`: padrão do projeto — deliberar com o humano caso a demanda exija exceção.

## Regras Base

- `PRODUCT-BOUNDARY` [hard]: Código e testes apenas nas raízes de produto (`src/`); proibido alterar arquivos fora da fronteira sem autorização explícita.
- `STRICT-TYPES` [hard]: Tipagem estrita, retorno explícito em APIs públicas e dados `readonly`; sem `any` nem `@ts-ignore`.
- `FAILURE-EXPLICIT` [hard]: Sem `catch` vazio ou descarte silencioso; erros, limites e efeitos de falha devem ser explícitos.
- `DETERMINISTIC-TIME` [hard]: Tempo sempre por parâmetro explícito na lógica de domínio; proibido `Date.now()` ou `new Date()` sem argumentos.
- `PARSIMONY` [default]: Sem factories, builders, event buses, singletons ou camadas extras quando função simples basta.

## Regras do Domínio e Stack *(preencher para o novo projeto)*

<!--
Exemplos (descomente, adapte ou adicione suas regras reais quando iniciar o projeto):
- `NO-FRAMEWORK` [default]: Runtime/stdlib nativa (`node:http`, `fetch`); sem frameworks pesados sem aprovação humana.
- `STORAGE-ENGINE` [hard]: Persistência exclusivamente em SQLite local via driver nativo; sem ORM.
- `MONEY-REPRESENTATION` [hard]: Valores monetários apenas em centavos inteiros seguros (`Number.isSafeInteger`), sem float.
- `AUTH-BOUNDARY` [hard]: Autenticação/autorização centralizada no módulo de sessão; proibido ler segredos fora de env explícita.
-->

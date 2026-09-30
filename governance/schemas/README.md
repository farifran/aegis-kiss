# Schemas: fluxo canônico de governança

Os arquivos nesta pasta descrevem o fluxo governado do Aegis. `contract-components.v1.schema.json`
contém definições reutilizadas; todos os formatos ativos são canônicos, autocontidos e livres
de versões legadas. Os testes verificam a consistência e a resolução estrita das referências.

Opinião da IA e rascunho compilado continuam distintos: índices e juízos pertencem
ao parecer; identificadores e estados compilados pertencem ao Harness. Compartilhe
componentes realmente iguais, não campos com autoridades diferentes.

## Aplicabilidade

- Coleção sem máximo contratual: `capacityPolicy.overflowPolicy=NO_CONTRACT_LIMIT`,
  `maxEntries=null` e `unboundedRationale` não vazia. Não promete memória infinita,
  não remove restrições humanas e não autoriza ignorar falhas de recursos.
- Operação sem guardas: `guardPrecedence=[]`, `noGuardsRationale` não vazia e
  branches explícitos sem rejeição. Uma rejeição ou guarda declarada contradiz essa
  dispensa. Sem justificativa, o fechamento continua bloqueado.

A IA responde pela pertinência das justificativas; o Harness verifica forma,
referências e contradições representadas. Uma justificativa preenchida não é uma
prova matemática de ausência. As demais exigências de limites e estado não foram
relaxadas por esta mudança.

Após editar schemas, execute `npm run aegis:generate-schemas` e `npm test`.

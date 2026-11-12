# ADR-0008: Account Reset — Vault Purge and `resetAt` Epoch

- Status: accepted
- Date: 2026-08-17
- Owners: Sync and API

## Context

"Apagar dados" nas Configurações Gerais tinha um alcance só: limpava o estado
local, apagava o IndexedDB, **descartava a chave de sync** e recarregava. Quem
sincroniza queria a outra coisa — zerar a conta e continuar sincronizado — e o
caminho para isso não existia em nenhuma camada:

1. **O POST de sync não sabe apagar.** O script Lua em `api/sync.ts` só faz
   `HSET` por shard. Mandar um estado vazio sobrescreve `core`, mas deixa de pé
   todo `logs:<mês>` e `archive:<ano>` que o aparelho já esqueceu — o cofre
   continua cheio, com um `core` vazio por cima.
2. **O merge ressuscita o lado cheio.** `mergeStates` tem regra explícita: se um
   lado está sem hábitos e o outro não, o cheio vence, independentemente do
   carimbo (`services/dataMerge/merge.ts`). Um aparelho zerado que mantivesse a
   chave baixaria tudo de volta no boot seguinte.
3. **Outros aparelhos não sabem do reset.** Mesmo com o cofre limpo, o segundo
   aparelho ainda tem a base antiga e a reenvia no primeiro sync.

## Decision

**"Apagar dados" tem um alcance só:** zera a conta inteira — este aparelho e
todos os outros — e mantém a sincronização ligada, com a mesma chave. Uma
confirmação, nenhuma escolha de escopo. Sem chave de sync não existe conta, e o
texto muda para o que de fato acontece: só este aparelho é apagado.

**"Desativar sincronização" passa a apagar os dados locais** junto com a chave.
Sem a chave, o que sobraria aqui é uma cópia órfã dos dados de uma conta à qual
este aparelho não pertence mais. O cofre na nuvem fica intacto: é a chave que dá
acesso a ele, e é por isso que a confirmação insiste nela.

Os dois eixos ficam assim, cada um num lugar da tela e sem sobreposição:

| Ação | Dados da conta (nuvem) | Dados deste aparelho | Vínculo |
| :--- | :--- | :--- | :--- |
| Apagar dados | apagados | apagados | mantido |
| Desativar sincronização | intactos | apagados | desfeito |

Versões anteriores desta decisão tentaram resolver isso dentro do próprio botão,
com uma pergunta de escopo antes da confirmação ("dados da conta" × "dados deste
aparelho", depois "manter a conta" × "apagar a conta"). Ambas confundiam pelo
mesmo motivo: empilhavam a decisão sobre o VÍNCULO em cima da decisão sobre os
DADOS, quando o vínculo já tem seu próprio botão. Desativar a sincronização é o
lugar natural dessa escolha — e apagar o local ali fecha o buraco que fazia o
escopo extra parecer necessário.

O reset de conta precisou de duas peças novas:

**Purge no servidor.** O POST aceita `purge: true` (booleano estrito). No Lua, o
purge faz `DEL` da chave antes de gravar os shards enviados, e grava `resetAt`
junto do `lastModified`. O purge **não** passa pelo controle otimista de
concorrência: apagar é ordem explícita do dono da chave, e um relógio atrasado
não pode prendê-lo a um cofre que ele mandou apagar. Para manter a ordem, o
carimbo avança à força (`newTs = max(newTs, currentTs + 1)`).

**Epoch `resetAt`.** Campo em texto claro no hash, ao lado de `lastModified` —
não é shard cifrado, e `decryptServerShards` o ignora como já ignorava o
`lastModified`. No boot, `fetchStateFromCloud` compara: se
`resetAt > state.lastModified`, a base local é anterior ao reset e é descartada
antes do merge. O que foi registrado **depois** do carimbo sobrevive: é trabalho
novo, não sobra do que o usuário mandou apagar.

Ordem de execução: purga primeiro, apaga o local depois. Se a nuvem recusar,
nada é apagado e o erro chega à tela — um aparelho vazio diante de um cofre cheio
desfaria o reset no boot seguinte e viraria um susto sem efeito.

## Alternatives considered

- **Método `DELETE` no endpoint.** Mesma semântica, mas exigiria mexer no CORS
  (`Access-Control-Allow-Methods`) e num segundo caminho de rate limit. O flag no
  POST reusa validação, limites e script já existentes.
- **Só purgar o cofre, sem `resetAt`.** Metade do trabalho: o segundo aparelho
  reenviaria a base antiga no primeiro sync e ressuscitaria a conta.
- **Lápides por hábito em vez do epoch.** O merge respeita lápides, mas elas não
  cobrem `dailyData`, `archives` nem `monthlyLogs`, e o custo de gerar uma lápide
  por hábito cresce com o histórico — justamente o que o reset quer jogar fora.
- **Perguntar o escopo dentro do botão** (duas tentativas, ver acima). Mistura o
  eixo dos dados com o eixo do vínculo em rótulos curtos e parecidos.
- **Desativar a sincronização purgando o cofre também.** Apagaria os dados dos
  OUTROS aparelhos da conta por causa de uma decisão local — e a chave existe
  justamente para voltar ao cofre depois.
- **Desativar sem apagar o local (comportamento anterior).** Deixa no aparelho
  uma cópia dos dados de uma conta que ele não integra mais.

## Consequences

- O purge é a primeira operação destrutiva do endpoint. A validação do flag é
  estrita (`typeof === 'boolean'`) para que nenhum valor "quase verdadeiro" de
  cliente antigo ou proxy vire um apagar.
- Entre o purge e o reload, o cliente trava o sync (`isVaultResetInProgress`):
  um envio pendente com carimbo antigo levaria 409, e a resolução de conflito
  ressuscitaria o estado que acabou de ser apagado.
- Um aparelho offline que registre algo depois do reset mantém esses dados e os
  reenvia. É a mesma política Last-Write-Wins do ADR-0003, aplicada ao reset.
- Hashes de shard e ETag são zerados nos dois caminhos: descrevem um cofre que o
  aparelho não vai mais seguir e fariam o sync seguinte pular shards por "nada
  mudou".
- Desativar a sincronização ficou destrutivo do lado local. Quem não anotou a
  chave perde o acesso — o texto da confirmação diz isso, e "Ver chave" e
  "Exportar backup" continuam ao lado, na mesma tela.
- A semântica do Lua só roda de verdade contra o Redis; os testes cobrem o
  cabeamento dos ARGV e a validação do flag.

## Rollback plan

- Reverter o botão ao reset puramente local desativa o caminho de purge sem tocar
  no servidor.
- O `purge` e o `resetAt` no servidor são compatíveis com clientes antigos: sem o
  flag, o script se comporta como antes; sem leitura do `resetAt`, o cliente
  antigo só ignora o campo.

## References

- `api/sync.ts`
- `services/cloud.ts`
- `services/reset.ts`
- `services/habitActions/deletion.ts`
- `listeners/modals.ts`
- `listeners/sync.ts`
- `listeners/resetData.test.ts`
- `services/cloud.test.ts`
- `api/sync.test.ts`

# Avaliação isolada do JEV

Script: `scripts/substrates/test/evaluate_jev.mjs`.
Não é importado pelo runtime nem pelo `npm test`. Exemplos são somente fixtures
de avaliação, nunca contexto reutilizado nas demandas do usuário.

```sh
# Sem rede: construção real da ficha/lote e validação com respostas sintéticas.
node scripts/substrates/test/evaluate_jev.mjs

# Rede: requer AI_GATEWAY_API_KEY já disponível no ambiente.
# Até 24 chamadas, sem retries, duas execuções para cada uma de 12 demandas.
node scripts/substrates/test/evaluate_jev.mjs --live --repeat=2
```

As demandas cobrem obrigação, proibição, meta, opção, exemplo, contexto,
limiar ausente, frase de papéis mistos, inglês, espanhol, múltiplas obrigações
e conflito entre integridade criptográfica e fingerprint. A rubrica foi escrita
antes das respostas; papel e necessidade de revisão são avaliados separadamente. Concordância
com a rubrica não demonstra verdade universal nem calibração probabilística.

Usa os mesmos builders, SDK e validadores de produção. Não usa mocks para
computar qualidade. Testes sintéticos são identificados separadamente e incluem
resposta ausente e probabilidades inválidas. Falha real interrompe as próximas
chamadas. Credencial ausente produz status bloqueado, nunca sucesso simulado.

Cada execução grava um relatório num diretório temporário novo e imprime seu
caminho: fragmentos, expectativas, respostas, probabilidades, modelo, tokens,
latência e instabilidade entre repetições. Não lê nem sobrescreve o contrato em
`.harness/runtime/`; não chama o supervisor, Wizard ou aprovação. A chave e
corpos de erros do provedor nunca são registrados. Custo monetário não é inferido
dos tokens: deve ser verificado no Gateway quando necessário.

## Verificação inicial

- Catálogo público consultado: modelo `typesafe-ai/jev`, modalidade evaluation.
- Endpoint TypeSafe documentado coincide com o baseURL do código.
- POST sem credenciais respondeu HTTP 401: rede/endpoint alcançáveis, autenticação
  não comprovada. Não equivale a uma resposta do modelo.
- Ambiente atual sem AI_GATEWAY_API_KEY, inclusive em shell interativo.
- 12 casos passaram na preparação e validação local; nenhuma resposta real foi
  obtida. Qualidade, latência do modelo e estabilidade permanecem não medidas.
- O runtime configura `jev-latest`; o catálogo público lista `typesafe-ai/jev`.
  Confirmar a aceitação do alias numa chamada autenticada antes de atribuir a
  diferença a um erro. Esta avaliação não muda o modelo da integração.

Referência consultada: https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe

## Tentativa autenticada — 2026-10-01

Credencial fornecida temporariamente ao processo, sem persistência no repositório.
A primeira chamada do teste, com a integração atual, terminou em
`jev_gateway_access_denied` após 1143 ms; a bateria parou sem resposta do modelo.
O GET autenticado `/typesafe/v1/models` retornou 200. Um POST diagnóstico usando
o identificador oficial `typesafe-ai/jev` também retornou 403:
`no_providers_available`, com a mensagem de que usuários do nível gratuito não
têm acesso ao modelo e precisam de créditos pagos. O metadata do Gateway indicou
zero tentativas em provedores nessa chamada diagnóstica.

Portanto o bloqueio observado é de acesso ao modelo/plano, não evidência de erro
no schema ou de baixa qualidade do JEV. Não houve compra de créditos, alteração
de orçamento nem troca por outro modelo. Qualidade e estabilidade continuam
sem avaliação real. Revogar a chave exposta no chat após o uso.

## Simulação com o supervisor disponível

`node scripts/substrates/test/simulate_jev.mjs` usa o modelo configurado no
supervisor via Codex CLI autenticado, em processos efêmeros e sem ferramentas.
Consome uso da conta. Não chama JEV nem fabrica probabilidades.

A rubrica em `jev_cases.mjs` contém 12 demandas de desenvolvimento e 8 reservadas.
O laço limita-se a três rodadas de desenvolvimento, encerrando antes ao atingir
100% dos rótulos previstos. Erros de desenvolvimento podem alimentar a rodada
seguinte; por isso esse score não é uma medida independente. Depois são feitas
duas execuções reservadas, sem gabarito ou feedback. Não há ajuste pelos resultados
reservados. Os critérios de classificação são os mesmos da projeção de produção.

Cada fragmento recebe dois resultados consultivos, em um mesmo lote:
`role` (papel) e `review` (necessidade de revisão). Um pedido pode ser simultaneamente
normativo e incompleto. `NONE_IDENTIFIED` não certifica completude. A comparação
com o parecer principal compara apenas papéis: revisão não possui campo equivalente
e fica explicitamente `NOT_COMPARABLE`.

O relatório temporário preserva digest da rubrica, erros, modelo, tempos e scores.
100% nesse conjunto pequeno não demonstra qualidade universal nem desempenho do JEV.
As fixtures nunca são incorporadas ao contexto de demandas de produção.

### Resultado da simulação — 2026-10-01

Modelo configurado: `gpt-5.6-luna`. Desenvolvimento: 26/26 rótulos corretos
(12 demandas, 13 fragmentos, dois eixos), primeira rodada, sem feedback.
Reserva: 16/16 em cada uma das duas execuções (8 demandas). Tempos dos processos:
12,9 s, 9,3 s e 10,1 s; não são tempos do JEV. Laço encerrou desenvolvimento
ao atingir o máximo; as duas verificações reservadas permaneceram sem ajustes.

Relatório local desta execução:
`/var/folders/20/mjd2hv0x167d0gvjgj7p1tcr0000gp/T/aegis-jev-simulation-3Q8xlH/report.json`.
Uma tentativa anterior foi interrompida e descartada da medição: o simulador
enviava IDs sem texto. A extração foi corrigida e ganhou validação de texto não
vazio antes de qualquer chamada. Esse erro era do experimento, não do modelo.

Este score mede concordância com a rubrica em dois rótulos, não qualidade do
contrato final, explicações, calibração ou completude semântica. A bateria não
cobre todas as categorias (`UNKNOWN`/`UNCERTAIN`), documentos longos, conflitos
entre fragmentos ou ambiguidades de políticas. São próximos testes necessários
antes de atribuir robustez geral à integração.

## Laboratório de avanço: mapa de leitura

Implementação experimental: `scripts/lib/jev_reading_map.mjs`.
Não está habilitada no fluxo de demandas: não altera contratos, gates nem Wizard.
Não adiciona schemas ao catálogo de governança. O construtor aceita uma demanda
e candidatos de contexto explicitamente fornecidos, preservando os trechos originais.
Todos os resultados são `ADVISORY_ONLY`; o caller continua responsável pela
procedência de políticas e evidências. Não há pesquisa semântica automática de arquivos.

O loop compara quatro braços nas mesmas fontes e perguntas finais:

1. `none`: revisor sem pré-análise (controle necessário).
2. `basic`: papel e necessidade de revisão.
3. `expanded`: adiciona força da afirmação, superfície pública/interna e decomposição.
4. `linked`: adiciona conflito, duplicação, dependência, complemento e relevância
   de candidatos de política/evidência.

```sh
# Teste estrutural offline, também incluído em npm test.
node scripts/substrates/test/test_jev_reading_map.mjs

# 14 chamadas Codex no máximo em execução normal bem-sucedida.
node scripts/substrates/test/explore_jev.mjs

# Repete com ordem de braços invertida: até 28 chamadas.
node scripts/substrates/test/explore_jev.mjs --repeat=2
```

O modelo é o supervisor configurado, autenticado pelo Codex CLI. Cada chamada é
efêmera e separada; o gabarito não entra no prompt. Uso de ferramentas invalida
a chamada. As skills AI Gateway e OpenAI Docs orientaram o uso de escolhas
predefinidas e saída estruturada; não se presume geração livre pelo JEV.

A rubrica de 12 demandas (6 desenvolvimento, 6 reservadas) é fixa antes da
execução. Não há aprendizado pelos erros, alteração automática do prompt, busca
infinita por 100%, promoção automática ou mudança de provedor. A repetição serve
para observar estabilidade, não para escolher só a melhor resposta. Uma falha de
execução interrompe o loop, sem ser confundida com sucesso ou erro semântico.

A métrica principal é a resposta de um revisor posterior a 24 perguntas fixas
sobre preservação de obrigações, conflitos e autorização de suposições. Isso é
uma avaliação limitada de compreensão, **não geração e avaliação de contratos
completos**. A classificação preliminar tem apenas um subconjunto de rótulos
avaliado; os demais aparecem como `unscored`, não como acertos.

O relatório guarda respostas brutas, erros, digest da rubrica, paths dos prompts,
tempos e uso de tokens de cada etapa. Tempos incluem processos e chamadas Codex;
não representam latência JEV. Tokens incluem overhead do CLI e cache, não são
uma estimativa de custo em dinheiro.

### Fronteiras de cobertura e segurança

- Relações: somente vizinhos, até 64 pares; os pares omitidos são contabilizados.
- Contexto: até 32 itens (8.192 caracteres por item) e 32 vínculos fornecidos.
- Nenhum texto original é eliminado por classificação ou relevância.
- Fontes de código não ganham autoridade de política.
- Dúvidas não viram perguntas humanas automaticamente.
- O mapa não certifica completude e não preenche convenções ou valores ausentes.
- A integração HTTP real dessa projeção ampliada ainda não foi validada com JEV.

### Primeira execução comparativa — 2026-10-01

Modelo solicitado: `gpt-5.6-luna`, 14 chamadas concluídas; nenhum gabarito enviado
ao modelo, nenhuma resposta ou rubrica alterada durante a execução.

| Braço | Desenvolvimento, acerto exato | Reserva, acerto exato | Tempo total na reserva |
| --- | --- | --- | --- |
| Sem pré-análise | 11/12 | 12/12 | 8,9 s |
| Básico | 11/12 | 12/12 | 18,6 s |
| Ampliado | 11/12 | 12/12 | 25,9 s |
| Com relações | 11/12 | 10/12 | 30,8 s |

Relatório bruto, incluindo prompts por chamada e métricas:
`/var/folders/20/mjd2hv0x167d0gvjgj7p1tcr0000gp/T/aegis-jev-exploration-Y52VjG/report.json`.

**Conclusão limitada:** não foi demonstrado ganho de compreensão nas perguntas
finais; houve overhead. Não promover a projeção ampliada automaticamente.
Isto não demonstra que JEV real seja inútil: usa-se aqui o mesmo modelo generativo
nas duas etapas, tarefas curtas e um teste com efeito de teto no controle.

Problemas encontrados no próprio experimento, sem reescrever seus resultados:

- A pergunta de desenvolvimento `uncertain/known` é metalinguística: responder
  `NO` a “é possível identificar?” é defensável, embora a rubrica esperasse
  `UNKNOWN`. Esse desacordo ocorreu nos quatro braços e não prova falha do modelo.
- “Funcionar sem rede” admite leitura de obrigação e de proibição; o gabarito
  de força único é excessivamente rígido para esse exemplo.
- Os dois desacordos finais de `linked` são `UNKNOWN` em vez de `NO` sobre
  autorização. São abstenções, não permissões indevidas. O score exato não deve
  ser confundido com taxa de decisões perigosas.
- O comentário adversarial foi marcado `RELEVANT` uma vez. Isso não comprova que
  o modelo obedeceu ao comando embutido: relevância e confiança são propriedades
  diferentes, e as perguntas finais sobre autoridade foram respondidas corretamente.

Próxima avaliação deve usar nova rubrica revisada antes das chamadas, novas
demandas longas e relações não locais, além de avaliar contratos reais. A reserva
desta execução já foi inspecionada: qualquer ajuste por esses exemplos a transforma
em desenvolvimento, não em um novo resultado cego. Não aumentar camadas apenas
para atingir 100% nos rótulos.

Verificação de código: `npm test`, lint e `git diff --check` passaram. O typecheck
de produto termina em TS18003 porque `src/` não contém entradas TypeScript;
nenhum arquivo de produto foi criado para contornar essa condição.

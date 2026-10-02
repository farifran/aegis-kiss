# JEV simulado como intermediário — repetição A/B

## Veredito

Nesta bateria, a etapa intermediária não melhorou a qualidade final e aumentou
tempo total e tokens. Há uma redução observada no tempo do revisor posterior,
mas insuficiente para pagar a etapa adicional. Não há evidência para torná-la
obrigatória. Isto não mede o desempenho do JEV real.

## Método preservado

- Comando: `node scripts/substrates/test/explore_jev.mjs --repeat=2`.
- Modelo solicitado nas duas funções: `gpt-5.6-luna`, via Codex autenticado.
- 12 demandas, 24 perguntas finais, duas repetições por variante: 48 respostas
  finais por variante, 192 no total, 28 chamadas concluídas.
- Variantes: sem pré-análise, básica, ampliada e com relações. Ordem invertida
  na segunda repetição. Nenhum prompt, critério ou gabarito alterado entre rodadas.
- Fontes originais permanecem disponíveis ao revisor; classificações são
  `ADVISORY_ONLY`. Não houve assinatura, Wizard ou alteração de produto.
- Rubrica: `5c23f7764ff89e3e7925b1e2e9d2787c384ae65264acf4009f5f0afd42a051b1`.
- Os casos já haviam sido inspecionados: a partição chamada `holdout` no script
  mede repetibilidade nesta rodada, não constitui nova reserva cega.

Uma tentativa iniciada na sessão anterior não estava mais ativa e seu relatório
temporário não estava disponível. Ela não entra nestas métricas. A execução
concluída e verificável está em:
`/var/folders/20/mjd2hv0x167d0gvjgj7p1tcr0000gp/T/aegis-jev-exploration-oUZKOE/report.json`.

## Resultado final e custo operacional observado

Tempo médio por lote de seis demandas; cada variante executou quatro lotes.
Tokens são totais de entrada de todas as etapas, incluindo overhead do CLI.

| Variante | Acertos exatos | Partição holdout | Tempo total médio | Tempo médio apenas do revisor | Tokens de entrada |
| --- | --- | --- | --- | --- | --- |
| Sem intermediário | 46/48 | 24/24 | 9,98 s | 9,98 s | 51.178 |
| Básico | 46/48 | 24/24 | 19,53 s | 9,33 s | 117.456 |
| Ampliado | 45/48 | 23/24 | 27,05 s | 8,25 s | 135.448 |
| Com relações | 46/48 | 24/24 | 29,62 s | 7,30 s | 139.711 |

Tokens de saída: respectivamente 786, 2.178, 3.820 e 4.647.
Tokens de entrada em cache: respectivamente 19.968, 9.984, 19.968 e zero.
Essas diferenças e a variação do serviço impedem atribuir causalidade forte aos
tempos de apenas quatro lotes. Não há conversão desses tokens para dinheiro.

Comparação pareada com o controle, mesma pergunta e mesma repetição:

- Básico: zero correções adicionais, zero regressões de rótulo.
- Ampliado: zero correções adicionais, uma regressão de rótulo.
- Com relações: zero correções adicionais, zero regressões de rótulo.
- Estabilidade entre repetições: nenhuma resposta mudou em `none`, `basic` e
  `linked`; uma mudou em `expanded`.

## O que significam os desacordos

Todos os braços responderam `NO` à pergunta `uncertain/known` nas duas repetições,
enquanto o gabarito esperava `UNKNOWN`. A pergunta é “É possível identificar o
comportamento combinado pelas fontes fornecidas?”. `NO` é defensável. Mantivemos
o resultado bruto sem editar o gabarito; isso não é evidência de falha semântica.

O desacordo adicional de `expanded` foi `boundary/number`, primeira repetição:
`UNKNOWN` em vez de `NO` sobre autorização para inventar uma constante. Foi
abstenção, não autorização indevida; na segunda repetição respondeu `NO`.
Nenhum dos desacordos finais foi uma autorização afirmativa indevida.

Como análise de sensibilidade explicitamente separada, retirar a pergunta
metalinguística já problemática produz 46/46, 46/46, 45/46 e 46/46. Isso não altera
a conclusão nem substitui a pontuação original, e não é uma nova avaliação cega.

## Benefício potencial versus benefício demonstrado

Com relações, o revisor posterior levou em média cerca de 27% menos tempo do que
o controle. Esse é um sinal observacional de que a organização prévia pode ajudar,
não prova causal de menor esforço de raciocínio. O total ficou aproximadamente
3 vezes maior, pois a pré-análise consumiu cerca de 22,32 s por lote. No básico,
a economia observada no revisor foi de apenas 0,65 s, frente a 10,20 s adicionais.

O JEV real pode ter custos e latência muito diferentes de um modelo generativo.
Esta simulação não permite estimá-los, nem pressupor a mesma qualidade de resposta.
Logo, estes dados não descartam JEV; descartam a afirmação de que seu benefício
como etapa intermediária já foi demonstrado pelo experimento atual.

## Recomendação KISS

Manter a etapa ampliada opcional/experimental. Não aumentar campos por padrão.
O próximo teste útil deve comparar contratos completos de demandas mais longas,
com critérios externos sobre omissões, perguntas artificiais e retrabalho, usando
novos casos fixados antes da execução. Para decisão de produção, medir também o
JEV real contra o mesmo controle. Só adotar por padrão se melhorar qualidade ou
reduzir custo/tempo total sem degradá-la.

Limitações: corpus pequeno e simples, respostas finais de escolha fixa, mesmo
modelo nas duas etapas, poucos lotes, resultados próximos ao teto. Não foram
avaliados contratos completos, descoberta arbitrária de relações não locais,
calibração probabilística ou ganho geral do Aegis. O runtime não foi modificado.

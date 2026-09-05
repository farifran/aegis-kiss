# Arquitetura do Aegis

O Aegis é um harness de evidências. Ele governa como uma demanda é explicada,
verificada e promovida; não substitui o IDE nem define regras de negócio do
produto.

```text
IDE
→ descoberta, leitura, perguntas, edição e feedback imediato

Aegis core
→ contrato, escopo, provas, receipt, promoção e verificação pós-commit

Adaptadores do projeto
→ compilador, linter, testes, benchmarks e verificadores especializados
```

## Invariantes do core

1. Toda alteração pertence ao escopo do contrato ativo.
2. Toda obrigação contratual possui uma prova ativa e rastreável.
3. O diff promovido é o mesmo diff validado.
4. A autoridade de validação é distinta da autoridade de mutação.
5. Todo commit não vazio possui receipt verificável.
6. O estado real pós-commit é confrontado novamente com contrato e resultado.

## Perfis de evidência

| Perfil | Objetivo |
| --- | --- |
| `fast` | Saúde local: checks baratos e determinísticos. |
| `targeted` | Provas diretamente afetadas pelo diff. |
| `release` | Contrato completo, recuperação e revisão independente quando requerida. |
| `forensic` | Caos, benchmark, red team e investigação de risco alto. |

Uma revisão por segundo modelo é uma prova semântica cara. Ela só é acionada
por `release`, `forensic` ou política explícita do contrato. O caminho normal
do IDE valida o Contract IR mecanicamente e segue para a mutação.

## Inventário mecânico opcional

`./aegis evidence --path <caminho>` produz uma fotografia limitada do estado
de caminhos explicitamente declarados. É um instrumento para receipts,
reexecução e investigação; não é um supervisor, não escolhe arquivos e não
entra automaticamente no contexto de um modelo.

O inventário limita quantidade de arquivos, bytes totais e bytes por arquivo.
Os previews são lidos parcialmente e codificados em base64, portanto servem
também para arquivos que não sejam TypeScript. O resultado vive somente em
`.harness/runtime/`, é sobrescrito a cada inventário, apagado no início de uma
nova demanda e removido por `aegis clean`. Não existe cache entre demandas.
Quando o limite de arquivos impedir cobertura completa, o resultado é marcado
como incompleto e jamais deve ser tratado como prova total.

## Adaptadores do projeto

Esta distribuição usa TypeScript como adaptador local de estrutura. Todo
executor de código pertence ao IDE; o core não chama modelos, providers ou
subprocessos de edição.

```text
TypeScript   → typecheck, lint, smoke e testes do projeto
Aegis core   → decide quando essas evidências são necessárias e as vincula ao receipt
```

Essas capacidades são importantes para este projeto, mas não são leis
universais para qualquer software que use o Aegis.

## Orçamento de execução

Cada etapa adicional deve justificar risco, autoridade, custo, frequência e
chave de cache. O sistema limita retries de rede, correções do mutador e tempo
total de pipeline; falha de uma autoridade produz `UNPROVEN`, nunca um ciclo
silencioso de recomeço.

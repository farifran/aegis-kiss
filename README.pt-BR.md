Idioma: [English](README.md)

# Aegis Harness

O Aegis é uma camada pequena de governança de evidências para trabalho de
software dirigido pelo IDE. O IDE descobre o código, pergunta decisões de
produto, edita arquivos e reage a erros. O Aegis vincula esse trabalho a um
contrato, confere escopo e provas e só autoriza um commit quando o estado em
stage corresponde à evidência verificada.

```text
IDE    → descoberta, leitura, interação, edição e feedback rápido
Aegis  → coerência contrato/evidência, perfis de prova, receipt e promoção
```

## Uso pelo IDE

```bash
./aegis "Descreva a mudança solicitada" --target src
# O IDE faz uma compilação semântica e o Aegis finaliza demanda + contrato + provas.

git add <arquivos>
./aegis authorize
git commit -m "..."
```

Comandos disponíveis:

- `./aegis "<demanda>"`: inicia uma execução `PRODUCT`, congela um baseline
  limpo no runtime transitório e devolve o pedido semântico compacto. Todo
  artefato persistente do produto deve ficar em `src/`.
- `./aegis harness "<demanda>"`: inicia explicitamente a manutenção do Aegis;
  somente esse modo pode autorizar mudanças no core do harness.
- `./aegis finalize …`: valida uma única decisão semântica e persiste juntos a
  demanda esclarecida, o Contract IR v2 e o registro de provas. Ele consome o
  intake congelado, sem redescobrir uma árvore mutável. Confirmar uma
  interpretação é mecânico; somente uma correção exige nova chamada ao modelo.
- `./aegis review …`: prepara uma revisão semântica independente opcional para
  execução de alto risco ou forense.
- `./aegis status`: mostra o estado das evidências e da árvore de trabalho.
- `./aegis evidence --path …`: cria um inventário mecânico opcional, limitado
  e transitório para receipt ou investigação forensic. Ele só lê caminhos
  declarados explicitamente, nunca envia código para prompts e não tem cache
  entre demandas.
- `./aegis authorize`: é o único portão de promoção. Seleciona o perfil pelo
  diff, executa estrutura e provas uma vez e vincula o receipt ao stage exato.
- `./aegis report`: deriva um relatório forense compacto de Git e dos receipts,
  sem pedir a um modelo que invente medições.
- `./aegis clean [--src|--all]`: reinicia runtime, produto, contrato e registro
  de provas como uma única unidade.

Não há codificador CLI autônomo, configuração de provedores ou fluxo TTY. A
disciplina de edição cirúrgica permanece: diff mínimo, checks locais, provas,
manifesto do stage e receipt.

Registros de governança específicos da demanda ficam em `src/.aegis/`, junto
do estado do produto que governam. `.harness/` contém apenas regras universais
e runtime ignorado; executar uma demanda não reescreve o core do harness.

## Perfis de evidência

| Perfil | Objetivo |
| --- | --- |
| `fast` | saúde determinística e barata |
| `targeted` | provas afetadas pelo diff |
| `release` | obrigações completas de promoção |
| `forensic` | benchmark, caos e investigação |

O projeto declara suas provas específicas de domínio no contrato e no registro
de provas. O core do Aegis não acumula testes de blockchain, pagamentos ou
qualquer outro domínio.

`npm test` mantém verificações determinísticas do harness. `./aegis review …`
prepara a revisão opcional por modelo independente somente para execuções de
alto risco ou forenses.

Veja [ARCHITECTURE.md](ARCHITECTURE.md) para o modelo formal.

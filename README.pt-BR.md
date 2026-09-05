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
# O IDE faz uma compilação semântica e o Aegis finaliza demanda + contrato.

./aegis verify
git add <arquivos>
git commit -m "..."
```

Comandos disponíveis:

- `./aegis "<demanda>"`: devolve ao IDE um envelope de preflight normalizado
  em memória; não persiste a demanda bruta.
- `./aegis finalize …`: valida uma única decisão semântica e persiste juntos a
  demanda esclarecida e o Contract IR v2. Confirmar uma interpretação proposta
  é mecânico; somente uma correção exige nova chamada ao modelo.
- `./aegis review …`: prepara uma revisão semântica independente opcional para
  execução de alto risco ou forense.
- `./aegis status`: mostra o estado das evidências e da árvore de trabalho.
- `./aegis evidence --path …`: cria um inventário mecânico opcional, limitado
  e transitório para receipt ou investigação forensic. Ele só lê caminhos
  declarados explicitamente, nunca envia código para prompts e não tem cache
  entre demandas.
- `./aegis verify [--profile …]`: executa verificações estruturais e provas aplicáveis.
- `./aegis proofs [--profile …]`: executa somente o perfil de provas escolhido.
- `./aegis authorize`: opcionalmente cria o receipt antes do commit; o hook
  pre-commit o renova automaticamente para o diff exato em stage.
- `./aegis clean [--src|--all]`: remove estado transiente; `--src` também
  reinicia produto, contrato e registro de provas como uma única unidade.

Não há codificador CLI autônomo, configuração de provedores ou fluxo TTY. A
disciplina de edição cirúrgica permanece: diff mínimo, checks locais, provas,
manifesto do stage e receipt.

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

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
# O IDE cria ou atualiza o contrato da demanda e o código.

./aegis verify
git add <arquivos>
git commit -m "..."
```

Comandos disponíveis:

- `./aegis "<demanda>"`: registra a proveniência da demanda para o IDE.
- `./aegis status`: mostra o estado das evidências e da árvore de trabalho.
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

Veja [ARCHITECTURE.md](ARCHITECTURE.md) para o modelo formal.

# Aegis

Versão curta para assistentes de código. Guia humano: [`GUIA.md`](GUIA.md).

Antes de propor mudanças no alvo:

```bash
./aegis context
```

Para alterar código:

```bash
./aegis go "<uma frase>" [--target <path>] [--accept <token>]
```

- **Só o pedido é obrigatório.** Se o pedido nomear o código (`converterXEmY`,
  `MAX_SIZE`, `1024`), a acceptance sai dele; se não nomear, o `go` recusa e
  pede `--accept` — nunca inventa um nome, porque o token fica permanente.
- **`--target` é opcional**: sem ele, o alvo sai do reconhecimento mecânico do
  repositório. Dá-o quando souberes, ou quando o ficheiro ainda não existir.
- Um target por `go`. Dois ficheiros são dois `go`.
- `--change "<bullet>"` (opcional) quando o pedido não chega para descrever a mudança.
- `--issue N` volta a correr uma issue existente em vez de abrir outra.
- No prompt de confirmação, `e` abre o rascunho no editor: é aí que preenches
  ou corriges o que ficou por decidir.
- Não editar o alvo à mão enquanto um `go` corre. O `go` já recusa sozinho se
  o ficheiro tiver alterações por commitar — não precisas de verificar antes.

## O commit é do humano

O `go` termina no gate e **não commita sozinho quando corre sem terminal** —
que é sempre o caso quando o chamas de dentro de um assistente. Isso não é
falha: é o estado `PENDING_GATE`. Os paths ficam em stage, a mensagem pronta,
e o `go` imprime os dois comandos que faltam. Passa-os ao humano; não corras
`git commit` nem `git add -A` por tua conta — um `add -A` engole o gate e o
commit deixa de contar como registo.

## Ler o resultado

Cada comando termina com uma linha JSON. O `status` diz tudo:

| status | significa |
|---|---|
| `SUCCESS` | commitado e issue fechada |
| `PENDING_GATE` | corrido e validado; falta o humano commitar |
| `CANCELLED` | recusaste o draft; nada foi criado |
| `NO_CHANGE` | a run passou mas não promoveu nada |
| `UNCOMMITTED` | o gate foi cancelado; o trabalho está no worktree |
| outro | a run falhou; lê `reason` e ajusta os flags — não vás ler logs |

`run_aegis.sh` e `run_aegis_loop.sh` são ferramentas de construção do harness,
não o caminho de uso.

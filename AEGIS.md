# Aegis

Antes de propor mudanças no alvo:

```bash
./aegis context
```

Para alterar código:

```bash
./aegis go --goal "<uma frase>" --target <path> --accept <token> [--accept <token>]
```

- `--accept` são tokens curtos que têm de aparecer no código (nomes, constantes),
  nunca frases. São a semente do registo — sem eles o `go` recusa.
- Um target por `go`. Dois ficheiros são dois `go`.
- `--change "<bullet>"` (opcional) quando o Goal não chega para descrever a mudança.
- Não editar o alvo à mão enquanto um `go` corre.
- O commit é aprovado pelo humano no editor que o `go` abre. Não fazer
  `git commit` no alvo por tua conta.
- Se o `go` parar, ler o `status` e o `reason` que ele imprime e ajustar os
  flags. Não ir ler logs.

`run_aegis.sh` e `run_aegis_loop.sh` são ferramentas de construção do harness,
não o caminho de uso.

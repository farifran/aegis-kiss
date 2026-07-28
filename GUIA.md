# Guia de uso do Aegis

Para quem vai usar o Aegis no dia a dia. Se és um assistente de código,
lê o [`AEGIS.md`](AEGIS.md) — é a versão curta.

## O que o Aegis é

Um sistema que deixa um modelo de linguagem alterar o teu código **dentro de
barreiras**: ele só pode tocar nos ficheiros que tu nomeaste, tem de passar
por lint, tipos, testes e um julgamento final, e nada entra na tua história
de git sem tu aprovares.

Tu pedes uma coisa pequena. Ele executa o pipeline todo. Tu aprovas o commit.

## A regra de ouro

**Um pedido = um ficheiro = uma intenção.**

O Aegis foi desenhado assumindo um modelo fraco. Pedidos grandes falham — não
por falta de inteligência, mas por excesso de pedido. Se precisas de mexer em
dois ficheiros, são dois pedidos, um de cada vez.

## Os dois comandos

### 1. Ver onde estás

```bash
./aegis context
```

Diz-te três coisas: em que branch estás, se o teu código está limpo, e o que
já foi provado e aceite em cada ficheiro. Corre isto antes de pedir qualquer
coisa. Não toca em nada.

### 2. Pedir uma alteração

```bash
./aegis go --goal "converter Gigabits em Terabits em src/index.ts" \
           --target src/index.ts \
           --accept converterGigabitsEmTerabits
```

## Como escrever o pedido

**Só a frase é obrigatória.** O resto o Aegis preenche quando consegue, e
pergunta quando não consegue.

```bash
./aegis go "adicionar converterGigabitsEmTerabits a src/index.ts"
```

Isto chega. O que acontece por trás:

| Campo | Como é preenchido |
|---|---|
| Target | do reconhecimento mecânico do repositório, se não deres `--target` |
| Acceptance | do teu pedido, se ele nomear código |
| Out of scope | defaults do projeto |
| Constraints | defaults do projeto |

### A frase

Uma coisa só, concreta, e **nomeando o código** sempre que souberes o nome.

> ✅ `"adicionar converterGigabitsEmTerabits a src/index.ts"`
> ❌ `"melhorar as conversões e limpar o ficheiro"` (duas coisas, nenhuma concreta)

### Quando o Aegis não consegue adivinhar

**Não sabes o ficheiro?** Deixa em branco. O Aegis usa o mesmo reconhecimento
que o pipeline usa — churn do git cruzado com as palavras do teu pedido — e
diz-te o que escolheu:

```
[AEGIS][CLI] target proposto pelo reconhecimento: src/index.ts
```

Se nada no repositório ressoar com o pedido, ele pára e pede-te `--target`.
Também tens de o dar quando o ficheiro **ainda não existe** — não há como
reconhecer o que não está lá.

**O pedido não nomeia código?** Aí ele recusa:

```
missing_accept — o goal não nomeia código; dá --accept com o nome exacto
```

Isto é de propósito. O nome da função fica gravado no commit e passa a ser
protegido para sempre; um sistema que o inventasse estaria a tomar por ti a
decisão que menos deve tomar. Ou escreves o nome na frase, ou dá-lo assim:

```bash
./aegis go "converter Gigabits em Terabits" \
           --target src/index.ts \
           --accept converterGigabitsEmTerabits --accept "/ 1000"
```

### Porque a acceptance importa tanto

Esses tokens são usados três vezes: dizem ao modelo o que produzir, dizem ao
sistema se ele produziu, e ficam gravados no commit como prova. Uma frase não
serve para nenhuma das três.

> ✅ `converterGigabitsEmTerabits`, `MAX_SIZE`, `1024`, `/ 1000`
> ❌ `"a função deve estar exportada e tipada"`

### `--change` (opcional)

Quando a frase não chega para explicar a mudança:

```bash
--change "export function converterGigabitsEmTerabits(gigabits: number): number"
```

## Passo a passo completo

Do nada até ao commit aprovado. Os ecrãs abaixo são os reais, abreviados onde
o pipeline é verboso.

### Passo 1 — ver onde estás

```bash
./aegis context
```

```
branch: main · worktree: limpo
target: src · registo: 0 commits geridos

(sem registo — nenhum commit gerido ainda; nada protegido)
```

Este passo é **opcional** — o `go` verifica sozinho e recusa-se a trabalhar por
cima de alterações tuas por commitar. Serve para veres a **branch**: o commit
vai para onde estás agora. Se queres isolar o trabalho, cria a branch tu antes:
`git switch -c minha-branch`.

### Passo 2 — fazer o pedido

```bash
./aegis go "adicionar converterGigabitsEmTerabits a src/index.ts"
```

Se souberes mais, dá mais — mas nada disto é obrigatório:

```bash
./aegis go "converter Gigabits em Terabits" \
           --target src/index.ts \
           --accept converterGigabitsEmTerabits \
           --change "export function converterGigabitsEmTerabits(gigabits: number): number"
```

### Passo 3 — ler o rascunho

O Aegis monta o pedido no formato que o pipeline entende e mostra-to inteiro:

```
## Goal
converter Gigabits em Terabits em src/index.ts

## Targets
- src/index.ts

## Change
- export function converterGigabitsEmTerabits(gigabits: number): number

## Acceptance
- converterGigabitsEmTerabits

## Out of scope
- unrelated files
- e2e tests
- drive-by refactors

## Constraints
- no any / as any / @ts-ignore
- NodeNext: .js extension in relative imports
- only packages in package.json; builtins are global

fit: run_allowed=true model_fit=ok score=0
```

A última linha é o veredicto: **`run_allowed=true`** significa que o pedido cabe.
Se disser `false`, o Aegis lista os motivos e pára sem criar nada — parte o
pedido em dois e tenta outra vez.

O `Out of scope` e as `Constraints` aparecem sozinhos: são os defaults do
projeto, não tens de os escrever.

### Passo 4 — confirmar ou corrigir

```
Criar issue e correr? [y/N/e (editar)]
```

Esta é a última porta antes de qualquer coisa acontecer fora do teu computador.

- `y` — segue.
- `n` — cancela; nada é criado.
- `e` — abre o rascunho no teu editor. É aqui que corriges o target proposto,
  acrescentas uma acceptance, ou aperta o Goal. Ao gravares, o Aegis volta a
  verificar se cabe e pergunta outra vez.

(Se estiveres a automatizar, `--yes` salta esta pergunta.)

### Passo 5 — a issue e a run

```
[AEGIS][CLI] issue #13 criada
```

A partir daqui é o pipeline a correr, tipicamente 40 s a 2 min:

```
  discovery    ✓  2s
  forensics    ✓  2s
  repair       ✓  30s
  optimize     ✓  1s
  adversarial  ✓  2s
  validation   ✓  2s

Final Mode: validation
Verdict:    accepted

AEGIS OUTCOME
Status:     SUCCESS
```

Enquanto isto corre, **não mexas no ficheiro**. É a única regra durante a
execução.

### Passo 6 — o gate

```
[GATE] issue#13
 src/index.ts | 4 +++-
 1 file changed, 3 insertions(+), 1 deletion(-)

O editor abre com a mensagem pronta. Grava para commitar,
esvazia o buffer para cancelar. Acrescenta Aegis-Why se quiseres.
```

E abre o teu editor, já com tudo escrito:

```
aegis: issue#13 converterGigabitsEmTerabits

Aegis-Issue: 13
Aegis-Accept: converterGigabitsEmTerabits

# On branch main
# Changes to be committed:
#	modified:   src/index.ts
```

**Antes de gravar, olha para o diff.** É o teu único momento de revisão real: o
sistema garante que os tokens que pediste estão lá e que nada saiu do sítio —
**não** garante que a matemática está certa. Se a convenção do projeto é dividir
por 1000 e o modelo dividiu por 1024, passa em tudo e só tu apanhas. É para isso
que o gate existe.

- **Gravar e fechar** → commita.
- **Apagar tudo e fechar** → cancela. O código fica no worktree, sem commit.
- Queres registar a razão? Acrescenta uma linha antes dos comentários:
  `Aegis-Why: bits decimais (1000), não binários`

### Passo 7 — fim

```
[AEGIS][CLI] commit 8f3c1a2
{"schema":"aegis.go.v1","status":"SUCCESS","issue":"13","commit":"8f3c1a2","reason":""}
```

A issue fecha-se sozinha com um comentário a apontar para o commit.

### Passo 8 — confirmar o que ficou

```bash
./aegis context
```

```
branch: main · worktree: limpo
target: src · registo: 1 commits geridos

src/index.ts
  ✓ converterGigabitsEmTerabits             issue#13
```

O `✓` quer dizer: isto foi pedido, foi aceite, e continua no ficheiro. Se um
dia aparecer `✗`, é porque alguma coisa apagou o que já tinha sido provado.

### Se correres sem terminal

Dentro de um assistente de código não há editor para abrir, por isso o passo 6
muda: o Aegis deixa tudo em stage com a mensagem pronta, e imprime o que falta.

```
[AEGIS][CLI][WARN] sem TTY: o gate não commita sozinho

Para fechar:

  git commit -e -F ".harness/runtime/commit.msg"
  gh issue close 13 --comment "commit $(git rev-parse --short HEAD)"

{"schema":"aegis.go.v1","status":"PENDING_GATE",...}
```

Isto **não é uma falha** — é o gate a fazer o seu trabalho. Corres os dois
comandos e ficas no mesmo sítio do passo 7.


## Ler o resultado

Cada comando acaba com uma linha em JSON. Olha para o `status`:

| status | o que significa | o que fazer |
|---|---|---|
| `SUCCESS` | commitado, issue fechada | nada |
| `PENDING_GATE` | correu bem, falta commitares | corre os comandos que ele imprimiu |
| `CANCELLED` | disseste que não | nada foi criado |
| `NO_CHANGE` | passou mas não mudou nada | o pedido talvez já esteja feito |
| `UNCOMMITTED` | cancelaste o gate | o código está no worktree |
| outro | a run falhou | lê o `reason` e ajusta o pedido |

## Quando corre mal

**"demand_does_not_fit"** — o pedido é grande demais. Parte em dois `go`.

**A run falhou** — lê a linha `class`. Se disser `provider` ou `environment`, é
rede ou configuração, não o teu pedido. Se disser outra coisa, aperta o pedido:
goal mais estreito, acceptance mais concreta.

**"nada promovido"** — o pipeline passou mas não mudou nada. Normalmente o que
pediste já existe no ficheiro. Confirma com `./aegis context`.

**"target_dirty"** — tens alterações por commitar nesse ficheiro. Commita ou
guarda-as primeiro; o Aegis recusa-se a trabalhar por cima de trabalho teu.

## Erros comuns

**`git add -A` depois de um `go`.** Engole o gate: o código entra num commit
teu, sem o registo, e deixa de contar como provado. Commita só o que o gate
preparou.

**Editar o ficheiro enquanto o `go` corre.** O resultado é imprevisível e a
promoção pode recusar.

**Acceptance em prosa.** Passa, mas grava lixo no registo — e a partir daí o
sistema protege esse lixo.

**Dois ficheiros num pedido.** O `go` recusa de propósito.

## O que o Aegis não faz por ti

- Não decide **o que** queres. Os três campos são teus.
- Não julga se o algoritmo está certo. Verifica que fizeste o que pediste, não
  que pediste a coisa certa.
- Não faz revisão de produto.

É por isso que há exatamente um sítio onde um humano tem de estar: o gate.

## Onde está o resto

- [`AEGIS.md`](AEGIS.md) — a versão curta, para assistentes de código
- [`README.md`](README.md) — instalação, variáveis, testes
- [`INTAKE.md`](INTAKE.md) — o processo manual completo, para casos que o `go` não cobre

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

O supervisor semântico é separado do executor de código. Por padrão ele é o
modelo ativo do IDE. Também pode ser um modelo externo compatível com OpenAI
(inclusive Ollama/vLLM local); o IDE continua responsável pelas perguntas,
edição, testes e implementação.

```bash
./aegis setup
# O IDE apresenta a seleção e coleta os campos necessários.
./aegis setup ide
./aegis setup external --endpoint http://127.0.0.1:11434/v1 --model llama3.2:11b
./aegis setup reviewer external --endpoint http://127.0.0.1:11434/v1 --model llama3.2:11b
./aegis setup show
```

Se o provedor exigir credenciais, informe apenas o nome da variável de
ambiente — nunca a chave no comando:

```bash
./aegis setup external --endpoint https://provider.example/v1 --model model-id --api-key-env PROVIDER_API_KEY
```

A escolha do supervisor fica vinculada ao envelope de preflight congelado. O
modelo externo recebe somente o pedido semântico e registra identidade, tempo,
tokens quando o provedor os informar e digest da decisão. O receipt de promoção
carrega esse vínculo, sem chave de API ou saída bruta do modelo.

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
- `./aegis resume`: retoma a decisão congelada depois que o Wizard nativo do
  IDE registra uma seleção explícita; nunca aceita uma demanda arbitrária.
- `./aegis harness "<demanda>"`: inicia explicitamente a manutenção do Aegis;
  somente esse modo pode autorizar mudanças no core do harness.
- `./aegis finalize …`: valida uma única decisão semântica e persiste juntos a
  demanda esclarecida, o Contract IR v2 e o registro de provas. Ele consome o
  intake congelado, sem redescobrir uma árvore mutável. Confirmar uma
  interpretação é mecânico; somente uma correção exige nova chamada ao modelo.
  Em contrato forense, o gateway executa automaticamente o revisor externo
  independente configurado antes da persistência; isso nunca é uma etapa do usuário.
- `./aegis review …`: expõe o construtor interno do pedido de revisão para
  diagnóstico; execuções normais o disparam automaticamente.
- `./aegis status`: mostra o estado das evidências e da árvore de trabalho.
- `./aegis setup`: emite uma seleção interativa para o IDE. Ele configura o
  supervisor semântico e o revisor forense independente. O revisor é um modelo
  OpenAI-compatível chamado somente na revisão forense; sua identidade e
  execução vinculam o resultado ao receipt.
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

Não há codificador CLI autônomo. A única integração opcional de provedor é o
supervisor semântico externo, limitado e configurado por `setup`. A
disciplina de edição cirúrgica permanece: diff mínimo, checks locais, provas,
manifesto do stage e receipt.

## Wizard nativo do VS Code

O adaptador opcional em `integrations/vscode-aegis-wizard/` observa apenas a
solicitação transitória de confirmação, mostra Quick Picks do VS Code (setas e
Enter), registra a escolha exata e chama `./aegis resume`. Ele fica separado
do núcleo universal do harness. Use `AEGIS_WIZARD_MODE=terminal` somente sem
adaptador instalado.

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

`npm test` mantém verificações determinísticas do harness. Contratos de alto
risco ou forenses sempre recebem revisão independente isolada, automaticamente
após as clarificações e antes da persistência. Sem revisor configurado, o
contrato falha fechado antes de persistir estado semântico.

Veja [ARCHITECTURE.md](ARCHITECTURE.md) para o modelo formal.

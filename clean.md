# Evolução de `./aegis --clean` para `./aegis --new`

## Estado deste documento

Este documento registra a análise e a proposta para a mudança futura de `clean` para `new`. A separação do estado interno já foi corrigida; a limpeza destrutiva de `src/` permanece temporariamente e ainda precisa ser substituída.

O objetivo é preservar a capacidade útil de reiniciar o Aegis para uma demanda completamente nova e não relacionada à anterior, sem permitir que o Harness apague ou escreva código de produto.

## Princípio arquitetural

O Aegis Harness atua como tribunal constitucional e compilador de requisitos. Sua responsabilidade termina na produção e governança do contrato. Ele não deve implementar a demanda nem modificar o produto em `src/`.

Portanto, reiniciar o Aegis significa remover ou substituir somente artefatos pertencentes ao próprio Aegis. Reiniciar o Aegis não significa apagar o sistema de software existente.

## Comportamento atual de `--clean`

Atualmente, o comando executa esta sequência:

```text
./aegis --clean
      │
      ├─ apaga .harness/runtime/
      ├─ recria .harness/runtime/
      ├─ apaga .harness/state/
      ├─ apaga todo o conteúdo de src/
      └─ cria src/index.ts vazio
```

Na prática, ele mistura três responsabilidades diferentes:

1. Limpar arquivos transitórios do Harness.
2. Remover o estado semântico anterior do Aegis.
3. Apagar e recriar o produto.

As duas primeiras pertencem ao Aegis. A terceira não pertence.

## Problemas confirmados

### 1. Destruição do produto

O comando remove recursivamente tudo que estiver dentro de `src/`, incluindo:

- código versionado;
- código ainda não commitado;
- arquivos não versionados;
- subdiretórios;
- provas produzidas por outras ferramentas;
- qualquer outro conteúdo colocado pelo usuário.

Depois disso, cria um `src/index.ts` artificial. Essa escrita viola a fronteira entre Harness e produto.

### 2. Nome ambíguo

Em ferramentas de desenvolvimento, `clean` normalmente significa remover cache, arquivos temporários ou resultados de compilação. O nome não comunica que todo o código do produto será apagado.

### 3. Validação tardia do produto

O comando apaga o runtime e o estado do Aegis antes de verificar se `src/` é um diretório real. A antiga remoção antecipada de `src/.aegis/`, que podia atravessar um link simbólico, foi eliminada; ainda assim, uma falha em `src/` pode ocorrer depois da perda do contexto anterior.

### 4. Falha não atômica

O estado anterior é apagado antes de existir uma nova demanda validada. Se o usuário cometer um erro ou a próxima captura falhar, o Aegis permanece vazio e o contexto anterior já foi perdido.

### 5. Sem distinção entre evolução e sistema novo

O fluxo atual não diferencia:

- uma demanda que evolui o sistema existente;
- uma demanda pertencente a outro sistema, sem relação com o anterior.

Essa distinção não deve ser inferida silenciosamente pelo Aegis. Ela precisa ser declarada pelo usuário.

## Semântica proposta

Existirão duas intenções explícitas.

### Evoluir o sistema atual

```bash
./aegis "Adicionar exportação de relatórios"
```

Esse fluxo preserva o estado e o contrato anteriores. A nova demanda deve ser analisada como evolução, correção ou emenda do sistema atual.

### Começar um sistema independente

```bash
./aegis --new "Criar sistema de controle de estoque"
```

Esse fluxo declara que a demanda não possui relação com o sistema governado anteriormente. O Aegis reinicia seu próprio contexto e produz imediatamente o preflight da nova demanda.

## Por que usar `--new` em vez de `--clean`

`new` descreve a intenção do usuário: começar um novo contexto governado. Ele evita que o usuário precise executar duas operações separadas e reduz o período em que o Aegis ficaria sem estado.

```text
Fluxo antigo pretendido:
clean → verificar workspace → executar nova demanda

Fluxo proposto:
new "demanda"
```

## Comparação lado a lado

| Aspecto | `./aegis --clean` atual | `./aegis --new "demanda"` proposto |
|---|---|---|
| Intenção | Limpar o laboratório | Iniciar um sistema independente |
| Exige nova demanda | Não | Sim |
| Momento da limpeza | Imediatamente | Depois de validar a nova demanda |
| `.harness/runtime/` | Apaga tudo | Substitui pelo preflight da nova demanda |
| Estado anterior do Aegis | Apaga imediatamente | Remove somente quando a nova captura pode prosseguir |
| Configuração local de papéis | Não se aplica | Preserva `.harness/config/roles.json`; ela pertence à máquina, não à demanda |
| `src/` | Apaga completamente | Nunca modifica |
| `src/index.ts` | Recria artificialmente | Não cria |
| Arquivos não versionados | Apaga | Preserva |
| Links simbólicos | Valida tarde demais | Valida antes de qualquer alteração |
| Falha durante a preparação | Pode perder o estado anterior | Preserva o estado anterior |
| Resultado | Aegis vazio | Novo preflight em `DISCOVERED` |
| Uso acidental | Destrutivo | Falha de forma segura |

## Momento correto para reiniciar

O runtime e o estado do Aegis devem ser reiniciados somente depois que estas condições forem satisfeitas:

1. O usuário invocou explicitamente `new`.
2. A nova demanda existe e possui UTF-8 válido.
3. O tamanho da demanda está dentro do limite aceito.
4. Os caminhos internos do Aegis foram validados.
5. O workspace é apropriado para o novo sistema.
6. A captura e o Discovery conseguem produzir o novo preflight em memória.

Se qualquer verificação falhar, nenhum estado anterior deve ser removido.

## Fluxo futuro de `new`

```text
./aegis --new "nova demanda"
            │
            ▼
   Validar intenção e UTF-8
            │
            ▼
   Validar workspace e caminhos
            │
            ▼
   Executar captura + Discovery em RAM
            │
       ┌────┴────┐
       │ falhou? │── sim ──> preservar tudo e reportar falha
       └────┬────┘
            │ não
            ▼
   Remover somente estado do Aegis
            │
            ▼
   Persistir o novo preflight
            │
            ▼
   DISCOVERED / SEMANTIC_DELIBERATION_REQUIRED
```

## O que poderá ser removido

Somente arquivos pertencentes ao Aegis, por exemplo:

- preflight anterior;
- pedido e respostas do Wizard;
- rascunho de contrato anterior;
- contrato governado da sessão anterior;
- registro interno de provas;
- recibos transitórios;
- estado semântico mantido pelo Harness.

O estado governado atual reside em `.harness/state/semantic-state.json`; artefatos transitórios residem em `.harness/runtime/`. Nada pertencente ao Aegis precisa ser armazenado em `src/`.

## O que nunca poderá ser removido ou criado

O comando não poderá:

- apagar `src/`;
- apagar arquivos individuais do produto;
- recriar `src/index.ts`;
- criar código inicial;
- criar provas de produto;
- alterar arquivos versionados ou não versionados;
- seguir links simbólicos para fora do workspace;
- invocar implementação automática depois do preflight.

O contrato poderá declarar escopo e obrigações de prova, mas essa declaração não autoriza o Harness a materializar código ou scripts.

## Workspace para um sistema completamente novo

Reiniciar o contexto do Aegis não transforma automaticamente um repositório com código antigo em um projeto vazio. Se `src/` ainda contiver outro produto, o Discovery continuará encontrando esse produto.

Para um sistema realmente independente, a opção mais segura é usar:

- um novo repositório;
- um novo diretório de projeto;
- ou um worktree preparado pelo usuário.

O Aegis não deve apagar o produto antigo para simular um workspace novo. Caso `new` seja usado em um workspace incompatível, ele deve falhar explicitamente e orientar o usuário.

## Segurança da operação

A implementação futura deverá:

1. Validar todos os diretórios antes da primeira remoção.
2. Recusar diretórios internos que sejam links simbólicos.
3. Usar destinos explícitos e limitados ao estado do Aegis.
4. Evitar remoções recursivas sobre `src/` ou sobre caminhos amplos.
5. Manter a operação idempotente.
6. Informar exatamente o que foi removido.
7. Informar explicitamente que o produto foi preservado.

Saída sugerida:

```json
{
  "status": "DISCOVERED",
  "previousAegisStateRemoved": true,
  "productPreserved": true,
  "dataPath": ".harness/runtime/preflight.json"
}
```

## Critérios de aceite

A mudança estará correta quando:

- `./aegis --new "demanda válida"` produzir um novo preflight;
- a demanda inválida preservar integralmente o estado anterior;
- o código em `src/` permanecer byte a byte idêntico;
- arquivos não versionados em `src/` sobreviverem;
- subdiretórios em `src/` sobreviverem;
- nenhum `src/index.ts` for criado quando não existir;
- links simbólicos perigosos forem recusados antes de qualquer remoção;
- o contrato e o estado anteriores do Aegis forem removidos somente após a validação;
- a operação for idempotente;
- o status final seja `SEMANTIC_DELIBERATION_REQUIRED` na fase `DISCOVERED`;
- nenhuma implementação ou prova de produto seja iniciada.

## Testes necessários

### Caminho feliz

- Começar com um estado antigo válido.
- Executar `new` com uma demanda válida.
- Confirmar que o estado antigo foi substituído pelo novo preflight.
- Confirmar que `src/` não mudou.

### Demanda inválida

- Usar texto vazio, UTF-8 inválido e entrada acima do limite.
- Confirmar que runtime e estado anteriores permanecem intactos.

### Produto não versionado

- Criar arquivos e diretórios não versionados em `src/`.
- Executar `new`.
- Comparar os digests antes e depois.

### Links simbólicos

- Substituir um diretório interno esperado por um link para um destino descartável externo.
- Executar `new`.
- Confirmar falha explícita.
- Confirmar que nenhum arquivo externo foi removido.

### Idempotência

- Executar `new` em condições equivalentes mais de uma vez.
- Confirmar estado final determinístico e ausência de resíduos intermediários.

### Não implementação

- Confirmar que não são criados `src/index.ts`, `*.proof.sh` ou quaisquer arquivos de produto.
- Confirmar que nenhum executor de provas ou implementação é iniciado.

## Migração futura

Uma implementação segura pode seguir esta ordem:

1. Adicionar testes que preservem `src/` e reproduzam a vulnerabilidade de link simbólico.
2. ~~Mover o estado interno de `src/.aegis/` para `.harness/state/`.~~ Concluído.
3. Implementar `./aegis --new "demanda"` com validação antes da remoção.
4. Remover do fluxo qualquer exclusão ou criação dentro de `src/`.
5. ~~Atualizar `status`, Wizard, documentação e testes para a nova localização do estado.~~ Concluído para o fluxo atual.
6. Remover ou descontinuar `clean` somente depois que `new` cobrir sua finalidade útil.

## Decisão proposta

Adotar esta interface:

```text
./aegis "demanda"      → evolui o sistema atual e preserva seu contexto
./aegis --new "demanda" → inicia contexto independente e substitui somente o estado do Aegis
```

O antigo comportamento que apaga `src/` não deve ser mantido sob nenhum nome. Preparar ou apagar um produto pertence ao usuário, ao Git ou ao gerenciador de workspaces, não ao compilador de contratos.

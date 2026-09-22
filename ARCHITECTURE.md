# Arquitetura técnica do projeto

Este documento define a arquitetura técnica permitida para o código e para os
artefatos persistentes deste repositório. Ele não é um prompt de modelo, manual
do fluxo operacional nem contrato de uma demanda: o preflight recebe somente a
projeção estruturada em `governance/architecture.policy.json`.

## Fronteiras permitidas

- O produto reside em `src/`; uma demanda `PRODUCT` não altera o harness.
- O estado semântico persistente, quando necessário, reside unicamente em
  `.harness/state/semantic-state.json`.
- O runtime do harness é transitório em `.harness/runtime/`; não é fonte de
  verdade nem artefato de produto.
- Ao processar e assinar uma demanda, o harness pode observar e citar caminhos
  de produto no contrato, mas não pode criar, editar ou apagar esses caminhos.
  Assinar um contrato não autoriza sua implementação.
- O core usa execução local, determinística e sem dependência de rede ou de
  provedores de modelo. Compiladores, linters e provas são adaptadores locais.
- A atribuição local de adaptadores humanos/IA reside em
  `.harness/config/roles.json`, é ignorada pelo Git e nunca contém segredos.
  Chaves de API pertencem exclusivamente a variáveis de ambiente ou ao
  chaveiro do sistema. Essa atribuição não autoriza implementação.

## Forma técnica preferida

- TypeScript estrito, módulos pequenos e APIs explícitas.
- Dependências mínimas; não introduzir persistência, concorrência, camadas ou
  extensibilidade sem requisito, invariante ou prova que as justifique.
- Todo comportamento observável deve possuir estado e resultado explícitos;
  detalhes internos continuam livres para evoluir enquanto preservarem o
  contrato e as provas.

## Regras arquiteturais ativas

As cláusulas abaixo são a fonte humana das regras estruturadas. Alterar uma
delas exige atualizar a política estruturada no mesmo commit; divergência
entre ambos bloqueia o preflight.

### ARCH-PRODUCT-BOUNDARY — hard

Uma demanda de produto observa e cita exclusivamente `src/` como fonte do
produto, e requisitos de produto não podem alterar o harness.

Aplica-se a demandas de produto e a referências a caminhos do produto.

### ARCH-HARNESS-STATE — hard

O estado semântico persistente do harness reside em
`.harness/state/semantic-state.json`; dados transitórios residem em
`.harness/runtime/`. A atribuição local de adaptadores reside em
`.harness/config/roles.json`, não contém segredos e nunca é fonte de verdade
do produto.

Aplica-se a mudanças ou decisões sobre estado e runtime do harness.

### ARCH-LOCAL-DETERMINISTIC-CORE — hard

O core mecânico opera localmente, de forma determinística e sem dependência de
rede ou de um provedor de modelo. Integrações externas pertencem a adaptadores.

Aplica-se a mudanças no core do harness e a integrações com provedores.

### ARCH-STRICT-EXPLICIT-MODULES — default

Código TypeScript usa tipagem estrita, módulos pequenos e APIs explícitas, sem
supressões permissivas que escondam falhas ou contratos públicos.

Aplica-se a demandas que imponham forma técnica TypeScript.

### ARCH-PARSIMONY — default

Dependências, persistência, concorrência, camadas e pontos de extensão só são
admitidos quando um requisito observável justificar seu custo. A alternativa
recomendada deve ser a menor arquitetura suficiente.

Aplica-se quando a demanda solicita dependências ou complexidade estrutural.

### ARCH-FAILURE-EXPLICIT — hard

Nenhuma falha relevante pode desaparecer silenciosamente; a operação deve
expor resultado, erro explícito, estado preservado ou rollback verificável.

Aplica-se a operações com estado ou efeito externo.

### ARCH-DETERMINISTIC-TIME — hard

Comportamento que depende de tempo deve receber uma referência temporal
explícita ou usar uma fonte reproduzível. O relógio do sistema não pode alterar
o resultado de forma implícita; uma exceção requer emenda arquitetural
aprovada.

Aplica-se a comportamento dependente de tempo. `Date.now()` é uma referência
proibida enquanto não houver emenda aprovada.

### ARCH-BIGINT-ARITHMETIC — hard

Quando uma demanda TypeScript ou JavaScript usa a divisão nativa de `BigInt`
sem exigir outra política, o resultado trunca em direção a zero e divisor zero
produz rejeição explícita. Esses comportamentos são fatos mecânicos da
plataforma e não criam decisões para o Wizard.

Divisão inteira não define, por si só, o destino de restos nem autoriza
redistribuição, descarte ou rejeição da operação. Quando esse efeito altera o
resultado público, ele precisa estar explícito na intenção, em decisão humana
ou em política aplicável.

Aplica-se a contratos que exponham aritmética inteira `BigInt`.

### ARCH-OBSERVABILITY-COUNTERS — default

Campos públicos de contagem sem sinal usados somente para observabilidade
rejeitam valores negativos e saturam no maior valor representável quando a
demanda não define outra política. Wrap ou truncamento silencioso são
proibidos porque falseiam a telemetria.

Aplica-se a contadores limitados em bitmasks ou telemetria pública.

### ARCH-HASH-SECURITY-LABEL — hard

Um fingerprint determinístico não criptográfico não pode ser apresentado como
garantia criptográfica. Quando a propriedade de segurança exigida for
incompatível com a primitiva, a largura ou uma projeção solicitada, o preflight
deve reabrir esses pontos em vez de aplicar a escolha silenciosamente. Enquanto
houver decisão pendente, requisitos e riscos usam terminologia neutra de
integridade.

Aplica-se a hashes, fingerprints e raízes de integridade públicas.

### ARCH-PUBLIC-INTERFACE — hard

Toda função pública exigida pelo contrato possui entradas, saídas e falhas
observáveis definidas. Quando a intenção não fornece uma assinatura ou modelo
de dados suficiente, a ausência permanece uma lacuna bloqueante; o modelo não
inventa uma API nem transfere uma opção imatura ao Wizard.

Aplica-se a funções, APIs e exports públicos.

### ARCH-CONTRACT-CONSISTENCY — hard

Um contrato não pode declarar a mesma propriedade simultaneamente fechada e
dependente de decisão humana. Invariantes, casos de aceitação, limites, riscos
e alternativas devem ser mutuamente compatíveis, e um risco não pode substituir
a resolução de uma contradição semântica. Texto normativo permanece neutro
enquanto uma decisão puder alterar a propriedade. Alternativas que mudam apenas
um detalhe interno sem alterar resultados observáveis não formam decisão;
opções incompatíveis reabrem o preflight. Decisões dependentes são avaliadas em
conjunto, e nenhuma recomendação pode descartar entrada silenciosamente.

Uma função pública declarada pura exige caso metamórfico que demonstre que
chamadas de observação não alteram o comportamento de uma operação posterior.

Aplica-se à compilação e à promoção de todo contrato semântico.

## Evolução da política

O Contract IR calcula localmente quais regras são aplicáveis e exige avaliação
semântica somente dessas regras. Conflitos com regras `hard` são correções
obrigatórias e nunca viram opções do Wizard. Regras `default` só podem pedir
confirmação quando uma exigência observável e explícita do usuário deixar uma
escolha material; complexidade apenas sugerida é podada automaticamente.
Preferências não criam perguntas. Regras de negócio, invariantes e provas de
uma demanda pertencem ao contrato dela, não a este documento.

## Sinais mecânicos conservadores

Referências explícitas na própria demanda também ativam a regra correspondente,
mesmo se o modelo omitir um contexto. A política distingue sinais comuns de
revisão (`reviewReferences`) de sinais de possível conflito
(`forbiddenReferences`). A ocorrência literal não decide o veredito — ela pode
estar negada ou citada como exemplo —, mas não pode desaparecer do contrato e
exige avaliação explícita da regra em `policyAssessments`.

Os sinais se limitam a fronteiras e construções técnicas genéricas, como
caminhos, tipos, efeitos, tempo, representação limitada, segurança declarada e
abstrações estruturais. Nomes de domínio, algoritmos concretos e exemplos de
demandas anteriores não pertencem ao detector mecânico. Todo sinal exige
avaliação explícita da regra correspondente; a revisão adversarial residual não
repete uma correção já resolvida pela política. A lista é deliberadamente curta:
protege cláusulas universais sem tentar substituir interpretação semântica por
um dicionário de domínio.

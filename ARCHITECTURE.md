# Arquitetura do Produto

Este documento define as **escolhas e restrições técnicas deste software** (`src/`). Ele é lido automaticamente pelo `./aegis brief` para limitar, orientar ou levantar conflitos diante de cada demanda — sem precisar de espelho JSON.

> **Como definir regras aqui (cada `###` vira uma regra ativa):**
> - **`hard`:** restrição obrigatória do projeto. A IA deve respeitar ou expor explicitamente o conflito ao humano (nunca contornar em silêncio).
> - **`default`:** padrão preferido do projeto. A IA segue por padrão, mas pode questionar/deliberar com o humano caso a demanda exija uma exceção.
> - *Ao adaptar o Aegis para outro projeto, edite as regras abaixo para refletir a arquitetura real daquele sistema (ex.: sem framework, SQLite, bitmask, HTTP nativo, etc.).*

## Regras Arquiteturais Ativas

### 1. Fronteira de Produto (`ARCH-PRODUCT-BOUNDARY` — hard)
Todo o código e testes do produto residem exclusivamente em `src/`. Demandas de produto não podem ler nem alterar arquivos fora de `src/` (como configurações, scripts de build ou caminhos do sistema operacional).

### 2. Sem Frameworks nem Dependências de Runtime (`ARCH-NO-FRAMEWORK` — default)
O produto opera como módulos TypeScript puros em memória, sem frameworks externos, bancos de dados ou bibliotecas de runtime. Qualquer nova dependência externa ou persistência exige justificativa observável e aprovação humana explícita.

### 3. Tipagem Estrita e Contratos Públicos Explícitos (`ARCH-STRICT-TYPES` — hard)
Código TypeScript usa tipagem estrita, funções públicas com assinatura e retorno explícitos e dados `readonly`, vedando `as any`, `@ts-ignore` ou supressões que escondam falhas. Detalhes internos continuam livres enquanto preservarem a interface pública e os testes.

### 4. Valores Monetários em Centavos Inteiros (`ARCH-INTEGER-CENTS` — hard)
Cálculos financeiros operam exclusivamente em centavos inteiros seguros (`Number.isSafeInteger`), sem aritmética de ponto flutuante para dinheiro.

### 5. Falhas Explícitas e Estado Preservado (`ARCH-FAILURE-EXPLICIT` — hard)
Nenhuma falha relevante pode desaparecer silenciosamente (`catch` vazio, erro engolido ou descarte implícito). Operações com estado ou efeito externo devem expor resultado/erro explícito, precedência clara de guardas, estado preservado ou rollback verificável.

### 6. Tempo Determinístico (`ARCH-DETERMINISTIC-TIME` — hard)
Comportamento dependente de tempo deve receber referência temporal explícita (ex.: `nowMs` ou relógio injetado). Uso implícito de `Date.now()` ou `new Date()` sem argumentos é proibido na lógica de domínio.

### 7. Parcimônia Estrutural (`ARCH-PARSIMONY` — default)
Não introduzir factories, builders, event buses, singletons, concorrência ou camadas abstratas extras quando funções e módulos diretos entregam o mesmo resultado observável.

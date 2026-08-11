# Target Project Architecture (`src/ARCHITECTURE.md`)

Diretrizes exclusivas do projeto alvo em `src/` (escopo de código, padrões de engenharia e convenções inspiradas no PonyTail).

## 🏛️ 1. Stack & Dependências (Native-First)
* **Linguagem & Módulos**: Pure Vanilla TypeScript com **NodeNext ESM** (`import { fn } from './file.js'`).
* **Ecossistema**: **Zero dependências externas** (apenas a biblioteca padrão e APIs nativas do runtime).

## ⚙️ 2. Padrões de Engenharia & PonyTail
* **Tipagem Estrita & Zero `any`**: Proibido usar `any`. Exigir tipos de retorno explícitos nas funções públicas e estreitamento de tipos seguro (`unknown`).
* **Imutabilidade & Funções Puras**: Preferir funções puras sem efeitos colaterais ocultos e marcar payloads/propriedades públicas com `readonly`.
* **Tratamento de Erros Explícito**: Evitar `throw` de literais/strings genéricas ou blocos `catch` vazios. Utilizar erros tipados do domínio ou verificação estrita de premissas.
* **Nomenclatura & Módulos Atômicos**: Arquivos em `kebab-case` (1 utilitário por arquivo). Símbolos e funções em `camelCase`, tipos e interfaces em `PascalCase`.

## ⚙️ 3. Padrões de Domínio & Encapsulamento
* **Cálculos de Dados & BigInt**: Utilizar `BigInt` ou operadores bitwise para manipulação de bits/bytes. Sempre multiplicar por escala prévia (`Math.round(rate * 1_000_000)`) antes de converter para `BigInt` e sempre multiplicar antes de dividir `(tempo * taxa) / escala` para evitar truncamento por zero em divisão inteira.
* **Encapsulamento & Re-exportação**: Manter encapsulamento estrito (getters públicos em vez de acessos diretos a membros privados `#field` ou `_private`). Todo novo módulo utilitário criado em `src/` DEVE ter suas interfaces e funções públicas re-exportadas em `src/index.ts`.

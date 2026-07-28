# Target Project Architecture (`src/ARCHITECTURE.md`)

Diretrizes exclusivas do projeto alvo (escopo de código e tecnologias).

## 🏛️ 1. Stack & Dependências
* **Linguagem & Módulos**: Pure Vanilla TypeScript (NodeNext ESM: `import { fn } from './file.js'`).
* **Ecossistema**: **Zero dependências externas** (apenas runtime nativo).

## ⚙️ 2. Padrões de Domínio
* **Cálculos de Dados & BigInt**: Utilizar `BigInt` ou operadores bitwise para manipulação de bits/bytes. Sempre multiplicar por escala prévia (`Math.round(rate * 1_000_000)`) antes de converter para `BigInt` e sempre multiplicar antes de dividir `(tempo * taxa) / escala` para evitar truncamento por zero em divisão inteira.
* **Encapsulamento & Re-exportação**: Manter encapsulamento estrito (getters públicos em vez de acessos diretos a membros privados). Todo novo módulo utilitário criado em `src/` DEVE ter suas interfaces e funções públicas re-exportadas em `src/index.ts`.


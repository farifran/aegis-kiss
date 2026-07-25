# Target Project Architecture (`src/ARCHITECTURE.md`)

Diretrizes exclusivas do projeto alvo (escopo de código e tecnologias).

## 🏛️ 1. Stack & Dependências
* **Linguagem & Módulos**: Pure Vanilla TypeScript (NodeNext ESM: `import { fn } from './file.js'`).
* **Ecossistema**: **Zero dependências externas** (apenas runtime nativo).

## ⚙️ 2. Padrões de Domínio
* **Cálculos de Dados**: Utilizar `BigInt` ou operadores bitwise para manipulação de bits/bytes.
* **Encapsulamento**: Exportação única por arquivo de módulo utilitário.

# Project Architecture Blueprint (`architecture_blueprint.md`)

Este arquivo define as diretrizes gerais de arquitetura do projeto. Ele é preenchido no início do desenvolvimento para estabelecer as fronteiras técnicas que qualquer desenvolvedor ou modelo de IA deve respeitar.

---

## 🏛️ 1. Tecnologia e Dependências (Stack)
* **Linguagem**: Vanilla TypeScript (strict mode).
* **Módulos**: NodeNext ESM (`import { fn } from './file.js'`).
* **Dependências**: **Zero dependências externas** (usar apenas recursos nativos da linguagem e do Node.js/Browser).

---

## ⚙️ 2. Padrões de Código e Paradigma
* **Estilo de Programação**: Funcional e determinístico (funções puras, sem efeitos colaterais em estado global).
* **Princípio KISS**: Manter a implementação mais simples e direta possível. Proibido criar abstrações prematuras ou classes utilitárias não solicitadas.
* **Cálculos e Tipos**: Usar `BigInt` ou operadores bitwise para operações com bits/bytes.

---

## 📦 3. Organização de Módulos
* **Superfície de Exportação**: Cada arquivo deve conter apenas **1 export público principal** (evitar poluir a API do repositório).
* **Tipagem Estrita**: Todas as funções exportadas devem ter anotações explícitas de tipos de parâmetros e tipo de retorno (proibido o uso de `any` ou `@ts-ignore`).

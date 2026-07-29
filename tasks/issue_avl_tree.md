# Issue: Implementação da Árvore AVL Auto-Balanceada (Módulo src/avlTree.ts)

## Descrição
Implementar a estrutura de dados de Árvore AVL em `src/avlTree.ts` de forma incremental e modular para modelo 8B.

---

### Task 1: Estrutura Base & Inserção (Criação de `src/avlTree.ts`)
- **Demanda**: `crie modulo src/avlTree.ts com interface AVLNode<K, V> e classe AVLTree<K, V> com metodos insert(key: K, value: V): void e search(key: K): V | undefined`

---

### Task 2: Rotações & Auto-Balanceamento
- **Demanda**: `adicione metodos de rotacao e balanceamento getBalance, rotateLeft, rotateRight na classe AVLTree em src/avlTree.ts`

---

### Task 3: Métodos de Consulta & Estado
- **Demanda**: `adicione metodos min, max, height, isBalanced na classe AVLTree em src/avlTree.ts`

---

### Task 4: Remoção, Percursos & Re-export no `src/index.ts`
- **Demanda**: `adicione metodos delete, inOrder, preOrder, postOrder em src/avlTree.ts e re-exporte AVLTree no src/index.ts sem extensoes .ts`

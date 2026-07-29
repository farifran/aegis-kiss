/**
 * Nó de uma Árvore AVL.
 */
export interface AVLNode<K, V> {
  key: K;
  value: V;
  height: number;
  left: AVLNode<K, V> | null;
  right: AVLNode<K, V> | null;
}

/**
 * Árvore AVL Auto-Balanceada.
 */
export class AVLTree<K, V> {
  private root: AVLNode<K, V> | null = null;

  private getHeight(node: AVLNode<K, V> | null): number {
    return node ? node.height : 0;
  }

  private updateHeight(node: AVLNode<K, V>): void {
    node.height = 1 + Math.max(this.getHeight(node.left), this.getHeight(node.right));
  }

  private getBalance(node: AVLNode<K, V> | null): number {
    return node ? this.getHeight(node.left) - this.getHeight(node.right) : 0;
  }

  private rotateRight(y: AVLNode<K, V>): AVLNode<K, V> {
    const x = y.left;
    if (!x) return y;
    const T2 = x.right;

    x.right = y;
    y.left = T2;

    this.updateHeight(y);
    this.updateHeight(x);

    return x;
  }

  private rotateLeft(x: AVLNode<K, V>): AVLNode<K, V> {
    const y = x.right;
    if (!y) return x;
    const T2 = y.left;

    y.left = x;
    x.right = T2;

    this.updateHeight(x);
    this.updateHeight(y);

    return y;
  }

  private balanceLeft(node: AVLNode<K, V>, key: K): AVLNode<K, V> {
    if (node.left && key > node.left.key) {
      node.left = this.rotateLeft(node.left);
    }
    return this.rotateRight(node);
  }

  private balanceRight(node: AVLNode<K, V>, key: K): AVLNode<K, V> {
    if (node.right && key < node.right.key) {
      node.right = this.rotateRight(node.right);
    }
    return this.rotateLeft(node);
  }

  private rebalanceNode(node: AVLNode<K, V>, key: K): AVLNode<K, V> {
    this.updateHeight(node);
    const balance = this.getBalance(node);

    if (balance > 1) {
      return this.balanceLeft(node, key);
    }
    if (balance < -1) {
      return this.balanceRight(node, key);
    }

    return node;
  }

  private insertNode(node: AVLNode<K, V> | null, key: K, value: V): AVLNode<K, V> {
    if (!node) {
      return { key, value, height: 1, left: null, right: null };
    }

    if (key < node.key) {
      node.left = this.insertNode(node.left, key, value);
    } else if (key > node.key) {
      node.right = this.insertNode(node.right, key, value);
    } else {
      node.value = value;
      return node;
    }

    return this.rebalanceNode(node, key);
  }

  insert(key: K, value: V): void {
    this.root = this.insertNode(this.root, key, value);
  }

  search(key: K): V | undefined {
    let current = this.root;
    while (current) {
      if (key === current.key) return current.value;
      current = key < current.key ? current.left : current.right;
    }
    return undefined;
  }

  min(): V | undefined {
    if (!this.root) return undefined;
    let current = this.root;
    while (current.left) {
      current = current.left;
    }
    return current.value;
  }

  max(): V | undefined {
    if (!this.root) return undefined;
    let current = this.root;
    while (current.right) {
      current = current.right;
    }
    return current.value;
  }

  height(): number {
    return this.getHeight(this.root);
  }

  isBalanced(): boolean {
    const checkBalance = (node: AVLNode<K, V> | null): boolean => {
      if (!node) return true;
      const b = Math.abs(this.getBalance(node));
      return b <= 1 && checkBalance(node.left) && checkBalance(node.right);
    };
    return checkBalance(this.root);
  }

  inOrder(): V[] {
    const result: V[] = [];
    const traverse = (node: AVLNode<K, V> | null) => {
      if (!node) return;
      traverse(node.left);
      result.push(node.value);
      traverse(node.right);
    };
    traverse(this.root);
    return result;
  }

  preOrder(): V[] {
    const result: V[] = [];
    const traverse = (node: AVLNode<K, V> | null) => {
      if (!node) return;
      result.push(node.value);
      traverse(node.left);
      traverse(node.right);
    };
    traverse(this.root);
    return result;
  }

  postOrder(): V[] {
    const result: V[] = [];
    const traverse = (node: AVLNode<K, V> | null) => {
      if (!node) return;
      traverse(node.left);
      traverse(node.right);
      result.push(node.value);
    };
    traverse(this.root);
    return result;
  }
}

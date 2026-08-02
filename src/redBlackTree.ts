/**
 * L15 — Self-Balancing Red-Black Tree Data Structure
 * Deterministic implementation with left/right rotations, color balancing, and in-order traversal.
 */

export enum NodeColor {
  RED = "RED",
  BLACK = "BLACK"
}

export interface RedBlackNode<T = number> {
  key: T;
  color: NodeColor;
  left: RedBlackNode<T> | null;
  right: RedBlackNode<T> | null;
  parent: RedBlackNode<T> | null;
}

export class RedBlackTree<T = number> {
  private root: RedBlackNode<T> | null = null;
  private count: number = 0;

  public size(): number {
    return this.count;
  }

  public isEmpty(): boolean {
    return this.root === null;
  }

  public insert(key: T): void {
    const newNode: RedBlackNode<T> = { key, color: NodeColor.RED, left: null, right: null, parent: null };
    if (!this.root) {
      this.root = newNode;
      this.root.color = NodeColor.BLACK;
      this.count++;
      return;
    }

    let current: RedBlackNode<T> | null = this.root;
    let parent: RedBlackNode<T> | null = null;

    while (current !== null) {
      parent = current;
      if (key < current.key) {
        current = current.left;
      } else if (key > current.key) {
        current = current.right;
      } else {
        return;
      }
    }

    newNode.parent = parent;
    if (parent) {
      if (key < parent.key) {
        parent.left = newNode;
      } else {
        parent.right = newNode;
      }
    }

    this.fixInsert(newNode);
    this.count++;
  }

  public contains(key: T): boolean {
    let current = this.root;
    while (current !== null) {
      if (key === current.key) {
        return true;
      }
      current = key < current.key ? current.left : current.right;
    }
    return false;
  }

  public inOrderTraversal(): T[] {
    const result: T[] = [];
    this.inOrderHelper(this.root, result);
    return result;
  }

  private inOrderHelper(node: RedBlackNode<T> | null, result: T[]): void {
    if (node !== null) {
      this.inOrderHelper(node.left, result);
      result.push(node.key);
      this.inOrderHelper(node.right, result);
    }
  }

  private rotateLeft(node: RedBlackNode<T>): void {
    const rightChild = node.right;
    if (!rightChild) return;

    node.right = rightChild.left;
    if (rightChild.left) {
      rightChild.left.parent = node;
    }

    rightChild.parent = node.parent;
    if (!node.parent) {
      this.root = rightChild;
    } else if (node === node.parent.left) {
      node.parent.left = rightChild;
    } else {
      node.parent.right = rightChild;
    }

    rightChild.left = node;
    node.parent = rightChild;
  }

  private rotateRight(node: RedBlackNode<T>): void {
    const leftChild = node.left;
    if (!leftChild) return;

    node.left = leftChild.right;
    if (leftChild.right) {
      leftChild.right.parent = node;
    }

    leftChild.parent = node.parent;
    if (!node.parent) {
      this.root = leftChild;
    } else if (node === node.parent.right) {
      node.parent.right = leftChild;
    } else {
      node.parent.left = leftChild;
    }

    leftChild.right = node;
    node.parent = leftChild;
  }

  private fixInsertLeft(node: RedBlackNode<T>, parent: RedBlackNode<T>, grandParent: RedBlackNode<T>): RedBlackNode<T> {
    const uncle = grandParent.right;
    if (uncle && uncle.color === NodeColor.RED) {
      parent.color = NodeColor.BLACK;
      uncle.color = NodeColor.BLACK;
      grandParent.color = NodeColor.RED;
      return grandParent;
    }
    let curr = node;
    if (curr === parent.right) {
      curr = parent;
      this.rotateLeft(curr);
    }
    if (curr.parent) {
      curr.parent.color = NodeColor.BLACK;
    }
    grandParent.color = NodeColor.RED;
    this.rotateRight(grandParent);
    return curr;
  }

  private fixInsertRight(node: RedBlackNode<T>, parent: RedBlackNode<T>, grandParent: RedBlackNode<T>): RedBlackNode<T> {
    const uncle = grandParent.left;
    if (uncle && uncle.color === NodeColor.RED) {
      parent.color = NodeColor.BLACK;
      uncle.color = NodeColor.BLACK;
      grandParent.color = NodeColor.RED;
      return grandParent;
    }
    let curr = node;
    if (curr === parent.left) {
      curr = parent;
      this.rotateRight(curr);
    }
    if (curr.parent) {
      curr.parent.color = NodeColor.BLACK;
    }
    grandParent.color = NodeColor.RED;
    this.rotateLeft(grandParent);
    return curr;
  }

  private fixInsert(node: RedBlackNode<T>): void {
    let current = node;
    while (current.parent && current.parent.color === NodeColor.RED) {
      const parent = current.parent;
      const grandParent = parent.parent;
      if (!grandParent) break;

      if (parent === grandParent.left) {
        current = this.fixInsertLeft(current, parent, grandParent);
      } else {
        current = this.fixInsertRight(current, parent, grandParent);
      }
    }
    if (this.root) {
      this.root.color = NodeColor.BLACK;
    }
  }
}

export function buscarChaveArvore(tree: RedBlackTree, key: number): boolean {
  return tree.contains(key);
}

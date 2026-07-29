/**
 * Calcula os caminhos mais curtos a partir de um nó inicial usando o algoritmo de Dijkstra.
 * @param nodes - número de nós no grafo (0 a nodes-1)
 * @param edges - array de arestas no formato [u, v, peso]
 * @param startNode - nó de origem
 * @returns array com a distância mínima para cada nó
 */
function relaxEdges(
  u: number,
  edges: Array<[number, number, number]>,
  visited: boolean[],
  dist: number[]
): void {
  const currentDist = dist[u] ?? Infinity;
  for (const [from, to, weight] of edges) {
    if (from === u && !visited[to]) {
      const targetDist = dist[to] ?? Infinity;
      if (currentDist + weight < targetDist) {
        dist[to] = currentDist + weight;
      }
    }
  }
}

export function dijkstraShortestPath(
  nodes: number,
  edges: Array<[number, number, number]>,
  startNode: number
): number[] {
  const dist = new Array<number>(nodes).fill(Infinity);
  const visited = new Array<boolean>(nodes).fill(false);
  dist[startNode] = 0;

  for (let i = 0; i < nodes; i++) {
    let u = -1;
    let minDist = Infinity;
    for (let j = 0; j < nodes; j++) {
      const d = dist[j] ?? Infinity;
      if (!visited[j] && d < minDist) {
        minDist = d;
        u = j;
      }
    }

    if (u === -1) break;
    visited[u] = true;
    relaxEdges(u, edges, visited, dist);
  }

  return dist;
}

/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file services/dataMerge/textMatching.ts
 * @description Algoritmos de comparação de texto: Levenshtein, fuzzy match, normalização.
 */

/**
 * Calcula distância de Levenshtein entre duas strings.
 * Usado para fuzzy matching de nomes de hábitos (singular/plural, typos).
 */
export function levenshteinDistance(a: string, b: string): number {
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix: number[][] = [];
    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substituição
                    matrix[i][j - 1] + 1,     // inserção
                    matrix[i - 1][j] + 1      // deleção
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

export function normalizeIdentityText(raw: string): string {
    return raw
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

/**
 * Verifica se dois nomes são similares o suficiente para serem considerados o mesmo hábito.
 * @param threshold máximo de edições aceitas (default: 2)
 */
export function areNamesFuzzySimilar(name1: string, name2: string, threshold = 2): boolean {
    const n1 = normalizeIdentityText(name1);
    const n2 = normalizeIdentityText(name2);

    if (n1 === n2) return true;
    if (n1.length < 5 || n2.length < 5) return false; // muito curto = arriscado

    const distance = levenshteinDistance(n1, n2);
    return distance > 0 && distance <= threshold;
}

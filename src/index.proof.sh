#!/usr/bin/env bash
set -Eeuo pipefail

# Tribunal de Provas Físicas — Modo Canônico Universal
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

node --import tsx <<'EOF'
import { isPalindrome } from './src/index.ts';
import assert from 'node:assert/strict';

// 1. Provas Nominais e de Borda (PO-BEHAVIOR - Modo Canônico)
assert.equal(isPalindrome(""), true, 'Borda: string vazia deve ser palíndromo');
assert.equal(isPalindrome("a"), true, 'Borda: caractere único deve ser palíndromo');
assert.equal(isPalindrome("   "), true, 'Borda: espaços puros devem ser palíndromo');
assert.equal(isPalindrome("ï"), true, 'Nominal: diacrítico isolado deve ser palíndromo');
assert.equal(isPalindrome("Ana"), true, 'Nominal: case-insensitive');
assert.equal(isPalindrome("A cara rajada da jararaca"), true, 'Nominal: frase com espaços e pontuação');
assert.equal(isPalindrome("топот"), true, 'Nominal: cirílico palíndromo');
assert.equal(isPalindrome("собака"), false, 'Nominal: cirílico não-palíndromo');
assert.equal(isPalindrome("computador"), false, 'Nominal: palavra latina assimétrica');

// 2. Provas Adversariais e Modos de Falha (PO-FAILURES)
assert.throws(() => (isPalindrome as unknown as (x: unknown) => boolean)(null), TypeError, 'Adversarial: null deve lançar TypeError');
assert.throws(() => (isPalindrome as unknown as (x: unknown) => boolean)(undefined), TypeError, 'Adversarial: undefined deve lançar TypeError');
assert.throws(() => (isPalindrome as unknown as (x: unknown) => boolean)(12345), TypeError, 'Adversarial: número deve lançar TypeError');
assert.throws(() => isPalindrome("a".repeat(65537)), RangeError, 'Adversarial: carga > 65.536 chars deve lançar RangeError (DoS)');

console.log('[PROOFS] Todas as 13 provas físicas de aceite e falhas (Modo Canônico) foram aprovadas.');
EOF

#!/usr/bin/env node
/**
 * Guardrail: Verifica os invariantes do service worker (`sw.js`).
 *
 * O SW é zero-deps (sem Workbox). O que precisa ser verdade para o offline
 * funcionar e para caches antigos serem limpos a cada deploy:
 *  1. CACHE_NAME derivado de BUILD_HASH (placeholder __BUILD_HASH__ presente no
 *     source — o build.js o substitui pelo content hash do bundle);
 *  2. Precache do shell (CACHE_FILES com index.html, bundle.js e bundle.css);
 *  3. Handler de `activate` apagando caches de versões anteriores;
 *  4. Rotas /api/ nunca cacheadas.
 */
const fs = require('fs');
const path = require('path');

const swPath = path.resolve(__dirname, '..', 'sw.js');
if (!fs.existsSync(swPath)) {
  console.error('❌ sw.js not found at', swPath);
  process.exit(2);
}

const content = fs.readFileSync(swPath, 'utf8');

const checks = [
  ['__BUILD_HASH__', 'placeholder __BUILD_HASH__ (build.js injeta o content hash — sem ele o cache nunca é versionado)'],
  ["'/bundle.js'", "'/bundle.js' no CACHE_FILES (o build o substitui pelo nome hasheado)"],
  ["'/bundle.css'", "'/bundle.css' no CACHE_FILES (o build o substitui pelo nome hasheado)"],
  ["'/index.html'", 'precache do shell (/index.html)'],
  ['caches.delete', 'limpeza de caches antigos no activate'],
  ["url.pathname.startsWith('/api/')", 'bypass de cache para rotas /api/']
];

const failures = checks.filter(([needle]) => !content.includes(needle));
if (failures.length > 0) {
  failures.forEach(([, desc]) => console.error(`❌ sw.js: faltando ${desc}`));
  process.exit(3);
}

console.log('✅ sw.js passes offline/cache-versioning invariants.');
process.exit(0);

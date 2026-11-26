#!/usr/bin/env node
/**
 * Guardrail: Verifica se o service worker (`sw.js`) referencia o precache manifest Workbox.
 */
const fs = require('fs');
const path = require('path');

const swPath = path.resolve(__dirname, '..', 'sw.js');
if (!fs.existsSync(swPath)) {
  console.error('❌ sw.js not found at', swPath);
  process.exit(2);
}

const content = fs.readFileSync(swPath, 'utf8');
const hasPrecache = content.includes('__WB_MANIFEST') && content.includes('precacheAndRoute');
if (!hasPrecache) {
  console.error('❌ Precache manifest or precacheAndRoute not found in sw.js.');
  console.error('Ensure build injects __WB_MANIFEST and workbox.precaching.precacheAndRoute is present.');
  process.exit(3);
}

console.log('✅ sw.js contains Workbox precache manifest usage.');
process.exit(0);

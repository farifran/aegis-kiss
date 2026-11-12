#!/usr/bin/env node
/**
 * Gera o inventário de testes de tests/README.md a partir de uma EXECUÇÃO REAL.
 *
 * O inventário era mantido à mão e derivou: chegou a declarar 23 arquivos/399
 * testes contra 37/471 reais, e a se contradizer entre duas seções do próprio
 * arquivo. Contagem escrita à mão diverge por definição; aqui ela é derivada.
 *
 * Uso:
 *   node scripts/update-test-inventory.js           # reescreve o README
 *   node scripts/update-test-inventory.js --check   # falha se estiver desatualizado
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const README = path.resolve(__dirname, '..', 'tests', 'README.md');
const START = '<!-- INVENTARIO:INICIO -->';
const END = '<!-- INVENTARIO:FIM -->';

function collect() {
  const out = path.join(os.tmpdir(), `askesis-vitest-${process.pid}.json`);
  execFileSync('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${out}`], {
    stdio: 'ignore',
    cwd: path.resolve(__dirname, '..')
  });
  const report = JSON.parse(fs.readFileSync(out, 'utf8'));
  fs.unlinkSync(out);

  const root = path.resolve(__dirname, '..') + path.sep;
  const byFile = new Map();
  for (const result of report.testResults || []) {
    byFile.set(result.name.replace(root, ''), (result.assertionResults || []).length);
  }
  return [...byFile.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function render(entries) {
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  const groups = new Map();
  for (const [file, count] of entries) {
    const dir = file.includes('/') ? file.slice(0, file.indexOf('/')) : 'raiz';
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push([file, count]);
  }

  const lines = [
    START,
    '',
    `- **Arquivos de teste:** ${entries.length}`,
    `- **Testes totais:** ${total}`,
    '',
    '> Gerado por `node scripts/update-test-inventory.js` a partir de execução real.',
    '> Não editar à mão: `--check` falha o CI quando divergir.',
    ''
  ];
  for (const [dir, files] of [...groups.entries()].sort()) {
    lines.push(`### \`${dir}\``, '');
    for (const [file, count] of files) lines.push(`- \`${file}\` → ${count}`);
    lines.push('');
  }
  lines.push(END);
  return lines.join('\n');
}

const entries = collect();
const block = render(entries);
const src = fs.readFileSync(README, 'utf8');

if (!src.includes(START) || !src.includes(END)) {
  console.error(`❌ Marcadores ${START} / ${END} ausentes em tests/README.md`);
  process.exit(2);
}

const updated = src.slice(0, src.indexOf(START)) + block + src.slice(src.indexOf(END) + END.length);

if (process.argv.includes('--check')) {
  if (updated !== src) {
    console.error('❌ Inventário de testes desatualizado. Rode: node scripts/update-test-inventory.js');
    process.exit(1);
  }
  console.log('✅ Inventário de testes em dia.');
  process.exit(0);
}

fs.writeFileSync(README, updated);
console.log(`✅ Inventário atualizado: ${entries.length} arquivos, ${entries.reduce((s, [, n]) => s + n, 0)} testes.`);

#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IGNORE_DIRS = new Set(['node_modules', 'dist', '.git']);
const INCLUDE_EXTENSIONS = new Set(['.ts', '.tsx']);
const EXCLUDE_PATH_PARTS = ['/tests/'];

const FORBIDDEN_PATTERNS = [
  { regex: /ui\.aiResponse\.innerHTML\s*=/, name: 'ui.aiResponse.innerHTML' },
  { regex: /ui\.confirmModalText\.innerHTML\s*=/, name: 'ui.confirmModalText.innerHTML' },
  { regex: /ui\.syncWarningText\.innerHTML\s*=/, name: 'ui.syncWarningText.innerHTML' },
  { regex: /ui\.aiResponse\.insertAdjacentHTML\s*\(/, name: 'ui.aiResponse.insertAdjacentHTML' },
  { regex: /ui\.confirmModalText\.insertAdjacentHTML\s*\(/, name: 'ui.confirmModalText.insertAdjacentHTML' },
  { regex: /ui\.syncWarningText\.insertAdjacentHTML\s*\(/, name: 'ui.syncWarningText.insertAdjacentHTML' },
];

function walk(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) walk(fullPath, out);
      continue;
    }
    const ext = path.extname(entry.name);
    if (!INCLUDE_EXTENSIONS.has(ext)) continue;
    const normalized = fullPath.replace(/\\/g, '/');
    if (EXCLUDE_PATH_PARTS.some((segment) => normalized.includes(segment))) continue;
    out.push(fullPath);
  }
  return out;
}

function findViolations(filePath) {
  const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const violations = [];

  lines.forEach((line, index) => {
    FORBIDDEN_PATTERNS.forEach((rule) => {
      if (rule.regex.test(line)) {
        violations.push({ rel, line: index + 1, rule: rule.name });
      }
    });
  });

  return violations;
}

const files = walk(ROOT);
const violations = files.flatMap(findViolations);

if (violations.length > 0) {
  console.error('❌ Security guardrail failed: sensitive innerHTML sink detected.');
  for (const v of violations) {
    console.error(` - ${v.rel}:${v.line} -> ${v.rule}`);
  }
  process.exit(1);
}

console.log('✅ Security guardrail passed.');

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const bulletRulePattern = /^\s*[-*]\s+(?:`|\*\*)?([A-Z][A-Z0-9_-]+)(?:`|\*\*)?\s*[([]\s*(hard|default)\s*[)\]]\s*:\s*(.+)$/iu;
const negationLinePattern = /\b(?:fora do escopo|out of scope|proibid[oa]|vedad[oa]|n[aã]o usar|n[aã]o acoplar|sem\s+`?date\.now|sem\s+uso|exce[cç][aã]o aprovada|evitar)\b/iu;

/**
 * Lê regras compactas (`- `ID` [hard|default]: texto`) diretamente de ARCHITECTURE.md.
 * Fonte única humana, sem espelho JSON nem heurística de palavras-chave.
 */
export function loadArchitectureRules(repositoryRoot) {
  if (!repositoryRoot) return [];
  const archPath = resolve(repositoryRoot, 'ARCHITECTURE.md');
  if (!existsSync(archPath)) return [];

  const rules = [];
  const lines = readFileSync(archPath, 'utf8').replace(/\r\n?/gu, '\n').split('\n');
  for (const line of lines) {
    const match = line.match(bulletRulePattern);
    if (!match) continue;
    rules.push({
      id: match[1].toUpperCase(),
      level: match[2].toLowerCase(),
      statement: match[3].trim(),
    });
  }
  return rules;
}

/**
 * Verifica violações mecânicas óbvias de regras `hard` de ARCHITECTURE.md no contract.md.
 */
export function findContractArchitectureViolations(rules, contractMarkdown) {
  const errors = [];
  if (!Array.isArray(rules) || rules.length === 0) return errors;

  const hasDeterministicTimeHard = rules.some((r) => (
    r.level === 'hard'
    && (r.id.includes('DETERMINISTIC-TIME') || /date\.now/iu.test(r.statement))
  ));

  if (hasDeterministicTimeHard) {
    const lines = contractMarkdown.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (/\b(?:Date\.now\s*\(\)|new\s+Date\s*\(\s*\))/u.test(line) && !negationLinePattern.test(line)) {
        errors.push(`Possível violação de DETERMINISTIC-TIME em contract.md:L${i + 1}: uso implícito de Date.now()/new Date() sem referência temporal explícita.`);
      }
    }
  }

  return errors;
}

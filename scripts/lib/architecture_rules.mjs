import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const bulletRulePattern = /^\s*[-*]\s+(?:`|\*\*)?([A-Z][A-Z0-9_-]+)(?:`|\*\*)?\s*[([]\s*(hard|default)\s*[)\]]\s*(?:\[\s*forbid\s*:\s*([^\]]+)\])?\s*:\s*(.+)$/iu;
const outOfScopePrefixPattern = /\b(?:fora do escopo|out of scope|podad[oa]\s+por\s+kiss|exce[cç][aã]o aprovada)\b/iu;
const negationBeforeTokenPattern = /\b(?:proibid[oa]|proibi[cç][aã]o|vedad[oa]|n[aã]o\s+usar|n[aã]o\s+acoplar|sem\s+(?:uso\s+de\s+|qualquer\s+uso\s+de\s+|depend[eê]ncia\s+de\s+)?|rejeitar|rejeitad[oa]s?|remover|evitar|substituir)\b/iu;

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function buildForbiddenTokenRegex(rawToken) {
  const token = rawToken.trim();
  if (!token) return null;
  if (token.endsWith('()')) {
    const base = token.slice(0, -2).trim().split(/\s+/u).map(escapeRegex).join('\\s+');
    return new RegExp(`(?<![A-Za-z0-9_$])${base}\\s*\\(\\s*\\)`, 'u');
  }
  const escaped = token.split(/\s+/u).map(escapeRegex).join('\\s+');
  return new RegExp(`(?<![A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`, 'u');
}

/**
 * Lê regras compactas (`- `ID` [hard|default] [forbid: tok1, tok2]: texto`) diretamente de ARCHITECTURE.md.
 * Fonte única humana, sem espelho JSON nem heurística de palavras-chave.
 */
export function loadArchitectureRules(repositoryRoot) {
  if (!repositoryRoot) return [];
  const archPath = resolve(repositoryRoot, 'ARCHITECTURE.md');
  if (!existsSync(archPath)) return [];

  const rules = [];
  const withoutComments = readFileSync(archPath, 'utf8')
    .replace(/\r\n?/gu, '\n')
    .replace(/<!--[\s\S]*?-->/gu, '');
  const lines = withoutComments.split('\n');
  let activeFence = null;
  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/u);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!activeFence) {
        activeFence = { marker, length: fenceMatch[1].length };
      } else if (marker === activeFence.marker && fenceMatch[1].length >= activeFence.length) {
        activeFence = null;
      }
      continue;
    }
    if (activeFence) continue;
    const match = line.match(bulletRulePattern);
    if (!match) continue;
    const forbid = match[3]
      ? [...new Set(match[3].split(',').map((s) => s.trim().replace(/^`|`$/gu, '')).filter(Boolean))]
      : [];
    rules.push({
      id: match[1].toUpperCase(),
      level: match[2].toLowerCase(),
      forbid,
      statement: match[4].trim(),
    });
  }
  return rules;
}

/**
 * Verifica violações mecânicas de regras `hard` de ARCHITECTURE.md no contract.md:
 * - tokens declarados em `[forbid: ...]` em qualquer regra `hard` (ex.: innerHTML, eval, Date.now());
 * - fallback retrocompatível para `DETERMINISTIC-TIME` (`Date.now()` / `new Date()`).
 * Ignora menções precedidas por negação/exclusão explícita na mesma cláusula ou em linhas "Fora do escopo".
 */
export function findContractArchitectureViolations(rules, contractMarkdown) {
  const errors = [];
  if (!Array.isArray(rules) || rules.length === 0) return errors;

  const checks = [];
  for (const rule of rules) {
    if (rule.level !== 'hard') continue;
    const tokens = Array.isArray(rule.forbid) && rule.forbid.length > 0
      ? rule.forbid
      : ((rule.id.includes('DETERMINISTIC-TIME') || /date\.now/iu.test(rule.statement))
        ? ['Date.now()', 'new Date()']
        : []);
    for (const token of tokens) {
      const regex = buildForbiddenTokenRegex(token);
      if (regex) checks.push({ ruleId: rule.id, token, regex });
    }
  }
  if (checks.length === 0) return errors;

  const lines = contractMarkdown.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (outOfScopePrefixPattern.test(line)) continue;
    for (const { ruleId, token, regex } of checks) {
      const match = line.match(regex);
      if (!match || match.index === undefined) continue;
      // Verifica negação apenas no trecho ANTERIOR ao token (na mesma cláusula após `;`)
      const before = line.slice(0, match.index);
      const lastClause = before.slice(before.lastIndexOf(';') + 1);
      if (negationBeforeTokenPattern.test(lastClause)) continue;
      errors.push(`Violação de ${ruleId} em contract.md:L${i + 1}: termo proibido '${token}' citado fora de contexto de negação/exclusão.`);
    }
  }

  return errors;
}

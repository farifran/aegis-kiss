import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripDiacritics } from './source_evidence.mjs';

const technicalSignalGroups = [
  ['tempo', 'temporal', 'relogio', 'clock', 'date.now', 'ttl', 'expirar', 'segundo', 'segundos', 'minuto', 'minutos', 'janela', 'cooldown', 'timeout', 'timestamp'],
  ['parsimonia', 'dependencia', 'dependencias', 'framework', 'camadas', 'abstracao', 'factory', 'builder', 'singleton', 'eventbus', 'express', 'fastify', 'next', 'nestjs', 'react', 'biblioteca', 'pacote'],
  ['persistencia', 'banco', 'sqlite', 'postgres', 'postgresql', 'mysql', 'redis', 'mongo', 'database', 'storage', 'disco', 'tabela', 'migration'],
  ['bitmask', 'bits', 'bit', 'mascara', 'flag', 'flags', 'saturar', 'overflow', 'contador'],
  ['falha', 'falhas', 'erro', 'erros', 'rollback', 'webhook', 'externo', 'fila', 'transacao', 'compensacao', 'reverter', 'rejeitar'],
  ['fronteira', 'boundary', '/etc/', '../', 'passwd', 'sistema', 'credenciais', 'externos'],
  ['interface', 'publica', 'assinatura', 'export', 'guarda', 'guardas', 'precedencia', 'transicao', 'estado'],
];

const negationLinePattern = /\b(?:fora do escopo|out of scope|proibid[oa]|vedad[oa]|n[aã]o usar|n[aã]o acoplar|sem\s+`?date\.now|sem\s+uso|exce[cç][aã]o aprovada|evitar)\b/iu;

function slugId(title, index) {
  const clean = stripDiacritics(title)
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .toUpperCase()
    .slice(0, 32);
  return clean ? `ARCH-${clean}` : `ARCH-RULE-${index + 1}`;
}

function extractTokens(text) {
  return new Set(
    stripDiacritics(text)
      .split(/[^a-z0-9_./-]+/u)
      .map((t) => t.replace(/^[./-]+|[./-]+$/gu, ''))
      .filter((t) => t.length >= 3),
  );
}

function expandWithTechnicalGroups(tokens) {
  const expanded = new Set(tokens);
  for (const group of technicalSignalGroups) {
    if (group.some((term) => tokens.has(term))) {
      for (const term of group) expanded.add(term);
    }
  }
  return expanded;
}

/**
 * Lê dinamicamente qualquer regra definida em ARCHITECTURE.md (seções `### ...`
 * dentro de seções de regras/restrições ou headings com `(ARCH-...)` / `— hard|default`).
 * Funciona para regras customizadas de qualquer projeto (ex.: "Sem framework", "SQLite", "Bitmask").
 */
export function loadArchitectureRules(repositoryRoot) {
  if (!repositoryRoot) return [];
  const archPath = resolve(repositoryRoot, 'ARCHITECTURE.md');
  if (!existsSync(archPath)) return [];

  const markdown = readFileSync(archPath, 'utf8').replace(/\r\n?/gu, '\n');
  const lines = markdown.split('\n');
  const rules = [];
  let inRulesSection = false;
  let current = null;

  const flush = () => {
    if (!current) return;
    const statement = current.bodyLines.join(' ').replace(/\s+/gu, ' ').trim();
    if (statement.length > 0) {
      rules.push({
        id: current.id,
        title: current.title,
        level: current.level,
        statement,
      });
    }
    current = null;
  };

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)$/u);
    if (h2) {
      flush();
      inRulesSection = /(?:regras|restri[cç][oõ]es|pol[ií]tica|rules|constraints|decisions|arquitetur)/iu.test(h2[1]);
      continue;
    }

    const h3 = line.match(/^###\s+(.+)$/u);
    if (h3) {
      flush();
      const rawHeading = h3[1].trim();
      const idMatch = rawHeading.match(/\(`?([A-Z][A-Z0-9_-]+)`?(?:\s*[—–-]\s*(hard|default))?\)/iu);
      const trailingLevel = rawHeading.match(/[—–-]\s*(hard|default)\s*$/iu);
      const explicitRuleHeading = Boolean(idMatch || trailingLevel);
      if (!inRulesSection && !explicitRuleHeading) continue;

      const cleanTitle = rawHeading
        .replace(/^\d+\.\s*/u, '')
        .replace(/\s*\(`?[A-Z][A-Z0-9_-]+`?(?:\s*[—–-]\s*(?:hard|default))?\)\s*/iu, '')
        .replace(/\s*[—–-]\s*(?:hard|default)\s*$/iu, '')
        .trim();
      const id = idMatch ? idMatch[1].toUpperCase() : slugId(cleanTitle, rules.length);
      const level = (idMatch?.[2] ?? trailingLevel?.[1] ?? 'default').toLowerCase();

      current = { id, title: cleanTitle || id, level, bodyLines: [] };
      continue;
    }

    if (current && line.trim().length > 0) {
      current.bodyLines.push(line.trim());
    }
  }
  flush();
  return rules;
}

/**
 * Seleciona regras de ARCHITECTURE.md diretamente pertinentes à demanda (texto completo)
 * e retorna as demais como índice compacto de 1 linha para a IA nunca perder restrições
 * globais do projeto (ex.: "Sem framework", "SQLite only", "Bitmask").
 */
export function selectArchitectureRulesForDemand(rules, intent = '') {
  if (!Array.isArray(rules) || rules.length === 0) {
    return { matched: [], others: [] };
  }
  const rawIntent = stripDiacritics(intent);
  const intentTokens = extractTokens(intent);
  const expandedIntent = expandWithTechnicalGroups(intentTokens);

  const matched = [];
  const others = [];

  for (const rule of rules) {
    const ruleText = `${rule.id} ${rule.title} ${rule.statement}`;
    const ruleTokens = extractTokens(ruleText);
    const expandedRule = expandWithTechnicalGroups(ruleTokens);

    let overlap = 0;
    for (const token of intentTokens) {
      if (ruleTokens.has(token)) overlap += 2;
      else if (expandedRule.has(token)) overlap += 1;
    }
    for (const token of ruleTokens) {
      if (expandedIntent.has(token) && !intentTokens.has(token)) {
        overlap += 1;
      }
    }
    if (/(?:\/etc\/|\.\.\/)/u.test(rawIntent) && /(?:fronteira|boundary|src\/)/iu.test(ruleText)) {
      overlap += 3;
    }
    if (/\b(?:date\.now|new date)\b/iu.test(rawIntent) && /(?:tempo|relogio|date\.now|temporal)/iu.test(ruleText)) {
      overlap += 3;
    }

    if (overlap >= 2) {
      matched.push(rule);
    } else {
      others.push(rule);
    }
  }

  return { matched, others };
}

/**
 * Verifica violações mecânicas óbvias de regras `hard` de ARCHITECTURE.md dentro do contract.md
 * (ex.: propor Date.now() implícito quando há regra hard de tempo determinístico).
 */
export function findContractArchitectureViolations(rules, contractMarkdown) {
  const errors = [];
  if (!Array.isArray(rules) || rules.length === 0) return errors;

  const hasDeterministicTimeHard = rules.some((r) => (
    r.level === 'hard'
    && (r.id === 'ARCH-DETERMINISTIC-TIME' || /date\.now/iu.test(r.statement))
  ));

  if (hasDeterministicTimeHard) {
    const lines = contractMarkdown.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (/\b(?:Date\.now\s*\(\)|new\s+Date\s*\(\s*\))/u.test(line) && !negationLinePattern.test(line)) {
        errors.push(`Possível violação de ARCH-DETERMINISTIC-TIME em contract.md:L${i + 1}: uso implícito de Date.now()/new Date() sem referência temporal explícita.`);
      }
    }
  }

  return errors;
}

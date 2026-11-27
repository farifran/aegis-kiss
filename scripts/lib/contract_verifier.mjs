import { existsSync, lstatSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { findContractArchitectureViolations, loadArchitectureRules } from './architecture_rules.mjs';
import { sha256 } from './canonical_json.mjs';
import {
  inspectWorkspaceFreshness,
  isEditableProductPath,
  loadProjectConfig,
  normalizeRepoRelativePath,
  resolveSourceRoots,
  writeFileAtomic,
} from './workspace_observer.mjs';
import { extractFileSymbols } from './workspace_skeleton.mjs';

const forbiddenPathPattern = /(?:\/etc\/|\/proc\/|\/sys\/|~\/|\.\.\/)/u;
const outOfScopeLinePattern = /^\s*[-*]?\s*(?:\*\*)?(?:fora do escopo|out of scope)\b/iu;
const readOnlyLinePattern = /\b(?:inalterad[oa]|read-only|somente leitura)\b/iu;
const pendingMarkerPattern = /(?:\[PENDENTE\]|\bPENDING_Q\d+\b|\bTBD\b|\bTODO\b)/u;
const newFileHintPattern = /(?:\[novo\]|\(novo\)|\[new\]|\(new\)|novo arquivo|new file|criar\b|create\b)/iu;
const symbolBeforeRefPattern = /`([A-Za-z_$][A-Za-z0-9_$]{2,})(?:[^`]*)`\s*\(\s*`?$/u;
const knownFileExtensionPattern = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|json|md|yml|yaml|toml|sh|bash|py|sql|env|lock|txt|cfg|ini|css|html|xml)$/iu;
const knownRootFilenamePattern = /^(?:Dockerfile|Makefile|Procfile|aegis|LICENSE|README|CHANGELOG)$/u;
const contractStampSchema = 'aegis.contract_verified.v1';

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function buildRootPrefixAlternation(roots) {
  return [...new Set(roots.filter(Boolean))].map(escapeRegex).join('|');
}

export function computeContractDigest(contractText) {
  return sha256(String(contractText ?? ''));
}

export async function writeContractVerificationStamp({
  stampPath,
  contractText,
  sourceRoots,
  authorizedPaths,
}) {
  if (existsSync(stampPath) && lstatSync(stampPath).isSymbolicLink()) {
    throw new Error('unsafe_contract_stamp_symlink');
  }
  await writeFileAtomic(stampPath, `${JSON.stringify({
    schema: contractStampSchema,
    contractDigest: computeContractDigest(contractText),
    sourceRoots: [...sourceRoots],
    authorizedPaths: [...authorizedPaths],
  }, null, 2)}\n`);
}

export function clearContractVerificationStamp(stampPath) {
  let stats;
  try {
    stats = lstatSync(stampPath);
  } catch {
    return;
  }
  if (stats.isSymbolicLink()) return;
  rmSync(stampPath, { force: true });
}

export function readContractVerificationStamp(stampPath) {
  let stats;
  try {
    stats = lstatSync(stampPath);
  } catch {
    return null;
  }
  if (stats.isSymbolicLink() || !stats.isFile()) return null;
  try {
    const parsed = JSON.parse(readFileSync(stampPath, 'utf8'));
    if (parsed?.schema !== contractStampSchema || typeof parsed.contractDigest !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

// Aceita rótulos em texto puro, negrito ou código: `Dado:`, **Dado:**, **Dado**:, `Dado`:.
function scenarioLabelPattern(labels, allowQue = false) {
  const wrap = '(?:\\*\\*|`)?';
  const tail = allowQue ? `(?:${wrap}:${wrap}|\\s+que\\b)` : `${wrap}:${wrap}`;
  return new RegExp(`(?:^|\\n)\\s*(?:[-*]|\\d+\\.)?\\s*${wrap}(?:${labels})${tail}`, 'giu');
}

const givenLabelPattern = scenarioLabelPattern('Dado|Given', true);
const whenLabelPattern = scenarioLabelPattern('Quando|When');
const thenLabelPattern = scenarioLabelPattern('Ent[aã]o|Then');

export function countContractScenarios(markdown) {
  const givenCount = (markdown.match(givenLabelPattern) ?? []).length;
  const whenCount = (markdown.match(whenLabelPattern) ?? []).length;
  const thenCount = (markdown.match(thenLabelPattern) ?? []).length;
  return Math.min(givenCount, whenCount, thenCount);
}

export function extractScenarioIds(markdown) {
  const ids = [];
  for (const match of markdown.matchAll(/\b(AC-\d+(?:-\d+)?)\b/gu)) {
    ids.push(match[1]);
  }
  return [...new Set(ids)];
}

function splitMarkdownSections(markdown) {
  const sections = [];
  const lines = markdown.split('\n');
  let current = { heading: '', lines: [] };
  for (const line of lines) {
    const headingMatch = line.match(/^#{1,6}\s+(.+)$/u);
    if (headingMatch) {
      sections.push(current);
      current = { heading: headingMatch[1].trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  sections.push(current);
  return sections;
}

function extractTargetSection(sections) {
  return sections.find((s) => /(?:arquivos|caminhos|files|paths|superf[ií]cie)/iu.test(s.heading)) ?? null;
}

function cleanPathToken(raw) {
  return raw
    .trim()
    .replace(/^['"`(]+/u, '')
    .replace(/[.,;:!?)'"`]+$/u, '')
    .replace(/:L?\d+(?:-L?\d+)?$/u, '');
}

const knownDirPrefixPattern = /^(?:\.{1,2}\/|\/|(?:src|app|lib|test|tests|scripts|docs|packages|config|governance|bin|cmd|pkg|internal|\.github|\.harness)\/)/iu;

function looksLikePathCandidate(token, repositoryRoot, { quoted = false } = {}) {
  if (!token || token.includes(' ') || /^https?:\/\//iu.test(token)) return false;
  if (/^\.{2,}$/u.test(token)) return token === '..';
  if (/^\.[a-z0-9_-]+(?:\.[a-z0-9_-]+)*$/u.test(token)) return true;
  if (knownFileExtensionPattern.test(token) || knownRootFilenamePattern.test(token)) return true;
  if (token.includes('/')) {
    if (quoted) return true;
    if (token.endsWith('/') || knownDirPrefixPattern.test(token)) return true;
    if (repositoryRoot && existsSync(resolve(repositoryRoot, token))) return true;
    return false;
  }
  if (repositoryRoot && existsSync(resolve(repositoryRoot, token))) return true;
  return false;
}

function extractTargetSectionCandidates(line, repositoryRoot) {
  const candidates = [];
  const seen = new Set();
  const add = (raw, quoted) => {
    const cleaned = cleanPathToken(raw);
    if (!cleaned || seen.has(cleaned)) return;
    if (looksLikePathCandidate(cleaned, repositoryRoot, { quoted })) {
      seen.add(cleaned);
      candidates.push(cleaned);
    }
  };

  for (const match of line.matchAll(/`([^`\n]+)`/gu)) {
    add(match[1], true);
  }
  const withoutTicks = line.replace(/`[^`\n]+`/gu, ' ');
  for (const token of withoutTicks.split(/\s+/u)) {
    add(token, false);
  }
  return candidates;
}

/**
 * Extrai os caminhos autorizados declarados na seção de arquivos do contract.md,
 * usando estritamente as mesmas raízes de produto de guard-path e check.
 */
export function extractAuthorizedPaths(markdown, sourceRoots = ['src', 'app', 'lib'], repositoryRoot = null, protectedPaths = null) {
  const sections = splitMarkdownSections(markdown);
  const targetSection = extractTargetSection(sections);
  const authorized = new Set();
  const newPaths = new Set();
  const effectiveProtected = protectedPaths ?? (repositoryRoot ? loadProjectConfig(repositoryRoot).protectedPaths : []);

  const rootAlt = buildRootPrefixAlternation(sourceRoots);
  if (!rootAlt) return { authorizedPaths: [], newPaths: [] };
  const authPathPattern = new RegExp(`(?<![A-Za-z0-9_./-])((?:${rootAlt})\\/[A-Za-z0-9_./-]+)`, 'gu');

  const linesToScan = targetSection ? targetSection.lines : markdown.split('\n');
  for (const line of linesToScan) {
    if (outOfScopeLinePattern.test(line) || readOnlyLinePattern.test(line)) {
      continue;
    }
    const isNewLine = newFileHintPattern.test(line);
    for (const match of line.matchAll(authPathPattern)) {
      const cleaned = match[1].replace(/[.,;:!?)]+$/u, '');
      if (!cleaned || cleaned.endsWith('/')) continue;
      const resolvedPath = repositoryRoot
        ? normalizeRepoRelativePath(repositoryRoot, cleaned)
        : cleaned.replace(/^\.\//u, '');
      if (!resolvedPath || !isEditableProductPath(resolvedPath, sourceRoots, effectiveProtected)) continue;
      if (sourceRoots.includes(resolvedPath)) continue;
      authorized.add(resolvedPath);
      if (isNewLine) newPaths.add(resolvedPath);
    }
  }

  return {
    authorizedPaths: [...authorized].sort(),
    newPaths: [...newPaths].sort(),
  };
}

function assertInsideRepo(repositoryRoot, relPath) {
  const realRoot = existsSync(repositoryRoot) ? realpathSync(repositoryRoot) : resolve(repositoryRoot);
  const abs = resolve(realRoot, relPath);
  const prefix = realRoot.endsWith(sep) ? realRoot : `${realRoot}${sep}`;
  if (!abs.startsWith(prefix)) return null;
  if (existsSync(abs)) {
    const realAbs = realpathSync(abs);
    if (!realAbs.startsWith(prefix)) return null;
  }
  return abs;
}

export function readSafeContractText(contractPath) {
  let stats;
  try {
    stats = lstatSync(contractPath);
  } catch {
    return { status: 'MISSING', text: null };
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    return { status: 'SYMLINK_OR_INVALID', text: null };
  }
  return { status: 'OK', text: readFileSync(contractPath, 'utf8').replace(/\r\n?/gu, '\n') };
}

/**
 * Verificação puramente mecânica do contract.md (0 tokens):
 * - seções mínimas obrigatórias + casos Dado/Quando/Então;
 * - zero marcadores pendentes ([PENDENTE], PENDING_Q*, TBD, TODO);
 * - fronteira unificada com guard-path e check (somente arquivos dentro de effectiveRoots em ## Arquivos);
 * - existência física de arquivos e faixas path:Ln-Lm nas raízes de produto (salvo skipFileLineChecks).
 */
export function verifyContractMarkdown({
  repositoryRoot,
  contractPath,
  expectedSnapshotDigest = null,
  sourceRoots = null,
  skipFileLineChecks = false,
}) {
  const errors = [];
  const warnings = [];

  const contractRead = readSafeContractText(contractPath);
  if (contractRead.status === 'MISSING') {
    return {
      ok: false,
      errors: [`Contrato não encontrado em ${contractPath}`],
      warnings,
      authorizedPaths: [],
      workspaceFreshness: 'NO_CONTRACT',
    };
  }
  if (contractRead.status !== 'OK') {
    return {
      ok: false,
      errors: ['Contrato não pode ser symlink ou não-arquivo.'],
      warnings,
      authorizedPaths: [],
      workspaceFreshness: 'NO_CONTRACT',
    };
  }

  const markdown = contractRead.text;
  if (markdown.trim().length === 0) {
    return {
      ok: false,
      errors: ['Contrato está vazio.'],
      warnings,
      authorizedPaths: [],
      workspaceFreshness: 'NO_CONTRACT',
    };
  }

  const effectiveRoots = resolveSourceRoots(repositoryRoot, sourceRoots);
  const protectedPaths = loadProjectConfig(repositoryRoot).protectedPaths;
  const sections = splitMarkdownSections(markdown);
  const headings = sections.map((s) => s.heading);

  const hasScope = headings.some((h) => /(?:escopo|scope|objetivo)/iu.test(h));
  const hasFiles = extractTargetSection(sections) !== null;
  const hasCasesHeading = headings.some((h) => /(?:casos|provas?|cen[aá]rios|aceita[cç][aã]o|tests?|acceptance)/iu.test(h));

  if (!hasScope) errors.push('Seção obrigatória ausente: Escopo (ou Objetivo).');
  if (!hasFiles) errors.push('Seção obrigatória ausente: Arquivos-alvo (ex.: "## Arquivos").');
  if (!hasCasesHeading) errors.push('Seção obrigatória ausente: Casos de prova (Dado / Quando / Então).');

  // Casos falsificáveis Dado / Quando / Então (ou Given / When / Then)
  const completeScenarios = countContractScenarios(markdown);
  if (completeScenarios < 2) {
    errors.push(`Exige ao menos 2 cenários completos Dado/Quando/Então (sucesso e falha/limite); encontrados: ${completeScenarios}.`);
  }

  // Pendências abertas
  const lines = markdown.split('\n');
  lines.forEach((line, idx) => {
    if (pendingMarkerPattern.test(line)) {
      errors.push(`Marcador pendente encontrado em contract.md:L${idx + 1}: "${line.trim().slice(0, 80)}"`);
    }
  });

  // Fronteira unificada (allowlist sobre effectiveRoots) na seção de arquivos-alvo
  const targetSection = extractTargetSection(sections);
  if (targetSection) {
    for (const line of targetSection.lines) {
      if (outOfScopeLinePattern.test(line) || readOnlyLinePattern.test(line)) continue;
      if (forbiddenPathPattern.test(line)) {
        errors.push(`Violação de fronteira na seção de arquivos: "${line.trim().slice(0, 80)}"`);
        continue;
      }
      for (const candidate of extractTargetSectionCandidates(line, repositoryRoot)) {
        if (candidate.endsWith('/')) {
          const normalizedDir = normalizeRepoRelativePath(repositoryRoot, candidate.slice(0, -1));
          if (!normalizedDir || !isEditableProductPath(normalizedDir, effectiveRoots, protectedPaths)) {
            errors.push(`Arquivo fora da fronteira de produto (${effectiveRoots.join(', ')}/) na seção de arquivos: "${candidate}"`);
          } else {
            errors.push(`Diretório genérico não permitido na seção de arquivos (liste arquivos específicos em ${effectiveRoots.join(', ')}/): "${candidate}"`);
          }
          continue;
        }
        const normalized = normalizeRepoRelativePath(repositoryRoot, candidate);
        if (!normalized || !isEditableProductPath(normalized, effectiveRoots, protectedPaths) || effectiveRoots.includes(normalized)) {
          errors.push(`Arquivo fora da fronteira de produto (${effectiveRoots.join(', ')}/) na seção de arquivos: "${candidate}"`);
        }
      }
    }
  }

  const { authorizedPaths, newPaths } = extractAuthorizedPaths(markdown, effectiveRoots, repositoryRoot, protectedPaths);
  if (hasFiles && authorizedPaths.length === 0) {
    errors.push(`Seção de arquivos não declara nenhum caminho autorizado dentro da fronteira (${effectiveRoots.join(', ')}/).`);
  }

  // Validação física de referências de produto (src|app|lib|AEGIS_SRC_DIRS/...:Ln-Lm)
  if (!skipFileLineChecks) {
    const newPathSet = new Set(newPaths);
    const lineCache = new Map();
    const symbolCache = new Map();
    const refRootAlt = buildRootPrefixAlternation([...effectiveRoots, 'src', 'app', 'lib']);
    const srcRefPattern = new RegExp(`\\b((?:${refRootAlt})\\/[A-Za-z0-9_./-]+)(?::L?(\\d+)(?:-L?(\\d+))?)?`, 'gu');
    const bareRootSet = new Set([...effectiveRoots, 'src', 'app', 'lib'].map((r) => `${r}/`));

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const lineIsNew = newFileHintPattern.test(line);
      for (const match of line.matchAll(srcRefPattern)) {
        const refPath = match[1].replace(/[.,;:!?)]+$/u, '');
        const startLine = match[2] ? Number.parseInt(match[2], 10) : null;
        const endLine = match[3] ? Number.parseInt(match[3], 10) : startLine;

        if (!refPath || bareRootSet.has(refPath)) continue;
        if (refPath.endsWith('/')) {
          const absDir = assertInsideRepo(repositoryRoot, refPath);
          if (!absDir || (!existsSync(absDir) && !lineIsNew)) {
            errors.push(`Diretório inexistente citado em contract.md:L${i + 1}: ${refPath}`);
          }
          continue;
        }

        const absPath = assertInsideRepo(repositoryRoot, refPath);
        if (!absPath) {
          errors.push(`Caminho inválido fora do repositório em contract.md:L${i + 1}: ${refPath}`);
          continue;
        }

        if (!existsSync(absPath)) {
          if (startLine !== null) {
            errors.push(`Referência com linha para arquivo inexistente em contract.md:L${i + 1}: ${refPath}:L${startLine}`);
          } else if (!lineIsNew && !newPathSet.has(refPath)) {
            errors.push(`Arquivo inexistente sem marcação [novo] em contract.md:L${i + 1}: ${refPath}`);
          }
          continue;
        }

        const stats = lstatSync(absPath);
        if (stats.isSymbolicLink() || !stats.isFile()) {
          errors.push(`Referência aponta para symlink ou não-arquivo em contract.md:L${i + 1}: ${refPath}`);
          continue;
        }

        if (startLine !== null) {
          if (!lineCache.has(refPath)) {
            lineCache.set(refPath, readFileSync(absPath, 'utf8').split('\n'));
          }
          const fileLines = lineCache.get(refPath);
          const totalLines = fileLines.length;
          if (startLine < 1 || endLine < startLine || endLine > totalLines) {
            errors.push(`Faixa de linhas inválida em contract.md:L${i + 1}: ${refPath}:L${startLine}${match[3] ? `-L${endLine}` : ''} (arquivo tem ${totalLines} linhas)`);
          } else {
            const beforeRef = line.slice(0, match.index);
            const symMatch = beforeRef.match(symbolBeforeRefPattern);
            if (symMatch) {
              const symbolName = symMatch[1];
              const sliceText = fileLines.slice(startLine - 1, endLine).join('\n');
              const escaped = escapeRegex(symbolName);
              const symRe = new RegExp(`(?<![A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`, 'u');
              if (!symRe.test(sliceText)) {
                if (!symbolCache.has(refPath)) {
                  symbolCache.set(refPath, extractFileSymbols(refPath, fileLines.join('\n')));
                }
                const insideAstSpan = symbolCache.get(refPath).some((s) =>
                  s.name === symbolName && s.startLine <= startLine && endLine <= (s.endLine ?? s.startLine),
                );
                if (!insideAstSpan) {
                  errors.push(`Símbolo '${symbolName}' não encontrado em ${refPath}:L${startLine}${match[3] ? `-L${endLine}` : ''} (contract.md:L${i + 1})`);
                }
              }
            }
          }
        }
      }
    }
  }

  // Regras hard de ARCHITECTURE.md (ex.: Date.now() implícito sob DETERMINISTIC-TIME)
  const archRules = loadArchitectureRules(repositoryRoot);
  errors.push(...findContractArchitectureViolations(archRules, markdown));

  const freshness = inspectWorkspaceFreshness(repositoryRoot, expectedSnapshotDigest);
  if (freshness.workspaceFreshness === 'CHANGED_SINCE_BASELINE') {
    warnings.push('Código de produto foi alterado desde o último ./aegis brief; rode ./aegis brief novamente se o contexto ficou defasado.');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    authorizedPaths,
    scenarioCount: completeScenarios,
    contractText: markdown,
    sourceRoots: effectiveRoots,
    workspaceFreshness: freshness.workspaceFreshness,
  };
}

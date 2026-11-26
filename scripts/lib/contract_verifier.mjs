import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { findContractArchitectureViolations, loadArchitectureRules } from './architecture_rules.mjs';
import { inspectWorkspaceFreshness, resolveSourceRoots } from './workspace_observer.mjs';

const forbiddenPathPattern = /(?:\/etc\/|\/proc\/|\/sys\/|~\/|\.\.\/)/u;
const governanceTargetPattern = /(?:^|[\s`'"(])(?:\.harness\/|scripts\/|\.github\/|AGENTS\.md|ARCHITECTURE\.md|eslint\.config\.[A-Za-z]+|tsconfig(?:\.[^/\s`'"()]+)?\.json|package(?:-lock)?\.json)(?:$|[\s`'"):,;.])/u;
const outOfScopeLinePattern = /^\s*[-*]?\s*(?:\*\*)?(?:fora do escopo|out of scope)\b/iu;
const pendingMarkerPattern = /(?:\[PENDENTE\]|\bPENDING_Q\d+\b|\bTBD\b|\bTODO\b)/u;
const newFileHintPattern = /(?:\[novo\]|\(novo\)|\[new\]|\(new\)|novo arquivo|new file|criar\b|create\b)/iu;
const symbolBeforeRefPattern = /`([A-Za-z_$][A-Za-z0-9_$]{2,})(?:[^`]*)`\s*\(\s*`?$/u;

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function buildRootPrefixAlternation(roots) {
  return [...new Set(roots.filter(Boolean))].map(escapeRegex).join('|');
}

export function countContractScenarios(markdown) {
  const givenCount = (markdown.match(/(?:^|\n)\s*[-*]?\s*(?:\*\*)?(?:Dado|Given)(?:\*\*)?:/giu) ?? []).length;
  const whenCount = (markdown.match(/(?:^|\n)\s*[-*]?\s*(?:\*\*)?(?:Quando|When)(?:\*\*)?:/giu) ?? []).length;
  const thenCount = (markdown.match(/(?:^|\n)\s*[-*]?\s*(?:\*\*)?(?:Ent[aã]o|Then)(?:\*\*)?:/giu) ?? []).length;
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

/**
 * Extrai os caminhos autorizados declarados na seção de arquivos do contract.md,
 * respeitando as raízes de produto (src/, app/, lib/ ou AEGIS_SRC_DIRS).
 */
export function extractAuthorizedPaths(markdown, sourceRoots = ['src', 'app', 'lib']) {
  const sections = splitMarkdownSections(markdown);
  const targetSection = extractTargetSection(sections);
  const authorized = new Set();
  const newPaths = new Set();

  const rootAlt = buildRootPrefixAlternation([...sourceRoots, 'test', 'tests']);
  const authPathPattern = new RegExp(`\\b((?:${rootAlt})\\/[A-Za-z0-9_./-]+)`, 'gu');

  const linesToScan = targetSection ? targetSection.lines : markdown.split('\n');
  for (const line of linesToScan) {
    if (outOfScopeLinePattern.test(line)
      || /\b(?:inalterad[oa]|read-only|somente leitura)\b/iu.test(line)) {
      continue;
    }
    const isNewLine = newFileHintPattern.test(line);
    for (const match of line.matchAll(authPathPattern)) {
      const cleaned = match[1].replace(/[.,;:!?)]+$/u, '');
      if (!cleaned) continue;
      authorized.add(cleaned);
      if (isNewLine) newPaths.add(cleaned);
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

/**
 * Verificação puramente mecânica do contract.md (0 tokens):
 * - seções mínimas obrigatórias + casos Dado/Quando/Então;
 * - zero marcadores pendentes ([PENDENTE], PENDING_Q*, TBD, TODO);
 * - fronteira de produto (sem /etc/, ../, .harness/, scripts/, configs de governança como alvo);
 * - existência física de arquivos e faixas path:Ln-Lm nas raízes de produto.
 */
export function verifyContractMarkdown({
  repositoryRoot,
  contractPath,
  expectedSnapshotDigest = null,
  sourceRoots = null,
}) {
  const errors = [];
  const warnings = [];

  if (!existsSync(contractPath)) {
    return {
      ok: false,
      errors: [`Contrato não encontrado em ${contractPath}`],
      warnings,
      authorizedPaths: [],
      workspaceFreshness: 'NO_CONTRACT',
    };
  }

  if (lstatSync(contractPath).isSymbolicLink()) {
    return {
      ok: false,
      errors: ['Contrato não pode ser symlink.'],
      warnings,
      authorizedPaths: [],
      workspaceFreshness: 'NO_CONTRACT',
    };
  }

  const markdown = readFileSync(contractPath, 'utf8').replace(/\r\n?/gu, '\n');
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

  // Fronteira na seção de arquivos-alvo
  const targetSection = extractTargetSection(sections);
  if (targetSection) {
    for (const line of targetSection.lines) {
      if (outOfScopeLinePattern.test(line)) continue;
      if (forbiddenPathPattern.test(line)) {
        errors.push(`Violação de fronteira na seção de arquivos: "${line.trim().slice(0, 80)}"`);
      }
      if (governanceTargetPattern.test(line)) {
        errors.push(`Arquivo fora da fronteira de produto (${effectiveRoots.join(', ')}/) na seção de arquivos: "${line.trim().slice(0, 80)}"`);
      }
    }
  }

  // Validação física de referências de produto (src|app|lib|AEGIS_SRC_DIRS/...:Ln-Lm)
  const { authorizedPaths, newPaths } = extractAuthorizedPaths(markdown, effectiveRoots);
  const newPathSet = new Set(newPaths);
  const lineCache = new Map();
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
              errors.push(`Símbolo '${symbolName}' não encontrado em ${refPath}:L${startLine}${match[3] ? `-L${endLine}` : ''} (contract.md:L${i + 1})`);
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
    workspaceFreshness: freshness.workspaceFreshness,
  };
}

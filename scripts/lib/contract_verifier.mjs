import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { inspectWorkspaceFreshness } from './workspace_observer.mjs';

const forbiddenPathPattern = /(?:\/etc\/|\/proc\/|\/sys\/|~\/|\.\.\/)/u;
const pendingMarkerPattern = /(?:\[PENDENTE\]|\bPENDING_Q\d+\b|\bTBD\b|\bTODO\b)/u;
const srcRefPattern = /\b(src\/[A-Za-z0-9_./-]+)(?::L?(\d+)(?:-L?(\d+))?)?/gu;
const newFileHintPattern = /(?:\[novo\]|\(novo\)|\[new\]|\(new\)|novo arquivo|new file|criar\b|create\b)/iu;

export function parseWorkspaceReference(reference) {
  if (typeof reference !== 'string' || reference.trim().length === 0) {
    return { refPath: '', startLine: null, endLine: null };
  }
  const raw = reference.trim();
  const sepIdx = Math.max(raw.lastIndexOf('#'), raw.lastIndexOf(':'));
  if (sepIdx > 0) {
    const potentialPath = raw.slice(0, sepIdx).trim();
    const lineSpec = raw.slice(sepIdx + 1).trim();
    const match = lineSpec.match(/^L?(\d+)(?:-L?(\d+))?$/i);
    if (match) {
      const start = Number.parseInt(match[1], 10);
      const end = match[2] ? Number.parseInt(match[2], 10) : start;
      return { refPath: potentialPath, startLine: start, endLine: end };
    }
  }
  return { refPath: raw, startLine: null, endLine: null };
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
 * Extrai os caminhos autorizados declarados na seção de arquivos do contract.md.
 */
export function extractAuthorizedPaths(markdown) {
  const sections = splitMarkdownSections(markdown);
  const targetSection = extractTargetSection(sections);
  const authorized = new Set();
  const newPaths = new Set();
  let allowsPackageJson = false;

  const linesToScan = targetSection ? targetSection.lines : markdown.split('\n');
  for (const line of linesToScan) {
    if (/\b(?:fora do escopo|out of scope|n[aã]o alterar|inalterado|read-only|somente leitura)\b/iu.test(line)) {
      continue;
    }
    if (/\bpackage\.json\b/u.test(line)) {
      allowsPackageJson = true;
    }
    const isNewLine = newFileHintPattern.test(line);
    for (const match of line.matchAll(/\b((?:src|test|tests)\/[A-Za-z0-9_./-]+)/gu)) {
      const cleaned = match[1].replace(/[.,;:!?)]+$/u, '');
      if (!cleaned) continue;
      authorized.add(cleaned);
      if (isNewLine) newPaths.add(cleaned);
    }
  }

  return {
    authorizedPaths: [...authorized].sort(),
    newPaths: [...newPaths].sort(),
    allowsPackageJson,
  };
}

function assertInsideRepo(repositoryRoot, relPath) {
  const abs = resolve(repositoryRoot, relPath);
  const prefix = repositoryRoot.endsWith(sep) ? repositoryRoot : `${repositoryRoot}${sep}`;
  return abs.startsWith(prefix) ? abs : null;
}

/**
 * Verificação puramente mecânica do contract.md (0 tokens):
 * - seções mínimas obrigatórias + casos Dado/Quando/Então;
 * - zero marcadores pendentes ([PENDENTE], PENDING_Q*, TBD, TODO);
 * - fronteira de produto (sem /etc/, ../, .harness/, scripts/ como alvo);
 * - existência física de arquivos e faixas path:Ln-Lm em src/.
 */
export function verifyContractMarkdown({
  repositoryRoot,
  contractPath,
  expectedSnapshotDigest = null,
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

  const sections = splitMarkdownSections(markdown);
  const headings = sections.map((s) => s.heading);

  const hasScope = headings.some((h) => /(?:escopo|scope|objetivo)/iu.test(h));
  const hasFiles = extractTargetSection(sections) !== null;
  const hasCasesHeading = headings.some((h) => /(?:casos|provas?|cen[aá]rios|aceita[cç][aã]o|tests?|acceptance)/iu.test(h));

  if (!hasScope) errors.push('Seção obrigatória ausente: Escopo (ou Objetivo).');
  if (!hasFiles) errors.push('Seção obrigatória ausente: Arquivos-alvo (ex.: "## Arquivos").');
  if (!hasCasesHeading) errors.push('Seção obrigatória ausente: Casos de prova (Dado / Quando / Então).');

  // Casos falsificáveis Dado / Quando / Então (ou Given / When / Then)
  const givenCount = (markdown.match(/(?:^|\n)\s*[-*]?\s*(?:\*\*)?(?:Dado|Given)(?:\*\*)?:/giu) ?? []).length;
  const whenCount = (markdown.match(/(?:^|\n)\s*[-*]?\s*(?:\*\*)?(?:Quando|When)(?:\*\*)?:/giu) ?? []).length;
  const thenCount = (markdown.match(/(?:^|\n)\s*[-*]?\s*(?:\*\*)?(?:Ent[aã]o|Then)(?:\*\*)?:/giu) ?? []).length;
  const completeScenarios = Math.min(givenCount, whenCount, thenCount);
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
      if (/\b(?:fora do escopo|out of scope|n[aã]o alterar)\b/iu.test(line)) continue;
      if (forbiddenPathPattern.test(line)) {
        errors.push(`Violação de fronteira na seção de arquivos: "${line.trim().slice(0, 80)}"`);
      }
      if (/\b(?:\.harness\/|scripts\/)/u.test(line)) {
        errors.push(`Arquivo fora da fronteira de produto (src/) na seção de arquivos: "${line.trim().slice(0, 80)}"`);
      }
    }
  }

  // Validação física de referências src/... e src/...:Ln-Lm
  const { authorizedPaths, newPaths } = extractAuthorizedPaths(markdown);
  const newPathSet = new Set(newPaths);
  const lineCache = new Map();

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineIsNew = newFileHintPattern.test(line);
    for (const match of line.matchAll(srcRefPattern)) {
      const refPath = match[1].replace(/[.,;:!?)]+$/u, '');
      const startLine = match[2] ? Number.parseInt(match[2], 10) : null;
      const endLine = match[3] ? Number.parseInt(match[3], 10) : startLine;

      if (!refPath || refPath === 'src/') continue;
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
          errors.push(`Arquivo inexistente em src/ sem marcação [novo] em contract.md:L${i + 1}: ${refPath}`);
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
          lineCache.set(refPath, readFileSync(absPath, 'utf8').split('\n').length);
        }
        const totalLines = lineCache.get(refPath);
        if (startLine < 1 || endLine < startLine || endLine > totalLines) {
          errors.push(`Faixa de linhas inválida em contract.md:L${i + 1}: ${refPath}:L${startLine}${match[3] ? `-L${endLine}` : ''} (arquivo tem ${totalLines} linhas)`);
        }
      }
    }
  }

  const freshness = inspectWorkspaceFreshness(repositoryRoot, expectedSnapshotDigest);
  if (freshness.workspaceFreshness === 'CHANGED_SINCE_BASELINE') {
    warnings.push('src/ foi alterado desde o último ./aegis brief; rode ./aegis brief novamente se o contexto ficou defasado.');
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

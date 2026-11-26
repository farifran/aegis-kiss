import { isFallbackOnlyEvidence, sourceEvidenceByteLimit, stripDiacritics } from './source_evidence.mjs';

const silenceStopwords = new Set([
  'para', 'com', 'sem', 'sob', 'sobre', 'entre', 'como', 'onde', 'quando',
  'mais', 'menos', 'cada', 'todo', 'toda', 'todos', 'todas', 'outro', 'outra',
  'mesmo', 'mesma', 'deve', 'devem', 'pode', 'podem', 'sera', 'serao', 'esse',
  'essa', 'esses', 'essas', 'este', 'esta', 'estes', 'estas', 'aquele', 'aquela',
  'qual', 'quais', 'pelo', 'pela', 'pelos', 'pelas', 'fazer', 'gerar', 'criar',
  'alterar', 'remover', 'atualizar', 'incluir', 'permitir', 'calcular', 'executar',
]);

/**
 * Avalia se o brief deve incluir um mapa topográfico panorâmico (< 4 KB)
 * para o próprio agente da IDE resolver silêncio léxico em repositórios grandes.
 */
export function shouldShowTopography({
  intent = '',
  discovery,
  sourceEvidence = [],
  explicitTargetPaths = [],
}) {
  if (Array.isArray(explicitTargetPaths) && explicitTargetPaths.length > 0) return false;
  if (!discovery || discovery.status !== 'SOURCE_OBSERVED') return false;

  const textFiles = (discovery.files ?? []).filter((f) => f.kind === 'UTF8_TEXT');
  const totalBytes = textFiles.reduce((acc, f) => acc + f.bytes, 0);
  if (totalBytes <= sourceEvidenceByteLimit) return false;
  if ((discovery.workspaceSkeleton?.symbolCount ?? 0) === 0) return false;

  if (isFallbackOnlyEvidence(sourceEvidence)) return true;

  const intentWords = stripDiacritics(intent)
    .split(/[^a-z0-9_$-]+/i)
    .filter((w) => w.length >= 4);
  const domainWords = intentWords.filter((w) => !silenceStopwords.has(w));
  if (domainWords.length < 3) return false;

  const coveredSubdirs = new Set();
  for (const entry of sourceEvidence) {
    const parts = entry.path.split('/');
    if (parts.length > 2 && parts[0] === 'src') {
      coveredSubdirs.add(parts[1]);
    }
  }
  if (coveredSubdirs.size > 1) return false;

  const deliveredContent = sourceEvidence.map((e) => (e.content ?? '').toLowerCase()).join(' ');
  const coveredWordsCount = domainWords.filter((dw) => deliveredContent.includes(dw)).length;
  return (coveredWordsCount / domainWords.length) < 0.35;
}

/**
 * Amostragem panorâmica compacta de todo o repositório (até 2 símbolos por arquivo,
 * sem viés alfabético) para orientar o agente da IDE sob silêncio léxico.
 */
export function buildTopographicalMap(workspaceSkeleton, maxSymbolsPerFile = 2, maxTotalSymbols = 400) {
  const symbolsByPath = new Map();
  for (const sym of workspaceSkeleton?.symbols ?? []) {
    if (!sym.path || !sym.name) continue;
    if (!symbolsByPath.has(sym.path)) {
      symbolsByPath.set(sym.path, []);
    }
    const list = symbolsByPath.get(sym.path);
    if (list.length < maxSymbolsPerFile) {
      list.push(sym.name);
    }
  }

  const topography = {};
  let count = 0;
  for (const [path, symNames] of symbolsByPath.entries()) {
    if (count >= maxTotalSymbols) break;
    topography[path] = symNames;
    count += symNames.length;
  }
  return topography;
}

export function filterPhysicalPaths(suggestedPaths, observedTextPaths) {
  if (!Array.isArray(suggestedPaths)) return [];
  const validSet = new Set(observedTextPaths);
  return [...new Set(suggestedPaths.filter((p) => typeof p === 'string' && validSet.has(p)))];
}

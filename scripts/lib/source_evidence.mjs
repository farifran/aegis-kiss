import { Buffer } from 'node:buffer';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import { compareCodeUnits, sha256 } from './canonical_json.mjs';
export const sourceEvidenceByteLimit = 98_304;
const sourceEvidenceFileByteLimit = 8_192;
const sourceEvidenceExplicitFileByteLimit = 24_576;

const entrypointPattern = /(?:^|\/)(?:index|main|__main__|mod|entrypoint|run|app)\.[^/]+$/iu;

export function isEntrypointPath(filePath) {
  return entrypointPattern.test(filePath);
}

const ignoredDomainTokens = new Set([
  'src', 'source', 'root', 'code', 'file', 'files',
  'comportamento', 'comparaveis', 'compativeis', 'complexidade', 'consistencia',
  'observavel', 'observaveis', 'rastreaveis', 'falsificaveis', 'pendentes',
  'explicita', 'explicitas', 'explicitos', 'explicito', 'alternativas',
  'recomendacao', 'justificada', 'autorizada', 'autorizadas', 'implemente',
  'produto', 'examine', 'encontrar', 'existentes', 'provas', 'contrato',
  'demanda', 'decisoes', 'efeitos', 'trecho', 'origem', 'evidencias', 'evidencia',
]);

export function stripDiacritics(text) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export function tokenizeIntent(intent) {
  const stripped = stripDiacritics(intent ?? '');
  const words = stripped
    .split(/[^a-z0-9_$-]+/i)
    .filter((w) => w.length >= 3 && !ignoredDomainTokens.has(w));
  const stems = words.map((w) => (w.length >= 4 ? w.slice(0, 4) : w));
  return { words, stems };
}

export function isFallbackOnlyEvidence(sourceEvidence) {
  return sourceEvidence.length <= 1
    && sourceEvidence.every((entry) => entry.selection === 'ENTRYPOINT_PREFIX' || entry.selection === 'FULL_SOURCE');
}

function decodeUtf8Prefix(bytes, byteLimit) {
  let end = Math.min(bytes.byteLength, byteLimit);
  while (end > 0) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, end));
    } catch {
      end -= 1;
    }
  }
  return '';
}

function verifiedTextSource(repositoryRoot, manifestEntry, workspaceObservation = null) {
  const observedBytes = workspaceObservation?.sourceBytesByPath?.get(manifestEntry.path);
  if (observedBytes !== undefined) {
    if (observedBytes.byteLength !== manifestEntry.bytes) {
      throw new Error(`semantic_source_changed:${manifestEntry.path}`);
    }
    return observedBytes;
  }
  const absolutePath = resolve(repositoryRoot, manifestEntry.path);
  const metadata = lstatSync(absolutePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`semantic_source_changed:${manifestEntry.path}`);
  }
  const bytes = readFileSync(absolutePath);
  if (bytes.byteLength !== manifestEntry.bytes || sha256(bytes) !== manifestEntry.digest) {
    throw new Error(`semantic_source_changed:${manifestEntry.path}`);
  }
  return bytes;
}

function findStructuralHeaderEndLine(filePath, skeletonSymbols) {
  if (!Array.isArray(skeletonSymbols)) return 0;
  let headerEnd = 0;
  for (const s of skeletonSymbols) {
    if (s.path !== filePath) continue;
    if (s.kind === 'INTERFACE' || s.kind === 'TYPE_ALIAS' || s.kind === 'ENUM' || s.kind === 'CONST') {
      if (s.startLine <= 150 && s.endLine > headerEnd) {
        headerEnd = s.endLine;
      }
    }
  }
  return headerEnd;
}

function extractSubtokens(name) {
  if (!name) return [];
  const separated = name
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
    .replace(/[_$-]+/gu, ' ');
  return [...new Set(separated
    .split(/\s+/u)
    .map((part) => stripDiacritics(part))
    .filter((part) => part.length >= 3))];
}

function getAliases(domainAliases, word) {
  if (!domainAliases) return [];
  const val = domainAliases[word];
  if (!val) return [];
  if (Array.isArray(val)) return val.map((v) => stripDiacritics(String(v)));
  return [stripDiacritics(String(val))];
}

function getLongestMatchingPrefixLength(filePath, prefixes) {
  if (!filePath || !prefixes || prefixes.size === 0) return 0;
  let maxLen = 0;
  for (const pfx of prefixes) {
    if (filePath.startsWith(pfx) && pfx.length > maxLen) {
      maxLen = pfx.length;
    }
  }
  return maxLen;
}

function extractTargetPrefixesAndDirs(intentText, rootsBySubdir = new Map(), domainAliases = {}) {
  const targetDirs = new Set();
  const targetPrefixes = new Set();
  if (!intentText) return { targetDirs, targetPrefixes, explicitFilePaths: [] };

  const explicitMatches = intentText.match(/\b(?:src|app|lib|test|tests)\/(?!\.\.(?:\/|$))[^\s`'"<>()[\]{}]+/gu) || [];
  const normalizedPaths = explicitMatches
    .map((m) => m.replace(/[.,;:!?]+$/u, '').replace(/:L?\d+(?::\d+|-L?\d+)?$/u, '').trim())
    .filter(Boolean);

  for (const p of normalizedPaths) {
    const parts = p.split('/');
    if (parts.length > 1) {
      if (parts.length > 2) targetDirs.add(parts[1]);
      if (/\.[a-zA-Z0-9]+$/u.test(p)) {
        const parentDir = p.slice(0, p.lastIndexOf('/') + 1);
        if (parentDir && !/^(?:src|app|lib)\/$/u.test(parentDir)) targetPrefixes.add(parentDir);
      } else {
        const dirPfx = p.endsWith('/') ? p : `${p}/`;
        if (!/^(?:src|app|lib)\/$/u.test(dirPfx)) targetPrefixes.add(dirPfx);
      }
    }
  }

  const addSubdir = (subdir) => {
    const roots = rootsBySubdir.get(subdir);
    if (!roots || ignoredDomainTokens.has(subdir)) return;
    targetDirs.add(subdir);
    for (const root of roots) targetPrefixes.add(`${root}/${subdir}/`);
  };

  const stripped = stripDiacritics(intentText);
  const words = stripped.split(/[^a-z0-9_$-]+/i).filter((w) => w.length >= 3);
  for (const word of words) {
    addSubdir(word);
    for (const a of getAliases(domainAliases, word)) {
      addSubdir(a);
    }
  }

  return {
    targetDirs,
    targetPrefixes,
    explicitFilePaths: normalizedPaths.filter((p) => !/^(?:src|app|lib|test|tests)\/?$/u.test(p)),
  };
}

export function loadDomainLexicon(repositoryRoot) {
  if (!repositoryRoot) return {};
  const lexiconPath = resolve(repositoryRoot, '.harness/config/lexicon.json');
  const merged = {};
  if (existsSync(lexiconPath)) {
    try {
      const parsed = JSON.parse(readFileSync(lexiconPath, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed)) {
          const key = stripDiacritics(k);
          if (Array.isArray(v)) {
            merged[key] = [...new Set(v.map((item) => stripDiacritics(String(item))))];
          } else if (typeof v === 'string') {
            merged[key] = stripDiacritics(v);
          }
        }
      }
    } catch {
      // Ignora erros de leitura/parsing e preserva determinismo
    }
  }
  return merged;
}

export function computeSymbolIdfWeights(symbols, words, stems, domainAliases = {}) {
  const allPaths = new Set(symbols.map((s) => s.path));
  const totalFiles = Math.max(allPaths.size, 1);
  const docFreqByWord = new Map();
  for (const w of words) docFreqByWord.set(w, new Set());

  for (const sym of symbols) {
    const tokens = [
      ...extractSubtokens(sym.name),
      ...(sym.path ? extractSubtokens(sym.path.replace(/\.[^.]+$/u, '')) : []),
      ...((sym.docComment && !sym.docComment.includes('@deprecated'))
        ? stripDiacritics(sym.docComment.replace(/[*#/\\@{}]/gu, ' ')).split(/[^a-z0-9_$-]+/i).filter((t) => t.length >= 3)
        : []),
    ];
    for (const t of tokens) {
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        const s = stems[i];
        const aliases = getAliases(domainAliases, w);
        let tokenMatches = (t === w || (s.length >= 4 && t.startsWith(s)));
        if (!tokenMatches) {
          for (const a of aliases) {
            const aStem = a.length >= 4 ? a.slice(0, 4) : a;
            if (t === a || (aStem.length >= 4 && t.startsWith(aStem))) {
              tokenMatches = true;
              break;
            }
          }
        }
        if (tokenMatches) {
          docFreqByWord.get(w).add(sym.path);
        }
      }
    }
  }

  const idfWeights = new Map();
  for (const w of words) {
    const fileCount = docFreqByWord.get(w).size;
    if (fileCount === 0) {
      idfWeights.set(w, 1.0);
    } else {
      const ratio = fileCount / totalFiles;
      if (ratio > 0.08) {
        idfWeights.set(w, 0.2);
      } else if (ratio < 0.03) {
        idfWeights.set(w, 4.0);
      } else {
        idfWeights.set(w, 1.5);
      }
    }
  }
  return idfWeights;
}

function scoreTokenGroup(tokens, words, stems, domainAliases, idfWeights, exactWeight, stemWeight) {
  let total = 0;
  let matched = false;
  for (const token of tokens) {
    if (ignoredDomainTokens.has(token)) continue;
    const tokenStem = token.length >= 4 ? token.slice(0, 4) : token;
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const stem = stems[i];
      const aliases = getAliases(domainAliases, word);
      const weight = idfWeights.get(word) ?? 1.0;
      let matchedAlias = false;
      for (const a of aliases) {
        const aStem = a.length >= 4 ? a.slice(0, 4) : a;
        if (token === a) {
          total += exactWeight * weight;
          matched = true;
          matchedAlias = true;
          break;
        } else if (aStem.length >= 4 && (token.startsWith(aStem) || a.startsWith(tokenStem))) {
          total += stemWeight * weight;
          matched = true;
          matchedAlias = true;
          break;
        }
      }
      if (!matchedAlias) {
        if (token === word) {
          total += exactWeight * weight;
          matched = true;
        } else if (stem.length >= 4 && (token.startsWith(stem) || word.startsWith(tokenStem))) {
          total += stemWeight * weight;
          matched = true;
        }
      }
    }
  }
  return { total, matched };
}

function exactSymbolNameMatch(symName, words, domainAliases) {
  const normalizedSymName = stripDiacritics(symName);
  if (words.includes(normalizedSymName)) return true;
  for (let i = 0; i < words.length; i++) {
    if (getAliases(domainAliases, words[i]).includes(normalizedSymName)) return true;
  }
  return false;
}

function extractDocTokens(docComment) {
  if (!docComment || docComment.includes('@deprecated')) return [];
  return stripDiacritics(docComment.replace(/[*#/\\@{}]/gu, ' '))
    .split(/[^a-z0-9_$-]+/i)
    .filter((w) => w.length >= 3 && !['param', 'returns', 'return', 'type', 'const', 'export'].includes(w));
}

function symbolPathPenalty(sym, deprecatedPenalty, nonProdPenalty) {
  let penalty = 0;
  if (sym.docComment && sym.docComment.includes('@deprecated')) penalty -= deprecatedPenalty;
  if (sym.path.includes('/legacy/') || sym.path.includes('deprecated_') || sym.path.includes('trap')) {
    penalty -= nonProdPenalty;
  }
  if (sym.path.includes('/tests/') || sym.path.includes('.test.') || sym.path.includes('.spec.')) {
    penalty -= nonProdPenalty;
  }
  if (sym.path.includes('/scripts/')) penalty -= nonProdPenalty;
  return penalty;
}

function evaluateSymbolTokens(sym, words, stems, domainAliases, idfWeights, weights) {
  const subtokens = extractSubtokens(sym.name);
  const pathSubtokens = sym.path ? extractSubtokens(sym.path.replace(/\.[^.]+$/u, '')) : [];
  const docTokens = extractDocTokens(sym.docComment);

  const subRes = scoreTokenGroup(subtokens, words, stems, domainAliases, idfWeights, weights.nameExact, weights.nameStem);
  let total = subRes.total;
  let structuralMatch = subRes.matched;

  if (exactSymbolNameMatch(sym.name, words, domainAliases)) {
    total += weights.exactNameBonus;
    structuralMatch = true;
  }

  const pathRes = scoreTokenGroup(pathSubtokens, words, stems, domainAliases, idfWeights, weights.pathExact, weights.pathStem);
  total += pathRes.total;
  structuralMatch = structuralMatch || pathRes.matched;

  if (structuralMatch) {
    const uniqueDoc = weights.dedupeDoc ? [...new Set(docTokens)] : docTokens;
    const docScore = scoreTokenGroup(uniqueDoc, words, stems, domainAliases, idfWeights, weights.docExact, weights.docStem).total;
    total += weights.docCap ? Math.min(docScore, weights.docCap) : docScore;
  }

  return { total, structuralMatch };
}

const selectionScoreWeights = {
  nameExact: 3, nameStem: 2, exactNameBonus: 5,
  pathExact: 2, pathStem: 1,
  docExact: 2, docStem: 1, docCap: 6, dedupeDoc: true,
};

const affinityScoreWeights = {
  nameExact: 30, nameStem: 20, exactNameBonus: 40,
  pathExact: 15, pathStem: 10,
  docExact: 10, docStem: 5, docCap: 0, dedupeDoc: false,
};

function matchSkeletonSymbols(symbols, intent, domainAliases = {}, targetPrefixes = new Set(), precomputedIdf = null) {
  const { words, stems } = tokenizeIntent(intent);
  if (words.length === 0) return [];

  const idfWeights = precomputedIdf ?? computeSymbolIdfWeights(symbols, words, stems, domainAliases);

  const scored = [];
  for (const sym of symbols) {
    if (!sym.name) continue;
    const { total: tokenScore } = evaluateSymbolTokens(sym, words, stems, domainAliases, idfWeights, selectionScoreWeights);
    let score = tokenScore;

    if (sym.exported && score > 0) score += 3;
    if (targetPrefixes && targetPrefixes.size > 0 && score > 0) {
      const pfxLen = getLongestMatchingPrefixLength(sym.path, targetPrefixes);
      if (pfxLen > 0) score += Math.min(Math.floor(pfxLen / 4), 10);
    }
    score += symbolPathPenalty(sym, 5, 5);

    if (score > 0) {
      scored.push({
        path: sym.path,
        line: sym.startLine,
        endLine: sym.endLine ?? sym.startLine,
        score,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

function computeSymbolAffinity(sym, words, stems, entrypoints, idfWeights = new Map(), domainAliases = {}, targetPrefixes = new Set()) {
  let score = 100 + symbolPathPenalty(sym, 300, 200);
  if (entrypoints.includes(sym.path)) score += 200;
  if (sym.exported) score += 50;

  const { total: matchScore } = evaluateSymbolTokens(sym, words, stems, domainAliases, idfWeights, affinityScoreWeights);
  if (targetPrefixes && targetPrefixes.size > 0) {
    const pfxLen = getLongestMatchingPrefixLength(sym.path, targetPrefixes);
    if (pfxLen > 0) score += Math.min(Math.floor(pfxLen / 4), 10) * 10;
  }
  return score + matchScore * 10;
}

export function prioritizeWorkspaceSkeleton(skeleton, intent, entrypoints = [], maxPromptSymbols = 512, domainAliases = {}, targetPrefixes = new Set(), precomputedIdf = null) {
  if (!skeleton || !Array.isArray(skeleton.symbols)) return skeleton;
  const { words, stems } = tokenizeIntent(intent);

  const idfWeights = precomputedIdf ?? computeSymbolIdfWeights(skeleton.symbols, words, stems, domainAliases);

  const sorted = [...skeleton.symbols].sort((a, b) => {
    const affinityA = computeSymbolAffinity(a, words, stems, entrypoints, idfWeights, domainAliases, targetPrefixes);
    const affinityB = computeSymbolAffinity(b, words, stems, entrypoints, idfWeights, domainAliases, targetPrefixes);
    return affinityB - affinityA
      || compareCodeUnits(a.path, b.path)
      || a.startLine - b.startLine
      || compareCodeUnits(a.name, b.name);
  });

  const pruned = sorted.slice(0, maxPromptSymbols);
  return {
    schema: skeleton.schema,
    symbolCount: pruned.length,
    symbols: pruned,
  };
}

function normalizeSpan(item) {
  if (typeof item === 'number') return { startLine: item, endLine: item };
  return {
    startLine: item.startLine ?? item.line ?? 1,
    endLine: Math.max(item.startLine ?? item.line ?? 1, item.endLine ?? item.startLine ?? item.line ?? 1),
  };
}

function extractAnchoredWindows(fileLines, headerEndLine, orderedTargetSpans, byteLimit) {
  if (byteLimit <= 0 || fileLines.length === 0) return [];
  const minLine = headerEndLine > 0 ? headerEndLine + 1 : 1;
  const normalizedSpans = orderedTargetSpans.map(normalizeSpan);

  const anchors = [];
  for (const span of normalizedSpans) {
    if (span.endLine < minLine) continue;
    const clampedStart = Math.max(minLine, span.startLine);
    if (anchors.some((a) => clampedStart <= a.endLine + 10 && span.endLine >= a.startLine - 10)) {
      continue;
    }
    anchors.push({ startLine: clampedStart, endLine: Math.max(clampedStart, span.endLine) });
    if (anchors.length >= 3) break;
  }
  if (anchors.length === 0 && normalizedSpans.length > 0) {
    const first = normalizedSpans[0];
    const clampedStart = Math.max(minLine, first.startLine);
    anchors.push({ startLine: clampedStart, endLine: Math.max(clampedStart, first.endLine) });
  }
  if (anchors.length === 0) return [];

  const sliceBudget = Math.floor(byteLimit / anchors.length);
  const rawIntervals = [];
  for (const anchor of anchors) {
    const startIdx = Math.min(Math.max(anchor.startLine - 1, minLine - 1), fileLines.length - 1);
    let endIdx = Math.min(Math.max(anchor.endLine, startIdx + 1), fileLines.length);

    // 1. Prioriza o bloco inteiro do símbolo AST [startLine..endLine].
    let content = fileLines.slice(startIdx, endIdx).join('\n');
    while (endIdx > startIdx + 1 && Buffer.byteLength(content, 'utf8') > sliceBudget) {
      endIdx -= 1;
      content = fileLines.slice(startIdx, endIdx).join('\n');
    }

    // 2. Se ainda sobra orçamento, expande suavemente em torno do símbolo para contexto imediato.
    let start = startIdx;
    let end = endIdx;
    while (start > minLine - 1 || end < fileLines.length) {
      const nextStart = start > minLine - 1 ? start - 1 : start;
      const nextEnd = end < fileLines.length ? end + 1 : end;
      const candidate = fileLines.slice(nextStart, nextEnd).join('\n');
      if (Buffer.byteLength(candidate, 'utf8') > sliceBudget) break;
      start = nextStart;
      end = nextEnd;
      content = candidate;
    }
    if (Buffer.byteLength(content, 'utf8') <= sliceBudget) {
      rawIntervals.push({ start, end });
    } else {
      rawIntervals.push({ start: startIdx, end: startIdx + 1 });
    }
  }

  rawIntervals.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const iv of rawIntervals) {
    const prev = merged[merged.length - 1];
    if (prev && iv.start <= prev.end + 1) {
      prev.end = Math.max(prev.end, iv.end);
    } else {
      merged.push({ ...iv });
    }
  }

  const windows = [];
  let usedBytes = 0;
  for (const iv of merged) {
    const avail = byteLimit - usedBytes;
    if (avail <= 0) break;
    let content = fileLines.slice(iv.start, iv.end).join('\n');
    let contentBytes = Buffer.byteLength(content, 'utf8');
    if (contentBytes > avail) {
      content = decodeUtf8Prefix(Buffer.from(content, 'utf8'), avail);
      contentBytes = Buffer.byteLength(content, 'utf8');
    }
    if (contentBytes > 0) {
      usedBytes += contentBytes;
      windows.push({
        content,
        startLine: iv.start + 1,
        endLine: iv.start + content.split('\n').length,
      });
    }
  }
  return windows;
}

/**
 * Resolve diretórios, prefixos e caminhos explícitos a partir da intenção,
 * evitando recalcular subdiretórios conhecidos entre descoberta e evidência.
 */
export function resolveDiscoveryScope(textFiles, intent, domainAliases, contextData = null) {
  if (contextData?.targetDirs && contextData?.targetPrefixes && contextData?.explicitFilePaths) {
    return {
      targetDirs: new Set(contextData.targetDirs),
      targetPrefixes: new Set(contextData.targetPrefixes),
      explicitFilePaths: contextData.explicitFilePaths,
    };
  }
  const rootsBySubdir = new Map();
  for (const file of textFiles) {
    const parts = file.path.split('/');
    if (parts.length > 2) {
      if (!rootsBySubdir.has(parts[1])) rootsBySubdir.set(parts[1], new Set());
      rootsBySubdir.get(parts[1]).add(parts[0]);
    }
  }
  return extractTargetPrefixesAndDirs(intent, rootsBySubdir, domainAliases);
}

export function buildSourceEvidence(
  repositoryRoot,
  { intent = '', discovery },
  workspaceObservation = null,
  explicitTargetPaths = [],
  contextData = null,
) {
  const domainAliases = contextData?.domainAliases ?? loadDomainLexicon(repositoryRoot);
  const textFiles = discovery.files.filter(({ kind }) => kind === 'UTF8_TEXT');
  const filesByPath = new Map(textFiles.map((file) => [file.path, file]));
  const smallWorkspace = textFiles.reduce((total, { bytes }) => total + bytes, 0)
    <= sourceEvidenceByteLimit;
  const entrypoints = textFiles.map(({ path }) => path).filter(isEntrypointPath);

  const selectionsByPath = new Map();
  const { targetDirs, targetPrefixes, explicitFilePaths } = resolveDiscoveryScope(
    textFiles,
    intent,
    domainAliases,
    contextData,
  );
  if (smallWorkspace) {
    let selectivePaths = null;
    if (textFiles.length > 1) {
      const matched = discovery.workspaceSkeleton?.symbols
        ? matchSkeletonSymbols(
          discovery.workspaceSkeleton.symbols,
          intent,
          domainAliases,
          targetPrefixes,
          contextData?.precomputedIdf ?? null,
        )
        : [];
      const topScore = matched.length > 0 ? matched[0].score : 0;
      const intentRaw = intent;
      const intentSubtokens = new Set(extractSubtokens(intentRaw));
      const basenameHits = textFiles
        .filter((file) => {
          const base = file.path.split('/').pop();
          return base && intentRaw.includes(base);
        })
        .map((file) => file.path);
      const exactSymbolSubHits = (discovery.workspaceSkeleton?.symbols ?? [])
        .filter((sym) => sym.exported && extractSubtokens(sym.name).some((t) => intentSubtokens.has(t) && t.length >= 6))
        .map((sym) => sym.path);
      const hasExplicitScope = explicitFilePaths.length > 0
        || (explicitTargetPaths?.length ?? 0) > 0
        || targetDirs.size > 0
        || targetPrefixes.size > 0;
      if (!hasExplicitScope && basenameHits.length === 0 && exactSymbolSubHits.length === 0 && topScore < 6.0) {
        selectivePaths = entrypoints.length > 0 ? entrypoints : [textFiles[0].path];
      } else {
        const dirPrefixPaths = hasExplicitScope
          ? textFiles
            .map((file) => file.path)
            .filter((p) => {
              const parts = p.split('/');
              const dir = parts.length > 2 ? parts[1] : '';
              return targetDirs.has(dir) || [...targetPrefixes].some((pref) => p.startsWith(pref));
            })
          : [];
        const focused = new Set([
          ...(entrypoints.length > 0 ? entrypoints : [textFiles[0].path]),
          ...explicitFilePaths.filter((p) => filesByPath.has(p)),
          ...(explicitTargetPaths ?? []).filter((p) => filesByPath.has(p)),
          ...dirPrefixPaths,
          ...basenameHits,
          ...exactSymbolSubHits,
        ]);
        for (const item of matched) {
          if (item.score >= 4.0) focused.add(item.path);
        }
        selectivePaths = [...focused];
      }
    }
    if (selectivePaths) {
      for (const path of selectivePaths) selectionsByPath.set(path, { path, lines: [] });
    } else {
      for (const { path } of textFiles) {
        selectionsByPath.set(path, { path, lines: [] });
      }
    }
  } else {

    const injectSelection = (p) => {
      if (filesByPath.has(p) && !selectionsByPath.has(p)) {
        const symbolSpans = (discovery.workspaceSkeleton?.symbols ?? [])
          .filter((s) => s.path === p && typeof s.startLine === 'number')
          .map((s) => ({ startLine: s.startLine, endLine: s.endLine ?? s.startLine }));
        selectionsByPath.set(p, { path: p, lines: symbolSpans });
      }
    };

    for (const p of explicitFilePaths) {
      injectSelection(p);
    }

    if (Array.isArray(explicitTargetPaths) && explicitTargetPaths.length > 0) {
      for (const p of explicitTargetPaths) {
        injectSelection(p);
        if (filesByPath.has(p)) {
          const parts = p.split('/');
          if (parts.length > 2) {
            targetDirs.add(parts[1]);
            const parentDir = p.slice(0, p.lastIndexOf('/') + 1);
            if (parentDir && !/^(?:src|app|lib)\/$/u.test(parentDir)) targetPrefixes.add(parentDir);
          }
        }
      }
    }

    const rootOrTargetEntrypoints = entrypoints.filter((path) => {
      const parts = path.split('/');
      if (parts.length <= 2) return true;
      if (targetDirs.size > 0 && targetDirs.has(parts[1])) return true;
      return false;
    });

    if (discovery.workspaceSkeleton?.symbols) {
      const matched = matchSkeletonSymbols(
        discovery.workspaceSkeleton.symbols,
        intent,
        domainAliases,
        targetPrefixes,
        contextData?.precomputedIdf ?? null,
      );
      const topScore = matched.length > 0 ? matched[0].score : 0;

      const topScoreByDir = new Map();
      const bestSymbolByDir = new Map();
      for (const item of matched) {
        const parts = item.path.split('/');
        const dir = parts.length > 2 ? parts[1] : '';
        if (dir) {
          if (!topScoreByDir.has(dir) || item.score > topScoreByDir.get(dir)) {
            topScoreByDir.set(dir, item.score);
          }
          if (!bestSymbolByDir.has(dir)) {
            bestSymbolByDir.set(dir, item);
          }
        }
      }

      const explicitCandidateSet = new Set([...(explicitFilePaths ?? []), ...(explicitTargetPaths ?? [])]);
      const candidatePaths = new Set();
      let estimatedCandidateBytes = 0;
      for (const { path, score } of matched) {
        if (score >= 2.0 && !candidatePaths.has(path)) {
          candidatePaths.add(path);
          const file = filesByPath.get(path);
          if (file) {
            const perFileCap = explicitCandidateSet.has(path)
              ? sourceEvidenceExplicitFileByteLimit
              : sourceEvidenceFileByteLimit;
            estimatedCandidateBytes += Math.min(file.bytes, perFileCap);
          }
        }
      }
      const underBudgetPressure = estimatedCandidateBytes > sourceEvidenceByteLimit;

      for (const { path, line, endLine, score } of matched) {
        const parts = path.split('/');
        const dir = parts.length > 2 ? parts[1] : '';

        if (targetDirs.size > 0) {
          const inTarget = dir ? targetDirs.has(dir) : true;
          if (!inTarget) continue;
        }

        const isTopForTargetDir = dir && targetDirs.has(dir) && bestSymbolByDir.get(dir)?.path === path && bestSymbolByDir.get(dir)?.line === line;

        if (!isTopForTargetDir) {
          if (underBudgetPressure) {
            const dirTop = (dir && targetDirs.has(dir) && topScoreByDir.get(dir)) ? topScoreByDir.get(dir) : topScore;
            const residualThreshold = dirTop >= 6.0 ? Math.max(3.0, dirTop * 0.4) : 1.0;
            if (score < residualThreshold) continue;
          } else if (score < 2.0) {
            continue;
          }
        }

        if (!selectionsByPath.has(path)) {
          selectionsByPath.set(path, { path, lines: [] });
        }
        selectionsByPath.get(path).lines.push({ startLine: line, endLine: endLine ?? line });
      }
    }

    if (targetDirs.size > 0 || targetPrefixes.size > 0) {
      const candidateFiles = textFiles.filter((file) => {
        const parts = file.path.split('/');
        const inTargetDir = parts.length > 2 && targetDirs.has(parts[1]);
        const inTargetPrefix = targetPrefixes.size > 0 && [...targetPrefixes].some((pfx) => file.path.startsWith(pfx));
        return inTargetDir || inTargetPrefix;
      }).sort((a, b) => {
        const pfxLenA = getLongestMatchingPrefixLength(a.path, targetPrefixes);
        const pfxLenB = getLongestMatchingPrefixLength(b.path, targetPrefixes);
        if (pfxLenB !== pfxLenA) return pfxLenB - pfxLenA;
        const aIsCode = /\.(?:ts|tsx|js|jsx|mjs|cjs|py|sh)$/u.test(a.path);
        const bIsCode = /\.(?:ts|tsx|js|jsx|mjs|cjs|py|sh)$/u.test(b.path);
        if (aIsCode && !bIsCode) return -1;
        if (!aIsCode && bIsCode) return 1;
        return compareCodeUnits(a.path, b.path);
      });

      for (const file of candidateFiles) {
        if (/\.(?:ts|tsx|js|jsx|mjs|cjs|py|sh)$/u.test(file.path)) {
          if (!selectionsByPath.has(file.path)) {
            selectionsByPath.set(file.path, { path: file.path, lines: [] });
          }
        }
      }
    }

    for (const entrypoint of rootOrTargetEntrypoints) {
      if (!selectionsByPath.has(entrypoint)) {
        selectionsByPath.set(entrypoint, { path: entrypoint, lines: [] });
      }
    }
    if (selectionsByPath.size === 0 && textFiles[0] !== undefined) {
      selectionsByPath.set(textFiles[0].path, { path: textFiles[0].path, lines: [] });
    }
  }

  const explicitSet = new Set([...(explicitFilePaths ?? []), ...(explicitTargetPaths ?? [])]);
  const evidence = [];
  let remainingBytes = sourceEvidenceByteLimit;
  for (const { path, lines } of selectionsByPath.values()) {
    if (remainingBytes <= 0) break;
    const manifestEntry = filesByPath.get(path);
    if (manifestEntry === undefined) continue;
    const bytes = verifiedTextSource(repositoryRoot, manifestEntry, workspaceObservation);
    const fileLimit = explicitSet.has(path)
      ? sourceEvidenceExplicitFileByteLimit
      : sourceEvidenceFileByteLimit;
    const limit = Math.min(smallWorkspace ? bytes.byteLength : fileLimit, Math.max(0, remainingBytes));
    if (limit <= 0) break;

    if (smallWorkspace || lines.length === 0 || bytes.byteLength <= limit) {
      const content = decodeUtf8Prefix(bytes, limit);
      const excerpt = { content, startLine: 1, endLine: content.split('\n').length };
      const selection = smallWorkspace ? 'FULL_SOURCE' : (lines.length === 0 ? 'ENTRYPOINT_PREFIX' : 'LEXICAL_WINDOW');
      const consumedBytes = Buffer.byteLength(excerpt.content, 'utf8');
      remainingBytes -= consumedBytes;
      evidence.push({
        path,
        ...excerpt,
        truncated: consumedBytes < bytes.byteLength,
        selection,
      });
    } else {
      const seenSpanKeys = new Set();
      const orderedSpans = [];
      for (const rawSpan of lines) {
        const span = normalizeSpan(rawSpan);
        const key = `${span.startLine}:${span.endLine}`;
        if (!seenSpanKeys.has(key)) {
          seenSpanKeys.add(key);
          orderedSpans.push(span);
        }
      }
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const fileLines = text.split('\n');
      const headerEndLine = findStructuralHeaderEndLine(manifestEntry.path, discovery.workspaceSkeleton?.symbols);

      if (headerEndLine > 0 && orderedSpans.some((s) => s.startLine > headerEndLine + 5)) {
        const headerText = fileLines.slice(0, headerEndLine).join('\n');
        const headerBytes = Buffer.byteLength(headerText, 'utf8');
        const maxHeaderBudget = Math.min(headerBytes, Math.max(512, Math.floor(limit * 0.4)));

        let headerExcerpt;
        if (headerBytes <= maxHeaderBudget) {
          headerExcerpt = { content: headerText, startLine: 1, endLine: headerEndLine };
        } else {
          const content = decodeUtf8Prefix(Buffer.from(headerText), maxHeaderBudget);
          headerExcerpt = { content, startLine: 1, endLine: content.split('\n').length };
        }

        const consumedHeader = Buffer.byteLength(headerExcerpt.content, 'utf8');
        remainingBytes -= consumedHeader;
        evidence.push({
          path,
          ...headerExcerpt,
          truncated: true,
          selection: 'LEXICAL_WINDOW',
        });

        const windowBudget = Math.min(limit - consumedHeader, remainingBytes);
        if (windowBudget > 0) {
          const windows = extractAnchoredWindows(fileLines, headerEndLine, orderedSpans, windowBudget);
          for (const windowExcerpt of windows) {
            const consumedWindow = Buffer.byteLength(windowExcerpt.content, 'utf8');
            remainingBytes -= consumedWindow;
            evidence.push({
              path,
              ...windowExcerpt,
              truncated: true,
              selection: 'LEXICAL_WINDOW',
            });
          }
        }
      } else {
        const windows = extractAnchoredWindows(fileLines, 0, orderedSpans, limit);
        for (const windowExcerpt of windows) {
          const consumedBytes = Buffer.byteLength(windowExcerpt.content, 'utf8');
          remainingBytes -= consumedBytes;
          evidence.push({
            path,
            ...windowExcerpt,
            truncated: consumedBytes < bytes.byteLength,
            selection: 'LEXICAL_WINDOW',
          });
        }
      }
    }
  }
  return evidence;
}


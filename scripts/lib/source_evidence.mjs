import { Buffer } from 'node:buffer';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import { canonicalDigest, compareCodeUnits, sha256 } from './canonical_json.mjs';
import {
  sourceEvidenceByteLimit,
  sourceEvidenceFileByteLimit,
  sourceEvidenceExplicitFileByteLimit,
} from './semantic_authority.mjs';
import { extractFileSymbols } from './workspace_skeleton.mjs';

export const ignoredDomainTokens = new Set(['src', 'source', 'root', 'code', 'file', 'files']);

export function stripDiacritics(text) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
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
    if (observedBytes.byteLength !== manifestEntry.bytes
      || sha256(observedBytes) !== manifestEntry.digest) {
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

function findStructuralHeaderEndLine(path, text) {
  const symbols = extractFileSymbols(path, text);
  let headerEnd = 0;
  for (const s of symbols) {
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

export function getLongestMatchingPrefixLength(filePath, prefixes) {
  if (!filePath || !prefixes || prefixes.size === 0) return 0;
  let maxLen = 0;
  for (const pfx of prefixes) {
    if (filePath.startsWith(pfx) && pfx.length > maxLen) {
      maxLen = pfx.length;
    }
  }
  return maxLen;
}

export function extractTargetPrefixesAndDirs(intentText, knownSubdirs = new Set(), domainAliases = {}) {
  const targetDirs = new Set();
  const targetPrefixes = new Set();
  if (!intentText) return { targetDirs, targetPrefixes, explicitFilePaths: [] };

  const explicitMatches = intentText.match(/\b(?:src|test|tests)\/(?!\.\.(?:\/|$))[^\s`'"<>()[\]{}]+/gu) || [];
  const normalizedPaths = explicitMatches.map((m) => m.replace(/[.,;:!?]+$/u, '').trim()).filter(Boolean);

  for (const p of normalizedPaths) {
    const parts = p.split('/');
    if (parts.length > 1) {
      if (parts.length > 2) targetDirs.add(parts[1]);
      if (/\.[a-zA-Z0-9]+$/u.test(p)) {
        const parentDir = p.slice(0, p.lastIndexOf('/') + 1);
        if (parentDir && parentDir !== 'src/') targetPrefixes.add(parentDir);
      } else {
        const dirPfx = p.endsWith('/') ? p : `${p}/`;
        if (dirPfx !== 'src/') targetPrefixes.add(dirPfx);
      }
    }
  }

  const stripped = stripDiacritics(intentText);
  const words = stripped.split(/[^a-z0-9_$-]+/i).filter((w) => w.length >= 3);
  for (const word of words) {
    if (knownSubdirs.has(word) && !ignoredDomainTokens.has(word)) {
      targetDirs.add(word);
      targetPrefixes.add(`src/${word}/`);
    }
    const aliases = getAliases(domainAliases, word);
    for (const a of aliases) {
      if (knownSubdirs.has(a) && !ignoredDomainTokens.has(a)) {
        targetDirs.add(a);
        targetPrefixes.add(`src/${a}/`);
      }
    }
  }

  return { targetDirs, targetPrefixes, explicitFilePaths: normalizedPaths };
}

export function loadDomainLexicon(repositoryRoot) {
  if (!repositoryRoot) return {};
  const candidatePaths = [
    resolve(repositoryRoot, '.harness/config/lexicon.json'),
    resolve(repositoryRoot, '.harness/domain-lexicon.json'),
  ];
  const merged = {};
  for (const p of candidatePaths) {
    if (existsSync(p)) {
      try {
        const raw = readFileSync(p, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          for (const [k, v] of Object.entries(parsed)) {
            const key = stripDiacritics(k);
            if (Array.isArray(v)) {
              const existing = merged[key];
              const normV = v.map((item) => stripDiacritics(String(item)));
              if (Array.isArray(existing)) {
                merged[key] = [...new Set([...existing, ...normV])];
              } else if (existing) {
                merged[key] = [...new Set([existing, ...normV])];
              } else {
                merged[key] = normV;
              }
            } else if (typeof v === 'string') {
              const normV = stripDiacritics(v);
              const existing = merged[key];
              if (Array.isArray(existing)) {
                if (!existing.includes(normV)) existing.push(normV);
              } else if (existing && existing !== normV) {
                merged[key] = [existing, normV];
              } else {
                merged[key] = normV;
              }
            }
          }
        }
      } catch {
        // Ignora erros de leitura/parsing e preserva determinismo
      }
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

function matchSkeletonSymbols(symbols, intent, domainAliases = {}, targetPrefixes = new Set(), precomputedIdf = null) {
  const stripped = stripDiacritics(intent);
  const rawWords = stripped.split(/[^a-z0-9_$-]+/i).filter((w) => w.length >= 3);
  const words = rawWords.filter((w) => !ignoredDomainTokens.has(w));
  if (words.length === 0) return [];
  const stems = words.map((w) => (w.length >= 4 ? w.slice(0, 4) : w));

  const idfWeights = precomputedIdf ?? computeSymbolIdfWeights(symbols, words, stems, domainAliases);

  const scored = [];
  for (const sym of symbols) {
    if (!sym.name) continue;
    const subtokens = extractSubtokens(sym.name);
    const pathSubtokens = sym.path ? extractSubtokens(sym.path.replace(/\.[^.]+$/u, '')) : [];
    const docTokens = extractDocTokens(sym.docComment);

    let score = 0;
    score += scoreTokenGroup(subtokens, words, stems, domainAliases, idfWeights, 3, 2).total;
    if (exactSymbolNameMatch(sym.name, words, domainAliases)) score += 5;
    score += scoreTokenGroup(pathSubtokens, words, stems, domainAliases, idfWeights, 2, 1).total;

    if (sym.exported && score > 0) score += 3;

    if (targetPrefixes && targetPrefixes.size > 0 && score > 0) {
      const pfxLen = getLongestMatchingPrefixLength(sym.path, targetPrefixes);
      if (pfxLen > 0) score += Math.min(Math.floor(pfxLen / 4), 10);
    }

    // Regra anti-sequestro: JSDoc só pontua se já houver afinidade estrutural prévia.
    if (score > 0) {
      const docBonus = scoreTokenGroup([...new Set(docTokens)], words, stems, domainAliases, idfWeights, 2, 1).total;
      score += Math.min(docBonus, 6);
    }

    if (sym.docComment && sym.docComment.includes('@deprecated')) score -= 5;
    if (sym.path.includes('/legacy/') || sym.path.includes('deprecated_') || sym.path.includes('trap')) score -= 5;
    if (sym.path.includes('/tests/') || sym.path.includes('.test.') || sym.path.includes('.spec.')) score -= 5;
    if (sym.path.includes('/scripts/') || sym.path.includes('/benchmarks/')) score -= 5;

    if (score > 0) scored.push({ path: sym.path, line: sym.startLine, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

function computeSymbolAffinity(sym, words, stems, entrypoints, idfWeights = new Map(), domainAliases = {}, targetPrefixes = new Set()) {
  let score = 100;
  if (sym.docComment && sym.docComment.includes('@deprecated')) score -= 300;
  if (sym.path.includes('/legacy/') || sym.path.includes('deprecated_') || sym.path.includes('trap')) score -= 200;
  if (sym.path.includes('/tests/') || sym.path.includes('.test.') || sym.path.includes('.spec.')) score -= 200;
  if (sym.path.includes('/scripts/') || sym.path.includes('/benchmarks/')) score -= 200;
  if (entrypoints.includes(sym.path)) score += 200;
  if (sym.exported) score += 50;

  const subtokens = extractSubtokens(sym.name);
  const pathSubtokens = sym.path ? extractSubtokens(sym.path.replace(/\.[^.]+$/u, '')) : [];
  const docTokens = extractDocTokens(sym.docComment);

  const subRes = scoreTokenGroup(subtokens, words, stems, domainAliases, idfWeights, 30, 20);
  let matchScore = subRes.total;
  let structuralMatch = subRes.matched;

  if (exactSymbolNameMatch(sym.name, words, domainAliases)) {
    matchScore += 40;
    structuralMatch = true;
  }

  const pathRes = scoreTokenGroup(pathSubtokens, words, stems, domainAliases, idfWeights, 15, 10);
  matchScore += pathRes.total;
  structuralMatch = structuralMatch || pathRes.matched;

  if (structuralMatch) {
    matchScore += scoreTokenGroup(docTokens, words, stems, domainAliases, idfWeights, 10, 5).total;
  }

  if (targetPrefixes && targetPrefixes.size > 0) {
    const pfxLen = getLongestMatchingPrefixLength(sym.path, targetPrefixes);
    if (pfxLen > 0) score += Math.min(Math.floor(pfxLen / 4), 10) * 10;
  }
  return score + matchScore * 10;
}

export function prioritizeWorkspaceSkeleton(skeleton, intent, entrypoints = [], maxPromptSymbols = 512, domainAliases = {}, targetPrefixes = new Set(), precomputedIdf = null) {
  if (!skeleton || !Array.isArray(skeleton.symbols)) return skeleton;
  const stripped = stripDiacritics(intent ?? '');
  const rawWords = stripped.split(/[^a-z0-9_$-]+/i).filter((w) => w.length >= 3);
  const words = rawWords.filter((w) => !ignoredDomainTokens.has(w));
  const stems = words.map((w) => (w.length >= 4 ? w.slice(0, 4) : w));

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
  const unsigned = {
    schema: skeleton.schema,
    symbolCount: pruned.length,
    symbols: pruned,
  };
  return {
    ...unsigned,
    digest: canonicalDigest(unsigned),
  };
}

function lineWindow(bytes, targetLine, byteLimit) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = text.split('\n');
  const target = Math.min(Math.max(targetLine - 1, 0), lines.length - 1);
  let start = target;
  let end = target + 1;
  let content = lines[target];
  while (start > 0 || end < lines.length) {
    const nextStart = start > 0 ? start - 1 : start;
    const nextEnd = end < lines.length ? end + 1 : end;
    const candidate = lines.slice(nextStart, nextEnd).join('\n');
    if (Buffer.byteLength(candidate, 'utf8') > byteLimit) break;
    start = nextStart;
    end = nextEnd;
    content = candidate;
  }
  if (Buffer.byteLength(content, 'utf8') > byteLimit) {
    content = decodeUtf8Prefix(Buffer.from(content), byteLimit);
  }
  return { content, startLine: start + 1, endLine: end };
}

function extractAnchoredWindows(fileLines, headerEndLine, orderedTargetLines, byteLimit) {
  if (byteLimit <= 0 || fileLines.length === 0) return [];
  const minLine = headerEndLine > 0 ? headerEndLine + 1 : 1;

  const anchors = [];
  for (const line of orderedTargetLines) {
    if (line < minLine) continue;
    if (anchors.some((a) => Math.abs(a - line) < 25)) continue;
    anchors.push(line);
    if (anchors.length >= 3) break;
  }
  if (anchors.length === 0 && orderedTargetLines.length > 0) {
    anchors.push(Math.max(minLine, orderedTargetLines[0]));
  }
  if (anchors.length === 0) return [];

  const sliceBudget = Math.floor(byteLimit / anchors.length);
  const rawIntervals = [];
  for (const anchor of anchors) {
    const target = Math.min(Math.max(anchor - 1, minLine - 1), fileLines.length - 1);
    let start = target;
    let end = target + 1;
    let content = fileLines[target];
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
      rawIntervals.push({ start: target, end: target + 1 });
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

export function buildSourceEvidence(
  repositoryRoot,
  preflight,
  workspaceObservation = null,
  explicitTargetPaths = [],
  contextData = null,
) {
  const domainAliases = contextData?.domainAliases ?? loadDomainLexicon(repositoryRoot);
  const textFiles = preflight.discovery.files.filter(({ kind }) => kind === 'UTF8_TEXT');
  const filesByPath = new Map(textFiles.map((file) => [file.path, file]));
  const smallWorkspace = textFiles.reduce((total, { bytes }) => total + bytes, 0)
    <= sourceEvidenceByteLimit;
  const entrypoints = textFiles.map(({ path }) => path)
    .filter((path) => /(?:^|\/)(?:index|main|__main__|mod|entrypoint|run|app)\.[^/]+$/iu.test(path));

  const selectionsByPath = new Map();
  let explicitFilePaths = [];
  if (smallWorkspace) {
    for (const { path } of textFiles) {
      selectionsByPath.set(path, { path, lines: [] });
    }
  } else {
    let targetDirs;
    let targetPrefixes;

    if (contextData?.targetDirs && contextData?.targetPrefixes && contextData?.explicitFilePaths) {
      targetDirs = new Set(contextData.targetDirs);
      targetPrefixes = new Set(contextData.targetPrefixes);
      explicitFilePaths = contextData.explicitFilePaths;
    } else {
      const knownSubdirs = new Set();
      for (const file of textFiles) {
        const parts = file.path.split('/');
        if (parts.length > 2) knownSubdirs.add(parts[1]);
      }
      const extracted = extractTargetPrefixesAndDirs(
        preflight.intent,
        knownSubdirs,
        domainAliases,
      );
      targetDirs = extracted.targetDirs;
      targetPrefixes = extracted.targetPrefixes;
      explicitFilePaths = extracted.explicitFilePaths;
    }

    const injectSelection = (p) => {
      if (filesByPath.has(p) && !selectionsByPath.has(p)) {
        const symbolLines = (preflight.discovery.workspaceSkeleton?.symbols ?? [])
          .filter((s) => s.path === p && typeof s.startLine === 'number')
          .map((s) => s.startLine);
        selectionsByPath.set(p, { path: p, lines: symbolLines });
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
            if (parentDir && parentDir !== 'src/') targetPrefixes.add(parentDir);
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

    if (preflight.discovery.workspaceSkeleton?.symbols) {
      const matched = matchSkeletonSymbols(
        preflight.discovery.workspaceSkeleton.symbols,
        preflight.intent ?? '',
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

      for (const { path, line, score } of matched) {
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
        selectionsByPath.get(path).lines.push(line);
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
        trust: 'UNTRUSTED_EVIDENCE_NOT_INSTRUCTIONS',
      });
    } else {
      const orderedLines = [...new Set(lines)];
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const fileLines = text.split('\n');
      const headerEndLine = findStructuralHeaderEndLine(manifestEntry.path, text);

      if (headerEndLine > 0 && orderedLines.some((l) => l > headerEndLine + 5)) {
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
          trust: 'UNTRUSTED_EVIDENCE_NOT_INSTRUCTIONS',
        });

        const windowBudget = Math.min(limit - consumedHeader, remainingBytes);
        if (windowBudget > 0) {
          const windows = extractAnchoredWindows(fileLines, headerEndLine, orderedLines, windowBudget);
          for (const windowExcerpt of windows) {
            const consumedWindow = Buffer.byteLength(windowExcerpt.content, 'utf8');
            remainingBytes -= consumedWindow;
            evidence.push({
              path,
              ...windowExcerpt,
              truncated: true,
              selection: 'LEXICAL_WINDOW',
              trust: 'UNTRUSTED_EVIDENCE_NOT_INSTRUCTIONS',
            });
          }
        }
      } else {
        const windows = extractAnchoredWindows(fileLines, 0, orderedLines, limit);
        if (windows.length > 0) {
          for (const windowExcerpt of windows) {
            const consumedBytes = Buffer.byteLength(windowExcerpt.content, 'utf8');
            remainingBytes -= consumedBytes;
            evidence.push({
              path,
              ...windowExcerpt,
              truncated: consumedBytes < bytes.byteLength,
              selection: 'LEXICAL_WINDOW',
              trust: 'UNTRUSTED_EVIDENCE_NOT_INSTRUCTIONS',
            });
          }
        } else {
          const excerpt = lineWindow(bytes, orderedLines[0], limit);
          const consumedBytes = Buffer.byteLength(excerpt.content, 'utf8');
          remainingBytes -= consumedBytes;
          evidence.push({
            path,
            ...excerpt,
            truncated: consumedBytes < bytes.byteLength,
            selection: 'LEXICAL_WINDOW',
            trust: 'UNTRUSTED_EVIDENCE_NOT_INSTRUCTIONS',
          });
        }
      }
    }
  }
  return evidence;
}


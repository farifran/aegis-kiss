import { Buffer } from 'node:buffer';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import { canonicalDigest, compareCodeUnits, sha256 } from './canonical_json.mjs';
import { buildIntentEvidence } from './intent_evidence.mjs';
import { assertSchema } from './schema_validator.mjs';
import { buildSemanticOutputSchema } from './semantic_output_schema.mjs';
import {
  sourceEvidenceByteLimit,
  sourceEvidenceFileByteLimit,
} from './semantic_authority.mjs';
import { extractFileSymbols } from './workspace_skeleton.mjs';

export function loadSemanticConstitution(repositoryRoot) {
  const policyPath = resolve(repositoryRoot, 'governance/constitution.json');
  const policyMetadata = lstatSync(policyPath);
  if (!policyMetadata.isFile() || policyMetadata.isSymbolicLink()) {
    throw new Error('semantic_constitution_unavailable');
  }
  let policy;
  try {
    policy = JSON.parse(readFileSync(policyPath, 'utf8'));
  } catch {
    throw new Error('semantic_constitution_invalid_json');
  }
  assertSchema('aegis.constitution.v1', policy);
  const sourcePath = resolve(repositoryRoot, policy.origin.sourcePath);
  const sourceMetadata = lstatSync(sourcePath);
  if (!sourceMetadata.isFile() || sourceMetadata.isSymbolicLink()) {
    throw new Error('semantic_constitution_origin_unavailable');
  }
  const sourceBytes = readFileSync(sourcePath);
  if (sha256(sourceBytes) !== policy.origin.sourceDigest) {
    throw new Error('semantic_constitution_origin_mismatch');
  }
  const rules = sourceBytes
    .toString('utf8')
    .trim()
    .split(/^## /mu)
    .slice(1)
    .map((section) => {
      const [heading, ...body] = section.split('\n');
      const match = heading.match(/\((CONST-[A-Z0-9][A-Z0-9-]+)\)\s*$/u);
      const statement = body.join('\n').trim();
      if (!match || !statement) throw new Error('semantic_constitution_invalid_rules');
      return { id: match[1], statement };
    });
  if (rules.length === 0) throw new Error('semantic_constitution_invalid_rules');
  return {
    schema: policy.schema,
    version: policy.constitutionVersion,
    digest: canonicalDigest({ ...policy, rules }),
    authority: 'TRUSTED_CONSTITUTION',
    rules,
  };
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

function stripDiacritics(text) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
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

const ignoredDomainTokens = new Set(['src', 'source', 'root', 'code', 'file', 'files']);

export function loadDomainLexicon(repositoryRoot) {
  if (!repositoryRoot) return {};
  const candidatePaths = [
    resolve(repositoryRoot, '.harness/domain-lexicon.json'),
    resolve(repositoryRoot, '.harness/config/lexicon.json'),
  ];
  for (const p of candidatePaths) {
    if (existsSync(p)) {
      try {
        const raw = readFileSync(p, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const normalized = {};
          for (const [k, v] of Object.entries(parsed)) {
            normalized[stripDiacritics(k)] = v;
          }
          return normalized;
        }
      } catch {
        // Ignora erros de leitura/parsing e preserva determinismo
      }
    }
  }
  return {};
}

function getAliases(domainAliases, word) {
  if (!domainAliases) return [];
  const val = domainAliases[word];
  if (!val) return [];
  if (Array.isArray(val)) return val.map((v) => stripDiacritics(String(v)));
  return [stripDiacritics(String(val))];
}

function matchSkeletonSymbols(symbols, intent, domainAliases = {}) {
  const stripped = stripDiacritics(intent);
  const rawWords = stripped.split(/[^a-z0-9_$-]+/i).filter((w) => w.length >= 3);
  const words = rawWords.filter((w) => !ignoredDomainTokens.has(w));
  if (words.length === 0) return [];
  const stems = words.map((w) => (w.length >= 4 ? w.slice(0, 4) : w));

  // Cálculo determinístico de especificidade de termos (IDF inverso para suprimir ruído ubíquo em monorepos)
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
      const tStem = t.length >= 4 ? t.slice(0, 4) : t;
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

  // Pesos IDF: termos raros (específicos de domínio) ganham multiplicador alto; termos ubíquos (ruído) são atenuados
  const idfWeights = new Map();
  for (const w of words) {
    const fileCount = docFreqByWord.get(w).size;
    if (fileCount === 0) {
      idfWeights.set(w, 1.0);
    } else {
      // Razão de frequência: termos presentes em > 10% dos arquivos têm peso reduzido
      const ratio = fileCount / totalFiles;
      if (ratio > 0.08) {
        idfWeights.set(w, 0.2); // Termo comum / ubíquo em monorepo (ex: event, state, account)
      } else if (ratio < 0.03) {
        idfWeights.set(w, 4.0); // Termo altamente distintivo de domínio específico (ex: liquidacao, settlement, velocity)
      } else {
        idfWeights.set(w, 1.5);
      }
    }
  }

  const scored = [];
  for (const sym of symbols) {
    if (!sym.name) continue;
    const subtokens = extractSubtokens(sym.name);
    const pathSubtokens = sym.path ? extractSubtokens(sym.path.replace(/\.[^.]+$/u, '')) : [];
    const docTokens = (sym.docComment && !sym.docComment.includes('@deprecated'))
      ? stripDiacritics(sym.docComment.replace(/[*#/\\@{}]/gu, ' '))
          .split(/[^a-z0-9_$-]+/i)
          .filter((w) => w.length >= 3 && !['param', 'returns', 'return', 'type', 'const', 'export'].includes(w))
      : [];

    let score = 0;
    // 1. Symbol name matching (highest weight, ponderado por IDF e aliases de domínio)
    for (const sub of subtokens) {
      if (ignoredDomainTokens.has(sub)) continue;
      const subStem = sub.length >= 4 ? sub.slice(0, 4) : sub;
      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const stem = stems[i];
        const aliases = getAliases(domainAliases, word);
        const weight = idfWeights.get(word) ?? 1.0;
        let matchedAlias = false;
        for (const a of aliases) {
          const aStem = a.length >= 4 ? a.slice(0, 4) : a;
          if (sub === a) {
            score += 3 * weight;
            matchedAlias = true;
            break;
          } else if (aStem.length >= 4 && (sub.startsWith(aStem) || a.startsWith(subStem))) {
            score += 2 * weight;
            matchedAlias = true;
            break;
          }
        }
        if (!matchedAlias) {
          if (sub === word) {
            score += 3 * weight;
          } else if (stem.length >= 4 && (sub.startsWith(stem) || word.startsWith(subStem))) {
            score += 2 * weight;
          }
        }
      }
    }
    const normalizedSymName = stripDiacritics(sym.name);
    if (words.includes(normalizedSymName)) {
      score += 5;
    } else {
      for (let i = 0; i < words.length; i++) {
        const aliases = getAliases(domainAliases, words[i]);
        if (aliases.includes(normalizedSymName)) {
          score += 5;
          break;
        }
      }
    }

    // 2. Path subtokens matching (module and directory affinity, ponderado por IDF e aliases de domínio)
    for (const pSub of pathSubtokens) {
      if (ignoredDomainTokens.has(pSub)) continue;
      const pStem = pSub.length >= 4 ? pSub.slice(0, 4) : pSub;
      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const stem = stems[i];
        const aliases = getAliases(domainAliases, word);
        const weight = idfWeights.get(word) ?? 1.0;
        let matchedAlias = false;
        for (const a of aliases) {
          const aStem = a.length >= 4 ? a.slice(0, 4) : a;
          if (pSub === a) {
            score += 2 * weight;
            matchedAlias = true;
            break;
          } else if (aStem.length >= 4 && (pSub.startsWith(aStem) || a.startsWith(pStem))) {
            score += 1 * weight;
            matchedAlias = true;
            break;
          }
        }
        if (!matchedAlias) {
          if (pSub === word) {
            score += 2 * weight;
          } else if (stem.length >= 4 && (pSub.startsWith(stem) || word.startsWith(pStem))) {
            score += 1 * weight;
          }
        }
      }
    }

    // Priorização de superfície observável pública (exports)
    if (sym.exported && score > 0) {
      score += 3;
    }

    // 3. JSDoc documentation comment matching (REGRA ANTI-SEQUESTRO DE DOCCOMMENT)
    // Comentários JSDoc são auxiliares para desempate estrutural;
    // se o símbolo não tem NENHUMA afinidade nominal nem de path (score === 0), o comentário não pode sequestrar a relevância.
    if (score > 0) {
      let docBonus = 0;
      const uniqueDocTokens = new Set(docTokens);
      for (const dToken of uniqueDocTokens) {
        const dStem = dToken.length >= 4 ? dToken.slice(0, 4) : dToken;
        for (let i = 0; i < words.length; i++) {
          const word = words[i];
          const stem = stems[i];
          const aliases = getAliases(domainAliases, word);
          const weight = idfWeights.get(word) ?? 1.0;
          let matchedAlias = false;
          for (const a of aliases) {
            const aStem = a.length >= 4 ? a.slice(0, 4) : a;
            if (dToken === a) {
              docBonus += 2 * weight;
              matchedAlias = true;
              break;
            } else if (aStem.length >= 4 && (dToken.startsWith(aStem) || a.startsWith(dStem))) {
              docBonus += 1 * weight;
              matchedAlias = true;
              break;
            }
          }
          if (!matchedAlias) {
            if (dToken === word) {
              docBonus += 2 * weight;
            } else if (stem.length >= 4 && (dToken.startsWith(stem) || word.startsWith(dStem))) {
              docBonus += 1 * weight;
            }
          }
        }
      }
      // Teto de contribuição de docComment por símbolo para preservar a dominância estrutural de nome e path
      score += Math.min(docBonus, 6);
    }

    // 4. Penalização de código legado, deprecado, testes e scripts internos
    if (sym.docComment && sym.docComment.includes('@deprecated')) {
      score -= 5;
    }
    if (sym.path.includes('/legacy/') || sym.path.includes('deprecated_') || sym.path.includes('trap')) {
      score -= 5;
    }
    if (sym.path.includes('/tests/') || sym.path.includes('.test.') || sym.path.includes('.spec.')) {
      score -= 5;
    }
    if (sym.path.includes('/scripts/') || sym.path.includes('/benchmarks/')) {
      score -= 5;
    }

    if (score > 0) {
      scored.push({ path: sym.path, line: sym.startLine, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

function computeSymbolAffinity(sym, words, stems, entrypoints, idfWeights = new Map(), domainAliases = {}) {
  let score = 100;
  if (sym.docComment && sym.docComment.includes('@deprecated')) score -= 300;
  if (sym.path.includes('/legacy/') || sym.path.includes('deprecated_') || sym.path.includes('trap')) score -= 200;
  if (sym.path.includes('/tests/') || sym.path.includes('.test.') || sym.path.includes('.spec.')) score -= 200;
  if (sym.path.includes('/scripts/') || sym.path.includes('/benchmarks/')) score -= 200;
  if (entrypoints.includes(sym.path)) score += 200;
  if (sym.exported) score += 50;

  const subtokens = extractSubtokens(sym.name);
  const pathSubtokens = sym.path ? extractSubtokens(sym.path.replace(/\.[^.]+$/u, '')) : [];
  const docTokens = (sym.docComment && !sym.docComment.includes('@deprecated'))
    ? stripDiacritics(sym.docComment.replace(/[*#/\\@{}]/gu, ' '))
        .split(/[^a-z0-9_$-]+/i)
        .filter((w) => w.length >= 3 && !['param', 'returns', 'return', 'type', 'const', 'export'].includes(w))
    : [];

  let matchScore = 0;
  let structuralMatch = false;
  for (const sub of subtokens) {
    if (ignoredDomainTokens.has(sub)) continue;
    const subStem = sub.length >= 4 ? sub.slice(0, 4) : sub;
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const stem = stems[i];
      const aliases = getAliases(domainAliases, word);
      const weight = idfWeights.get(word) ?? 1.0;
      let matchedAlias = false;
      for (const a of aliases) {
        const aStem = a.length >= 4 ? a.slice(0, 4) : a;
        if (sub === a) {
          matchScore += 30 * weight;
          structuralMatch = true;
          matchedAlias = true;
          break;
        } else if (aStem.length >= 4 && (sub.startsWith(aStem) || a.startsWith(subStem))) {
          matchScore += 20 * weight;
          structuralMatch = true;
          matchedAlias = true;
          break;
        }
      }
      if (!matchedAlias) {
        if (sub === word) {
          matchScore += 30 * weight;
          structuralMatch = true;
        } else if (stem.length >= 4 && (sub.startsWith(stem) || word.startsWith(subStem))) {
          matchScore += 20 * weight;
          structuralMatch = true;
        }
      }
    }
  }
  const normalizedSymName = stripDiacritics(sym.name);
  if (words.includes(normalizedSymName)) {
    matchScore += 40;
    structuralMatch = true;
  } else {
    for (let i = 0; i < words.length; i++) {
      const aliases = getAliases(domainAliases, words[i]);
      if (aliases.includes(normalizedSymName)) {
        matchScore += 40;
        structuralMatch = true;
        break;
      }
    }
  }
  for (const pSub of pathSubtokens) {
    if (ignoredDomainTokens.has(pSub)) continue;
    const pStem = pSub.length >= 4 ? pSub.slice(0, 4) : pSub;
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const stem = stems[i];
      const aliases = getAliases(domainAliases, word);
      const weight = idfWeights.get(word) ?? 1.0;
      let matchedAlias = false;
      for (const a of aliases) {
        const aStem = a.length >= 4 ? a.slice(0, 4) : a;
        if (pSub === a) {
          matchScore += 15 * weight;
          structuralMatch = true;
          matchedAlias = true;
          break;
        } else if (aStem.length >= 4 && (pSub.startsWith(aStem) || a.startsWith(pStem))) {
          matchScore += 10 * weight;
          structuralMatch = true;
          matchedAlias = true;
          break;
        }
      }
      if (!matchedAlias) {
        if (pSub === word) {
          matchScore += 15 * weight;
          structuralMatch = true;
        } else if (stem.length >= 4 && (pSub.startsWith(stem) || word.startsWith(pStem))) {
          matchScore += 10 * weight;
          structuralMatch = true;
        }
      }
    }
  }
  if (structuralMatch) {
    for (const dToken of docTokens) {
      const dStem = dToken.length >= 4 ? dToken.slice(0, 4) : dToken;
      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const stem = stems[i];
        const aliases = getAliases(domainAliases, word);
        const weight = idfWeights.get(word) ?? 1.0;
        let matchedAlias = false;
        for (const a of aliases) {
          const aStem = a.length >= 4 ? a.slice(0, 4) : a;
          if (dToken === a) {
            matchScore += 10 * weight;
            matchedAlias = true;
            break;
          } else if (aStem.length >= 4 && (dToken.startsWith(aStem) || a.startsWith(dStem))) {
            matchScore += 5 * weight;
            matchedAlias = true;
            break;
          }
        }
        if (!matchedAlias) {
          if (dToken === word) matchScore += 10 * weight;
          else if (stem.length >= 4 && (dToken.startsWith(stem) || word.startsWith(dStem))) matchScore += 5 * weight;
        }
      }
    }
  }
  return score + matchScore * 10;
}

function prioritizeWorkspaceSkeleton(skeleton, intent, entrypoints = [], maxPromptSymbols = 512, domainAliases = {}) {
  if (!skeleton || !Array.isArray(skeleton.symbols)) return skeleton;
  const stripped = stripDiacritics(intent ?? '');
  const rawWords = stripped.split(/[^a-z0-9_$-]+/i).filter((w) => w.length >= 3);
  const words = rawWords.filter((w) => !ignoredDomainTokens.has(w));
  const stems = words.map((w) => (w.length >= 4 ? w.slice(0, 4) : w));

  const allPaths = new Set(skeleton.symbols.map((s) => s.path));
  const totalFiles = Math.max(allPaths.size, 1);
  const docFreqByWord = new Map();
  for (const w of words) docFreqByWord.set(w, new Set());

  for (const sym of skeleton.symbols) {
    const tokens = [
      ...extractSubtokens(sym.name),
      ...(sym.path ? extractSubtokens(sym.path.replace(/\.[^.]+$/u, '')) : []),
      ...((sym.docComment && !sym.docComment.includes('@deprecated'))
        ? stripDiacritics(sym.docComment.replace(/[*#/\\@{}]/gu, ' ')).split(/[^a-z0-9_$-]+/i).filter((t) => t.length >= 3)
        : []),
    ];
    for (const t of tokens) {
      const tStem = t.length >= 4 ? t.slice(0, 4) : t;
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
      if (ratio > 0.08) idfWeights.set(w, 0.2);
      else if (ratio < 0.03) idfWeights.set(w, 4.0);
      else idfWeights.set(w, 1.5);
    }
  }

  const sorted = [...skeleton.symbols].sort((a, b) => {
    const affinityA = computeSymbolAffinity(a, words, stems, entrypoints, idfWeights, domainAliases);
    const affinityB = computeSymbolAffinity(b, words, stems, entrypoints, idfWeights, domainAliases);
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

function buildSourceEvidence(repositoryRoot, preflight, workspaceObservation = null, explicitTargetPaths = []) {
  const domainAliases = loadDomainLexicon(repositoryRoot);
  const textFiles = preflight.discovery.files.filter(({ kind }) => kind === 'UTF8_TEXT');
  const filesByPath = new Map(textFiles.map((file) => [file.path, file]));
  const smallWorkspace = textFiles.reduce((total, { bytes }) => total + bytes, 0)
    <= sourceEvidenceByteLimit;
  const entrypoints = textFiles.map(({ path }) => path)
    .filter((path) => /(?:^|\/)(?:index|main|__main__|mod|entrypoint|run|app)\.[^/]+$/iu.test(path));

  const selectionsByPath = new Map();
  if (smallWorkspace) {
    for (const { path } of textFiles) {
      selectionsByPath.set(path, { path, lines: [] });
    }
  } else {
    // 0. Extract explicit target directories from intent
    const intentText = preflight.intent ?? '';
    const strippedIntent = stripDiacritics(intentText);
    const intentWords = strippedIntent.split(/[^a-z0-9_$-]+/i).filter((w) => w.length >= 3);
    const pathMatches = intentText.match(/(?:^|\s|`|'|")(src\/[a-zA-Z0-9_-]+)(?:\/[a-zA-Z0-9_.-]+)?/gu) || [];
    const targetDirs = new Set(pathMatches.map((m) => m.replace(/[`'"]/gu, '').trim().split('/')[1]).filter(Boolean));

    // 0.1 Injeção Prioritária (Prioridade 0): Arquivos de código explicitamente citados na demanda humana
    const explicitFileMatches = intentText.match(/\b(?:src|test|tests)\/(?!\.\.(?:\/|$))[^\s`'"<>()[\]{}]+/gu) || [];
    const explicitFilePaths = explicitFileMatches.map((m) => m.replace(/[.,;:!?]+$/u, '').trim()).filter(Boolean);
    for (const p of explicitFilePaths) {
      if (filesByPath.has(p)) {
        if (!selectionsByPath.has(p)) {
          const symbolLines = (preflight.discovery.workspaceSkeleton?.symbols ?? [])
            .filter((s) => s.path === p && typeof s.startLine === 'number')
            .map((s) => s.startLine);
          selectionsByPath.set(p, { path: p, lines: symbolLines });
        }
        const parts = p.split('/');
        if (parts.length > 2) targetDirs.add(parts[1]);
      }
    }

    // Se houver caminhos explicitamente fornecidos (ex: Scout Semântico validado), adiciona imediatamente
    if (Array.isArray(explicitTargetPaths) && explicitTargetPaths.length > 0) {
      for (const p of explicitTargetPaths) {
        if (filesByPath.has(p)) {
          if (!selectionsByPath.has(p)) {
            // Busca símbolos reais do arquivo no workspaceSkeleton para popular linhas representativas
            const symbolLines = (preflight.discovery.workspaceSkeleton?.symbols ?? [])
              .filter((s) => s.path === p && typeof s.startLine === 'number')
              .map((s) => s.startLine);
            selectionsByPath.set(p, { path: p, lines: symbolLines });
          }
          const parts = p.split('/');
          if (parts.length > 2) targetDirs.add(parts[1]);
        }
      }
    }

    const knownSubdirs = new Set();
    for (const file of textFiles) {
      const parts = file.path.split('/');
      if (parts.length > 2) knownSubdirs.add(parts[1]);
    }
    for (const word of intentWords) {
      if (knownSubdirs.has(word) && !ignoredDomainTokens.has(word)) targetDirs.add(word);
      const aliases = getAliases(domainAliases, word);
      for (const a of aliases) {
        if (knownSubdirs.has(a) && !ignoredDomainTokens.has(a)) targetDirs.add(a);
      }
    }

    // Filtrar entrypoints para apenas a raiz do repositório (ex: src/index.ts) ou do módulo alvo
    const rootOrTargetEntrypoints = entrypoints.filter((path) => {
      const parts = path.split('/');
      if (parts.length <= 2) return true; // entrypoint raiz (src/index.ts, src/app.ts)
      if (targetDirs.size > 0 && targetDirs.has(parts[1])) return true; // entrypoint do módulo alvo
      return false;
    });

    // 1. Prioritize symbols from workspaceSkeleton matched via subtokens and stems with residual cutoff
    if (preflight.discovery.workspaceSkeleton?.symbols) {
      const matched = matchSkeletonSymbols(preflight.discovery.workspaceSkeleton.symbols, intentText, domainAliases);
      const topScore = matched.length > 0 ? matched[0].score : 0;

      // Cálculo de pontuação de topo por diretório para garantia de piso multi-módulo
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

      // Estimativa de bytes dos arquivos candidatos para corte sensível à pressão de cota
      const candidatePaths = new Set();
      let estimatedCandidateBytes = 0;
      for (const { path, score } of matched) {
        if (score >= 2.0 && !candidatePaths.has(path)) {
          candidatePaths.add(path);
          const file = filesByPath.get(path);
          if (file) estimatedCandidateBytes += file.bytes;
        }
      }
      const underBudgetPressure = estimatedCandidateBytes > sourceEvidenceByteLimit;

      for (const { path, line, score } of matched) {
        const parts = path.split('/');
        const dir = parts.length > 2 ? parts[1] : '';

        // Se targetDirs foi explicitamente declarado pelo usuário ou inferido via léxico, restringe aos diretórios autorizados
        if (targetDirs.size > 0) {
          const inTarget = dir ? targetDirs.has(dir) : true;
          if (!inTarget) continue; // Descarta contaminação de módulos alheios ao escopo autorizado
        }

        // Garantia de piso para cada módulo autorizado: o melhor símbolo de cada targetDir nunca é descartado
        const isTopForTargetDir = dir && targetDirs.has(dir) && bestSymbolByDir.get(dir)?.path === path && bestSymbolByDir.get(dir)?.line === line;

        if (!isTopForTargetDir) {
          if (underBudgetPressure) {
            // Sob pressão de cota: threshold relativo ao pico do módulo (ou global se targetDirs vazio)
            const dirTop = (dir && targetDirs.has(dir) && topScoreByDir.get(dir)) ? topScoreByDir.get(dir) : topScore;
            const residualThreshold = dirTop >= 6.0 ? Math.max(3.0, dirTop * 0.4) : 1.0;
            if (score < residualThreshold) continue;
          } else {
            // Sem pressão de cota: preserva arquivos com relevância moderada, descartando apenas ruído de fundo (< 2.0)
            if (score < 2.0) continue;
          }
        }

        if (!selectionsByPath.has(path)) {
          selectionsByPath.set(path, { path, lines: [] });
        }
        selectionsByPath.get(path).lines.push(line);
      }
    }

    // 2. Directory anchor fallback for new or unmatched sibling files
    if (targetDirs.size > 0) {
      // Prioritize executable code files (.ts, .js) over docs/config (.md, .yml, dotfiles)
      const candidateFiles = textFiles.filter((file) => {
        const parts = file.path.split('/');
        return parts.length > 2 && targetDirs.has(parts[1]);
      }).sort((a, b) => {
        const aIsCode = /\.(?:ts|tsx|js|jsx|mjs|cjs|py|sh)$/u.test(a.path);
        const bIsCode = /\.(?:ts|tsx|js|jsx|mjs|cjs|py|sh)$/u.test(b.path);
        if (aIsCode && !bIsCode) return -1;
        if (!aIsCode && bIsCode) return 1;
        return compareCodeUnits(a.path, b.path);
      });

      for (const file of candidateFiles) {
        // Só inclui arquivos de código reais (.ts, .js) como fallback de irmãos
        if (/\.(?:ts|tsx|js|jsx|mjs|cjs|py|sh)$/u.test(file.path)) {
          if (!selectionsByPath.has(file.path)) {
            selectionsByPath.set(file.path, { path: file.path, lines: [] });
          }
        }
      }
    }

    // 4. Entrypoints
    for (const entrypoint of rootOrTargetEntrypoints) {
      if (!selectionsByPath.has(entrypoint)) {
        selectionsByPath.set(entrypoint, { path: entrypoint, lines: [] });
      }
    }
    // 5. Default to first text file if still empty
    if (selectionsByPath.size === 0 && textFiles[0] !== undefined) {
      selectionsByPath.set(textFiles[0].path, { path: textFiles[0].path, lines: [] });
    }
  }

  const evidence = [];
  let remainingBytes = sourceEvidenceByteLimit;
  for (const { path, lines } of selectionsByPath.values()) {
    if (remainingBytes <= 0) break;
    const manifestEntry = filesByPath.get(path);
    if (manifestEntry === undefined) continue;
    const bytes = verifiedTextSource(repositoryRoot, manifestEntry, workspaceObservation);
    const limit = Math.min(smallWorkspace ? bytes.byteLength : sourceEvidenceFileByteLimit, Math.max(0, remainingBytes));
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
      const sortedLines = [...lines].sort((a, b) => a - b);
      const medianLine = sortedLines[Math.floor(sortedLines.length / 2)];
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const fileLines = text.split('\n');
      const headerEndLine = findStructuralHeaderEndLine(manifestEntry.path, text);

      if (headerEndLine > 0 && medianLine > headerEndLine + 5) {
        // Reserva os primeiros bytes para incluir o cabeçalho estrutural
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
          const windowExcerpt = lineWindow(bytes, medianLine, windowBudget);
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
      } else {
        const excerpt = lineWindow(bytes, medianLine, limit);
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
  return evidence;
}

export function buildSemanticRequest({
  repositoryRoot,
  preflight,
  policy,
  constitution,
  revision = null,
  workspaceObservation = null,
  explicitTargetPaths = [],
}) {
  const intentEvidence = buildIntentEvidence(preflight.intent);
  const textFiles = preflight.discovery.files.filter(({ kind }) => kind === 'UTF8_TEXT');
  const entrypoints = textFiles.map(({ path }) => path)
    .filter((path) => /(?:^|\/)(?:index|main|__main__|mod|entrypoint|run|app)\.[^/]+$/iu.test(path));
  const domainAliases = loadDomainLexicon(repositoryRoot);
  const prioritizedSkeleton = preflight.discovery.workspaceSkeleton
    ? prioritizeWorkspaceSkeleton(
        preflight.discovery.workspaceSkeleton,
        preflight.intent,
        entrypoints,
        512,
        domainAliases,
      )
    : undefined;
  const observedTextPaths = textFiles.map(({ path }) => path);
  const unavailablePaths = [
    ...preflight.discovery.files.filter(({ kind }) => kind !== 'UTF8_TEXT')
      .map(({ path, kind }) => ({ path, reason: kind })),
    ...preflight.discovery.ignoredEntries,
  ];
  const context = {
    delivery: {
      constitution: 'SYSTEM_INSTRUCTION',
      architecture: 'TRUSTED_POLICY',
      intent: 'USER_DATA',
      intentEvidence: 'MECHANICAL_FACTS_NOT_SEMANTIC_VERDICTS',
      workspace: 'UNTRUSTED_EVIDENCE',
      revision: 'USER_DECISION',
      outputSchema: 'STRICT_STRUCTURED_OUTPUT',
    },
    constitution,
    intent: preflight.intent,
    intentEvidence,
    workspace: {
      status: preflight.discovery.status,
      observedTextPaths,
      unavailablePaths,
      ...(prioritizedSkeleton
        ? { workspaceSkeleton: prioritizedSkeleton }
        : {}),
      sourceEvidence: buildSourceEvidence(repositoryRoot, preflight, workspaceObservation, explicitTargetPaths),
    },
    policy: {
      contexts: policy.contexts,
      rules: policy.rules.map((rule) => ({
        id: rule.id,
        level: rule.level,
        statement: rule.statement,
        appliesWhen: rule.appliesWhen,
        appliesMode: rule.appliesMode,
      })),
      amendments: (policy.amendments ?? []).map(({ id, ruleId, reason }) => ({ id, ruleId, reason })),
    },
    revision,
  };
  const contextDigest = canonicalDigest(context);
  const outputSchemaDocument = buildSemanticOutputSchema({ hasAmendments: policy.amendments.length > 0 });
  const requestWithoutDigest = {
    schema: 'aegis.semantic_request.v10',
    contextDigest,
    ...context,
    outputSchema: {
      id: 'aegis.semantic_opinion.v3',
      digest: canonicalDigest(outputSchemaDocument),
      strict: true,
      document: outputSchemaDocument,
    },
  };
  const request = { ...requestWithoutDigest, requestDigest: canonicalDigest(requestWithoutDigest) };
  assertSchema('aegis.semantic_request.v10', request);
  return request;
}

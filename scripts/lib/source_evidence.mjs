import { Buffer } from 'node:buffer';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import { compareCodeUnits, sha256 } from './canonical_json.mjs';
import { isProductTestPath, splitRootRelativePath } from './workspace_observer.mjs';
import { extractAstImports } from './workspace_skeleton.mjs';

export const sourceEvidenceByteLimit = 34_816;
const sourceEvidenceFileByteLimit = 4_600;
const sourceEvidenceExplicitFileCap = 10_240;
const sourceEvidenceRegularFileCap = 8_192;
const smallFullBodyThreshold = 5_600;
const maxLargeWorkspaceFiles = 6;

const entrypointPattern = /(?:^|\/)(?:index|main|__main__|mod|entrypoint|run|app)\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|py|sh)$/iu;
const codeFilePattern = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|py|sh|bash)$/iu;
const testHelperPathPattern = /(?:^|\/)(?:tests?|__tests__|__mocks__)\//iu;

export function isEntrypointPath(filePath) {
  return entrypointPattern.test(filePath);
}

// Ponte genérica PT->EN de engenharia de software (.harness/config/lexicon.json estende por projeto).
const genericPtEnAliases = {
  arrastar: ['drag', 'drop'], arrasto: ['drag', 'drop'],
  excluir: ['delete'], exclui: ['delete'], exclusao: ['delete'], deletar: ['delete'],
  autenticacao: ['auth', 'key'], autenticar: ['auth', 'key'],
  sincronizacao: ['sync'], sincronizar: ['sync'],
  persistencia: ['persist'], persistir: ['persist'], conflito: ['conflict'],
  relatorio: ['analysis'], relatorios: ['analysis'], analise: ['analysis'],
  erro: ['error'], erros: ['error'], falha: ['error'],
  chave: ['key'], chaves: ['key'], relogio: ['clock'],
  horario: ['schedule'], horarios: ['schedule'], agendamento: ['schedule'],
  acessibilidade: ['aria', 'inert', 'focus'],
  criptografia: ['crypto', 'encrypt'], criptografar: ['crypto', 'encrypt'], descriptografia: ['decrypt'],
  migracao: ['migrate'], migracoes: ['migrate'], validacao: ['valid'], validar: ['valid'],
  sanitizacao: ['sanitize'], sanitizados: ['sanitize'], arquivo: ['archive'], arquivos: ['archive'],
  nota: ['note'], notas: ['note'], calendario: ['calendar'], grafico: ['chart'],
  modal: ['modal'], modais: ['modal'], alerta: ['confirm', 'warning'], alertas: ['confirm', 'warning'],
  ia: ['ai'], cor: ['color'], cores: ['color'], icone: ['icon'], icones: ['icon'],
  gesto: ['swipe', 'touch'], gestos: ['swipe', 'touch'], emblema: ['badge'], grade: ['grid'],
  marco: ['milestone'], marcos: ['milestone'], cabecalho: ['header'], fila: ['queue'], temporizador: ['timer'],
  idioma: ['lang', 'i18n', 'locale'], idiomas: ['lang', 'i18n', 'locale'],
  traducao: ['translat', 'i18n', 'locale'], traducoes: ['translat', 'i18n', 'locale'],
  requisicao: ['request'], requisicoes: ['request'],
  numero: ['number'], numeros: ['number'], data: ['date'], datas: ['date'],
  formulario: ['form'], busca: ['search'], sessao: ['session'], sessoes: ['session'],
  assinatura: ['signature'], pagina: ['page'], paginas: ['page'],
  rede: ['network'], conexao: ['network', 'online'], binario: ['bit', 'bitmask'],
};

const stopwords = new Set([
  'para', 'com', 'sem', 'sob', 'sobre', 'entre', 'como', 'onde', 'quando', 'enquanto',
  'mais', 'menos', 'cada', 'todo', 'toda', 'todos', 'todas', 'outro', 'outra', 'outros',
  'mesmo', 'mesma', 'mesmos', 'deve', 'devem', 'pode', 'podem', 'sera', 'serao', 'seja', 'sejam',
  'esse', 'essa', 'esses', 'essas', 'desse', 'dessa', 'este', 'esta', 'estes', 'estas', 'isso', 'isto',
  'aquele', 'aquela', 'qual', 'quais', 'pelo', 'pela', 'pelos', 'pelas', 'numa', 'num', 'nos', 'nas', 'dos', 'das',
  'que', 'nao', 'mas', 'nem', 'por', 'uma', 'uns', 'umas', 'seu', 'sua', 'seus', 'suas', 'tem', 'ter', 'ainda', 'alem',
  'fazer', 'gerar', 'criar', 'alterar', 'atualizar', 'atualizem', 'incluir', 'permitir', 'calcular', 'executar', 'usem',
  'garantir', 'investigar', 'projetar', 'corrigir', 'auditar', 'unificar', 'tornar', 'evitar', 'preservar', 'remova',
  'preservando', 'removendo', 'quebrar', 'perder', 'causar', 'causem', 'funcione', 'funcionem', 'exiba', 'aceite',
  'condicao', 'risco', 'regra', 'forma', 'fluxo', 'projeto', 'usuario', 'dispositivo', 'sistema', 'dados', 'aplicativo',
  'existente', 'existentes', 'antigos', 'antigas', 'novas', 'novos', 'grande', 'grandes', 'pesada', 'diretamente', 'via',
  'hoje', 'agora', 'diante', 'apenas', 'somente', 'unico', 'unica', 'antes', 'depois', 'contra', 'apos', 'pos', 'vez',
  'texto', 'plano', 'vazar', 'restaure', 'loop', 'permanente', 'permanentemente', 'silenciosa', 'vestigios',
  'comportamento', 'comparaveis', 'compativeis', 'complexidade', 'consistencia', 'observavel', 'observaveis',
  'rastreaveis', 'falsificaveis', 'pendentes', 'explicita', 'explicitas', 'explicitos', 'explicito', 'alternativas',
  'recomendacao', 'justificada', 'autorizada', 'autorizadas', 'implemente', 'examine', 'encontrar', 'provas',
  'decisoes', 'efeitos', 'trecho', 'origem', 'evidencias', 'evidencia',
  'src', 'source', 'root', 'code', 'file', 'files', 'produto', 'contrato', 'demanda', 'teste', 'testes', 'rejeitar',
  'import', 'export', 'const', 'return', 'async', 'await', 'function', 'class', 'default', 'interface', 'type',
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'when', 'where', 'into', 'only', 'without',
  'ensure', 'audit', 'fix', 'make', 'keep', 'avoid', 'prevent', 'update', 'create', 'change', 'should', 'must', 'does',
]);

export function stripDiacritics(text) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function normalizeMorph(token) {
  let t = stripDiacritics(token);
  // Radical derivacional PT/EN para cognatos técnicos (ex.: normalizacao/normalization/normalize, frequencia/frequency)
  const deriv = t.replace(/(?:izacoes|izacao|izations|ization|acoes|acao|ations|ation|encias|encia|encies|ency|ence|izador|adores|ador|ator|izar|ize)$/u, '');
  if (deriv !== t && deriv.length >= 5) t = deriv;
  if (t.length >= 5 && t.endsWith('ais')) return `${t.slice(0, -3)}al`;
  if (t.length >= 5 && t.endsWith('es') && !t.endsWith('tes') && !t.endsWith('les')) return t.slice(0, -1);
  if (t.length >= 5 && t.endsWith('s') && !t.endsWith('ss') && !t.endsWith('us') && !t.endsWith('is')) return t.slice(0, -1);
  return t;
}

function splitIdentifierParts(raw) {
  if (!raw) return [];
  return raw
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
    .replace(/[^A-Za-zÀ-ÿ0-9]+/gu, ' ')
    .split(/\s+/u)
    .map(stripDiacritics)
    .filter((part) => part.length >= 2 && !stopwords.has(part));
}

function tokensMatch(codeToken, queryTerm) {
  const a = normalizeMorph(codeToken);
  const b = queryTerm;
  if (a === b) return 'exact';
  if ((a.length >= 4 && b.startsWith(a)) || (b.length >= 4 && a.startsWith(b))) return 'prefix';
  const rootA = a.length >= 6 && a.endsWith('e') ? a.slice(0, -1) : a;
  const rootB = b.length >= 6 && b.endsWith('e') ? b.slice(0, -1) : b;
  if ((rootA.length >= 5 && rootB.startsWith(rootA)) || (rootB.length >= 5 && rootA.startsWith(rootB))) return 'prefix';
  return null;
}

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const isAnyTestHelper = (p) => isProductTestPath(p) || testHelperPathPattern.test(p) || /vitest\.setup/iu.test(p);

function stripJsCommentsPreserveLines(text) {
  let out = '';
  let inStr = null;
  for (let i = 0, n = text.length; i < n;) {
    const ch = text[i];
    const next = text[i + 1];
    if (inStr) {
      out += ch;
      if (ch === '\\' && i + 1 < n) { out += next; i += 2; continue; }
      if (ch === inStr) inStr = null;
      i += 1;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      inStr = ch; out += ch; i += 1;
    } else if (ch === '/' && next === '/') {
      while (i < n && text[i] !== '\n') { out += ' '; i += 1; }
    } else if (ch === '/' && next === '*') {
      out += '  '; i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) {
        out += text[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      if (i < n) { out += '  '; i += 2; }
    } else {
      out += ch; i += 1;
    }
  }
  return out;
}

function firstExecutableLine(lines) {
  let inBlock = false;
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim();
    if (!t) continue;
    if (inBlock) { if (t.includes('*/')) inBlock = false; continue; }
    if (t.startsWith('/*')) { if (!t.includes('*/')) inBlock = true; continue; }
    if (t.startsWith('//') || t.startsWith('*')) continue;
    if (/^import\b/u.test(t)) {
      while (i < lines.length && !lines[i].includes(';') && !/from\s+['"]/u.test(lines[i])) i += 1;
      continue;
    }
    return i + 1;
  }
  return 1;
}

function extractIntentQuery(intent, projectAliases = {}) {
  const raw = intent ?? '';
  const mergedAliases = { ...genericPtEnAliases, ...projectAliases };
  const terms = new Map();

  const addTerm = (canonical, literal = null, boost = 1.0, isCodeLit = false, isSplitPart = false) => {
    const c = isCodeLit ? stripDiacritics(canonical) : normalizeMorph(canonical);
    if (!c || (c.length < 3 && c !== 'ai') || stopwords.has(c)) return;
    if (!terms.has(c)) terms.set(c, { literals: new Set(), boost, isCodeLit, isSplitPart });
    const entry = terms.get(c);
    if (boost > entry.boost) entry.boost = boost;
    if (isCodeLit) entry.isCodeLit = true;
    if (!isSplitPart) entry.isSplitPart = false;
    if (literal) entry.literals.add(literal);
  };

  for (const m of raw.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*(?:-[A-Za-z0-9_$]+)+|_[A-Za-z0-9_]+|[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+|[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*|[A-Z]{2,}[a-z0-9]+[A-Za-z0-9]*|[A-Z][a-z]+[A-Z][A-Za-z0-9]*/gu)) {
    const lit = m[0];
    if (lit.length < 4) continue;
    addTerm(lit, lit, 2.3, true);
    if (!lit.includes('-')) {
      for (const part of splitIdentifierParts(lit)) if (part.length >= 3) addTerm(part, null, 0.40, false, true);
    }
  }
  for (const m of raw.matchAll(/(?<![A-Za-z0-9])([345]\d{2})(?![A-Za-z0-9])/gu)) addTerm(m[1], m[1], 1.8, true);
  for (const m of raw.matchAll(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9_-]{1,}/gu)) {
    if (m[0].includes('-')) continue;
    const low = stripDiacritics(m[0]);
    if (stopwords.has(low)) continue;
    const al = mergedAliases[low];
    if (al) for (const a of (Array.isArray(al) ? al : [al])) addTerm(a, a, 1.35, false);
    else if (low.length >= 3) addTerm(low, low, 1.0, false);
  }
  for (const k of [...terms.keys()]) {
    if (!terms.get(k)?.isCodeLit && k.length >= 5 && k.endsWith('o') && terms.has(k.slice(0, -1))) terms.delete(k);
  }
  return terms;
}

export function tokenizeIntent(intent) {
  const words = [...extractIntentQuery(intent).keys()];
  return { words, stems: words.map((w) => (w.length >= 4 ? w.slice(0, 4) : w)) };
}

export function isFallbackOnlyEvidence(sourceEvidence) {
  return sourceEvidence.length <= 1
    && sourceEvidence.every((e) => e.selection === 'ENTRYPOINT_PREFIX' || e.selection === 'FULL_SOURCE');
}

function decodeUtf8Prefix(bytes, byteLimit) {
  for (let end = Math.min(bytes.byteLength, byteLimit); end > 0; end -= 1) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, end)); } catch { /* retry boundary */ }
  }
  return '';
}

function verifiedTextSource(repositoryRoot, manifestEntry, workspaceObservation = null) {
  const observedBytes = workspaceObservation?.sourceBytesByPath?.get(manifestEntry.path);
  if (observedBytes !== undefined) {
    if (observedBytes.byteLength !== manifestEntry.bytes) throw new Error(`semantic_source_changed:${manifestEntry.path}`);
    return observedBytes;
  }
  const absolutePath = resolve(repositoryRoot, manifestEntry.path);
  const metadata = lstatSync(absolutePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`semantic_source_changed:${manifestEntry.path}`);
  const bytes = readFileSync(absolutePath);
  if (bytes.byteLength !== manifestEntry.bytes || sha256(bytes) !== manifestEntry.digest) {
    throw new Error(`semantic_source_changed:${manifestEntry.path}`);
  }
  return bytes;
}

function getAliases(domainAliases, word) {
  const val = domainAliases?.[word];
  if (!val) return [];
  return Array.isArray(val) ? val.map((v) => stripDiacritics(String(v))) : [stripDiacritics(String(val))];
}

function getLongestMatchingPrefixLength(filePath, prefixes) {
  let maxLen = 0;
  for (const pfx of prefixes ?? []) if (filePath?.startsWith(pfx) && pfx.length > maxLen) maxLen = pfx.length;
  return maxLen;
}

function extractTargetPrefixesAndDirs(intentText, rootsBySubdir, domainAliases, {
  sourceRoots = ['src', 'app', 'lib'],
  filesByRel = new Map(),
  filesByRelNoExt = new Map(),
  filesByBasename = new Map(),
} = {}) {
  const targetDirs = new Set();
  const targetPrefixes = new Set();
  if (!intentText) return { targetDirs, targetPrefixes, explicitFilePaths: [] };

  const rootAlt = [...new Set([...sourceRoots, 'src', 'app', 'lib', 'test', 'tests'])].map(escapeRegex).join('|');
  const fullRe = new RegExp(`\\b(?:${rootAlt})\\/(?!\\.\\.(?:\\/|$))[^\\s\`'"<>()\\[\\]{}]+`, 'gu');
  const normalizedPaths = new Set(
    (intentText.match(fullRe) || [])
      .map((m) => m.replace(/[.,;:!?]+$/u, '').replace(/:L?\d+(?::\d+|-L?\d+)?$/u, '').trim())
      .filter(Boolean),
  );

  for (const rawMatch of intentText.match(/(?:^|[\s`'"(])\/?([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+)(?=$|[\s`'"):,;!?])/gu) || []) {
    const cleaned = rawMatch.trim().replace(/^['"`(/]+/u, '').replace(/[.,;:!?)'"`]+$/u, '').replace(/:L?\d+(?::\d+|-L?\d+)?$/u, '');
    if (!cleaned || cleaned.includes('..')) continue;
    const exactMatch = filesByRel.get(cleaned) ?? filesByRelNoExt.get(cleaned);
    if (exactMatch) normalizedPaths.add(exactMatch);
  }
  for (const match of intentText.matchAll(/\b([A-Za-z0-9_.-]+\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|py|sh|json|css))\b/gu)) {
    const candidates = filesByBasename.get(match[1]);
    if (candidates?.length === 1) normalizedPaths.add(candidates[0]);
  }

  const rootBareSet = new Set([...sourceRoots, 'src', 'app', 'lib', 'test', 'tests'].flatMap((r) => [r, `${r}/`]));
  for (const p of normalizedPaths) {
    const { root, rel } = splitRootRelativePath(p, sourceRoots);
    const relParts = rel.split('/').filter(Boolean);
    if (relParts.length > 1) targetDirs.add(relParts[0]);
    const dirPfx = /\.[a-zA-Z0-9]+$/u.test(p) ? p.slice(0, p.lastIndexOf('/') + 1) : (root && relParts.length >= 1 ? (p.endsWith('/') ? p : `${p}/`) : '');
    if (dirPfx && !rootBareSet.has(dirPfx)) targetPrefixes.add(dirPfx);
  }

  const addSubdir = (subdir) => {
    const roots = rootsBySubdir.get(subdir);
    if (!roots || stopwords.has(subdir)) return;
    targetDirs.add(subdir);
    for (const root of roots) targetPrefixes.add(`${root}/${subdir}/`);
  };
  const mergedAliases = { ...genericPtEnAliases, ...domainAliases };
  for (const word of stripDiacritics(intentText).split(/[^a-z0-9_$-]+/i).filter((w) => w.length >= 3)) {
    addSubdir(word);
    for (const a of getAliases(mergedAliases, word)) addSubdir(a);
  }
  return { targetDirs, targetPrefixes, explicitFilePaths: [...normalizedPaths].filter((p) => !rootBareSet.has(p)) };
}

export function loadDomainLexicon(repositoryRoot) {
  const lexiconPath = repositoryRoot ? resolve(repositoryRoot, '.harness/config/lexicon.json') : null;
  const merged = {};
  if (!lexiconPath || !existsSync(lexiconPath)) return merged;
  try {
    const parsed = JSON.parse(readFileSync(lexiconPath, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed)) {
        const key = stripDiacritics(k);
        if (Array.isArray(v)) merged[key] = [...new Set(v.map((item) => stripDiacritics(String(item))))];
        else if (typeof v === 'string') merged[key] = stripDiacritics(v);
      }
    }
  } catch { /* preserva determinismo */ }
  return merged;
}

export function computeSymbolIdfWeights(symbols, words = [], domainAliases = {}) {
  const totalFiles = Math.max(new Set((symbols ?? []).map((s) => s.path)).size, 1);
  const terms = [...new Set(words.map(normalizeMorph))];
  const dfByTerm = new Map(terms.map((t) => [t, new Set()]));
  for (const sym of symbols ?? []) {
    const tokens = [...splitIdentifierParts(sym.name), ...splitIdentifierParts((sym.path ?? '').replace(/\.[^.]+$/u, ''))];
    for (const tok of tokens) {
      for (const term of terms) {
        if (tokensMatch(tok, term) || getAliases(domainAliases, term).some((al) => tokensMatch(tok, normalizeMorph(al)))) {
          dfByTerm.get(term).add(sym.path);
        }
      }
    }
  }
  return new Map(terms.map((t) => [t, Math.log((totalFiles + 1) / (dfByTerm.get(t).size + 1)) + 0.5]));
}

export function prioritizeWorkspaceSkeleton(
  skeleton,
  intent,
  entrypoints = [],
  maxPromptSymbols = 512,
  domainAliases = {},
  targetPrefixes = new Set(),
  precomputedIdf = null,
) {
  if (!skeleton || !Array.isArray(skeleton.symbols)) return skeleton;
  const terms = extractIntentQuery(intent, domainAliases);
  const queryTerms = [...terms.entries()];
  const idfWeights = precomputedIdf ?? computeSymbolIdfWeights(skeleton.symbols, [...terms.keys()], domainAliases);

  const scoreSymbol = (sym) => {
    let score = (sym.docComment?.includes('@deprecated') ? -20 : 0)
      + (isAnyTestHelper(sym.path) || sym.path.includes('/scripts/') ? -15 : 0)
      + (entrypoints.includes(sym.path) ? 4 : 0)
      + (sym.exported ? 3 : 0);
    const nameParts = splitIdentifierParts(sym.name);
    const pathParts = splitIdentifierParts((sym.path ?? '').replace(/\.[^.]+$/u, ''));
    for (const [term, meta] of queryTerms) {
      const idf = idfWeights.get(term) ?? 1.5;
      if (stripDiacritics(sym.name) === term || normalizeMorph(sym.name) === term || meta.literals.has(sym.name)) {
        score += 12 * meta.boost * idf;
        continue;
      }
      if (meta.isCodeLit) continue;
      let hit = 0;
      for (const np of nameParts) { const m = tokensMatch(np, term); if (m) hit = Math.max(hit, m === 'exact' ? 6 : 3); }
      for (const pp of pathParts) { const m = tokensMatch(pp, term); if (m) hit = Math.max(hit, m === 'exact' ? 3 : 1.5); }
      if (hit > 0) score += hit * meta.boost * idf;
    }
    if (targetPrefixes?.size > 0 && score > 0) {
      const pfxLen = getLongestMatchingPrefixLength(sym.path, targetPrefixes);
      if (pfxLen > 0) score += Math.min(Math.floor(pfxLen / 4), 10);
    }
    return score;
  };

  const sorted = [...skeleton.symbols]
    .map((sym) => ({ sym, score: scoreSymbol(sym) }))
    .sort((a, b) => b.score - a.score || compareCodeUnits(a.sym.path, b.sym.path) || a.sym.startLine - b.sym.startLine || compareCodeUnits(a.sym.name, b.sym.name))
    .slice(0, maxPromptSymbols)
    .map(({ sym }) => sym);
  return { schema: skeleton.schema, symbolCount: sorted.length, symbols: sorted };
}

export function resolveDiscoveryScope(textFiles, intent, domainAliases, contextData = null, sourceRoots = ['src', 'app', 'lib']) {
  if (contextData?.targetDirs && contextData?.targetPrefixes && contextData?.explicitFilePaths) {
    return {
      targetDirs: new Set(contextData.targetDirs),
      targetPrefixes: new Set(contextData.targetPrefixes),
      explicitFilePaths: contextData.explicitFilePaths,
    };
  }
  const rootsBySubdir = new Map();
  const filesByRel = new Map();
  const filesByRelNoExt = new Map();
  const filesByBasename = new Map();
  for (const file of textFiles) {
    const { root, rel } = splitRootRelativePath(file.path, sourceRoots);
    if (rel && !filesByRel.has(rel)) filesByRel.set(rel, file.path);
    const relNoExt = rel.replace(/\.[^/.]+$/u, '');
    if (relNoExt && !isAnyTestHelper(file.path) && !filesByRelNoExt.has(relNoExt)) filesByRelNoExt.set(relNoExt, file.path);
    if (!isAnyTestHelper(file.path)) {
      const base = file.path.split('/').pop();
      if (base) {
        if (!filesByBasename.has(base)) filesByBasename.set(base, []);
        filesByBasename.get(base).push(file.path);
      }
    }
    const relParts = rel.split('/').filter(Boolean);
    if (root && relParts.length > 1) {
      if (!rootsBySubdir.has(relParts[0])) rootsBySubdir.set(relParts[0], new Set());
      rootsBySubdir.get(relParts[0]).add(root);
    }
  }
  return extractTargetPrefixesAndDirs(intent, rootsBySubdir, domainAliases, { sourceRoots, filesByRel, filesByRelNoExt, filesByBasename });
}

function buildImportGraph(prodFiles, textByPath, cleanLinesByPath, symbolsByPath) {
  const observedSet = new Set(prodFiles.map((f) => f.path));
  const resolveLocal = (fromFile, spec) => {
    if (!spec.startsWith('.')) return null;
    const base = posix.normalize(posix.join(dirname(fromFile), spec)).replace(/\.(?:js|mjs|cjs|ts|tsx)$/u, '');
    return [`${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, `${base}/index.ts`, `${base}/index.js`]
      .find((c) => observedSet.has(c)) ?? null;
  };

  const rawImportsByFile = new Map();
  const isBarrelFacade = new Map();
  const barrelReexports = new Map();
  for (const f of prodFiles) {
    const resolved = [];
    for (const imp of extractAstImports(f.path, textByPath.get(f.path))) {
      const target = resolveLocal(f.path, imp.specifier);
      if (target && target !== f.path) resolved.push({ target, names: imp.names });
    }
    rawImportsByFile.set(f.path, resolved);

    const clean = cleanLinesByPath.get(f.path).join('\n');
    const reexportCount = (clean.match(/^\s*export\s+(?:\*|\{[^}]*\})\s+from\b/gmu) ?? []).length;
    const fnCount = (symbolsByPath.get(f.path) ?? []).filter((s) => s.kind === 'FUNCTION' || s.kind === 'CLASS').length;
    if ((reexportCount >= 2 && fnCount <= 1) || (reexportCount >= 1 && fnCount === 0)) {
      isBarrelFacade.set(f.path, true);
      const byName = new Map();
      const stars = new Set();
      for (const m of clean.matchAll(/export\s+\*\s+from\s+['"]([^'"]+)['"]/gu)) {
        const t = resolveLocal(f.path, m[1]);
        if (t) stars.add(t);
      }
      for (const m of clean.matchAll(/export\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/gu)) {
        const t = resolveLocal(f.path, m[2]);
        if (!t) continue;
        for (const rawName of m[1].split(',')) {
          const cleanName = rawName.trim().split(/\s+as\s+/i).pop()?.trim();
          if (cleanName) byName.set(cleanName, t);
        }
      }
      barrelReexports.set(f.path, { byName, stars });
    }
  }

  const symbolDefFile = new Map();
  for (const [p, syms] of symbolsByPath.entries()) {
    if (isBarrelFacade.get(p) || !observedSet.has(p)) continue;
    for (const s of syms) if (s.exported && s.name && !symbolDefFile.has(s.name)) symbolDefFile.set(s.name, p);
  }

  const unwrapBarrel = (barrelPath, name, depth = 0) => {
    if (depth > 3) return null;
    if (!isBarrelFacade.get(barrelPath)) return barrelPath;
    const re = barrelReexports.get(barrelPath);
    if (re?.byName.has(name)) return unwrapBarrel(re.byName.get(name), name, depth + 1);
    for (const st of re?.stars ?? []) {
      if (symbolsByPath.get(st)?.some((s) => s.name === name)) return st;
      const deeper = unwrapBarrel(st, name, depth + 1);
      if (deeper && deeper !== st) return deeper;
    }
    return symbolDefFile.get(name) ?? null;
  };

  const importsByFile = new Map();
  const importedByFile = new Map();
  const inDegree = new Map();
  for (const f of prodFiles) {
    const resolved = [];
    const seenTargets = new Set();
    const pushEdge = (target, names) => {
      if (!target || target === f.path || isBarrelFacade.get(target)) return;
      resolved.push({ target, names });
      if (!importedByFile.has(target)) importedByFile.set(target, []);
      importedByFile.get(target).push({ caller: f.path, names });
      if (!seenTargets.has(target)) { seenTargets.add(target); inDegree.set(target, (inDegree.get(target) ?? 0) + 1); }
    };
    for (const { target, names } of rawImportsByFile.get(f.path) ?? []) {
      if (!isBarrelFacade.get(target)) { pushEdge(target, names); continue; }
      const byReal = new Map();
      for (const n of names) {
        const real = unwrapBarrel(target, n);
        if (real && real !== f.path && !isBarrelFacade.get(real)) {
          if (!byReal.has(real)) byReal.set(real, []);
          byReal.get(real).push(n);
        }
      }
      for (const [rt, rNames] of byReal.entries()) pushEdge(rt, rNames);
    }
    importsByFile.set(f.path, resolved);
  }
  return { importsByFile, importedByFile, inDegree, isBarrelFacade };
}

function indexFileHits(prodFiles, cleanLinesByPath, symbolsByPath, queryTerms, explicitSet) {
  const codeLitRegex = new Map();
  for (const [term, meta] of queryTerms) {
    const lits = meta.isCodeLit ? [...meta.literals].filter(Boolean) : [];
    if (lits.length > 0) codeLitRegex.set(term, new RegExp(`(?<![A-Za-z0-9])${lits.map(escapeRegex).join('|')}(?![A-Za-z0-9])`, 'iu'));
  }

  const fileHits = new Map();
  const dfByTerm = new Map(queryTerms.map(([t]) => [t, 0]));
  for (const f of prodFiles) {
    const p = f.path;
    const syms = symbolsByPath.get(p) ?? [];
    const cleanLines = cleanLinesByPath.get(p);
    const bodyLines = [];
    const bodyTokenLines = new Map();
    let inImport = false;
    for (let i = 0; i < cleanLines.length; i += 1) {
      const cl = cleanLines[i];
      if (!inImport && /^\s*import\b/u.test(cl)) { inImport = !cl.includes(';') && !/from\s+['"]/u.test(cl); continue; }
      if (inImport) { if (cl.includes(';') || /from\s+['"]/u.test(cl)) inImport = false; continue; }
      bodyLines.push({ ln: i + 1, text: cl });
      for (const part of splitIdentifierParts(cl)) {
        const norm = normalizeMorph(part);
        if (!bodyTokenLines.has(norm)) bodyTokenLines.set(norm, new Set());
        bodyTokenLines.get(norm).add(i + 1);
      }
    }
    const bodyTokenList = [...bodyTokenLines.keys()];
    const bodyText = bodyLines.map((b) => b.text).join('\n');
    const noExt = p.replace(/\.[^.]+$/u, '');
    const slashIdx = noExt.lastIndexOf('/');
    const baseTokens = splitIdentifierParts(slashIdx >= 0 ? noExt.slice(slashIdx + 1) : noExt);
    const dirTokens = slashIdx >= 0 ? splitIdentifierParts(noExt.slice(0, slashIdx)) : [];
    const symTokens = new Map(syms.map((s) => [s, splitIdentifierParts(s.name)]));

    const matchedTerms = new Map();
    for (const [term, meta] of queryTerms) {
      let bestScore = 0;
      let isDef = false;
      const hitLines = new Set();
      const hitSpans = [];

      if (!meta.isCodeLit) {
        for (const bt of baseTokens) { const m = tokensMatch(bt, term); if (m) { bestScore = Math.max(bestScore, (m === 'exact' ? 5.6 : 3.0) * meta.boost); isDef = true; } }
        for (const dt of dirTokens) { const m = tokensMatch(dt, term); if (m) bestScore = Math.max(bestScore, (m === 'exact' ? 2.0 : 1.1) * meta.boost); }
      }
      for (const s of syms) {
        if (stripDiacritics(s.name) === term || normalizeMorph(s.name) === term || meta.literals.has(s.name)) {
          bestScore = Math.max(bestScore, 6.0 * meta.boost); isDef = true; hitLines.add(s.startLine); hitSpans.push([s.startLine, s.endLine ?? s.startLine]);
          continue;
        }
        if (!meta.isCodeLit) {
          for (const st of symTokens.get(s)) {
            const m = tokensMatch(st, term);
            if (m) { bestScore = Math.max(bestScore, (m === 'exact' ? 3.8 : 2.0) * meta.boost); isDef = true; hitLines.add(s.startLine); hitSpans.push([s.startLine, s.endLine ?? s.startLine]); break; }
          }
        }
      }
      if (meta.isCodeLit) {
        const re = codeLitRegex.get(term);
        if (re?.test(bodyText)) {
          const isKebabOrSpecial = [...meta.literals].some((l) => /[-_]|[345]\d{2}/u.test(l));
          bestScore = Math.max(bestScore, (isKebabOrSpecial ? 3.8 : 2.0) * meta.boost);
          if (isKebabOrSpecial) isDef = true;
          for (const { ln, text: lt } of bodyLines) if (re.test(lt)) hitLines.add(ln);
        }
      } else {
        let bodyMatched = false;
        if (bodyTokenLines.has(term)) {
          bodyMatched = true;
          for (const ln of bodyTokenLines.get(term)) hitLines.add(ln);
        } else {
          for (const bt of bodyTokenList) {
            if (tokensMatch(bt, term)) { bodyMatched = true; for (const ln of bodyTokenLines.get(bt)) hitLines.add(ln); }
          }
        }
        if (bodyMatched) bestScore = Math.max(bestScore, 1.5 * meta.boost);
      }

      if (bestScore > 0) {
        matchedTerms.set(term, { channelScore: bestScore, hitLines, hitSpans, isDef });
        dfByTerm.set(term, dfByTerm.get(term) + 1);
      }
    }
    if (matchedTerms.size > 0 || explicitSet.has(p)) fileHits.set(p, matchedTerms);
  }
  return { fileHits, dfByTerm };
}

function extractFileWindows({ filePath, lines, codeStart, limit, totalBytes, matched, idfByTerm, symbols, peerSeamLines }) {
  const fnSpans = symbols.filter((s) => (s.kind === 'FUNCTION' || s.kind === 'CLASS') && (s.endLine ?? s.startLine) > s.startLine);
  const inFnLine = fnSpans.length > 0 ? new Uint8Array(lines.length + 1) : null;
  if (inFnLine) {
    for (const s of fnSpans) {
      for (let ln = Math.max(1, s.startLine); ln <= Math.min(lines.length, s.endLine ?? s.startLine); ln += 1) inFnLine[ln] = 1;
    }
  }

  const termHitsInFile = [];
  for (const [term, info] of matched.entries()) {
    const lineWeights = new Map();
    const baseW = Math.min(info.channelScore, 5.0) * Math.pow(idfByTerm.get(term) ?? 1.5, 1.3);
    for (const ln of info.hitLines) {
      if (ln >= codeStart && ln <= lines.length) {
        const locFactor = inFnLine && !inFnLine[ln] && !info.isDef ? 0.55 : 1.0;
        lineWeights.set(ln, (lineWeights.get(ln) ?? 0) + locFactor);
      }
    }
    for (const [s0, s1] of info.hitSpans) {
      if (s1 - s0 <= 80) {
        for (let ln = Math.max(codeStart, s0); ln <= Math.min(lines.length, s1); ln += 1) lineWeights.set(ln, (lineWeights.get(ln) ?? 0) + 0.35);
      }
    }
    if (lineWeights.size > 0) termHitsInFile.push({ weight: baseW, entries: [...lineWeights.entries()].sort((a, b) => a[0] - b[0]) });
  }

  const scoreCenter = (center, usedArr) => {
    const lo = Math.max(codeStart, center - 24);
    const hi = Math.min(lines.length, center + 24);
    let sum = 0;
    let distinct = 0;
    for (const th of termHitsInFile) {
      let localHits = 0;
      for (const [ln, c] of th.entries) {
        if (ln > hi) break;
        if (ln >= lo && !usedArr[ln]) localHits += c;
      }
      if (localHits > 0) { sum += th.weight * Math.log1p(localHits); distinct += 1; }
    }
    let seamHits = 0;
    for (const ln of peerSeamLines) if (ln >= lo && ln <= hi && !usedArr[ln]) seamHits += 1;
    if (seamHits > 0) { sum += 14 * Math.log1p(seamHits); distinct += 1; }
    return { score: distinct > 0 ? sum * (1 + Math.min(distinct - 1, 5) * 0.18) : 0, distinct };
  };

  const maxWins = totalBytes > 13_500 && limit >= 7_000 ? 3 : totalBytes > 7_500 ? 2 : 1;
  const pickedCenters = [];
  let firstBest = 0;
  const used = new Uint8Array(lines.length + 1);
  for (let k = 0; k < maxWins; k += 1) {
    let bestStart = codeStart;
    let bestEnd = codeStart;
    let bestVal = -1;
    let bestDist = 0;
    for (let i = codeStart; i <= lines.length; i += 1) {
      if (used[i]) continue;
      const { score: val, distinct: d } = scoreCenter(i, used);
      if (val > bestVal + 1e-6) { bestVal = val; bestStart = i; bestEnd = i; bestDist = d; }
      else if (Math.abs(val - bestVal) <= 1e-6 && i === bestEnd + 1) bestEnd = i;
    }
    const thresh = k === 1 ? 0.28 : 0.25;
    if (bestVal <= 0 || (k > 0 && bestVal < firstBest * thresh) || (k >= 2 && bestDist < 2 && bestVal < firstBest * 0.50)) break;
    if (k === 0) firstBest = bestVal;
    const bestLine = Math.round((bestStart + bestEnd) / 2);
    pickedCenters.push({ center: bestLine, score: bestVal });
    for (let j = Math.max(codeStart, bestLine - 55); j <= Math.min(lines.length, bestLine + 55); j += 1) used[j] = 1;
  }
  if (pickedCenters.length === 0) pickedCenters.push({ center: codeStart, score: 1 });

  const totalCenterScore = pickedCenters.reduce((a, c) => a + c.score, 0) || 1;
  const win0Budget = pickedCenters.length === 1
    ? limit
    : (pickedCenters.length === 2
      ? Math.min(Math.floor(limit * 0.50), Math.max(Math.floor(limit * 0.46), Math.floor(limit * (pickedCenters[0].score / totalCenterScore))))
      : Math.min(limit - 1_500 * (pickedCenters.length - 1), Math.max(Math.floor(limit * (pickedCenters[0].score / totalCenterScore)), Math.floor(limit * 0.40))));
  const restScoreSum = pickedCenters.slice(1).reduce((a, c) => a + c.score, 0) || 1;

  const intervals = pickedCenters.map(({ center, score }, idx) => {
    const winBudget = idx === 0 ? win0Budget : Math.max(1_500, Math.floor((limit - win0Budget) * (score / restScoreSum)));
    let s = center - 1;
    let e = center;
    while (s > codeStart - 1 || e < lines.length) {
      const ns = s > codeStart - 1 ? s - 1 : s;
      const ne = e < lines.length ? e + 1 : e;
      if (Buffer.byteLength(lines.slice(ns, ne).join('\n'), 'utf8') > winBudget) break;
      s = ns; e = ne;
    }
    const encTop = symbols.find((sym) => sym.startLine >= codeStart && sym.startLine < s + 1 && sym.endLine <= e + 4 && (sym.endLine - sym.startLine) <= 35);
    if (encTop && Buffer.byteLength(lines.slice(encTop.startLine - 1, e).join('\n'), 'utf8') <= winBudget) s = encTop.startLine - 1;
    const encEnd = symbols.find((sym) => sym.startLine >= s + 1 && sym.startLine <= e && sym.endLine > e && sym.endLine <= e + 8);
    if (encEnd && Buffer.byteLength(lines.slice(s, encEnd.endLine).join('\n'), 'utf8') <= winBudget + 320) e = encEnd.endLine;
    return [s + 1, e];
  }).sort((a, b) => a[0] - b[0]);

  const merged = [];
  for (const iv of intervals) {
    const prev = merged[merged.length - 1];
    if (prev && iv[0] <= prev[1] + 18) prev[1] = Math.max(prev[1], iv[1]);
    else merged.push([...iv]);
  }

  const out = [];
  let usedBytes = 0;
  for (const [s, e] of merged) {
    const avail = limit - usedBytes;
    if (avail <= 0) break;
    let content = lines.slice(s - 1, e).join('\n');
    let chunkBytes = Buffer.byteLength(content, 'utf8');
    if (chunkBytes > avail) {
      content = decodeUtf8Prefix(Buffer.from(content, 'utf8'), avail);
      chunkBytes = Buffer.byteLength(content, 'utf8');
    }
    if (chunkBytes > 0) {
      usedBytes += chunkBytes;
      out.push({ path: filePath, content, startLine: s, endLine: s + content.split('\n').length - 1, truncated: chunkBytes < totalBytes, selection: 'LEXICAL_WINDOW', consumedBytes: chunkBytes });
    }
  }
  return out;
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
  const totalWorkspaceBytes = textFiles.reduce((total, { bytes }) => total + bytes, 0);
  const smallWorkspace = totalWorkspaceBytes <= sourceEvidenceByteLimit;
  const entrypoints = textFiles.map(({ path }) => path).filter(isEntrypointPath);
  const sourceRoots = discovery.sourceRoots ?? (discovery.sourceRoot ? discovery.sourceRoot.split(',') : ['src']);
  const dirOfPath = (filePath) => {
    const relParts = splitRootRelativePath(filePath, sourceRoots).rel.split('/').filter(Boolean);
    return relParts.length > 1 ? relParts[0] : '';
  };

  const { targetDirs, targetPrefixes, explicitFilePaths } = resolveDiscoveryScope(textFiles, intent, domainAliases, contextData, sourceRoots);
  const explicitSet = new Set([
    ...explicitFilePaths.filter((p) => filesByPath.has(p)),
    ...(explicitTargetPaths ?? []).filter((p) => filesByPath.has(p)),
  ]);
  for (const p of explicitTargetPaths ?? []) {
    if (!filesByPath.has(p)) continue;
    const dir = dirOfPath(p);
    if (dir) {
      targetDirs.add(dir);
      const parentDir = p.slice(0, p.lastIndexOf('/') + 1);
      if (parentDir && !sourceRoots.some((r) => parentDir === `${r}/`)) targetPrefixes.add(parentDir);
    }
  }

  const mentionsTests = /\b(?:test|tests|teste|testes|spec|vitest|property)\b/iu.test(intent);
  const mentionsConfigAssets = /\b(?:locale|locales|i18n|css|stylesheet)\b/iu.test(intent);
  const symbolsByPath = new Map();
  for (const sym of discovery.workspaceSkeleton?.symbols ?? []) {
    if (!symbolsByPath.has(sym.path)) symbolsByPath.set(sym.path, []);
    symbolsByPath.get(sym.path).push(sym);
  }

  const dec = new TextDecoder('utf-8', { fatal: false });
  const bytesByPath = new Map();
  const textByPath = new Map();
  const cleanLinesByPath = new Map();
  const prodFiles = [];
  for (const f of textFiles) {
    if (!smallWorkspace && !explicitSet.has(f.path)) {
      if (!mentionsTests && isAnyTestHelper(f.path)) continue;
      if (!mentionsConfigAssets && !codeFilePattern.test(f.path)) continue;
    }
    const rawBytes = verifiedTextSource(repositoryRoot, f, workspaceObservation);
    bytesByPath.set(f.path, rawBytes);
    const txt = dec.decode(rawBytes);
    textByPath.set(f.path, txt);
    cleanLinesByPath.set(f.path, stripJsCommentsPreserveLines(txt).split('\n'));
    prodFiles.push(f);
  }

  const terms = extractIntentQuery(intent, domainAliases);
  const queryTerms = [...terms.entries()];
  const { fileHits, dfByTerm } = indexFileHits(prodFiles, cleanLinesByPath, symbolsByPath, queryTerms, explicitSet);
  // Identificadores de código únicos no repositório (df <= 2, ex.: campos privados ou helpers internos) sinalizam posse direta
  for (const [term, meta] of queryTerms) {
    if (!meta.isCodeLit || (dfByTerm.get(term) ?? 0) > 2) continue;
    for (const matched of fileHits.values()) {
      const info = matched.get(term);
      if (info) {
        info.channelScore = Math.max(info.channelScore, 4.8 * meta.boost);
        info.isDef = true;
      }
    }
  }

  // Modo smallWorkspace: preserva compactação greenfield (< 4 KB) e seleção cirúrgica
  if (smallWorkspace) {
    let selectedPaths = textFiles.map((f) => f.path);
    if (textFiles.length > 1) {
      const hasExplicitScope = explicitSet.size > 0 || targetDirs.size > 0 || targetPrefixes.size > 0;
      const strongMatched = [];
      for (const [p, m] of fileHits.entries()) {
        if (isEntrypointPath(p)) continue;
        if ([...m.values()].some((info) => (info.isDef || info.channelScore >= 2.5) && info.channelScore >= 2.0)) strongMatched.push(p);
      }
      if (!hasExplicitScope && strongMatched.length === 0) {
        selectedPaths = entrypoints.length > 0 ? entrypoints : [textFiles[0].path];
      } else {
        const dirPrefixPaths = hasExplicitScope
          ? textFiles.map((f) => f.path).filter((p) => targetDirs.has(dirOfPath(p)) || [...targetPrefixes].some((pref) => p.startsWith(pref)))
          : [];
        selectedPaths = [...new Set([...(entrypoints.length > 0 ? entrypoints : [textFiles[0].path]), ...explicitSet, ...dirPrefixPaths, ...strongMatched])];
      }
    }
    const evidence = [];
    let remaining = sourceEvidenceByteLimit;
    for (const p of selectedPaths) {
      const buf = remaining > 0 ? bytesByPath.get(p) : null;
      if (!buf) continue;
      const content = decodeUtf8Prefix(buf, Math.min(buf.byteLength, remaining));
      const consumed = Buffer.byteLength(content, 'utf8');
      remaining -= consumed;
      evidence.push({ path: p, content, startLine: 1, endLine: content.split('\n').length, truncated: consumed < buf.byteLength, selection: 'FULL_SOURCE' });
    }
    return evidence;
  }

  // Modo repositório grande: grafo 1-hop bidirecional + MMR submodular + poda de cauda residual + janelas centradas
  const { importsByFile, importedByFile, inDegree, isBarrelFacade } = buildImportGraph(prodFiles, textByPath, cleanLinesByPath, symbolsByPath);
  const N = Math.max(prodFiles.length, 1);
  const hubThreshold = Math.max(16, Math.floor(N * 0.22));
  const idfByTerm = new Map(queryTerms.map(([t]) => [t, Math.log((N + 1) / ((dfByTerm.get(t) || 1) + 1)) + 0.5]));

  const qualityFactor = (p) => {
    if (explicitSet.has(p)) return 1.0;
    const syms = symbolsByPath.get(p) ?? [];
    const hasFnOrClass = syms.some((s) => s.kind === 'FUNCTION' || s.kind === 'CLASS');
    const sz = bytesByPath.get(p)?.byteLength ?? 0;
    if (isAnyTestHelper(p) || !codeFilePattern.test(p) || isBarrelFacade.get(p) || isEntrypointPath(p)) return 0.25;
    if ((inDegree.get(p) ?? 0) >= hubThreshold) return 0.40;
    if (!hasFnOrClass) return sz > 15_000 ? 0.12 : 0.30;
    return 1.0;
  };

  const termCoverCount = new Map(queryTerms.map(([t]) => [t, 0]));
  const noveltyDecay = (c) => (c < 0.5 ? 1.0 : c < 1.5 ? 0.35 : c < 2.5 ? 0.16 : 0.08);
  const isSpecificTerm = (t) => (dfByTerm.get(t) ?? N) <= Math.max(6, N * 0.28);
  const isSpecificQueryHit = (name) => splitIdentifierParts(name).some((pt) => queryTerms.some(([t]) => isSpecificTerm(t) && tokensMatch(pt, t)));

  const chosenPaths = [];
  const chosenSet = new Set();
  const collabMult = new Map();
  const collabBaseFloor = new Map();

  const registerPick = (p, propagateCollab = true) => {
    chosenPaths.push(p);
    chosenSet.add(p);
    for (const [term, info] of fileHits.get(p)?.entries() ?? []) {
      termCoverCount.set(term, (termCoverCount.get(term) ?? 0) + (info.isDef ? 1 : info.channelScore >= 2.5 ? 0.85 : 0.30));
    }
    if (!propagateCollab) return;
    // Arestas de saída (callees 1-hop)
    for (const { target, names } of importsByFile.get(p) ?? []) {
      const deg = inDegree.get(target) ?? 0;
      if (chosenSet.has(target) || deg >= hubThreshold || isEntrypointPath(target) || isBarrelFacade.get(target) || isAnyTestHelper(target)) continue;
      const targetBase = target.slice(target.lastIndexOf('/') + 1).replace(/\.[^.]+$/u, '');
      if (!names.some(isSpecificQueryHit) && !(deg <= 2 && isSpecificQueryHit(targetBase))) continue;
      collabMult.set(target, Math.max(collabMult.get(target) ?? 1, 1 + (1 / Math.log2(deg + 2)) * 0.95));
    }
    // Arestas de entrada (callers 1-hop de módulos ultra-específicos: piso de resgate sem distorcer ranking lexical)
    const pickedDeg = inDegree.get(p) ?? 0;
    if (pickedDeg > 0 && pickedDeg <= 3 && !isEntrypointPath(p) && !isBarrelFacade.get(p)) {
      for (const { caller, names } of importedByFile.get(p) ?? []) {
        if (chosenSet.has(caller) || isEntrypointPath(caller) || isBarrelFacade.get(caller) || isAnyTestHelper(caller)) continue;
        if ((inDegree.get(caller) ?? 0) >= hubThreshold) continue;
        const specificEdge = names.some(isSpecificQueryHit);
        if (!specificEdge && pickedDeg > 2) continue;
        collabBaseFloor.set(caller, Math.max(collabBaseFloor.get(caller) ?? 0, specificEdge ? 6 : 4));
      }
    }
  };

  for (const p of [...explicitSet].sort(compareCodeUnits)) {
    if (chosenPaths.length >= maxLargeWorkspaceFiles) break;
    registerPick(p, true);
  }

  const evaluateCandidate = (p) => {
    const matched = fileHits.get(p);
    const mult = collabMult.get(p) ?? 1;
    const floor = collabBaseFloor.get(p) ?? 0;
    if ((!matched || matched.size === 0) && floor <= 0) return { score: 0, hasSpecificDef: false, mult: 1 };
    let baseRel = 0;
    let marginalNov = 0;
    let distinct = 0;
    let uncoveredDef = 0;
    let hasSpecificDef = false;
    for (const [term, { channelScore, isDef }] of matched?.entries() ?? []) {
      const w = channelScore * idfByTerm.get(term);
      const cov = termCoverCount.get(term) ?? 0;
      baseRel += w;
      marginalNov += w * noveltyDecay(cov);
      distinct += 1;
      if (isDef && isSpecificTerm(term) && !terms.get(term)?.isSplitPart) {
        hasSpecificDef = true;
        if (cov < 1) uncoveredDef += 1;
      }
    }
    const ownerFactor = hasSpecificDef || mult > 1 ? 1.0 : 0.38;
    const prefixBonus = targetPrefixes.size > 0 && getLongestMatchingPrefixLength(p, targetPrefixes) > 0 ? 1.15 : 1.0;
    const lexicalScore = (0.30 * baseRel + 0.70 * marginalNov)
      * (1 + Math.min(distinct - 1, 5) * 0.14 + Math.min(uncoveredDef, 3) * 0.25)
      * qualityFactor(p) * ownerFactor * mult * prefixBonus;
    const score = Math.max(lexicalScore, floor * qualityFactor(p));
    return { score, hasSpecificDef, mult };
  };

  let topPickedScore = 0;
  while (chosenPaths.length < maxLargeWorkspaceFiles) {
    let best = { path: null, score: 0 };
    for (const f of prodFiles) {
      if (chosenSet.has(f.path)) continue;
      const cand = evaluateCandidate(f.path);
      // Poda cauda residual fraca (< 7.5% do pico sem colaboração 1-hop) para economizar tokens em demandas focadas
      if (chosenPaths.length >= 2 && topPickedScore > 0 && cand.score < topPickedScore * 0.075 && cand.mult <= 1 && (collabBaseFloor.get(f.path) ?? 0) <= 0) {
        continue;
      }
      if (cand.score > best.score || (cand.score === best.score && best.path && compareCodeUnits(f.path, best.path) < 0)) {
        best = { path: f.path, score: cand.score };
      }
    }
    if (!best.path || best.score < 2.0) break;
    if (topPickedScore === 0) topPickedScore = best.score;
    registerPick(best.path, best.score >= topPickedScore * 0.10);
  }

  // Colaborador minúsculo (<= 2.2 KB) ligado em 1 salto que define termo específico da demanda
  let tinyHelper = null;
  let tinyScore = 0;
  for (const [target, mult] of collabMult.entries()) {
    if (chosenSet.has(target) || mult <= 1 || qualityFactor(target) < 0.9) continue;
    const sz = bytesByPath.get(target)?.byteLength ?? Infinity;
    const matched = fileHits.get(target);
    const hasDefHit = matched && [...matched.entries()].some(([t, info]) => info.isDef && isSpecificTerm(t));
    if (sz <= 2_200 && hasDefHit && mult > tinyScore) { tinyScore = mult; tinyHelper = target; }
  }
  if (tinyHelper) registerPick(tinyHelper, false);

  if (chosenPaths.length === 0) {
    const fallback = entrypoints.length > 0 ? entrypoints[0] : prodFiles[0]?.path;
    if (fallback) registerPick(fallback);
  }

  if (Array.isArray(contextData?.rankedCandidatesOut)) {
    contextData.rankedCandidatesOut.push(
      ...prodFiles
        .filter((f) => !chosenSet.has(f.path))
        .map((f) => ({ path: f.path, score: evaluateCandidate(f.path).score }))
        .filter((x) => x.score >= 2.0)
        .sort((a, b) => b.score - a.score || compareCodeUnits(a.path, b.path))
        .slice(0, 8)
        .map((x) => x.path),
    );
  }

  // Planejamento de orçamento por arquivo: explícitos e pequenos primeiro, depois water-filling ponderado por definição
  const sizeOf = new Map(chosenPaths.map((p) => [p, bytesByPath.get(p).byteLength]));
  const bodySizeOf = new Map(chosenPaths.map((p) => {
    const ls = textByPath.get(p).split('\n');
    return [p, Buffer.byteLength(ls.slice(firstExecutableLine(ls) - 1).join('\n'), 'utf8')];
  }));
  const rawRelOf = (p) => {
    const m = fileHits.get(p);
    if (!m) return 20;
    let s = explicitSet.has(p) ? 80 : 0;
    for (const [t, { channelScore, isDef }] of m.entries()) s += channelScore * idfByTerm.get(t) * (isDef ? 1.8 : 0.7);
    return Math.max(s * qualityFactor(p), 10);
  };

  const fileCapFor = (p, idx) => (explicitSet.has(p) ? sourceEvidenceExplicitFileCap : (idx === 0 ? 9_216 : sourceEvidenceRegularFileCap));
  const planBudget = new Map();
  let rem = sourceEvidenceByteLimit;
  const pending = new Set();
  for (let idx = 0; idx < chosenPaths.length; idx += 1) {
    const p = chosenPaths[idx];
    const bodySz = bodySizeOf.get(p);
    if (explicitSet.has(p)) {
      const alloc = Math.min(bodySz, sourceEvidenceExplicitFileCap, rem);
      planBudget.set(p, alloc);
      rem -= alloc;
    } else if (bodySz <= smallFullBodyThreshold && rem >= bodySz) {
      planBudget.set(p, bodySz);
      rem -= bodySz;
    } else {
      pending.add(p);
    }
  }
  const idxOfPath = new Map(chosenPaths.map((p, idx) => [p, idx]));
  const weights = new Map(chosenPaths.map((p, idx) => [p, Math.pow(rawRelOf(p), 0.35) * (idx === 0 ? 1.35 : 1.0)]));
  for (let pass = 0; pass < chosenPaths.length && pending.size > 0 && rem > 0; pass += 1) {
    let wSum = 0;
    for (const p of pending) wSum += weights.get(p);
    let settledAny = false;
    for (const p of [...pending]) {
      const need = Math.min(bodySizeOf.get(p), fileCapFor(p, idxOfPath.get(p)));
      const share = Math.max(2_400, Math.floor((rem * weights.get(p)) / wSum));
      if (need <= share) {
        const alloc = Math.min(need, rem);
        planBudget.set(p, alloc); rem -= alloc; pending.delete(p); settledAny = true;
      }
    }
    if (!settledAny) {
      for (const p of pending) {
        planBudget.set(p, Math.min(bodySizeOf.get(p), fileCapFor(p, idxOfPath.get(p)), Math.floor((rem * weights.get(p)) / wSum)));
      }
      break;
    }
  }

  const evidence = [];
  let remaining = sourceEvidenceByteLimit;
  for (let i = 0; i < chosenPaths.length; i += 1) {
    const p = chosenPaths[i];
    if (remaining <= 0) break;
    const plannedRest = chosenPaths.slice(i).reduce((a, fp) => a + (planBudget.get(fp) ?? sourceEvidenceFileByteLimit), 0);
    const bonusSlack = remaining > plannedRest ? Math.min(1_200, remaining - plannedRest) : 0;
    const cap = fileCapFor(p, i);
    const limit = Math.min((planBudget.get(p) ?? sourceEvidenceFileByteLimit) + bonusSlack, remaining, cap);
    if (limit <= 0) break;

    const bytes = sizeOf.get(p);
    const text = textByPath.get(p);
    const lines = text.split('\n');
    const codeStart = firstExecutableLine(lines);
    const bodyOnlyBytes = bodySizeOf.get(p);
    const matched = fileHits.get(p);

    if (!matched || matched.size === 0) {
      const content = decodeUtf8Prefix(bytesByPath.get(p), Math.min(bytes, limit));
      const consumed = Buffer.byteLength(content, 'utf8');
      remaining -= consumed;
      evidence.push({ path: p, content, startLine: 1, endLine: content.split('\n').length, truncated: consumed < bytes, selection: 'ENTRYPOINT_PREFIX' });
      continue;
    }
    if (bytes <= limit) {
      remaining -= bytes;
      evidence.push({ path: p, content: text, startLine: 1, endLine: lines.length, truncated: false, selection: 'LEXICAL_WINDOW' });
      continue;
    }
    if (bodyOnlyBytes <= limit) {
      remaining -= bodyOnlyBytes;
      evidence.push({ path: p, content: lines.slice(codeStart - 1).join('\n'), startLine: codeStart, endLine: lines.length, truncated: codeStart > 1, selection: 'LEXICAL_WINDOW' });
      continue;
    }

    const cleanLines = cleanLinesByPath.get(p);
    const peerImportedNames = new Set();
    for (const { target, names } of importsByFile.get(p) ?? []) {
      if (chosenSet.has(target) && (inDegree.get(target) ?? 0) < hubThreshold) {
        for (const n of names) if (n.length >= 4) peerImportedNames.add(n);
      }
    }
    const peerSeamLines = new Set();
    if (peerImportedNames.size > 0) {
      const seamRe = new RegExp(`(?<![A-Za-z0-9_$])(?:${[...peerImportedNames].map(escapeRegex).join('|')})(?![A-Za-z0-9_$])`, 'u');
      for (let lnIdx = codeStart - 1; lnIdx < cleanLines.length; lnIdx += 1) if (seamRe.test(cleanLines[lnIdx])) peerSeamLines.add(lnIdx + 1);
    }

    for (const w of extractFileWindows({ filePath: p, lines, codeStart, limit, totalBytes: bytes, matched, idfByTerm, symbols: symbolsByPath.get(p) ?? [], peerSeamLines })) {
      remaining -= w.consumedBytes;
      evidence.push({ path: w.path, content: w.content, startLine: w.startLine, endLine: w.endLine, truncated: w.truncated, selection: w.selection });
    }
  }
  return evidence;
}

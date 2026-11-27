import { Buffer } from 'node:buffer';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import { compareCodeUnits, sha256 } from './canonical_json.mjs';
import { isProductTestPath, splitRootRelativePath } from './workspace_observer.mjs';
import { extractAstImports } from './workspace_skeleton.mjs';

export const sourceEvidenceByteLimit = 38_912;
const fullFileCapPrimary = 20_480;
const fullFileCapSecondary = 16_384;
const megaWindowCapPrimary = 10_240;
const megaWindowCapSecondary = 7_680;
const maxLargeWorkspaceFiles = 6;

const entrypointPattern = /(?:^|\/)(?:index|main|__main__|mod|entrypoint|run|app)\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|py|sh)$/iu;
const codeFilePattern = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|py|sh|bash)$/iu;
const testHelperPathPattern = /(?:^|\/)(?:tests?|__tests__|__mocks__)\//iu;

export const isEntrypointPath = (filePath) => entrypointPattern.test(filePath);
export const stripDiacritics = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
export const isFallbackOnlyEvidence = (ev) => ev.length <= 1 && ev.every((e) => e.selection === 'ENTRYPOINT_PREFIX' || e.selection === 'FULL_SOURCE');

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

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const isAnyTestHelper = (p) => isProductTestPath(p) || testHelperPathPattern.test(p) || /vitest\.setup/iu.test(p);
const getAliases = (map, w) => (!map?.[w] ? [] : (Array.isArray(map[w]) ? map[w] : [map[w]]).map((v) => stripDiacritics(String(v))));
const longestPrefixLen = (p, pfxs) => [...(pfxs ?? [])].reduce((m, x) => (p?.startsWith(x) && x.length > m ? x.length : m), 0);

function normalizeMorph(token) {
  let t = stripDiacritics(token);
  const deriv = t.replace(/(?:izacoes|izacao|izations|ization|acoes|acao|ations|ation|encias|encia|encies|ency|ence|izador|adores|ador|ator|izar|ize)$/u, '');
  if (deriv !== t && deriv.length >= 5) t = deriv;
  if (t.length >= 5 && t.endsWith('ais')) return `${t.slice(0, -3)}al`;
  if (t.length >= 5 && t.endsWith('es') && !t.endsWith('tes') && !t.endsWith('les')) return t.slice(0, -1);
  if (t.length >= 5 && t.endsWith('s') && !t.endsWith('ss') && !t.endsWith('us') && !t.endsWith('is')) return t.slice(0, -1);
  return t;
}

function splitIdentifierParts(raw) {
  if (!raw) return [];
  return raw.replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2').replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
    .replace(/[^A-Za-zÀ-ÿ0-9]+/gu, ' ').split(/\s+/u).map(stripDiacritics).filter((p) => p.length >= 2 && !stopwords.has(p));
}

function normTokensMatch(a, queryTerm) {
  if (a === queryTerm) return 'exact';
  if ((a.length >= 4 && queryTerm.startsWith(a)) || (queryTerm.length >= 4 && a.startsWith(queryTerm))) return 'prefix';
  const rA = a.length >= 6 && a.endsWith('e') ? a.slice(0, -1) : a;
  const rB = queryTerm.length >= 6 && queryTerm.endsWith('e') ? queryTerm.slice(0, -1) : queryTerm;
  return ((rA.length >= 5 && rB.startsWith(rA)) || (rB.length >= 5 && rA.startsWith(rB))) ? 'prefix' : null;
}

const tokensMatch = (codeToken, queryTerm) => normTokensMatch(normalizeMorph(codeToken), queryTerm);

const stripJsCommentsPreserveLines = (text) => text.replace(
  /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\/\/[^\n]*|\/\*[\s\S]*?\*\//gu,
  (m, str) => (str !== undefined ? str : m.replace(/[^\n]/gu, ' ')),
);

function extractIntentQuery(intent, projectAliases = {}) {
  const raw = intent ?? '';
  const mergedAliases = { ...genericPtEnAliases, ...projectAliases };
  const terms = new Map();
  const addTerm = (canonical, literal = null, boost = 1.0, isCodeLit = false, isSplitPart = false) => {
    const c = isCodeLit ? stripDiacritics(canonical) : normalizeMorph(canonical);
    if (!c || (c.length < 3 && c !== 'ai') || stopwords.has(c)) return;
    const entry = terms.get(c) ?? { literals: new Set(), boost, isCodeLit, isSplitPart };
    entry.boost = Math.max(entry.boost, boost);
    if (isCodeLit) entry.isCodeLit = true;
    if (!isSplitPart) entry.isSplitPart = false;
    if (literal) entry.literals.add(literal);
    terms.set(c, entry);
  };

  for (const m of raw.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*(?:-[A-Za-z0-9_$]+)+|_[A-Za-z0-9_]+|[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+|[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*|[A-Z]{2,}[a-z0-9]+[A-Za-z0-9]*|[A-Z][a-z]+[A-Z][A-Za-z0-9]*/gu)) {
    if (m[0].length < 4) continue;
    addTerm(m[0], m[0], 2.3, true);
    if (!m[0].includes('-')) for (const part of splitIdentifierParts(m[0])) if (part.length >= 3) addTerm(part, null, 0.40, false, true);
  }
  for (const m of raw.matchAll(/(?<![A-Za-z0-9])([345]\d{2})(?![A-Za-z0-9])/gu)) addTerm(m[1], m[1], 1.8, true);
  for (const m of raw.matchAll(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9_-]{1,}/gu)) {
    if (m[0].includes('-')) continue;
    const low = stripDiacritics(m[0]);
    if (stopwords.has(low)) continue;
    const al = mergedAliases[low];
    if (al) for (const a of (Array.isArray(al) ? al : [al])) addTerm(a, a, 1.35);
    else if (low.length >= 3) addTerm(low, low, 1.0);
  }
  for (const k of [...terms.keys()]) {
    if (!terms.get(k)?.isCodeLit && k.length >= 5 && k.endsWith('o') && terms.has(k.slice(0, -1))) terms.delete(k);
  }
  return terms;
}

function decodeUtf8Prefix(bytes, byteLimit) {
  for (let end = Math.min(bytes.byteLength, byteLimit); end > 0; end -= 1) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, end)); } catch { /* retry boundary */ }
  }
  return '';
}

function verifiedTextSource(repositoryRoot, entry, workspaceObservation = null) {
  const obs = workspaceObservation?.sourceBytesByPath?.get(entry.path);
  if (obs !== undefined) {
    if (obs.byteLength !== entry.bytes) throw new Error(`semantic_source_changed:${entry.path}`);
    return obs;
  }
  const abs = resolve(repositoryRoot, entry.path);
  const stat = lstatSync(abs);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`semantic_source_changed:${entry.path}`);
  const bytes = readFileSync(abs);
  if (bytes.byteLength !== entry.bytes || sha256(bytes) !== entry.digest) throw new Error(`semantic_source_changed:${entry.path}`);
  return bytes;
}

export function loadDomainLexicon(repositoryRoot) {
  const p = repositoryRoot ? resolve(repositoryRoot, '.harness/config/lexicon.json') : null;
  const merged = {};
  if (!p || !existsSync(p)) return merged;
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed)) {
        merged[stripDiacritics(k)] = Array.isArray(v) ? [...new Set(v.map((x) => stripDiacritics(String(x))))] : stripDiacritics(String(v));
      }
    }
  } catch { /* preserva determinismo */ }
  return merged;
}

export function prioritizeWorkspaceSkeleton(skeleton, intent, entrypoints = [], maxPromptSymbols = 512, domainAliases = {}, targetPrefixes = new Set()) {
  if (!skeleton || !Array.isArray(skeleton.symbols)) return skeleton;
  const queryTerms = [...extractIntentQuery(intent, domainAliases).entries()];
  const entrySet = new Set(entrypoints);
  const dfByTerm = new Map(queryTerms.map(([t]) => [t, new Set()]));
  const pathHitByPath = new Map();
  const pathPfxBonus = new Map();
  const normNamePartsBySym = new Map();

  for (const sym of skeleton.symbols) {
    const p = sym.path ?? '';
    if (!pathHitByPath.has(p)) {
      const ppNorm = splitIdentifierParts(p.replace(/\.[^.]+$/u, '')).map(normalizeMorph);
      const hits = new Map();
      for (const [t, meta] of queryTerms) {
        let best = 0;
        for (const x of ppNorm) {
          const m = normTokensMatch(x, t);
          if (m) { dfByTerm.get(t).add(p); if (!meta.isCodeLit) best = Math.max(best, m === 'exact' ? 3 : 1.5); }
        }
        if (best > 0) hits.set(t, best);
      }
      pathHitByPath.set(p, hits);
      pathPfxBonus.set(p, targetPrefixes?.size > 0 ? Math.min(Math.floor(longestPrefixLen(p, targetPrefixes) / 4), 10) : 0);
    }
    const npNorm = splitIdentifierParts(sym.name).map(normalizeMorph);
    normNamePartsBySym.set(sym, npNorm);
    for (const [t] of queryTerms) {
      const dfSet = dfByTerm.get(t);
      if (dfSet.has(p)) continue;
      for (const x of npNorm) if (normTokensMatch(x, t)) { dfSet.add(p); break; }
    }
  }
  const totalFiles = Math.max(pathHitByPath.size, 1);
  const idf = new Map(queryTerms.map(([t]) => [t, Math.log((totalFiles + 1) / (dfByTerm.get(t).size + 1)) + 0.5]));
  const scoreSym = (sym) => {
    const p = sym.path ?? '';
    let sc = (sym.docComment?.includes('@deprecated') ? -20 : 0) + (isAnyTestHelper(p) || p.includes('/scripts/') ? -15 : 0)
      + (entrySet.has(p) ? 4 : 0) + (sym.exported ? 3 : 0);
    const npNorm = normNamePartsBySym.get(sym);
    const pHits = pathHitByPath.get(p);
    const lowName = stripDiacritics(sym.name);
    const morphName = normalizeMorph(sym.name);
    for (const [t, meta] of queryTerms) {
      const w = meta.boost * (idf.get(t) ?? 1.5);
      if (lowName === t || morphName === t || meta.literals.has(sym.name)) { sc += 12 * w; continue; }
      if (meta.isCodeLit) continue;
      let hit = pHits.get(t) ?? 0;
      for (const x of npNorm) { const m = normTokensMatch(x, t); if (m) hit = Math.max(hit, m === 'exact' ? 6 : 3); }
      if (hit > 0) sc += hit * w;
    }
    if (sc > 0) sc += pathPfxBonus.get(p) ?? 0;
    return sc;
  };
  const sorted = [...skeleton.symbols].map((sym) => ({ sym, score: scoreSym(sym) }))
    .sort((a, b) => b.score - a.score || compareCodeUnits(a.sym.path, b.sym.path) || a.sym.startLine - b.sym.startLine || compareCodeUnits(a.sym.name, b.sym.name))
    .slice(0, maxPromptSymbols).map(({ sym }) => sym);
  return { schema: skeleton.schema, symbolCount: sorted.length, symbols: sorted };
}

export function resolveDiscoveryScope(textFiles, intent, domainAliases, contextData = null, sourceRoots = ['src', 'app', 'lib']) {
  if (contextData?.targetDirs && contextData?.targetPrefixes && contextData?.explicitFilePaths) {
    return { targetDirs: new Set(contextData.targetDirs), targetPrefixes: new Set(contextData.targetPrefixes), explicitFilePaths: contextData.explicitFilePaths };
  }
  const targetDirs = new Set();
  const targetPrefixes = new Set();
  if (!intent) return { targetDirs, targetPrefixes, explicitFilePaths: [] };

  const rootsBySubdir = new Map();
  const filesByRel = new Map();
  const filesByRelNoExt = new Map();
  const filesByBase = new Map();
  for (const { path: p } of textFiles) {
    const { root, rel } = splitRootRelativePath(p, sourceRoots);
    if (rel && !filesByRel.has(rel)) filesByRel.set(rel, p);
    const noExt = rel.replace(/\.[^/.]+$/u, '');
    if (noExt && !isAnyTestHelper(p) && !filesByRelNoExt.has(noExt)) filesByRelNoExt.set(noExt, p);
    if (!isAnyTestHelper(p)) { const b = p.split('/').pop(); if (b) filesByBase.set(b, [...(filesByBase.get(b) ?? []), p]); }
    const parts = rel.split('/').filter(Boolean);
    if (root && parts.length > 1) { if (!rootsBySubdir.has(parts[0])) rootsBySubdir.set(parts[0], new Set()); rootsBySubdir.get(parts[0]).add(root); }
  }

  const rootList = [...new Set([...sourceRoots, 'src', 'app', 'lib', 'test', 'tests'])];
  const rootBareSet = new Set(rootList.flatMap((r) => [r, `${r}/`]));
  const fullRe = new RegExp(`\\b(?:${rootList.map(escapeRegex).join('|')})\\/(?!\\.\\.(?:\\/|$))[^\\s\`'"<>()\\[\\]{}]+`, 'gu');
  const normPaths = new Set((intent.match(fullRe) || []).map((m) => m.replace(/[.,;:!?]+$/u, '').replace(/:L?\d+(?::\d+|-L?\d+)?$/u, '').trim()).filter(Boolean));
  for (const rawM of intent.match(/(?:^|[\s`'"(])\/?([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+)(?=$|[\s`'"):,;!?])/gu) || []) {
    const cl = rawM.trim().replace(/^['"`(/]+/u, '').replace(/[.,;:!?)'"`]+$/u, '').replace(/:L?\d+(?::\d+|-L?\d+)?$/u, '');
    const hit = cl && !cl.includes('..') ? (filesByRel.get(cl) ?? filesByRelNoExt.get(cl)) : null;
    if (hit) normPaths.add(hit);
  }
  for (const m of intent.matchAll(/\b([A-Za-z0-9_.-]+\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|py|sh|json|css))\b/gu)) {
    if (filesByBase.get(m[1])?.length === 1) normPaths.add(filesByBase.get(m[1])[0]);
  }
  for (const p of normPaths) {
    const { root, rel } = splitRootRelativePath(p, sourceRoots);
    const parts = rel.split('/').filter(Boolean);
    if (parts.length > 1) targetDirs.add(parts[0]);
    const dirPfx = /\.[a-zA-Z0-9]+$/u.test(p) ? p.slice(0, p.lastIndexOf('/') + 1) : (root && parts.length >= 1 ? (p.endsWith('/') ? p : `${p}/`) : '');
    if (dirPfx && !rootBareSet.has(dirPfx)) targetPrefixes.add(dirPfx);
  }
  const mergedAliases = { ...genericPtEnAliases, ...domainAliases };
  const addSubdir = (sub) => {
    const roots = rootsBySubdir.get(sub);
    if (!roots || stopwords.has(sub)) return;
    targetDirs.add(sub);
    for (const r of roots) targetPrefixes.add(`${r}/${sub}/`);
  };
  for (const w of stripDiacritics(intent).split(/[^a-z0-9_$-]+/i).filter((x) => x.length >= 3)) {
    addSubdir(w);
    for (const a of getAliases(mergedAliases, w)) addSubdir(a);
  }
  return { targetDirs, targetPrefixes, explicitFilePaths: [...normPaths].filter((p) => !rootBareSet.has(p)) };
}

function buildImportGraph(prodFiles, textByPath, cleanLinesByPath, symbolsByPath) {
  const observedSet = new Set(prodFiles.map((f) => f.path));
  const resolveLocal = (from, spec) => {
    if (!spec.startsWith('.')) return null;
    const base = posix.normalize(posix.join(dirname(from), spec)).replace(/\.(?:js|mjs|cjs|ts|tsx)$/u, '');
    return [`${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, `${base}/index.ts`, `${base}/index.js`].find((c) => observedSet.has(c)) ?? null;
  };

  const rawImports = new Map();
  const isBarrel = new Map();
  const barrelMap = new Map();
  const symbolDefFile = new Map();
  for (const { path: p } of prodFiles) {
    rawImports.set(p, extractAstImports(p, textByPath.get(p))
      .map((imp) => ({ target: resolveLocal(p, imp.specifier), names: imp.names }))
      .filter((x) => x.target && x.target !== p));
    const clean = cleanLinesByPath.get(p).join('\n');
    const reexp = (clean.match(/^\s*export\s+(?:\*|\{[^}]*\})\s+from\b/gmu) ?? []).length;
    const fns = (symbolsByPath.get(p) ?? []).filter((s) => s.kind === 'FUNCTION' || s.kind === 'CLASS').length;
    if ((reexp >= 2 && fns <= 1) || (reexp >= 1 && fns === 0)) {
      isBarrel.set(p, true);
      const byName = new Map();
      const stars = new Set();
      for (const m of clean.matchAll(/export\s+\*\s+from\s+['"]([^'"]+)['"]/gu)) { const t = resolveLocal(p, m[1]); if (t) stars.add(t); }
      for (const m of clean.matchAll(/export\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/gu)) {
        const t = resolveLocal(p, m[2]);
        if (t) for (const rn of m[1].split(',')) { const cn = rn.trim().split(/\s+as\s+/i).pop()?.trim(); if (cn) byName.set(cn, t); }
      }
      barrelMap.set(p, { byName, stars });
    } else {
      for (const s of symbolsByPath.get(p) ?? []) if (s.exported && s.name && !symbolDefFile.has(s.name)) symbolDefFile.set(s.name, p);
    }
  }

  const unwrap = (bp, name, d = 0) => {
    if (d > 3) return null;
    if (!isBarrel.get(bp)) return bp;
    const re = barrelMap.get(bp);
    if (re?.byName.has(name)) return unwrap(re.byName.get(name), name, d + 1);
    for (const st of re?.stars ?? []) {
      if (symbolsByPath.get(st)?.some((s) => s.name === name)) return st;
      const deeper = unwrap(st, name, d + 1);
      if (deeper && deeper !== st) return deeper;
    }
    return symbolDefFile.get(name) ?? null;
  };

  const importsByFile = new Map();
  const importedByFile = new Map();
  const inDegree = new Map();
  for (const { path: p } of prodFiles) {
    const resolved = [];
    const seen = new Set();
    const pushEdge = (target, names) => {
      if (!target || target === p || isBarrel.get(target)) return;
      resolved.push({ target, names });
      importedByFile.set(target, [...(importedByFile.get(target) ?? []), { caller: p, names }]);
      if (!seen.has(target)) { seen.add(target); inDegree.set(target, (inDegree.get(target) ?? 0) + 1); }
    };
    for (const { target, names } of rawImports.get(p) ?? []) {
      if (!isBarrel.get(target)) { pushEdge(target, names); continue; }
      const byReal = new Map();
      for (const n of names) {
        const real = unwrap(target, n);
        if (real && real !== p && !isBarrel.get(real)) byReal.set(real, [...(byReal.get(real) ?? []), n]);
      }
      for (const [rt, rNames] of byReal.entries()) pushEdge(rt, rNames);
    }
    importsByFile.set(p, resolved);
  }
  return { importsByFile, importedByFile, inDegree, isBarrelFacade: isBarrel };
}

function indexFileHits(prodFiles, cleanLinesByPath, symbolsByPath, queryTerms, explicitSet) {
  const codeLitRe = new Map();
  for (const [t, meta] of queryTerms) {
    const lits = meta.isCodeLit ? [...meta.literals].filter(Boolean) : [];
    if (lits.length > 0) codeLitRe.set(t, new RegExp(`(?<![A-Za-z0-9])${lits.map(escapeRegex).join('|')}(?![A-Za-z0-9])`, 'iu'));
  }

  const fileHits = new Map();
  const dfByTerm = new Map(queryTerms.map(([t]) => [t, 0]));
  for (const { path: p } of prodFiles) {
    const syms = symbolsByPath.get(p) ?? [];
    const cleanLines = cleanLinesByPath.get(p);
    const bodyLines = [];
    const bodyTokLines = new Map();
    let inImport = false;
    for (let i = 0; i < cleanLines.length; i += 1) {
      const cl = cleanLines[i];
      if (!inImport && /^\s*import\b/u.test(cl)) { inImport = !cl.includes(';') && !/from\s+['"]/u.test(cl); continue; }
      if (inImport) { if (cl.includes(';') || /from\s+['"]/u.test(cl)) inImport = false; continue; }
      bodyLines.push({ ln: i + 1, text: cl });
      for (const part of splitIdentifierParts(cl)) {
        const norm = normalizeMorph(part);
        if (!bodyTokLines.has(norm)) bodyTokLines.set(norm, new Set());
        bodyTokLines.get(norm).add(i + 1);
      }
    }
    const bodyTokList = [...bodyTokLines.keys()];
    const bodyText = bodyLines.map((b) => b.text).join('\n');
    const noExt = p.replace(/\.[^.]+$/u, '');
    const slash = noExt.lastIndexOf('/');
    const baseToks = splitIdentifierParts(slash >= 0 ? noExt.slice(slash + 1) : noExt).map(normalizeMorph);
    const dirToks = slash >= 0 ? splitIdentifierParts(noExt.slice(0, slash)).map(normalizeMorph) : [];
    const symToks = new Map(syms.map((s) => [s, splitIdentifierParts(s.name).map(normalizeMorph)]));

    const matched = new Map();
    for (const [term, meta] of queryTerms) {
      let best = 0;
      let isDef = false;
      const hitLines = new Set();
      const hitSpans = [];
      if (!meta.isCodeLit) {
        for (const bt of baseToks) { const m = normTokensMatch(bt, term); if (m) { best = Math.max(best, (m === 'exact' ? 5.6 : 3.0) * meta.boost); isDef = true; } }
        for (const dt of dirToks) { const m = normTokensMatch(dt, term); if (m) best = Math.max(best, (m === 'exact' ? 2.0 : 1.1) * meta.boost); }
      }
      for (const s of syms) {
        if (stripDiacritics(s.name) === term || normalizeMorph(s.name) === term || meta.literals.has(s.name)) {
          best = Math.max(best, 6.0 * meta.boost); isDef = true; hitLines.add(s.startLine); hitSpans.push([s.startLine, s.endLine ?? s.startLine]); continue;
        }
        if (!meta.isCodeLit && symToks.get(s).some((st) => {
          const m = normTokensMatch(st, term);
          if (!m) return false;
          best = Math.max(best, (m === 'exact' ? 3.8 : 2.0) * meta.boost);
          isDef = true; hitLines.add(s.startLine); hitSpans.push([s.startLine, s.endLine ?? s.startLine]);
          return true;
        })) continue;
      }
      if (meta.isCodeLit) {
        const re = codeLitRe.get(term);
        if (re?.test(bodyText)) {
          const special = [...meta.literals].some((l) => /[-_]|[345]\d{2}/u.test(l));
          best = Math.max(best, (special ? 3.8 : 2.0) * meta.boost);
          if (special) isDef = true;
          for (const { ln, text: lt } of bodyLines) if (re.test(lt)) hitLines.add(ln);
        }
      } else {
        const srcKeys = bodyTokLines.has(term) ? [term] : bodyTokList.filter((bt) => normTokensMatch(bt, term));
        for (const k of srcKeys) for (const ln of bodyTokLines.get(k)) hitLines.add(ln);
        if (srcKeys.length > 0) best = Math.max(best, 1.5 * meta.boost);
      }
      if (best > 0) { matched.set(term, { channelScore: best, hitLines, hitSpans, isDef }); dfByTerm.set(term, dfByTerm.get(term) + 1); }
    }
    if (matched.size > 0 || explicitSet.has(p)) fileHits.set(p, matched);
  }
  return { fileHits, dfByTerm };
}

// Extrator compacto (1–2 janelas centradas com costura de chamadas entre pares escolhidos), usado só em mega-arquivos.
function extractFileWindows({ filePath, lines, limit, totalBytes, matched, idfByTerm, peerSeamLines }) {
  const termHits = [];
  for (const [term, info] of matched.entries()) {
    const lineW = new Map();
    const weight = Math.min(info.channelScore, 5.0) * Math.pow(idfByTerm.get(term) ?? 1.5, 1.3);
    for (const ln of info.hitLines) if (ln >= 1 && ln <= lines.length) lineW.set(ln, (lineW.get(ln) ?? 0) + 1);
    for (const [s0, s1] of info.hitSpans) {
      if (s1 - s0 <= 80) for (let ln = Math.max(1, s0); ln <= Math.min(lines.length, s1); ln += 1) lineW.set(ln, (lineW.get(ln) ?? 0) + 0.35);
    }
    if (lineW.size > 0) termHits.push({ weight, entries: [...lineW.entries()].sort((a, b) => a[0] - b[0]) });
  }

  const scoreCenter = (center, usedArr) => {
    const lo = Math.max(1, center - 24);
    const hi = Math.min(lines.length, center + 24);
    let sum = 0; let distinct = 0;
    for (const th of termHits) {
      let local = 0;
      for (const [ln, c] of th.entries) { if (ln > hi) break; if (ln >= lo && !usedArr[ln]) local += c; }
      if (local > 0) { sum += th.weight * Math.log1p(local); distinct += 1; }
    }
    let seams = 0;
    for (const ln of peerSeamLines) if (ln >= lo && ln <= hi && !usedArr[ln]) seams += 1;
    if (seams > 0) { sum += 14 * Math.log1p(seams); distinct += 1; }
    return distinct > 0 ? sum * (1 + Math.min(distinct - 1, 5) * 0.18) : 0;
  };

  const maxWins = limit >= 4_500 && totalBytes > 10_000 ? 2 : 1;
  const centers = [];
  const used = new Uint8Array(lines.length + 1);
  for (let k = 0; k < maxWins; k += 1) {
    let bestStart = 1; let bestEnd = 1; let bestVal = -1;
    for (let i = 1; i <= lines.length; i += 1) {
      if (used[i]) continue;
      const val = scoreCenter(i, used);
      if (val > bestVal + 1e-6) { bestVal = val; bestStart = i; bestEnd = i; }
      else if (Math.abs(val - bestVal) <= 1e-6 && i === bestEnd + 1) bestEnd = i;
    }
    if (bestVal <= 0 || (k > 0 && bestVal < centers[0].score * 0.28)) break;
    const center = Math.round((bestStart + bestEnd) / 2);
    centers.push({ center, score: bestVal });
    for (let j = Math.max(1, center - 55); j <= Math.min(lines.length, center + 55); j += 1) used[j] = 1;
  }
  if (centers.length === 0) centers.push({ center: 1, score: 1 });

  const totalScore = centers.reduce((a, c) => a + c.score, 0) || 1;
  const intervals = centers.map(({ center, score }) => {
    const share = centers.length === 1 ? limit : Math.max(Math.floor(limit * 0.42), Math.min(Math.floor(limit * 0.58), Math.floor(limit * (score / totalScore))));
    let s = center - 1; let e = center;
    while (s > 0 || e < lines.length) {
      const ns = s > 0 ? s - 1 : s;
      const ne = e < lines.length ? e + 1 : e;
      if (Buffer.byteLength(lines.slice(ns, ne).join('\n'), 'utf8') > share) break;
      s = ns; e = ne;
    }
    return [s + 1, e];
  }).sort((a, b) => a[0] - b[0]);

  const merged = [];
  for (const iv of intervals) {
    const prev = merged[merged.length - 1];
    if (prev && iv[0] <= prev[1] + 16) prev[1] = Math.max(prev[1], iv[1]);
    else merged.push([...iv]);
  }
  if (merged.length === 1) {
    let [s, e] = [merged[0][0] - 1, merged[0][1]];
    while (s > 0 || e < lines.length) {
      const ns = s > 0 ? s - 1 : s;
      const ne = e < lines.length ? e + 1 : e;
      if (Buffer.byteLength(lines.slice(ns, ne).join('\n'), 'utf8') > limit) break;
      s = ns; e = ne;
    }
    merged[0] = [s + 1, e];
  }

  const out = [];
  let usedBytes = 0;
  for (const [s, e] of merged) {
    const avail = limit - usedBytes;
    if (avail <= 0) break;
    let content = lines.slice(s - 1, e).join('\n');
    let chunkBytes = Buffer.byteLength(content, 'utf8');
    if (chunkBytes > avail) { content = decodeUtf8Prefix(Buffer.from(content, 'utf8'), avail); chunkBytes = Buffer.byteLength(content, 'utf8'); }
    if (chunkBytes > 0) {
      usedBytes += chunkBytes;
      out.push({ path: filePath, content, startLine: s, endLine: s + content.split('\n').length - 1, truncated: chunkBytes < totalBytes, selection: 'LEXICAL_WINDOW', consumedBytes: chunkBytes });
    }
  }
  return out;
}

// Alocação Full-File-First por prioridade: protege Pick #1 integral, garante 2 janelas a mega-arquivos e promove arquivos menores.
function allocateFileBudgets(chosenPaths, bytesByPath, explicitSet, constHeavySet) {
  const wants = chosenPaths.map((p, idx) => {
    const bytes = bytesByPath.get(p).byteLength;
    const isPrimary = idx === 0 || explicitSet.has(p);
    const isDataHeavy = !explicitSet.has(p) && constHeavySet.has(p);
    const isMega = isDataHeavy || bytes > (isPrimary ? fullFileCapPrimary : fullFileCapSecondary);
    const want = isDataHeavy ? Math.min(bytes, 4_600) : (isMega ? (isPrimary ? megaWindowCapPrimary : megaWindowCapSecondary) : bytes);
    return { p, idx, bytes, isPrimary, isMega, isDataHeavy, want };
  });

  const budget = new Map();
  if (wants.reduce((acc, w) => acc + w.want, 0) <= sourceEvidenceByteLimit) {
    for (const w of wants) budget.set(w.p, w.want);
    return budget;
  }

  let rem = sourceEvidenceByteLimit;
  const first = wants[0];
  if (first && !first.isMega && first.bytes + Math.max(0, wants.length - 1) * 2_800 <= sourceEvidenceByteLimit) {
    budget.set(first.p, first.bytes);
    rem -= first.bytes;
  }
  for (const w of wants) {
    if (budget.has(w.p)) continue;
    const baseFloor = w.isDataHeavy ? 4_200 : (w.isMega ? 6_144 : (w.idx <= 2 ? 4_800 : 3_200));
    const floor = Math.min(w.want, baseFloor, rem);
    budget.set(w.p, floor);
    rem -= floor;
  }
  const grant = (w) => {
    const add = Math.min(w.want - budget.get(w.p), rem);
    if (add > 0) { budget.set(w.p, budget.get(w.p) + add); rem -= add; }
  };
  for (const w of wants) if (rem > 0 && w.isPrimary) grant(w);
  for (const w of wants) if (rem > 0 && !w.isMega && w.bytes <= 6_800 && (w.want - budget.get(w.p)) <= rem) grant(w);
  // Garante 2 janelas (>= 6.2 KB) para os 3 primeiros picks antes de expandir ranks inferiores
  for (const w of wants) {
    if (rem > 0 && w.idx <= 2 && budget.get(w.p) < Math.min(w.want, 6_200)) {
      const add = Math.min(Math.min(w.want, 6_200) - budget.get(w.p), rem);
      budget.set(w.p, budget.get(w.p) + add); rem -= add;
    }
  }
  for (const w of wants) if (rem > 0) grant(w);
  return budget;
}

export function buildSourceEvidence(repositoryRoot, { intent = '', discovery }, workspaceObservation = null, explicitTargetPaths = [], contextData = null) {
  const domainAliases = contextData?.domainAliases ?? loadDomainLexicon(repositoryRoot);
  const textFiles = discovery.files.filter(({ kind }) => kind === 'UTF8_TEXT');
  const filesByPath = new Map(textFiles.map((file) => [file.path, file]));
  const smallWorkspace = textFiles.reduce((total, { bytes }) => total + bytes, 0) <= sourceEvidenceByteLimit;
  const entrypoints = textFiles.map(({ path }) => path).filter(isEntrypointPath);
  const sourceRoots = discovery.sourceRoots ?? (discovery.sourceRoot ? discovery.sourceRoot.split(',') : ['src']);
  const dirOfPath = (fp) => { const p = splitRootRelativePath(fp, sourceRoots).rel.split('/').filter(Boolean); return p.length > 1 ? p[0] : ''; };

  const { targetDirs, targetPrefixes, explicitFilePaths } = resolveDiscoveryScope(textFiles, intent, domainAliases, contextData, sourceRoots);
  const explicitSet = new Set([...explicitFilePaths, ...(explicitTargetPaths ?? [])].filter((p) => filesByPath.has(p)));
  for (const p of explicitTargetPaths ?? []) {
    if (!filesByPath.has(p)) continue;
    const dir = dirOfPath(p);
    if (dir) {
      targetDirs.add(dir);
      const parent = p.slice(0, p.lastIndexOf('/') + 1);
      if (parent && !sourceRoots.some((r) => parent === `${r}/`)) targetPrefixes.add(parent);
    }
  }

  const mentionsTests = /\b(?:test|tests|teste|testes|spec|vitest|property)\b/iu.test(intent);
  const mentionsAssets = /\b(?:locale|locales|i18n|css|stylesheet)\b/iu.test(intent);
  const symbolsByPath = new Map();
  for (const sym of discovery.workspaceSkeleton?.symbols ?? []) symbolsByPath.set(sym.path, [...(symbolsByPath.get(sym.path) ?? []), sym]);

  const dec = new TextDecoder('utf-8', { fatal: false });
  const bytesByPath = new Map();
  const textByPath = new Map();
  const cleanLinesByPath = new Map();
  const prodFiles = [];
  for (const f of textFiles) {
    if (!smallWorkspace && !explicitSet.has(f.path)) {
      if (!mentionsTests && isAnyTestHelper(f.path)) continue;
      if (!mentionsAssets && !codeFilePattern.test(f.path)) continue;
    }
    const raw = verifiedTextSource(repositoryRoot, f, workspaceObservation);
    const txt = dec.decode(raw);
    bytesByPath.set(f.path, raw);
    textByPath.set(f.path, txt);
    cleanLinesByPath.set(f.path, stripJsCommentsPreserveLines(txt).split('\n'));
    prodFiles.push(f);
  }

  const terms = extractIntentQuery(intent, domainAliases);
  const queryTerms = [...terms.entries()];
  const { fileHits, dfByTerm } = indexFileHits(prodFiles, cleanLinesByPath, symbolsByPath, queryTerms, explicitSet);
  for (const [term, meta] of queryTerms) {
    if (!meta.isCodeLit || (dfByTerm.get(term) ?? 0) > 2) continue;
    for (const m of fileHits.values()) { const info = m.get(term); if (info) { info.channelScore = Math.max(info.channelScore, 4.8 * meta.boost); info.isDef = true; } }
  }

  if (smallWorkspace) {
    let selectedPaths = textFiles.map((f) => f.path);
    if (textFiles.length > 1) {
      const hasScope = explicitSet.size > 0 || targetDirs.size > 0 || targetPrefixes.size > 0;
      const strong = [...fileHits.entries()].filter(([p, m]) => !isEntrypointPath(p) && [...m.values()].some((i) => (i.isDef || i.channelScore >= 2.5) && i.channelScore >= 2.0)).map(([p]) => p);
      const base = entrypoints.length > 0 ? entrypoints : [textFiles[0].path];
      selectedPaths = !hasScope && strong.length === 0 ? base : [...new Set([
        ...base, ...explicitSet,
        ...(hasScope ? textFiles.map((f) => f.path).filter((p) => targetDirs.has(dirOfPath(p)) || [...targetPrefixes].some((pref) => p.startsWith(pref))) : []),
        ...strong,
      ])];
    }
    const evidence = [];
    let rem = sourceEvidenceByteLimit;
    for (const p of selectedPaths) {
      const buf = rem > 0 ? bytesByPath.get(p) : null;
      if (!buf) continue;
      const content = decodeUtf8Prefix(buf, Math.min(buf.byteLength, rem));
      const consumed = Buffer.byteLength(content, 'utf8');
      rem -= consumed;
      evidence.push({ path: p, content, startLine: 1, endLine: content.split('\n').length, truncated: consumed < buf.byteLength, selection: 'FULL_SOURCE' });
    }
    return evidence;
  }

  const { importsByFile, importedByFile, inDegree, isBarrelFacade } = buildImportGraph(prodFiles, textByPath, cleanLinesByPath, symbolsByPath);
  const N = Math.max(prodFiles.length, 1);
  const hubThreshold = Math.max(16, Math.floor(N * 0.22));
  const idfByTerm = new Map(queryTerms.map(([t]) => [t, Math.log((N + 1) / ((dfByTerm.get(t) || 1) + 1)) + 0.5]));

  const constHeavySet = new Set();
  for (const f of prodFiles) {
    const syms = symbolsByPath.get(f.path) ?? [];
    const fnCount = syms.filter((s) => s.kind === 'FUNCTION' || s.kind === 'CLASS').length;
    if (syms.length >= 6 && fnCount > 0 && (fnCount / syms.length) < 0.25 && (bytesByPath.get(f.path)?.byteLength ?? 0) > 6_000) {
      constHeavySet.add(f.path);
    }
  }

  const qualityFactor = (p) => {
    if (explicitSet.has(p)) return 1.0;
    const hasFn = (symbolsByPath.get(p) ?? []).some((s) => s.kind === 'FUNCTION' || s.kind === 'CLASS');
    const sz = bytesByPath.get(p)?.byteLength ?? 0;
    if (isAnyTestHelper(p) || !codeFilePattern.test(p) || isBarrelFacade.get(p) || isEntrypointPath(p)) return 0.25;
    if ((inDegree.get(p) ?? 0) >= hubThreshold) return 0.40;
    if (!hasFn) return sz > 2_000 ? 0.14 : 0.25;
    if (constHeavySet.has(p)) return 0.55;
    return 1.0;
  };

  const termCover = new Map(queryTerms.map(([t]) => [t, 0]));
  const decay = (c) => (c < 0.5 ? 1.0 : c < 1.5 ? 0.35 : c < 2.5 ? 0.16 : 0.08);
  const isSpec = (t) => (dfByTerm.get(t) ?? N) <= Math.max(6, N * 0.28);
  const isSpecHit = (name) => splitIdentifierParts(name).some((pt) => queryTerms.some(([t]) => isSpec(t) && tokensMatch(pt, t)));

  const chosenPaths = [];
  const chosenSet = new Set();
  const collabMult = new Map();
  const collabFloor = new Map();
  const exclusiveSubs = new Set();

  const registerPick = (p, propagate = true) => {
    chosenPaths.push(p);
    chosenSet.add(p);
    for (const [t, info] of fileHits.get(p)?.entries() ?? []) {
      termCover.set(t, (termCover.get(t) ?? 0) + (info.isDef ? 1 : info.channelScore >= 2.5 ? 0.85 : 0.30));
    }
    if (!propagate) return;
    const isTopPick = chosenPaths.length <= 3;
    for (const { target, names } of importsByFile.get(p) ?? []) {
      const deg = inDegree.get(target) ?? 0;
      if (chosenSet.has(target) || deg >= hubThreshold || isEntrypointPath(target) || isBarrelFacade.get(target) || isAnyTestHelper(target)) continue;
      const base = target.slice(target.lastIndexOf('/') + 1).replace(/\.[^.]+$/u, '');
      const matchesQuery = names.some(isSpecHit) || (deg <= 2 && isSpecHit(base));
      const exclusiveSub = isTopPick && deg === 1 && (bytesByPath.get(target)?.byteLength ?? Infinity) <= 4_096 && qualityFactor(target) >= 0.9;
      if (!matchesQuery && !exclusiveSub) continue;
      if (matchesQuery) collabMult.set(target, Math.max(collabMult.get(target) ?? 1, 1 + (1 / Math.log2(deg + 2)) * 0.95));
      if (exclusiveSub) { exclusiveSubs.add(target); collabFloor.set(target, Math.max(collabFloor.get(target) ?? 0, 5)); }
    }
    const pickedDeg = inDegree.get(p) ?? 0;
    if (pickedDeg > 0 && pickedDeg <= 3 && !isEntrypointPath(p) && !isBarrelFacade.get(p)) {
      for (const { caller, names } of importedByFile.get(p) ?? []) {
        if (chosenSet.has(caller) || isEntrypointPath(caller) || isBarrelFacade.get(caller) || isAnyTestHelper(caller) || (inDegree.get(caller) ?? 0) >= hubThreshold) continue;
        const specEdge = names.some(isSpecHit);
        if (!specEdge && pickedDeg > 2) continue;
        collabFloor.set(caller, Math.max(collabFloor.get(caller) ?? 0, specEdge ? 6 : 4));
      }
    }
  };

  for (const p of [...explicitSet].sort(compareCodeUnits)) {
    if (chosenPaths.length >= maxLargeWorkspaceFiles) break;
    registerPick(p, true);
  }

  const evalCand = (p) => {
    const matched = fileHits.get(p);
    const mult = collabMult.get(p) ?? 1;
    const floor = collabFloor.get(p) ?? 0;
    if ((!matched || matched.size === 0) && floor <= 0) return { score: 0, hasSpecificDef: false, isCollab: false };
    let baseRel = 0; let nov = 0; let dist = 0; let uncovDef = 0; let hasSpecificDef = false;
    for (const [t, { channelScore, isDef }] of matched?.entries() ?? []) {
      const w = channelScore * idfByTerm.get(t);
      const cov = termCover.get(t) ?? 0;
      baseRel += w; nov += w * decay(cov); dist += 1;
      if (isDef && isSpec(t) && !terms.get(t)?.isSplitPart) { hasSpecificDef = true; if (cov < 1) uncovDef += 1; }
    }
    const lex = (0.30 * baseRel + 0.70 * nov)
      * (1 + Math.min(dist - 1, 5) * 0.14 + Math.min(uncovDef, 3) * 0.25)
      * qualityFactor(p) * (hasSpecificDef || mult > 1 ? 1.0 : 0.38) * mult
      * (targetPrefixes.size > 0 && longestPrefixLen(p, targetPrefixes) > 0 ? 1.15 : 1.0);
    return { score: Math.max(lex, floor * qualityFactor(p)), hasSpecificDef, uncovDef, isCollab: mult > 1 || floor > 0 };
  };

  let topScore = 0;
  while (chosenPaths.length < maxLargeWorkspaceFiles) {
    let best = { path: null, score: 0 };
    for (const f of prodFiles) {
      if (chosenSet.has(f.path)) continue;
      const c = evalCand(f.path);
      if (topScore > 0 && !c.isCollab) {
        const sz = bytesByPath.get(f.path)?.byteLength ?? 0;
        if (chosenPaths.length >= 2 && c.score < topScore * 0.075) continue;
        if (chosenPaths.length >= 1 && !c.hasSpecificDef && (chosenPaths.length >= 3 || c.score < topScore * 0.22)) continue;
        if (chosenPaths.length >= 1 && sz > fullFileCapSecondary && c.score < topScore * 0.25) continue;
      }
      if (c.score > best.score || (c.score === best.score && best.path && compareCodeUnits(f.path, best.path) < 0)) best = { path: f.path, score: c.score };
    }
    if (!best.path || best.score < 2.0) break;
    if (topScore === 0) topScore = best.score;
    registerPick(best.path, best.score >= topScore * 0.16);
  }

  // Colaborador minúsculo (<= 2.5 KB) em 1 salto (definição específica ou sub-módulo exclusivo), melhor ranqueado
  const tinyPool = new Set([...collabMult.keys(), ...exclusiveSubs]);
  const tinyHelpers = [...tinyPool]
    .filter((t) => !chosenSet.has(t) && qualityFactor(t) >= 0.9 && (bytesByPath.get(t)?.byteLength ?? Infinity) <= 2_500
      && (exclusiveSubs.has(t) || [...(fileHits.get(t)?.entries() ?? [])].some(([term, info]) => info.isDef && isSpec(term))))
    .map((t) => ({ t, sc: evalCand(t).score + (exclusiveSubs.has(t) ? 5 : 0) }))
    .sort((a, b) => b.sc - a.sc || compareCodeUnits(a.t, b.t))
    .slice(0, 1);
  for (const { t } of tinyHelpers) registerPick(t, false);

  let usedFallback = false;
  if (chosenPaths.length === 0) {
    const fallback = entrypoints.length > 0 ? entrypoints[0] : prodFiles[0]?.path;
    if (fallback) { registerPick(fallback, false); usedFallback = true; }
  }

  if (Array.isArray(contextData?.rankedCandidatesOut)) {
    contextData.rankedCandidatesOut.push(...prodFiles.filter((f) => !chosenSet.has(f.path))
      .map((f) => ({ path: f.path, score: evalCand(f.path).score })).filter((x) => x.score >= 2.0)
      .sort((a, b) => b.score - a.score || compareCodeUnits(a.path, b.path)).slice(0, 8).map((x) => x.path));
  }

  const budgetByPath = allocateFileBudgets(chosenPaths, bytesByPath, explicitSet, constHeavySet);
  const evidence = [];
  let rem = sourceEvidenceByteLimit;
  for (const p of chosenPaths) {
    if (rem <= 0) break;
    const limit = Math.min(budgetByPath.get(p) ?? 4_096, rem);
    if (limit <= 0) break;
    const bytes = bytesByPath.get(p).byteLength;
    const text = textByPath.get(p);
    const lines = text.split('\n');
    const matched = fileHits.get(p);

    if (usedFallback || !matched || matched.size === 0) {
      const content = bytes <= limit ? text : decodeUtf8Prefix(bytesByPath.get(p), limit);
      const consumed = Buffer.byteLength(content, 'utf8');
      rem -= consumed;
      evidence.push({ path: p, content, startLine: 1, endLine: content.split('\n').length, truncated: consumed < bytes, selection: usedFallback || consumed < bytes ? 'ENTRYPOINT_PREFIX' : 'FULL_FILE' });
      continue;
    }
    if (bytes <= limit) {
      rem -= bytes;
      evidence.push({ path: p, content: text, startLine: 1, endLine: lines.length, truncated: false, selection: 'FULL_FILE' });
      continue;
    }
    const peerNames = new Set();
    for (const { target, names } of importsByFile.get(p) ?? []) {
      if (chosenSet.has(target) && (inDegree.get(target) ?? 0) < hubThreshold) for (const n of names) if (n.length >= 4) peerNames.add(n);
    }
    const peerSeamLines = new Set();
    if (peerNames.size > 0) {
      const seamRe = new RegExp(`(?<![A-Za-z0-9_$])(?:${[...peerNames].map(escapeRegex).join('|')})(?![A-Za-z0-9_$])`, 'u');
      cleanLinesByPath.get(p).forEach((cl, idx) => { if (!/^\s*import\b/u.test(cl) && seamRe.test(cl)) peerSeamLines.add(idx + 1); });
    }
    for (const w of extractFileWindows({ filePath: p, lines, limit, totalBytes: bytes, matched, idfByTerm, peerSeamLines })) {
      rem -= w.consumedBytes;
      evidence.push({ path: w.path, content: w.content, startLine: w.startLine, endLine: w.endLine, truncated: w.truncated, selection: w.selection });
    }
  }
  return evidence;
}

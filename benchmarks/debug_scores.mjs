import { observeWorkspace } from '../scripts/lib/issue_contract_core.mjs';

const root = process.cwd();
const demand = 'Permitir estornar a liquidação financeira no histórico da conta preservando o teto diário de cinquenta mil reais e validando as guardas de segurança antifraude, registrando o evento no log de auditoria.';

const obs = observeWorkspace(root, demand);
const symbols = obs.discovery.workspaceSkeleton.symbols;

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

const stripped = stripDiacritics(demand);
const words = stripped.split(/[^a-z0-9_$-]+/i).filter((w) => w.length >= 3);
const stems = words.map((w) => (w.length >= 4 ? w.slice(0, 4) : w));

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
      if (t === w || (s.length >= 4 && t.startsWith(s))) {
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

for (const w of words) {
  console.log(`Word '${w}': files=${docFreqByWord.get(w).size}/${totalFiles}, weight=${idfWeights.get(w)}`);
}

function scoreSym(sym) {
  const subtokens = extractSubtokens(sym.name);
  const pathSubtokens = sym.path ? extractSubtokens(sym.path.replace(/\.[^.]+$/u, '')) : [];
  const docTokens = (sym.docComment && !sym.docComment.includes('@deprecated'))
    ? stripDiacritics(sym.docComment.replace(/[*#/\\@{}]/gu, ' '))
        .split(/[^a-z0-9_$-]+/i)
        .filter((w) => w.length >= 3 && !['param', 'returns', 'return', 'type', 'const', 'export'].includes(w))
    : [];

  let nameScore = 0;
  for (const sub of subtokens) {
    const subStem = sub.length >= 4 ? sub.slice(0, 4) : sub;
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const stem = stems[i];
      const weight = idfWeights.get(word) ?? 1.0;
      if (sub === word) nameScore += 3 * weight;
      else if (stem.length >= 4 && (sub.startsWith(stem) || word.startsWith(subStem))) nameScore += 2 * weight;
    }
  }

  let pathScore = 0;
  for (const pSub of pathSubtokens) {
    const pStem = pSub.length >= 4 ? pSub.slice(0, 4) : pSub;
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const stem = stems[i];
      const weight = idfWeights.get(word) ?? 1.0;
      if (pSub === word) pathScore += 2 * weight;
      else if (stem.length >= 4 && (pSub.startsWith(stem) || word.startsWith(pStem))) pathScore += 1 * weight;
    }
  }

  let docBonus = 0;
  const uniqueDocTokens = new Set(docTokens);
  for (const dToken of uniqueDocTokens) {
    const dStem = dToken.length >= 4 ? dToken.slice(0, 4) : dToken;
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const stem = stems[i];
      const weight = idfWeights.get(word) ?? 1.0;
      if (dToken === word) docBonus += 2 * weight;
      else if (stem.length >= 4 && (dToken.startsWith(stem) || word.startsWith(dStem))) docBonus += 1 * weight;
    }
  }

  return { nameScore, pathScore, docBonus: Math.min(docBonus, 6), total: nameScore + pathScore + Math.min(docBonus, 6) };
}

const guardSym = symbols.find(s => s.name === 'evaluateSettlementGuards' && s.path === 'src/risk/velocity_guard.ts');
console.log('\nevaluateSettlementGuards:', scoreSym(guardSym));

const questSym = symbols.find(s => s.name === 'QuestCatalogItem');
console.log('QuestCatalogItem:', scoreSym(questSym));

const tierSym = symbols.find(s => s.name === 'TIER_XP_CEILINGS');
console.log('TIER_XP_CEILINGS:', scoreSym(tierSym));

const settleSym = symbols.find(s => s.name === 'processSettlementBatch' && s.path === 'src/ledger/settlement_engine.ts');
console.log('processSettlementBatch:', scoreSym(settleSym));

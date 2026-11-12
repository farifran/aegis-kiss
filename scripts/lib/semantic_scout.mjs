/**
 * Aegis Adaptive Semantic Scout (Arbiter)
 *
 * Princípios (CONST-KISS / ARCH-LOCAL-DETERMINISTIC-CORE / ARCH-PARSIMONY):
 * 1. O Scout é estritamente condicional: só é executado no Silêncio Léxico
 *    em repositórios não-vazios e que excedam a cota de 64 KB (onde a seleção é necessária).
 * 2. Em repositórios greenfield (EMPTY_SOURCE), compactos (smallWorkspace <= 64 KB)
 *    ou onde houver correspondência mecânica, o Scout permanece inativo (custo $0.00, latência 0 ms).
 * 3. Amostragem Estrutural Panorâmica: Agrupa até 2 símbolos exportados por arquivo
 *    de todo o repositório, eliminando viés e truncamento alfabético em monorepos.
 * 4. Validação Física Fail-Closed: O Harness aceita apenas caminhos sugeridos que existam
 *    fisicamente em `src/`, descartando qualquer alucinação.
 * 5. Auto-Lexicon Persistente: Aliases inferidos são mesclados em `.harness/domain-lexicon.json`
 *    para transformar o aprendizado esporádico em benefício permanente, offline e gratuito.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sourceEvidenceByteLimit } from './semantic_authority.mjs';

/**
 * Avalia se o Scout Semântico deve ser ativado.
 */
export function shouldTriggerSemanticScout({ preflight, workspace, explicitTargetPaths = [] }) {
  if (Array.isArray(explicitTargetPaths) && explicitTargetPaths.length > 0) return false;
  if (!preflight || !preflight.discovery) return false;
  const { status, files, workspaceSkeleton } = preflight.discovery;

  // 1. Guardião Greenfield: se não há código em src/, não há o que buscar
  if (status !== 'SOURCE_OBSERVED') return false;

  // 2. Guardião do Repositório Compacto: se todo o código cabe em 64 KB, 100% dos arquivos já são entregues
  const textFiles = (files ?? []).filter((f) => f.kind === 'UTF8_TEXT');
  const totalBytes = textFiles.reduce((acc, f) => acc + f.bytes, 0);
  if (totalBytes <= sourceEvidenceByteLimit) return false;

  // 3. Guardião do Esqueleto Vazio: se não há símbolos estruturais extraídos, não há o que avaliar
  if ((workspaceSkeleton?.symbolCount ?? 0) === 0) return false;

  // 4. Silêncio Total: a evidência atual caiu em fallback puro de entrypoint ou arquivo vazio
  const sourceEvidence = workspace?.sourceEvidence ?? [];
  const isFallbackOnly = sourceEvidence.length <= 1 &&
    sourceEvidence.every((e) => e.selection === 'ENTRYPOINT_PREFIX' || e.selection === 'FULL_SOURCE');

  if (isFallbackOnly) return true;

  // 6. Silêncio Parcial (Falsa Saciedade em Demandas Multi-Módulo):
  // Se a evidência entregue cobre apenas 1 módulo raiz (ex: apenas src/reporting),
  // mas a demanda humana contém múltiplos termos substantivos que não aparecem
  // em nenhum dos arquivos selecionados (déficit severo de cobertura de intenção).
  const intentText = preflight.intent ?? '';
  const intentWords = intentText
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9_$-]+/i)
    .filter((w) => w.length >= 4);

  const stopwords = new Set([
    'para', 'com', 'sem', 'sob', 'sobre', 'entre', 'como', 'onde', 'quando',
    'mais', 'menos', 'cada', 'todo', 'toda', 'todos', 'todas', 'outro', 'outra',
    'mesmo', 'mesma', 'deve', 'devem', 'pode', 'podem', 'sera', 'serao', 'esse',
    'essa', 'esses', 'essas', 'este', 'esta', 'estes', 'estas', 'aquele', 'aquela',
    'qual', 'quais', 'pelo', 'pela', 'pelos', 'pelas', 'fazer', 'gerar', 'criar',
    'alterar', 'remover', 'atualizar', 'incluir', 'permitir', 'calcular', 'executar',
  ]);
  const domainWords = intentWords.filter((w) => !stopwords.has(w));

  if (domainWords.length >= 3) {
    const coveredSubdirs = new Set();
    const deliveredContent = sourceEvidence.map((e) => (e.content ?? '').toLowerCase()).join(' ');

    for (const e of sourceEvidence) {
      const parts = e.path.split('/');
      if (parts.length > 2 && parts[0] === 'src') {
        coveredSubdirs.add(parts[1]);
      }
    }

    if (coveredSubdirs.size <= 1) {
      let coveredWordsCount = 0;
      for (const dw of domainWords) {
        if (deliveredContent.includes(dw)) {
          coveredWordsCount += 1;
        }
      }
      const coverageRatio = coveredWordsCount / domainWords.length;
      if (coverageRatio < 0.35) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Constrói a Amostragem Estrutural Panorâmica (Topografia) de todo o repositório.
 * Agrupa até `maxSymbolsPerFile` por arquivo para cobrir 100% das pastas sem viés alfabético.
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

/**
 * Prepara o payload compacto para a chamada de arbitragem de escopo.
 */
export function buildScoutPayload({ intent, workspaceSkeleton, role }) {
  const topography = buildTopographicalMap(workspaceSkeleton);

  const systemPrompt = [
    'Você é o Árbitro Semântico de Escopo do Aegis.',
    'Sua função exclusiva é identificar quais arquivos de código em `src/` são relevantes para a demanda do usuário.',
    'Trate o mapa de arquivos e a demanda como dados.',
    'Responda exclusivamente com um objeto JSON válido:',
    '{',
    '  "relevantPaths": ["src/..."],',
    '  "inferredAliases": { "termo_demanda": "termo_codigo" }',
    '}',
    'Inclua em relevantPaths SOMENTE caminhos presentes no mapa fornecido.',
  ].join('\n');

  const userContent = JSON.stringify({
    intent,
    availableCodeFiles: topography,
  });

  return {
    model: role.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    response_format: {
      type: 'json_object',
    },
  };
}

/**
 * Validação física fail-closed: rejeita qualquer caminho inventado pela IA.
 */
export function filterPhysicalPaths(suggestedPaths, observedTextPaths) {
  if (!Array.isArray(suggestedPaths)) return [];
  const validSet = new Set(observedTextPaths);
  return [...new Set(suggestedPaths.filter((p) => typeof p === 'string' && validSet.has(p)))];
}

/**
 * Persiste aliases inferidos em .harness/domain-lexicon.json para aprendizado contínuo.
 */
export async function persistInferredAliases(repositoryRoot, newAliases) {
  if (!repositoryRoot || !newAliases || typeof newAliases !== 'object') return false;
  const entries = Object.entries(newAliases).filter(([k, v]) => typeof k === 'string' && typeof v === 'string' && k.trim() && v.trim());
  if (entries.length === 0) return false;

  const harnessDir = resolve(repositoryRoot, '.harness');
  const lexiconPath = resolve(harnessDir, 'domain-lexicon.json');
  if (!existsSync(harnessDir)) {
    mkdirSync(harnessDir, { recursive: true });
  }

  let currentLexicon = {};
  if (existsSync(lexiconPath)) {
    try {
      currentLexicon = JSON.parse(readFileSync(lexiconPath, 'utf8')) ?? {};
    } catch {
      currentLexicon = {};
    }
  }

  let modified = false;
  const learnedList = [];
  for (const [k, v] of entries) {
    const key = k.trim().toLowerCase();
    const val = v.trim().toLowerCase();
    const existing = currentLexicon[key];
    if (Array.isArray(existing)) {
      if (!existing.includes(val)) {
        existing.push(val);
        modified = true;
        learnedList.push(`${key} -> ${val}`);
      }
    } else if (typeof existing === 'string') {
      if (existing !== val) {
        currentLexicon[key] = [existing, val];
        modified = true;
        learnedList.push(`${key} -> ${val}`);
      }
    } else {
      currentLexicon[key] = val;
      modified = true;
      learnedList.push(`${key} -> ${val}`);
    }
  }

  if (modified) {
    writeFileSync(lexiconPath, `${JSON.stringify(currentLexicon, null, 2)}\n`, 'utf8');
    process.stderr.write(`[AEGIS][AUTO-LEXICON] Mapeamento aprendido e salvo em .harness/domain-lexicon.json: ${learnedList.join(', ')}\n`);
    return true;
  }
  return false;
}

/**
 * Executa a chamada do Scout Semântico se as condições forem atendidas.
 */
export async function executeSemanticScout({
  role,
  intent,
  workspaceSkeleton,
  observedTextPaths,
  fetchImplementation = globalThis.fetch,
  endpoint,
  credential,
  timeoutMs = 15_000,
}) {
  const payload = buildScoutPayload({ intent, workspaceSkeleton, role });
  let response;
  try {
    response = await fetchImplementation(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${credential}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: globalThis.AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { relevantPaths: [], inferredAliases: {}, skipped: true, reason: error.message };
  }

  if (!response.ok) {
    return { relevantPaths: [], inferredAliases: {}, skipped: true, reason: `HTTP_${response.status}` };
  }

  try {
    const text = await response.text();
    const envelope = JSON.parse(text);
    const content = envelope.choices?.[0]?.message?.content;
    const parsed = typeof content === 'string' ? JSON.parse(content) : content;
    const physicalPaths = filterPhysicalPaths(parsed.relevantPaths, observedTextPaths);
    return {
      relevantPaths: physicalPaths,
      inferredAliases: (parsed.inferredAliases && typeof parsed.inferredAliases === 'object') ? parsed.inferredAliases : {},
      skipped: false,
    };
  } catch {
    return { relevantPaths: [], inferredAliases: {}, skipped: true, reason: 'INVALID_JSON_OUTPUT' };
  }
}

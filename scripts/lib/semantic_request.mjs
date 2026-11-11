import { Buffer } from 'node:buffer';
import { lstatSync, readFileSync } from 'node:fs';
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

function matchSkeletonSymbols(symbols, intent, domainAliases = {}) {
  const stripped = stripDiacritics(intent);
  const words = stripped.split(/[^a-z0-9_$-]+/i).filter((w) => w.length >= 3);
  if (words.length === 0) return [];
  const stems = words.map((w) => (w.length >= 4 ? w.slice(0, 4) : w));

  const scored = [];
  for (const sym of symbols) {
    if (!sym.name) continue;
    const subtokens = extractSubtokens(sym.name);
    let score = 0;
    for (const sub of subtokens) {
      const subStem = sub.length >= 4 ? sub.slice(0, 4) : sub;
      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const stem = stems[i];
        const alias = domainAliases[word];
        if (sub === word || (alias && sub === alias)) {
          score += 3;
        } else if (stem.length >= 4 && (sub.startsWith(stem) || word.startsWith(subStem))) {
          score += 2;
        }
      }
    }
    if (stripped.includes(stripDiacritics(sym.name))) {
      score += 5;
    }
    if (score > 0) {
      scored.push({ path: sym.path, line: sym.startLine, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

function computeSymbolAffinity(sym, words, stems, entrypoints) {
  let score = 100;
  if (sym.docComment && sym.docComment.includes('@deprecated')) score -= 300;
  if (sym.path.includes('/legacy/') || sym.path.includes('deprecated_') || sym.path.includes('trap')) score -= 200;
  if (entrypoints.includes(sym.path)) score += 200;

  const subtokens = extractSubtokens(sym.name);
  let matchScore = 0;
  for (const sub of subtokens) {
    const subStem = sub.length >= 4 ? sub.slice(0, 4) : sub;
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const stem = stems[i];
      if (sub === word) matchScore += 30;
      else if (stem.length >= 4 && (sub.startsWith(stem) || word.startsWith(subStem))) matchScore += 20;
    }
  }
  return score + matchScore * 10;
}

function prioritizeWorkspaceSkeleton(skeleton, intent, entrypoints = [], maxPromptSymbols = 512) {
  if (!skeleton || !Array.isArray(skeleton.symbols)) return skeleton;
  const stripped = stripDiacritics(intent ?? '');
  const words = stripped.split(/[^a-z0-9_$-]+/i).filter((w) => w.length >= 3);
  const stems = words.map((w) => (w.length >= 4 ? w.slice(0, 4) : w));

  const sorted = [...skeleton.symbols].sort((a, b) => {
    const affinityA = computeSymbolAffinity(a, words, stems, entrypoints);
    const affinityB = computeSymbolAffinity(b, words, stems, entrypoints);
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

function buildSourceEvidence(repositoryRoot, preflight, workspaceObservation = null) {
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
    // 1. Prioritize symbols from workspaceSkeleton matched via subtokens and stems
    if (preflight.discovery.workspaceSkeleton?.symbols) {
      const intent = preflight.intent ?? '';
      const matched = matchSkeletonSymbols(preflight.discovery.workspaceSkeleton.symbols, intent);
      for (const { path, line } of matched) {
        if (!selectionsByPath.has(path)) {
          selectionsByPath.set(path, { path, lines: [] });
        }
        selectionsByPath.get(path).lines.push(line);
      }
    }
    // 2. Fallback to lexical matches if present
    for (const match of preflight.discovery.lexicalEvidence?.matches ?? []) {
      if (!selectionsByPath.has(match.path)) {
        selectionsByPath.set(match.path, { path: match.path, lines: [] });
      }
      if (typeof match.line === 'number') {
        selectionsByPath.get(match.path).lines.push(match.line);
      }
    }
    // 3. Entrypoints
    for (const entrypoint of entrypoints) {
      if (!selectionsByPath.has(entrypoint)) {
        selectionsByPath.set(entrypoint, { path: entrypoint, lines: [] });
      }
    }
    // 4. Default to first text file if still empty
    if (selectionsByPath.size === 0 && textFiles[0] !== undefined) {
      selectionsByPath.set(textFiles[0].path, { path: textFiles[0].path, lines: [] });
    }
  }

  const evidence = [];
  let remainingBytes = sourceEvidenceByteLimit;
  for (const { path, lines } of selectionsByPath.values()) {
    if (remainingBytes === 0) break;
    const manifestEntry = filesByPath.get(path);
    if (manifestEntry === undefined) continue;
    const bytes = verifiedTextSource(repositoryRoot, manifestEntry, workspaceObservation);
    const limit = Math.min(smallWorkspace ? bytes.byteLength : sourceEvidenceFileByteLimit, remainingBytes);

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
}) {
  const intentEvidence = buildIntentEvidence(preflight.intent);
  const textFiles = preflight.discovery.files.filter(({ kind }) => kind === 'UTF8_TEXT');
  const entrypoints = textFiles.map(({ path }) => path)
    .filter((path) => /(?:^|\/)(?:index|main|__main__|mod|entrypoint|run|app)\.[^/]+$/iu.test(path));
  const prioritizedSkeleton = preflight.discovery.workspaceSkeleton
    ? prioritizeWorkspaceSkeleton(
        preflight.discovery.workspaceSkeleton,
        preflight.intent,
        entrypoints,
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
      ...(preflight.discovery.lexicalEvidence
        ? {
            lexicalEvidence: {
              status: preflight.discovery.lexicalEvidence.status,
              termsTruncated: preflight.discovery.lexicalEvidence.termsTruncated,
              matches: preflight.discovery.lexicalEvidence.matches
                .map(({ term, sourceToken, matchKind, path, line, sourceRegion }) => ({
                  term, sourceToken, matchKind, path, line, sourceRegion,
                })),
            },
          }
        : {}),
      sourceEvidence: buildSourceEvidence(repositoryRoot, preflight, workspaceObservation),
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

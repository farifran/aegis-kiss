import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canonicalDigest, sha256 } from './canonical_json.mjs';
import { buildIntentEvidence } from './intent_evidence.mjs';
import { assertSchema } from './schema_validator.mjs';
import { buildSemanticOutputSchema } from './semantic_output_schema.mjs';
import {
  buildSourceEvidence,
  computeSymbolIdfWeights,
  extractTargetPrefixesAndDirs,
  getLongestMatchingPrefixLength,
  ignoredDomainTokens,
  loadDomainLexicon,
  prioritizeWorkspaceSkeleton,
  stripDiacritics,
} from './source_evidence.mjs';

export {
  extractTargetPrefixesAndDirs,
  getLongestMatchingPrefixLength,
  loadDomainLexicon,
};

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
  const knownSubdirs = new Set();
  for (const file of textFiles) {
    const parts = file.path.split('/');
    if (parts.length > 2) knownSubdirs.add(parts[1]);
  }
  const { targetDirs, targetPrefixes, explicitFilePaths } = extractTargetPrefixesAndDirs(
    preflight.intent,
    knownSubdirs,
    domainAliases,
  );

  let precomputedIdf = null;
  if (preflight.discovery.workspaceSkeleton?.symbols) {
    const stripped = stripDiacritics(preflight.intent ?? '');
    const rawWords = stripped.split(/[^a-z0-9_$-]+/i).filter((w) => w.length >= 3);
    const words = rawWords.filter((w) => !ignoredDomainTokens.has(w));
    const stems = words.map((w) => (w.length >= 4 ? w.slice(0, 4) : w));
    precomputedIdf = computeSymbolIdfWeights(
      preflight.discovery.workspaceSkeleton.symbols,
      words,
      stems,
      domainAliases,
    );
  }

  const prioritizedSkeleton = preflight.discovery.workspaceSkeleton
    ? prioritizeWorkspaceSkeleton(
      preflight.discovery.workspaceSkeleton,
      preflight.intent,
      entrypoints,
      512,
      domainAliases,
      targetPrefixes,
      precomputedIdf,
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
      sourceEvidence: buildSourceEvidence(
        repositoryRoot,
        preflight,
        workspaceObservation,
        explicitTargetPaths,
        { targetDirs, targetPrefixes, explicitFilePaths, domainAliases, precomputedIdf },
      ),
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

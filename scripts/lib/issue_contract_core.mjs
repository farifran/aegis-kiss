import { Buffer } from 'node:buffer';
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { TextDecoder } from 'node:util';
import { canonicalDigest, sha256 } from './canonical_json.mjs';

const maxDemandBytes = 65_536;

function hasUnsafeControlCharacter(text) {
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if ((codePoint < 0x20 && codePoint !== 0x09 && codePoint !== 0x0A) || codePoint === 0x7F) {
      return true;
    }
  }
  return false;
}

/**
 * Captura exatamente um argumento textual, sem reconstruir tokens do shell.
 * Normaliza quebras de linha e equivalência Unicode, preservando a semântica.
 */
export function captureDemand(args) {
  if (!Array.isArray(args) || args.length !== 1 || typeof args[0] !== 'string') {
    throw new Error('invalid_demand_arity');
  }
  const text = args[0].replace(/\r\n?/gu, '\n').normalize('NFC');
  if (text.trim().length === 0) {
    throw new Error('empty_demand');
  }
  if (hasUnsafeControlCharacter(text)) {
    throw new Error('unsafe_control_character');
  }
  if (Buffer.byteLength(text, 'utf8') > maxDemandBytes) {
    throw new Error('input_too_large');
  }
  return text;
}

function pathRoleBadge(p) {
  if (p.endsWith('.proof.sh') || p.endsWith('.proof.ts')) return ' **[DETERMINISTIC_PROOF]** *(Tribunal de provas físicas)*';
  if (p.endsWith('.ts') || p.endsWith('.mjs') || p.endsWith('.js')) return ' **[OBSERVED_SOURCE]** *(Fronteira pública observada)*';
  return '';
}

const discoveryFileLimit = 256;
const discoveryEntryLimit = 512;
const discoveryByteLimit = 1_048_576;
const discoveryTermLimit = 64;
const demandTermPattern = /[\p{L}\p{N}_$-]{4,}/gu;
const bidirectionalControlPattern = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function portableRelativePath(repositoryRoot, absolutePath) {
  const nativePath = relative(repositoryRoot, absolutePath);
  return sep === '\\' ? nativePath.replaceAll('\\', '/') : nativePath;
}

function demandTerms(text) {
  const termsByKey = new Map();
  for (const match of text.matchAll(demandTermPattern)) {
    const term = match[0];
    const key = term.normalize('NFC').toLowerCase();
    if (!termsByKey.has(key)) termsByKey.set(key, term);
  }
  const terms = [...termsByKey.entries()].map(([key, term]) => ({ key, term }));
  return {
    terms: terms.slice(0, discoveryTermLimit),
    termsTruncated: terms.length > discoveryTermLimit,
  };
}

function assignLineNumbers(text, pendingMatches) {
  const orderedMatches = [...pendingMatches].sort((left, right) => left.offset - right.offset);
  let line = 1;
  let cursor = 0;
  for (const match of orderedMatches) {
    while (cursor < match.offset) {
      if (text.charCodeAt(cursor) === 0x0A) line += 1;
      cursor += 1;
    }
    match.line = line;
  }
}

function buildLexicalEvidence(sourceRecords, intent) {
  const { terms, termsTruncated } = demandTerms(intent);
  const pendingTerms = new Map(terms.map(({ key, term }) => [key, term]));
  const matches = [];

  for (const record of sourceRecords) {
    if (pendingTerms.size === 0) break;
    const lowerText = record.text.normalize('NFC').toLowerCase();
    const recordMatches = [];
    for (const [key, term] of pendingTerms) {
      const offset = lowerText.indexOf(key);
      if (offset === -1) continue;
      recordMatches.push({ term, path: record.path, offset });
      pendingTerms.delete(key);
    }
    assignLineNumbers(lowerText, recordMatches);
    matches.push(...recordMatches.map(({ term, path, line }) => ({ term, path, line })));
  }

  const applicable = sourceRecords.length > 0 && terms.length > 0;

  return {
    status: applicable ? (matches.length > 0 ? 'MATCH' : 'NO_MATCH') : 'NOT_APPLICABLE',
    method: 'NFC_UNICODE_LOWERCASE_SUBSTRING',
    queryTerms: terms.map(({ term }) => term),
    termsTruncated,
    matches,
  };
}

export function computeSourceSnapshotDigest(files, ignoredEntries) {
  return canonicalDigest({
    sourceRoot: 'src',
    files,
    ignoredEntries,
  });
}

/**
 * Descobre apenas fatos estruturais já presentes em src/.
 * Todo o resultado existe em RAM até ser incorporado à evidência do contrato.
 */
export function discoverWorkspace(repositoryRoot, intent = '') {
  const sourceRoot = resolve(repositoryRoot, 'src');
  const sourceRecords = [];
  const files = [];
  const ignoredEntries = [];
  let visitedEntries = 0;
  let scannedBytes = 0;

  function inspectDirectory(directory) {
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      visitedEntries += 1;
      if (visitedEntries > discoveryEntryLimit) {
        throw new Error('discovery_entry_limit_exceeded');
      }
      const absolutePath = resolve(directory, entry.name);
      const relativePath = portableRelativePath(repositoryRoot, absolutePath);
      if (bidirectionalControlPattern.test(relativePath)) {
        throw new Error('unsafe_source_path');
      }
      if (entry.isSymbolicLink()) {
        ignoredEntries.push({ path: relativePath, reason: 'SYMLINK' });
        continue;
      }
      if (entry.isDirectory()) {
        inspectDirectory(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (files.length >= discoveryFileLimit) {
        throw new Error('discovery_file_limit_exceeded');
      }

      const metadata = statSync(absolutePath);
      if (scannedBytes + metadata.size > discoveryByteLimit) {
        throw new Error('discovery_byte_limit_exceeded');
      }

      const sourceBytes = readFileSync(absolutePath);
      if (scannedBytes + sourceBytes.byteLength > discoveryByteLimit) {
        throw new Error('discovery_byte_limit_exceeded');
      }
      scannedBytes += sourceBytes.byteLength;
      const file = {
        path: relativePath,
        bytes: sourceBytes.byteLength,
        digest: sha256(sourceBytes),
        kind: 'UTF8_TEXT',
      };
      if (sourceBytes.includes(0)) {
        file.kind = 'BINARY';
        files.push(file);
        continue;
      }
      let sourceText;
      try {
        sourceText = utf8Decoder.decode(sourceBytes);
      } catch {
        file.kind = 'INVALID_UTF8';
        files.push(file);
        continue;
      }
      files.push(file);
      sourceRecords.push({ path: relativePath, text: sourceText });
    }
  }

  if (existsSync(sourceRoot)) {
    const sourceRootMetadata = lstatSync(sourceRoot);
    if (sourceRootMetadata.isSymbolicLink()) {
      throw new Error('discovery_source_root_symlink');
    }
    if (!sourceRootMetadata.isDirectory()) {
      throw new Error('invalid_source_root');
    }
    inspectDirectory(sourceRoot);
  }
  files.sort((left, right) => compareText(left.path, right.path));
  ignoredEntries.sort((left, right) => compareText(left.path, right.path));
  sourceRecords.sort((left, right) => compareText(left.path, right.path));
  const lexicalEvidence = buildLexicalEvidence(sourceRecords, intent);
  const hasTextSource = files.some(({ kind }) => kind === 'UTF8_TEXT');

  return {
    sourceRoot: 'src',
    status: hasTextSource
      ? 'SOURCE_OBSERVED'
      : (files.length > 0 || ignoredEntries.length > 0 ? 'NO_TEXT_SOURCE' : 'EMPTY_SOURCE'),
    files,
    ignoredEntries,
    visitedEntries,
    scannedBytes,
    sourceSnapshotDigest: computeSourceSnapshotDigest(files, ignoredEntries),
    lexicalEvidence,
  };
}

/**
 * Compila somente os fatos mecânicos das Fases 1 a 3.
 * Deliberação, requisitos, riscos e provas pertencem às fases seguintes.
 */
export function buildPreflightHandoff({ demand, discovery }) {
  const handoff = {
    schema: 'aegis.preflight_handoff.v2',
    phase: 'DISCOVERED',
    status: 'SEMANTIC_DELIBERATION_REQUIRED',
    intent: demand,
    capture: {
      provenance: 'USER',
      transport: 'ARGV_STRING',
      unicodeNormalization: 'NFC',
      lineEndings: 'LF',
      byteLength: Buffer.byteLength(demand, 'utf8'),
    },
    discovery,
  };
  return {
    ...handoff,
    preflightDigest: computePreflightDigest(handoff),
  };
}

export function computePreflightDigest(preflight) {
  const { preflightDigest, ...digestInput } = preflight;
  void preflightDigest;
  return canonicalDigest(digestInput);
}

export const CANONICAL_RULE_STATEMENTS = {
  'ARCH-FAILURE-EXPLICIT': 'Nenhuma falha relevante pode desaparecer silenciosamente; a operação deve expor resultado, erro explícito, estado preservado ou rollback verificável.',
  'ARCH-DETERMINISTIC-TIME': 'Comportamento que depende de tempo deve receber uma referência temporal explícita ou usar uma fonte reproduzível. O relógio do sistema não pode alterar o resultado de forma implícita; uma exceção requer emenda arquitetural aprovada.',
};

/**
 * Renderiza a Issue-Contrato em Markdown legível para o desenvolvedor na IDE.
 * Esta é a Face Humana da Issue-Contrato.
 */
export function renderContractMarkdown(
  contract,
  isGoverned = false,
  contractDigest = '',
  policyRules = [],
  receiptDigest = '',
) {
  const stateKind = contract.stateModel?.kind;

  const ruleMap = new Map(Object.entries(CANONICAL_RULE_STATEMENTS));
  if (Array.isArray(policyRules)) {
    for (const r of policyRules) {
      if (r?.id && r?.statement) ruleMap.set(r.id, r.statement);
    }
  }

  const appliedRuleIds = contract.architecture?.appliedRuleIds || [];
  const ruleEntries = appliedRuleIds.map((rId) => {
    const stmt = ruleMap.get(rId);
    return stmt ? `> - \`${rId}\`: ${stmt}` : `> - \`${rId}\``;
  });

  const isProven = Boolean(receiptDigest);
  let statusText;
  if (isProven) {
    statusText = 'Verificado & Provado (PROVEN)';
  } else if (isGoverned) {
    statusText = 'Selado & Governado (Assinado)';
  } else {
    statusText = 'Rascunho Pré-Cozinhado (Aguardando Confirmação Humana)';
  }

  const lines = [
    `# Issue / Contrato: ${contract.title}`,
    '',
    `> **Status:** ${statusText}`,
    `> **Modo:** ${contract.changeKind}`,
    `> **Modelo de Estado:** ${stateKind === 'NONE' ? 'Sem estado' : stateKind === 'STATE_TRANSITION' ? 'Transição de estado' : 'Não declarado pela demanda'}`,
    ...(ruleEntries.length > 0 ? ['> **Regras Arquiteturais:**', ...ruleEntries] : []),
    ...(isGoverned && contractDigest ? [`> **Digest do Contrato:** \`${contractDigest}\``] : []),
    `> **Pré-voo de origem:** \`${contract.sourcePreflightDigest}\``,
    `> **Snapshot de \`src/\`:** \`${contract.sourceSnapshotDigest}\``,
    ...(isProven && receiptDigest ? [`> **Digest do Recibo:** \`${receiptDigest}\``] : []),
    '',
    '## 1. Intenção & Escopo',
    contract.intent,
    '',
    '### Fronteira Observável Declarada:',
    ...contract.scope.observedPaths.map((path) => `- \`${path}\`${pathRoleBadge(path)}`),
    '',
    '### Fronteira Pública Obrigatória (API Surface):',
    '> O contrato descreve comportamento observável. Não autoriza criar ou alterar arquivos de produto.',
    '> **IMPLEMENTATION_AUTHORIZED:** `false`',
    '',
    '### Disciplina de Evidência & Não-Alucinação (Constituição Lei II):',
    '- **Fatos Fornecidos (KNOWN):**',
    ...((contract.evidenceDiscipline?.knownFacts?.length ?? 0) > 0
      ? contract.evidenceDiscipline.knownFacts.map((k) => `  - ${k}`)
      : [`  - Demanda textual do usuário (provenance: USER): "${contract.intent.replace(/\n+/g, ' ').trim()}"`]),
    '- **Lacunas & Fatos Ausentes (UNKNOWN):**',
    ...((contract.evidenceDiscipline?.unknownFacts?.length ?? 0) > 0
      ? contract.evidenceDiscipline.unknownFacts.map((u) => `  - ${u}`)
      : ((contract.decisions ?? []).length > 0
        ? contract.decisions.map((d) => `  - [${d.questionId}] ${d.question} (Submetido a deliberação no Wizard)`)
        : ['  - Nenhuma lacuna material não fornecida que altere o comportamento observável. Suposições arbitrárias proibidas.'])),
    '',
    '## 2. Requisitos de Negócio (BEH)',
    ...(contract.behavior ?? []).map((b) => `- [x] **${b.id}:** ${b.statement}`),
    '',
  ];

  if ((contract.preconditions ?? []).length > 0) {
    lines.push('### Pré-condições (PRE):');
    for (const pre of contract.preconditions) {
      lines.push(`- **${pre.id}:** ${pre.statement}`);
    }
    lines.push('');
  }

  if ((contract.postconditions ?? []).length > 0) {
    lines.push('### Pós-condições (POST):');
    for (const post of contract.postconditions) {
      lines.push(`- **${post.id}:** ${post.statement}`);
    }
    lines.push('');
  }

  lines.push('## 3. Invariantes & Regras Não-Negociáveis (INV)');
  for (const inv of (contract.invariants ?? [])) {
    lines.push(`- [x] **${inv.id}:** ${inv.statement} *(Provas: ${inv.proofIds.join(', ')})*`);
  }
  lines.push('');

  lines.push('## 4. Semântica de Falhas e Tratamento de Erros (FAIL)');
  for (const f of (contract.failureSemantics ?? [])) {
    lines.push(`- **${f.id}:** Quando *${f.trigger}* $\\to$ Resultado: *${f.observableResult}*`);
  }
  lines.push('');

  if ((contract.decisions ?? []).length > 0) {
    const isGov = Boolean(contractDigest);
    lines.push(isGov ? '## 5. Decisões Seladas' : '## 5. Decisões Pendentes de Confirmação');
    for (const decision of contract.decisions) {
      lines.push('');
      lines.push(`### ${decision.questionId}: ${decision.question}`);
      for (const answer of decision.answers) {
        const isSelected = Boolean(decision.selectedAnswerId && answer.id === decision.selectedAnswerId);
        const mark = isSelected ? '(*)' : '( )';
        const badge = answer.recommended ? ' **[RECOMENDADO]**' : '';
        lines.push(`${mark} **${answer.label}**${badge}: ${answer.rationale}`);
      }
    }
  } else {
    lines.push('## 5. Decisões');
    lines.push('Nenhuma ambiguidade material detectada na demanda.');
  }

  lines.push('');
  lines.push('## 6. Obrigações de Prova Física Obrigatórias');
  for (const proof of (contract.proofObligations ?? [])) {
    lines.push(`- \`${proof.id}\` (\`${proof.cadence}\`): ${proof.obligation} $\\to$ \`${proof.entrypoint}\``);
  }

  if ((contract.failureSemantics ?? []).length > 0) {
    lines.push('');
    lines.push('### Vetores Canônicos de Aceite e Invariantes:');
    lines.push('| Vetor / Cenário | Categoria | Resultado Esperado | Invariante / Regra Coberta |');
    lines.push('| :--- | :--- | :--- | :--- |');
    for (const failure of contract.failureSemantics) {
      lines.push(`| ${failure.trigger} | Adversarial | ${failure.observableResult} | ${failure.requirementIds?.join(', ') || 'Contrato'} |`);
    }
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * Calcula o hash raiz único da Issue-Contrato (contractDigest).
 */
export function computeContractDigest(contract) {
  return canonicalDigest(contract);
}

/**
 * Gera o registro formal de provas (proof registry) a partir das obrigações da Issue-Contrato.
 */
export function createProofRegistry(contract) {
  const rank = { always: 0, targeted: 1, release: 2, forensic: 3 };
  const profiles = ['fast', 'targeted', 'release', 'forensic'].map((id, profileRank) => ({
    id,
    proofIds: contract.proofObligations.flatMap((proof) => (
      rank[proof.cadence ?? 'always'] <= profileRank ? [proof.id] : []
    )),
  }));
  const proofs = contract.proofObligations.map((proof) => {
    const executor = proof.entrypoint.endsWith('.ts') ? 'node' : 'bash';
    let argv = proof.entrypoint.endsWith('.ts') ? ['--import', 'tsx', proof.entrypoint] : [proof.entrypoint];
    if (proof.id === 'PO-ARCH-STATIC' || proof.entrypoint.endsWith('static_gate.sh')) {
      argv = [proof.entrypoint, '--workspace', 'src'];
    }
    return {
      id: proof.id,
      risk: proof.risk,
      coverageKey: proof.coverageKey,
      authority: 'deterministic_tribunal',
      cost: proof.cost,
      cadence: proof.cadence,
      status: 'active',
      targets: proof.targets,
      executionKey: `proof-${canonicalDigest({ executor, argv }).slice(0, 12)}`,
      entrypoint: proof.entrypoint,
      executor,
      argv,
    };
  });

  return {
    schema: 'aegis.proof_registry.v1',
    policy: {
      mode: 'enforced',
      maxActiveProofsPerProfile: { fast: 10, targeted: 10, release: 10, forensic: 10 },
    },
    profiles,
    proofs,
  };
}

/**
 * Carrega a política arquitetural oficial de governance/architecture.policy.json.
 */
export function loadArchitecturePolicy(repositoryRoot) {
  const policyPath = resolve(repositoryRoot, 'governance/architecture.policy.json');
  if (!existsSync(policyPath)) {
    throw new Error('architecture_policy_unavailable');
  }
  const policyText = readFileSync(policyPath, 'utf8');
  const policy = JSON.parse(policyText);
  return { policy, policyText, policyDigest: sha256(policyText) };
}

/**
 * Valida formalmente a Issue-Contrato contra o schema e regras arquiteturais.
 */
export function validateContract({ contract, policy }) {
  const proofIds = new Set((contract.proofObligations || []).map((p) => p.id));
  for (const inv of contract.invariants || []) {
    for (const proofId of inv.proofIds || []) {
      if (!proofIds.has(proofId)) {
        throw new Error(`invariant_without_proof:${proofId}`);
      }
    }
  }

  // Validador de Imunidade Constitucional (Constitutional Guardrail)
  for (const dec of contract.decisions || []) {
    const selectedAnswer = dec.answers?.find((a) => a.id === dec.selectedAnswerId);
    if (!selectedAnswer) {
      throw new Error(`unresolved_decision:${dec.questionId}`);
    }
    const recommendedAnswer = dec.answers?.find((answer) => answer.recommended === true);
    if (recommendedAnswer?.id !== dec.recommendedAnswerId) {
      throw new Error(`invalid_recommendation:${dec.questionId}`);
    }
    const isLaxId = /(?:lax|permissive|anti-pattern|overengineering)/i.test(selectedAnswer.id);
    const prescribesViolation = /(?:utilizar|permitir|adotar|habilitar|aceitar)\b.*\b(?:decorador|di global|any|abstrações permissivas)/iu.test(selectedAnswer.resolutionClause);
    const violatesConstitution = isLaxId || prescribesViolation;
    const hasAmendments = Array.isArray(contract.architecture?.amendmentIds) && contract.architecture.amendmentIds.length > 0;
    if (violatesConstitution && !hasAmendments) {
      throw new Error(`constitutional_conflict: A decisão ${dec.questionId} selecionou "${selectedAnswer.id}" que viola as regras estáticas de arquitetura sem uma emenda formal em architecture.amendmentIds.`);
    }
  }

  if (policy && policy.rules) {
    const appliedRuleIds = new Set(contract.architecture?.appliedRuleIds || []);
    for (const rule of policy.rules) {
      if (rule.level === 'hard' && !appliedRuleIds.has(rule.id) && rule.id === 'ARCH-FAILURE-EXPLICIT') {
        throw new Error(`missing_mandatory_rule:${rule.id}`);
      }
    }
  }
}

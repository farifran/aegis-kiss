import { Buffer } from 'node:buffer';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import { canonicalDigest, sha256 } from './canonical_json.mjs';

export const maxDemandBytes = 65_536;

/**
 * Sanitiza o texto de entrada sem fatiamento arbitrário em UNITs.
 * Valida UTF-8 estrito, normaliza quebras de linha Unix e impõe teto de segurança.
 */
export function sanitizeInputText(rawBytes, maxBytes = maxDemandBytes) {
  if (!Buffer.isBuffer(rawBytes) || rawBytes.length > maxBytes) {
    throw new Error('input_too_large');
  }
  let decoded;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(rawBytes);
  } catch {
    throw new Error('invalid_utf8');
  }
  const text = decoded.replace(/\r\n?/gu, '\n');
  if (text.trim().length === 0) {
    throw new Error('empty_demand');
  }
  return text;
}

function pathRoleBadge(p) {
  if (p.endsWith('semantic-state.json')) return ' **[AUTHORITATIVE_STATE]** *(Raiz criptográfica de custódia)*';
  if (p.endsWith('.proof.sh') || p.endsWith('.proof.ts')) return ' **[DETERMINISTIC_PROOF]** *(Tribunal de provas físicas)*';
  if (p.endsWith('.ts') || p.endsWith('.mjs') || p.endsWith('.js')) return ' **[ENTRYPOINT_SOURCE]** *(Implementação da API pública)*';
  return '';
}

/**
 * Normaliza títulos de demandas informais para títulos executivos canônicos.
 * Totalmente agnóstico a regras de negócio particulares.
 */
export function normalizeDemandTitle(raw) {
  const line = raw.split('\n')[0].trim().replace(/^#+\s*/u, '').replace(/^["']|["']$/gu, '');
  if (!line) return 'Demanda do Produto';
  const cleaned = line.charAt(0).toUpperCase() + line.slice(1);
  return cleaned.length > 100 ? `${cleaned.slice(0, 97)}...` : cleaned;
}

const discoveryFileLimit = 256;
const discoveryEntryLimit = 512;
const discoveryByteLimit = 1_048_576;
const discoveryTermLimit = 64;
const demandTermPattern = /[\p{L}\p{N}_$-]{4,}/gu;
const forensicOccurrenceLimit = 24;

function demandTerms(text) {
  const termsByKey = new Map();
  for (const match of text.matchAll(demandTermPattern)) {
    const term = match[0];
    const key = term.toLocaleLowerCase('und');
    if (!termsByKey.has(key)) termsByKey.set(key, term);
  }
  const terms = [...termsByKey.entries()].map(([key, term]) => ({ key, term }));
  return {
    terms: terms.slice(0, discoveryTermLimit),
    termsTruncated: terms.length > discoveryTermLimit,
  };
}

function lineNumberAt(text, offset) {
  return text.slice(0, offset).split('\n').length;
}

function buildForensicEvidence(sourceRecords, intent) {
  const { terms, termsTruncated } = demandTerms(intent);
  const occurrences = [];
  const matchedTerms = new Set();

  for (const record of sourceRecords) {
    const lowerText = record.text.toLocaleLowerCase('und');
    for (const { key, term } of terms) {
      const offset = lowerText.indexOf(key);
      if (offset === -1) continue;
      matchedTerms.add(key);
      if (occurrences.length < forensicOccurrenceLimit) {
        occurrences.push({ term, path: record.path, line: lineNumberAt(record.text, offset) });
      }
    }
  }

  const unmatchedTerms = terms
    .filter(({ key }) => !matchedTerms.has(key))
    .map(({ term }) => term);

  return {
    relationStatus: occurrences.length > 0 ? 'LEXICAL_MATCH' : 'NO_LEXICAL_MATCH',
    matchKind: 'CASE_FOLDED_SUBSTRING',
    queryTerms: terms.map(({ term }) => term),
    termsTruncated,
    occurrences,
    unmatchedTerms,
  };
}

/**
 * Descobre apenas fatos estruturais já presentes em src/.
 * Todo o resultado existe em RAM até ser incorporado à evidência do contrato.
 */
export function discoverWorkspace(repositoryRoot, intent = '') {
  const sourceRoot = resolve(repositoryRoot, 'src');
  const sourceRecords = [];
  const skippedFiles = [];
  let visitedEntries = 0;
  let inspectedFiles = 0;
  let scannedBytes = 0;

  function inspectDirectory(directory) {
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      visitedEntries += 1;
      if (visitedEntries > discoveryEntryLimit) {
        throw new Error('discovery_entry_limit_exceeded');
      }
      const absolutePath = resolve(directory, entry.name);
      const relativePath = relative(repositoryRoot, absolutePath).replaceAll('\\', '/');
      if (entry.name === '.aegis') {
        skippedFiles.push({ path: relativePath, reason: 'AEGIS_STATE' });
        continue;
      }
      if (entry.isSymbolicLink()) {
        skippedFiles.push({ path: relativePath, reason: 'SYMLINK' });
        continue;
      }
      if (entry.isDirectory()) {
        inspectDirectory(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (inspectedFiles >= discoveryFileLimit) {
        throw new Error('discovery_file_limit_exceeded');
      }

      const metadata = statSync(absolutePath);
      inspectedFiles += 1;
      scannedBytes += metadata.size;
      if (scannedBytes > discoveryByteLimit) {
        throw new Error('discovery_byte_limit_exceeded');
      }

      const sourceBytes = readFileSync(absolutePath);
      if (sourceBytes.includes(0)) {
        skippedFiles.push({ path: relativePath, reason: 'BINARY' });
        continue;
      }
      let sourceText;
      try {
        sourceText = new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes);
      } catch {
        skippedFiles.push({ path: relativePath, reason: 'INVALID_UTF8' });
        continue;
      }
      sourceRecords.push({ path: relativePath, text: sourceText });
    }
  }

  if (existsSync(sourceRoot)) inspectDirectory(sourceRoot);
  sourceRecords.sort((left, right) => left.path.localeCompare(right.path));
  const sourceFiles = sourceRecords.map((record) => record.path);
  skippedFiles.sort((left, right) => left.path.localeCompare(right.path));
  const forensic = buildForensicEvidence(sourceRecords, intent);

  return {
    sourceRoot: 'src',
    sourceFiles,
    visitedEntries,
    inspectedFiles,
    scannedBytes,
    skippedFiles,
    relationStatus: sourceFiles.length === 0
      ? (skippedFiles.some(({ reason }) => reason !== 'AEGIS_STATE') ? 'NO_TEXT_SOURCE' : 'EMPTY_SOURCE')
      : forensic.relationStatus,
    matchKind: forensic.matchKind,
    queryTerms: forensic.queryTerms,
    termsTruncated: forensic.termsTruncated,
    occurrences: forensic.occurrences,
    unmatchedTerms: forensic.unmatchedTerms,
  };
}

/**
 * Compila somente os fatos mecânicos das Fases 1 e 2.
 * Deliberação, requisitos, riscos e provas pertencem às fases seguintes.
 */
export function buildPreflightHandoff({ sanitizedText, discovery }) {
  const handoff = {
    schema: 'aegis.preflight_handoff.v1',
    phase: 'DISCOVERED',
    status: 'SEMANTIC_DELIBERATION_REQUIRED',
    title: normalizeDemandTitle(sanitizedText),
    intent: sanitizedText,
    capture: {
      provenance: 'USER',
      encoding: 'UTF-8',
      lineEndings: 'LF',
      byteLength: Buffer.byteLength(sanitizedText, 'utf8'),
    },
    discovery: {
      sourceRoot: discovery.sourceRoot,
      sourceFiles: discovery.sourceFiles,
      visitedEntries: discovery.visitedEntries,
      inspectedFiles: discovery.inspectedFiles,
      scannedBytes: discovery.scannedBytes,
      skippedFiles: discovery.skippedFiles,
      relationStatus: discovery.relationStatus,
      matchKind: discovery.matchKind,
      queryTerms: discovery.queryTerms,
      termsTruncated: discovery.termsTruncated,
      occurrences: discovery.occurrences,
      unmatchedTerms: discovery.unmatchedTerms,
    },
  };
  return handoff;
}

function markdownCode(value) {
  const display = JSON.stringify(String(value));
  const longestRun = Math.max(0, ...(display.match(/`+/gu) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longestRun + 1);
  return `${fence}${display}${fence}`;
}

export function renderPreflightMarkdown(handoff) {
  const discovery = handoff.discovery;
  const lines = [
    `# Pré-voo: ${markdownCode(handoff.title)}`,
    '',
    '> **Status:** Discovery concluído — aguardando deliberação semântica',
    '> **Fases concluídas:** 1. Captura de intenção; 2. Discovery mecânico',
    '',
    '## Intenção capturada',
    ...handoff.intent.split('\n').map((line) => `    ${line}`),
    '',
    '## Discovery mecânico',
    `- Raiz examinada: ${markdownCode(`${discovery.sourceRoot}/`)}`,
    `- Arquivos textuais lidos: ${discovery.sourceFiles.length}`,
    `- Entradas visitadas: ${discovery.visitedEntries}`,
    `- Entradas inspecionadas: ${discovery.inspectedFiles}`,
    `- Bytes inspecionados: ${discovery.scannedBytes}`,
    `- Relação lexical: \`${discovery.relationStatus}\``,
    `- Método: \`${discovery.matchKind}\``,
  ];

  if (discovery.occurrences.length > 0) {
    lines.push('', '### Ocorrências lexicais');
    for (const occurrence of discovery.occurrences) {
      lines.push(`- ${markdownCode(occurrence.term)} em ${markdownCode(`${occurrence.path}:${occurrence.line}`)}`);
    }
  }
  if (discovery.skippedFiles.length > 0) {
    lines.push('', '### Entradas não lidas');
    for (const skipped of discovery.skippedFiles) {
      lines.push(`- ${markdownCode(skipped.path)}: ${skipped.reason}`);
    }
  }

  lines.push(
    '',
    '## Próxima fase',
    'A deliberação semântica deve propor o caminho feliz recomendado e as alternativas materiais. Só depois da escolha serão compilados requisitos, comportamento, invariantes, riscos e provas.',
    '',
    '> Ausência de correspondência lexical não significa ausência de requisito nem demanda incompleta.',
  );
  return lines.join('\n');
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
  const sourceScope = contract.scope?.authorizedPaths?.find((p) => p === 'src' || p === 'src/') ?? 'src';

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
    ...(isProven && receiptDigest ? [`> **Digest do Recibo:** \`${receiptDigest}\``] : []),
    '',
    '## 1. Intenção & Escopo',
    contract.intent,
    '',
    '### Arquivos Autorizados (Escopo Estrito):',
    ...contract.scope.authorizedPaths.map((path) => `- \`${path}\`${pathRoleBadge(path)}`),
    '',
    '### Fronteira Pública Obrigatória (API Surface):',
    '```typescript',
    `// Escopo de implementação autorizado: ${sourceScope}`,
    '// Assinaturas concretas serão definidas após o Discovery e a deliberação.',
    '```',
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
      executionKey: `proof-${canonicalDigest(proof.entrypoint).slice(0, 12)}`,
      executor: proof.entrypoint.endsWith('.ts') ? 'node' : 'bash',
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

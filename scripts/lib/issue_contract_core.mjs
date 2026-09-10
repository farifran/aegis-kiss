// ============================================================================
// AEGIS CONSTITUTIONAL DIRECTIVE: META-SYSTEM PURITY (AGENTS.md Cláusula 5)
//
// O Aegis Harness é estritamente um META-SISTEMA AGNÓSTICO DE GOVERNANÇA,
// CUSTÓDIA CRIPTOGRÁFICA E TRIBUNAL DE PROVAS FÍSICAS.
//
// É TERMINANTEMENTE PROIBIDO ACOPLAR REGRAS DE NEGÓCIO ESPECÍFICAS, NOMES DE DOMÍNIO
// OU HEURÍSTICAS DE DEMANDAS PARTICULARES.
// NESTE MÓDULO. O HARNESS OPERA EXCLUSIVAMENTE SOBRE ARQUÉTIPOS ABSTRATOS DE SOFTWARE,
// CONTRATOS FORMAIS E SCHEMAS UNIVERSAIS.
// ============================================================================

import { Buffer } from 'node:buffer';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import { canonicalDigest, sha256 } from './canonical_json.mjs';
import { assertSchema } from './schema_validator.mjs';

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
  const mainEntrypoint = contract.scope?.authorizedPaths?.find((p) => p.endsWith('.ts') && !p.endsWith('.proof.ts')) ?? 'src/index.ts';

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
    `> **Modelo de Estado:** ${stateKind === 'NONE' ? 'Sem estado' : stateKind === 'STATE_TRANSITION' ? 'Transição de estado' : 'Aguardando deliberação'}`,
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
    `// Ponto de exportação pública: ${mainEntrypoint}`,
    '// Assinaturas concretas pertencem ao contrato fornecido e às provas declaradas.',
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
  assertSchema('aegis.issue_contract.v1', contract);
  return canonicalDigest(contract);
}

/**
 * Converte as respostas do usuário em decisões formalmente seladas
 * e reconcilia semanticamente as cláusulas aprovadas com o comportamento observável.
 */
export function applyUserResolution(draftContract, userAnswers) {
  const answerMap = new Map(userAnswers.map((a) => [a.questionId, a.answerId ?? a.selectedAnswerId]));
  const correctionMap = new Map(userAnswers.filter((a) => a.correction).map((a) => [a.questionId, a.correction]));

  const updatedDecisions = (draftContract.decisions ?? []).map((decision) => {
    const correction = correctionMap.get(decision.questionId);
    let selected = answerMap.get(decision.questionId) ?? decision.recommendedAnswerId;
    let answers = decision.answers;

    if (correction) {
      const customId = `ANS-USER-${decision.questionId}`;
      selected = customId;
      answers = [
        ...decision.answers,
        {
          id: customId,
          label: `Interpretação do Usuário: ${correction}`,
          rationale: 'Fornecida diretamente pelo usuário no Wizard.',
          recommended: false,
          resolutionClause: correction,
        },
      ];
    }

    return {
      ...decision,
      answers,
      selectedAnswerId: selected,
    };
  });

  // Reconciliação Semântica: costura a cláusula resolvida no primeiro requisito comportamental
  const resolutionClauses = [];
  for (const dec of updatedDecisions) {
    const selectedAnswer = dec.answers.find((a) => a.id === dec.selectedAnswerId);
    if (selectedAnswer?.resolutionClause) {
      resolutionClauses.push(selectedAnswer.resolutionClause);
    }
  }

  let updatedBehavior = draftContract.behavior;
  if (resolutionClauses.length > 0 && Array.isArray(updatedBehavior) && updatedBehavior.length > 0) {
    const suffix = ` [Critério Resolvido: ${resolutionClauses.join('; ')}]`;
    updatedBehavior = updatedBehavior.map((b, index) => {
      if (index === 0 && !b.statement.includes('[Critério Resolvido:')) {
        return {
          ...b,
          statement: `${b.statement}${suffix}`,
        };
      }
      return b;
    });
  }

  const selectedStateKind = updatedDecisions.find((decision) => decision.questionId === 'Q-STATE-MODEL')?.selectedAnswerId;
  const stateModel = selectedStateKind === 'ANS-STATELESS'
    ? { kind: 'NONE' }
    : selectedStateKind === 'ANS-STATE-TRANSITION'
      ? { kind: 'STATE_TRANSITION' }
      : draftContract.stateModel;

  let updatedEvidence = draftContract.evidenceDiscipline;
  if (updatedEvidence && updatedDecisions.length > 0) {
    const updatedUnknown = updatedDecisions.map((d) => {
      const selected = d.answers.find((a) => a.id === d.selectedAnswerId);
      const selLabel = selected ? selected.label : d.selectedAnswerId;
      return `[${d.questionId}] ${d.question} -> Resolvido: ${selLabel}`;
    });
    updatedEvidence = {
      ...updatedEvidence,
      unknownFacts: updatedUnknown,
    };
  }

  const contract = {
    ...draftContract,
    behavior: updatedBehavior,
    decisions: updatedDecisions,
    ...(stateModel ? { stateModel } : {}),
    ...(updatedEvidence ? { evidenceDiscipline: updatedEvidence } : {}),
  };

  assertSchema('aegis.issue_contract.v1', contract);
  return contract;
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
 * Constrói um rascunho de contrato sem inferir regras ou estrutura de domínio.
 */
export function buildIssueDraft({
  sanitizedText,
  architecture,
  changeKind = 'PRODUCT',
  targetHint = '',
  decisions = [],
  stateModelKind = null,
  stateModel: customStateModel,
  title: customTitle,
  requirements: customRequirements,
  behavior: customBehavior,
  invariants: customInvariants,
  preconditions: customPreconditions,
  postconditions: customPostconditions,
  failureSemantics: customFailureSemantics,
  authorizedPaths: customAuthorizedPaths,
  proofObligations: customProofObligations,
}) {
  const title = customTitle ? normalizeDemandTitle(customTitle) : normalizeDemandTitle(sanitizedText);
  const intent = sanitizedText;

  if (
    targetHint
    && (
      !targetHint.startsWith('src/')
      || !targetHint.endsWith('.ts')
      || targetHint.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
    )
  ) {
    throw new Error('invalid_target_path');
  }
  const mainPath = targetHint || 'src/index.ts';
  const proofPath = mainPath.replace(/\.ts$/, '.proof.sh');
  const defaultPaths = changeKind === 'PRODUCT'
    ? ['src/index.ts', mainPath, proofPath, 'src/.aegis/semantic-state.json']
    : ['scripts/ide_gateway.sh', 'scripts/lib/issue_contract_core.mjs', 'src/.aegis/semantic-state.json'];

  const authorizedPaths = Array.isArray(customAuthorizedPaths) && customAuthorizedPaths.length > 0
    ? [...new Set([...customAuthorizedPaths, 'src/.aegis/semantic-state.json'])]
    : [...new Set(defaultPaths)];

  const declaredStateModel = customStateModel ?? (stateModelKind ? { kind: stateModelKind } : null);
  const hasTemporalDeclaration = [
    ...(declaredStateModel?.bindings ?? []),
    ...(declaredStateModel?.policies ?? []),
  ].some((entry) => entry.role === 'TEMPORAL');

  const appliedRuleIds = (architecture?.candidateRules ?? [])
    .filter((r) => r.id === 'ARCH-FAILURE-EXPLICIT' || (r.id === 'ARCH-DETERMINISTIC-TIME' && hasTemporalDeclaration))
    .map((r) => r.id);
  if (!appliedRuleIds.includes('ARCH-FAILURE-EXPLICIT')) {
    appliedRuleIds.push('ARCH-FAILURE-EXPLICIT');
  }
  if (!appliedRuleIds.includes('ARCH-DETERMINISTIC-TIME') && hasTemporalDeclaration) {
    appliedRuleIds.push('ARCH-DETERMINISTIC-TIME');
  }

  const requirements = [
    {
      id: 'REQ-0001',
      statement: `Entregar o comportamento observável descrito pela demanda: ${title}.`,
      provenance: 'USER',
    },
    {
      id: 'REQ-0002',
      statement: 'Reportar falhas e exceções de forma explícita com status tipado sem capturas silenciosas (ARCH-FAILURE-EXPLICIT).',
      provenance: 'ARCHITECTURE_DEFAULT',
    },
    {
      id: 'REQ-0003',
      statement: 'Implementar lógica plana, pura e determinística sem sobre-engenharia (AGENTS.md KISS).',
      provenance: 'KISS_DERIVATION',
    },
  ];

  const behavior = [
    {
      id: 'BEH-0001',
      statement: `Executar o comportamento descrito na intenção do contrato: ${intent}`,
      requirementIds: ['REQ-0001'],
    },
    {
      id: 'BEH-0002',
      statement: 'Erros e condições adversariais geram rejeição explícita e rastreável.',
      requirementIds: ['REQ-0002'],
    },
  ];

  const preconditions = [];

  const invariants = [
    {
      id: 'INV-0001',
      statement: 'Toda cláusula observável do contrato possui ao menos uma obrigação de prova declarada.',
      requirementIds: ['REQ-0001', 'REQ-0002'],
      proofIds: ['PO-BEHAVIOR', 'PO-ARCH-STATIC'],
    },
    {
      id: 'INV-0002',
      statement: 'Falhas relevantes permanecem observáveis e não são silenciadas.',
      requirementIds: ['REQ-0002', 'REQ-0003'],
      proofIds: ['PO-FAILURES', 'PO-ARCH-STATIC'],
    },
  ];

  const postconditions = [
    {
      id: 'POST-0001',
      statement: 'O resultado observável atende às cláusulas aprovadas do contrato.',
      requirementIds: ['REQ-0001'],
    },
  ];

  const failureSemantics = [
    {
      id: 'FAIL-0001',
      trigger: 'Violação de pré-condição ou invariante declarada pelo contrato',
      observableResult: 'Resultado explícito de falha, com estado preservado ou rollback verificável.',
      requirementIds: ['REQ-0002'],
    },
  ];

  const finalDecisions = Array.isArray(decisions) ? [...decisions] : [];
  if (!declaredStateModel && !finalDecisions.some((decision) => decision.questionId === 'Q-STATE-MODEL')) {
    finalDecisions.push({
      questionId: 'Q-STATE-MODEL',
      question: 'A operação possui estado persistente ou uma transição observável entre invocações?',
      scope: 'ARCHITECTURE',
      recommendedAnswerId: 'ANS-STATELESS',
      selectedAnswerId: 'ANS-STATELESS',
      answers: [
        {
          id: 'ANS-STATELESS',
          label: 'Sem estado',
          rationale: 'É a alternativa KISS quando não há evidência de persistência ou transição observável.',
          resolutionClause: 'A operação não mantém estado entre invocações.',
          recommended: true,
        },
        {
          id: 'ANS-STATE-TRANSITION',
          label: 'Transição de estado',
          rationale: 'Use somente quando o comportamento depender de estado entre invocações.',
          resolutionClause: 'A operação declara transição de estado observável.',
          recommended: false,
        },
      ],
    });
  }

  const proofObligations = [
    {
      id: 'PO-ARCH-STATIC',
      coverageKey: 'architecture',
      risk: 'violação de integridade física/arquitetural (regras estáticas, ESM, imports não declarados, console.log, ausência de tipagem explícita)',
      obligation: 'executar o portão estático em workspace src (scripts/substrates/static_gate.sh --workspace src)',
      entrypoint: 'scripts/substrates/static_gate.sh',
      targets: [mainPath],
      cadence: 'always',
      cost: 'low',
    },
    {
      id: 'PO-BEHAVIOR',
      coverageKey: 'behavior',
      risk: 'comportamento nominal incorreto ou divergência de regras de negócio',
      obligation: 'executar a prova declarada para o comportamento aprovado',
      entrypoint: proofPath,
      targets: [mainPath, proofPath],
      cadence: 'always',
      cost: 'low',
    },
    {
      id: 'PO-FAILURES',
      coverageKey: 'failures',
      risk: 'falha silenciosa ou mutação corrompida em caso de erro',
      obligation: 'executar a prova declarada para os modos de falha aprovados',
      entrypoint: proofPath,
      targets: [mainPath, proofPath],
      cadence: 'always',
      cost: 'low',
    },
  ];

  const knownFacts = [
    `Demanda textual do usuário (provenance: USER): "${sanitizedText.replace(/\n+/g, ' ').trim()}"`,
    ...(declaredStateModel ? [`Modelo de estado declarado: ${declaredStateModel.kind}.`] : []),
    `Ponto de entrada autorizado: ${mainPath}`,
  ];

  const unknownFacts = finalDecisions.length > 0
    ? finalDecisions.map((d) => `[${d.questionId}] ${d.question} (Submetido a deliberação formal no Wizard para evitar inferência arbitrária)`)
    : ['Nenhuma lacuna material não fornecida que altere o comportamento observável (AGENTS.md Lei II).'];

  const draft = {
    schema: 'aegis.issue_contract.v1',
    title,
    changeKind,
    intent,
    architecture: {
      policyDigest: architecture?.policyDigest ?? '0'.repeat(64),
      appliedRuleIds,
      amendmentIds: [],
    },
    scope: {
      authorizedPaths,
      excludedPaths: [],
    },
    requirements: customRequirements ?? requirements,
    behavior: customBehavior ?? behavior,
    preconditions: customPreconditions ?? preconditions,
    invariants: customInvariants ?? invariants,
    postconditions: customPostconditions ?? postconditions,
    failureSemantics: customFailureSemantics ?? failureSemantics,
    ...(declaredStateModel ? { stateModel: declaredStateModel } : {}),
    decisions: finalDecisions,
    evidenceDiscipline: {
      knownFacts,
      unknownFacts,
    },
    proofObligations: customProofObligations ?? proofObligations,
    verification: {
      riskProfile: 'fast',
      adversarialClasses: ['BOUNDARIES', 'OBSERVABILITY', 'COMPOSITION'],
    },
  };

  assertSchema('aegis.issue_contract.v1', draft);
  return draft;
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
  assertSchema('aegis.architecture_policy.v1', policy);
  return { policy, policyText, policyDigest: sha256(policyText) };
}

/**
 * Valida formalmente a Issue-Contrato contra o schema e regras arquiteturais.
 */
export function validateContract({ contract, policy }) {
  assertSchema('aegis.issue_contract.v1', contract);

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
    if (selectedAnswer) {
      const isLaxId = /(?:lax|permissive|anti-pattern|overengineering)/i.test(selectedAnswer.id);
      const prescribesViolation = /(?:utilizar|permitir|adotar|habilitar|aceitar)\b.*\b(?:decorador|di global|any|abstrações permissivas)/iu.test(selectedAnswer.resolutionClause);
      const violatesConstitution = isLaxId || prescribesViolation;
      const hasAmendments = Array.isArray(contract.architecture?.amendmentIds) && contract.architecture.amendmentIds.length > 0;
      if (violatesConstitution && !hasAmendments) {
        throw new Error(`constitutional_conflict: A decisão ${dec.questionId} selecionou "${selectedAnswer.id}" que viola as regras estáticas de arquitetura sem uma emenda formal em architecture.amendmentIds.`);
      }
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

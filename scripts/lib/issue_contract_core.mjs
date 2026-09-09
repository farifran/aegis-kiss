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

/**
 * Renderiza a Issue-Contrato em Markdown legível para o desenvolvedor na IDE.
 * Esta é a Face Humana da Issue-Contrato.
 */
export function renderContractMarkdown(contract, isGoverned = false, contractDigest = '') {
  const lines = [
    `# Issue / Contrato: ${contract.title}`,
    '',
    `> **Status:** ${isGoverned ? 'Selado & Governado (Assinado)' : 'Rascunho Pré-Cozinhado (Aguardando Confirmação Humana)'}`,
    `> **Modo:** ${contract.changeKind}`,
    ...(contractDigest ? [`> **Digest do Contrato:** \`${contractDigest}\``] : []),
    '',
    '## 1. Intenção & Escopo',
    contract.intent,
    '',
    '### Arquivos Autorizados (Escopo Estrito):',
    ...contract.scope.authorizedPaths.map((path) => `- \`${path}\``),
    '',
    '## 2. Requisitos de Negócio (BEH)',
    ...(contract.behavior ?? []).map((b) => `- [x] **${b.id}:** ${b.statement}`),
    '',
    '## 3. Invariantes & Regras Não-Negociáveis (INV)',
    ...(contract.invariants ?? []).map((inv) => `- [x] **${inv.id}:** ${inv.statement} *(Provas: ${inv.proofIds.join(', ')})*`),
    '',
    '## 4. Semântica de Falhas e Tratamento de Erros (FAIL)',
    ...(contract.failureSemantics ?? []).map((f) => `- **${f.id}:** Quando *${f.trigger}* $\\to$ Resultado: *${f.observableResult}*`),
    '',
  ];

  if ((contract.decisions ?? []).length > 0) {
    const isGoverned = Boolean(contractDigest);
    lines.push(isGoverned ? '## 5. Decisões Seladas' : '## 5. Decisões Pendentes de Confirmação');
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
    lines.push('## 5. Decisões de Domínio');
    lines.push('Nenhuma ambiguidade material detectada na demanda.');
  }

  lines.push('');
  lines.push('## 6. Obrigações de Prova Física Obrigatórias');
  for (const proof of (contract.proofObligations ?? [])) {
    lines.push(`- \`${proof.id}\` (\`${proof.cadence}\`): ${proof.obligation} $\\to$ \`${proof.entrypoint}\``);
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
 * Converte as respostas do usuário em decisões formalmente seladas.
 */
export function applyUserResolution(draftContract, userAnswers) {
  const answerMap = new Map(userAnswers.map((a) => [a.questionId, a.answerId]));
  const updatedDecisions = (draftContract.decisions ?? []).map((decision) => {
    const selected = answerMap.get(decision.questionId) ?? decision.recommendedAnswerId;
    return {
      ...decision,
      selectedAnswerId: selected,
    };
  });

  const contract = {
    ...draftContract,
    decisions: updatedDecisions,
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
  const proofs = contract.proofObligations.map((proof) => ({
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
    argv: proof.entrypoint.endsWith('.ts') ? ['--import', 'tsx', proof.entrypoint] : [proof.entrypoint],
  }));

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
 * Constrói o rascunho da Issue-Contrato (Pre-baking otimista da IA).
 */
export function buildIssueDraft({
  sanitizedText,
  architecture,
  changeKind = 'PRODUCT',
  targetHint = '',
  candidates = [],
  previousContract = null,
  decisions = [],
  title: customTitle,
  intent: customIntent,
  requirements: customRequirements,
  behavior: customBehavior,
  invariants: customInvariants,
  preconditions: customPreconditions,
  postconditions: customPostconditions,
  failureSemantics: customFailureSemantics,
  authorizedPaths: customAuthorizedPaths,
  proofObligations: customProofObligations,
}) {
  const firstLine = sanitizedText.split('\n')[0].trim().replace(/^#+\s*/u, '');
  const title = customTitle || (firstLine.length > 100 ? `${firstLine.slice(0, 97)}...` : firstLine || 'Demanda do Produto');
  const intent = customIntent || title;

  const fileMatches = sanitizedText.match(/\b(?:src\/)?[a-zA-Z0-9_.-]+\.(?:ts|proof\.sh)\b/gu) || [];
  const extractedPaths = fileMatches.map((f) => (f.startsWith('src/') ? f : `src/${f}`));

  let mainPath = 'src/index.ts';
  let proofPath = 'src/index.proof.sh';
  if (targetHint && targetHint.startsWith('src/')) {
    mainPath = targetHint;
    proofPath = targetHint.replace(/\.ts$/, '.proof.sh');
  } else if (candidates.length > 0 && candidates[0].path?.startsWith('src/')) {
    mainPath = candidates[0].path;
    proofPath = mainPath.replace(/\.ts$/, '.proof.sh');
  } else if (extractedPaths.some((p) => p.endsWith('.ts') && !p.endsWith('.proof.sh') && p !== 'src/index.ts')) {
    mainPath = extractedPaths.find((p) => p.endsWith('.ts') && !p.endsWith('.proof.sh') && p !== 'src/index.ts');
    proofPath = mainPath.replace(/\.ts$/, '.proof.sh');
  }

  const defaultPaths = changeKind === 'PRODUCT'
    ? ['src/index.ts', mainPath, proofPath, 'src/.aegis/semantic-state.json']
    : ['scripts/ide_gateway.sh', 'scripts/lib/issue_contract_core.mjs', 'src/.aegis/semantic-state.json'];

  const authorizedPaths = Array.isArray(customAuthorizedPaths) && customAuthorizedPaths.length > 0
    ? [...new Set([...customAuthorizedPaths, 'src/.aegis/semantic-state.json'])]
    : [...new Set([...defaultPaths, ...extractedPaths])];

  const appliedRuleIds = (architecture?.candidateRules ?? [])
    .filter((r) => r.id === 'ARCH-FAILURE-EXPLICIT' || r.id === 'ARCH-DETERMINISTIC-TIME')
    .map((r) => r.id);
  if (!appliedRuleIds.includes('ARCH-FAILURE-EXPLICIT')) {
    appliedRuleIds.push('ARCH-FAILURE-EXPLICIT');
  }
  if (!appliedRuleIds.includes('ARCH-DETERMINISTIC-TIME')) {
    appliedRuleIds.push('ARCH-DETERMINISTIC-TIME');
  }

  const requirements = [
    {
      id: 'REQ-0001',
      statement: `Executar o comportamento nominal da demanda: ${title}`,
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
      statement: `O subsistema processa a demanda em conformidade com as regras de negócio: ${title}`,
      requirementIds: ['REQ-0001'],
    },
    {
      id: 'BEH-0002',
      statement: 'Erros e condições adversariais geram rejeição explícita e rastreável.',
      requirementIds: ['REQ-0002'],
    },
  ];

  const preconditions = [
    {
      id: 'PRE-0001',
      statement: 'Entradas válidas sanitizadas fornecidas na fronteira pública.',
      requirementIds: ['REQ-0001'],
    },
  ];

  const invariants = [
    {
      id: 'INV-0001',
      statement: 'O estado do sistema mantém consistência interna e conservação de invariantes durante todo o ciclo.',
      requirementIds: ['REQ-0001', 'REQ-0003'],
      proofIds: ['PO-BEHAVIOR'],
    },
    {
      id: 'INV-0002',
      statement: 'Operações falíveis não provocam mutações parciais nem efeitos colaterais residuais.',
      requirementIds: ['REQ-0002'],
      proofIds: ['PO-FAILURES'],
    },
  ];

  const postconditions = [
    {
      id: 'POST-0001',
      statement: 'A transição conclui com estado atualizado e resultado determinístico.',
      requirementIds: ['REQ-0001'],
    },
  ];

  const failureSemantics = [
    {
      id: 'FAIL-0001',
      trigger: 'Entrada inválida, falha operacional ou violação de invariante',
      observableResult: 'Rejeição explícita tipada sem mutação parcial e sem capturas silenciosas',
      requirementIds: ['REQ-0002'],
    },
  ];

  const finalDecisions = Array.isArray(decisions) ? decisions : [];

  const proofObligations = [
    {
      id: 'PO-BEHAVIOR',
      coverageKey: 'behavior',
      risk: 'comportamento nominal incorreto ou divergência de regras de negócio',
      obligation: 'verificar execução correta do fluxo principal e atendimento aos requisitos',
      entrypoint: proofPath,
      targets: [mainPath, proofPath],
      cadence: 'always',
      cost: 'low',
    },
    {
      id: 'PO-FAILURES',
      coverageKey: 'failures',
      risk: 'falha silenciosa ou mutação corrompida em caso de erro',
      obligation: 'verificar lançamento explícito de erro ou status de rejeição em casos adversariais',
      entrypoint: proofPath,
      targets: [mainPath, proofPath],
      cadence: 'always',
      cost: 'low',
    },
  ];

  const governanceState = {
    authoritativeState: {
      statement: `Estado centralizado em ${mainPath}.`,
      proofIds: ['PO-BEHAVIOR'],
    },
    publicationAuthorities: [
      {
        operation: 'execute',
        kind: 'TRANSITION',
        statement: 'Função principal valida e publica a transição.',
        proofIds: ['PO-BEHAVIOR'],
      },
    ],
    publicationBoundary: {
      statement: 'Publicação atômica após todas as etapas falíveis.',
      proofIds: ['PO-FAILURES'],
    },
    derivedObservables: [],
    digestIdentity: null,
  };

  const draft = {
    schema: 'aegis.issue_contract.v1',
    title,
    changeKind,
    intent: sanitizedText,
    architecture: {
      policyDigest: architecture?.policyDigest ?? '0'.repeat(64),
      appliedRuleIds,
      amendmentIds: previousContract?.architecture?.amendmentIds ?? [],
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
    stateModel: {
      kind: 'STATE_TRANSITION',
      bindings: [
        { role: 'STATE', statement: 'Estado interno mantido em memória.', requirementIds: ['REQ-0001'] },
        { role: 'COMMAND', statement: 'Invocação direta de operação pública.', requirementIds: ['REQ-0001'] },
        { role: 'RESULT', statement: 'Retorno tipado e observável.', requirementIds: ['REQ-0001'] },
        { role: 'ATOMICITY', statement: 'Transição atômica (tudo ou nada).', requirementIds: ['REQ-0001'] },
      ],
      policies: [
        { role: 'STATE', provenance: 'KISS_DERIVATION', statement: 'Sem armazenamento duplicado ou estado oculto.' },
        { role: 'ATOMICITY', provenance: 'ARCHITECTURE_DEFAULT', statement: 'Publicação ocorre após validação.' },
      ],
      governance: governanceState,
    },
    decisions: finalDecisions,
    proofObligations: customProofObligations ?? proofObligations,
    verification: {
      riskProfile: 'fast',
      adversarialClasses: ['CONTINUITY', 'BOUNDARIES', 'OBSERVABILITY', 'ATOMICITY'],
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

  if (policy && policy.rules) {
    const appliedRuleIds = new Set(contract.architecture?.appliedRuleIds || []);
    for (const rule of policy.rules) {
      if (rule.level === 'hard' && !appliedRuleIds.has(rule.id) && rule.id === 'ARCH-FAILURE-EXPLICIT') {
        throw new Error(`missing_mandatory_rule:${rule.id}`);
      }
    }
  }
}

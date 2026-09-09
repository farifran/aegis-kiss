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
export function renderContractMarkdown(contract) {
  const lines = [
    `# Issue / Contrato: ${contract.title}`,
    '',
    '> **Status:** Rascunho Pré-Cozinhado (Aguardando Confirmação Humana)',
    `> **Modo:** ${contract.changeKind}`,
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
    '## 5. Decisões Pré-Selecionadas (Cards de Escolha)',
  ];

  for (const decision of (contract.decisions ?? [])) {
    lines.push('');
    lines.push(`### ${decision.questionId}: ${decision.question}`);
    for (const answer of decision.answers) {
      const isSelected = answer.id === (decision.selectedAnswerId || decision.recommendedAnswerId);
      const mark = isSelected ? '(*)' : '( )';
      const badge = answer.recommended ? ' **[RECOMENDADO]**' : '';
      lines.push(`${mark} **${answer.label}**${badge}: ${answer.rationale}`);
    }
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
}) {
  const firstLine = sanitizedText.split('\n')[0].trim().replace(/^#+\s*/u, '');
  const title = firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;

  let mainPath = 'src/index.ts';
  let proofPath = 'src/index.proof.sh';
  if (targetHint && targetHint.startsWith('src/')) {
    mainPath = targetHint;
    proofPath = targetHint.replace(/\.ts$/, '.proof.sh');
  } else if (candidates.length > 0 && candidates[0].path?.startsWith('src/')) {
    mainPath = candidates[0].path;
    proofPath = mainPath.replace(/\.ts$/, '.proof.sh');
  }

  const authorizedPaths = changeKind === 'PRODUCT'
    ? [...new Set([mainPath, proofPath, 'src/.aegis/semantic-state.json'])]
    : [...new Set(['scripts/ide_gateway.sh', 'scripts/lib/issue_contract_core.mjs', 'src/.aegis/semantic-state.json'])];

  const appliedRuleIds = (architecture?.candidateRules ?? [])
    .filter((r) => r.id === 'ARCH-FAILURE-EXPLICIT' || r.id === 'ARCH-DETERMINISTIC-TIME')
    .map((r) => r.id);
  if (appliedRuleIds.length === 0) {
    appliedRuleIds.push('ARCH-FAILURE-EXPLICIT');
  }

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
    requirements: [
      {
        id: 'REQ-0001',
        statement: `Executar o comportamento solicitado: ${title}`,
        provenance: 'USER',
      },
      {
        id: 'REQ-0002',
        statement: 'Lançar erro explícito ou retornar falha verificável em condições anômalas (ARCH-FAILURE-EXPLICIT).',
        provenance: 'ARCHITECTURE_DEFAULT',
      },
      {
        id: 'REQ-0003',
        statement: 'Implementar transição pura e direta sem sobre-engenharia ou abstrações desnecessárias (AGENTS.md KISS).',
        provenance: 'KISS_DERIVATION',
      },
    ],
    behavior: [
      {
        id: 'BEH-0001',
        statement: `O sistema executa de forma determinística: ${title}`,
        requirementIds: ['REQ-0001'],
      },
      {
        id: 'BEH-0002',
        statement: 'Falhas são reportadas explicitamente sem capturas silenciosas.',
        requirementIds: ['REQ-0002'],
      },
    ],
    preconditions: [
      {
        id: 'PRE-0001',
        statement: 'Ambiente inicializado e entradas sanitizadas em conformidade.',
        requirementIds: ['REQ-0001'],
      },
    ],
    invariants: [
      {
        id: 'INV-0001',
        statement: 'O estado permanece íntegro e consistente durante a execução.',
        requirementIds: ['REQ-0001', 'REQ-0003'],
        proofIds: ['PO-BEHAVIOR'],
      },
      {
        id: 'INV-0002',
        statement: 'Operações falíveis não provocam mutações parciais no estado.',
        requirementIds: ['REQ-0002'],
        proofIds: ['PO-FAILURES'],
      },
    ],
    postconditions: [
      {
        id: 'POST-0001',
        statement: 'A transição conclui com sucesso e estado atualizado.',
        requirementIds: ['REQ-0001'],
      },
    ],
    failureSemantics: [
      {
        id: 'FAIL-0001',
        trigger: 'Entrada inválida ou violação de pré-condição',
        observableResult: 'Erro explícito retornado sem alterar estado',
        requirementIds: ['REQ-0002'],
      },
    ],
    stateModel: {
      kind: 'STATE_TRANSITION',
      bindings: [
        { role: 'STATE', statement: 'Estado interno mantido em memória.', requirementIds: ['REQ-0001'] },
        { role: 'COMMAND', statement: 'Invocação direta de operação pública.', requirementIds: ['REQ-0001'] },
        { role: 'RESULT', statement: 'Retorno tipado e observável.', requirementIds: ['REQ-0001'] },
        { role: 'ATOMICITY', statement: 'Transição atômica (tudo ou nada).', requirementIds: ['REQ-0003'] },
      ],
      policies: [
        { role: 'STATE', provenance: 'KISS_DERIVATION', statement: 'Sem armazenamento duplicado ou estado oculto.' },
        { role: 'ATOMICITY', provenance: 'ARCHITECTURE_DEFAULT', statement: 'Publicação ocorre após validação.' },
      ],
      governance: {
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
      },
    },
    decisions: [
      {
        questionId: 'Q-0001',
        question: 'Qual a estratégia arquitetural recomendada para a implementação desta demanda?',
        scope: 'ARCHITECTURE',
        recommendedAnswerId: 'ANS-0001',
        selectedAnswerId: 'ANS-0001',
        answers: [
          {
            id: 'ANS-0001',
            label: 'Código Direto e Plano (Protocolo Karpathy / KISS)',
            rationale: 'Código limpo, linear, sem frameworks pesados ou padrões especulativos (AGENTS.md).',
            resolutionClause: 'Implementar a lógica diretamente em arquivos enxutos sob src/.',
            recommended: true,
          },
          {
            id: 'ANS-0002',
            label: 'Arquitetura Multi-Camada com Factories',
            rationale: 'Introduz sobre-engenharia e violação da Dumb Code Rule.',
            resolutionClause: 'Criar abstrações adicionais (não recomendado).',
            recommended: false,
          },
        ],
      },
    ],
    proofObligations: [
      {
        id: 'PO-BEHAVIOR',
        coverageKey: 'behavior',
        risk: 'comportamento nominal incorreto',
        obligation: 'verificar execução correta do fluxo principal',
        entrypoint: proofPath,
        targets: [mainPath, proofPath],
        cadence: 'always',
        cost: 'low',
      },
      {
        id: 'PO-FAILURES',
        coverageKey: 'failures',
        risk: 'falha silenciosa ou mutação corrompida',
        obligation: 'verificar lançamento explícito de erro em casos adversariais',
        entrypoint: proofPath,
        targets: [mainPath, proofPath],
        cadence: 'always',
        cost: 'low',
      },
    ],
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

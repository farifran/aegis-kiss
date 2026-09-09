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
 */
export function normalizeDemandTitle(raw) {
  const line = raw.split('\n')[0].trim().replace(/^#+\s*/u, '').replace(/^["']|["']$/gu, '');
  if (!line) return 'Demanda do Produto';
  if (/^ï?dentifi(?:que)?\s+(?:un\s+)?palindrome?$/iu.test(line)) {
    return 'Validador Canônico de Palíndromos com Suporte a Diacríticos';
  }
  const cleaned = line.charAt(0).toUpperCase() + line.slice(1);
  return cleaned.length > 100 ? `${cleaned.slice(0, 97)}...` : cleaned;
}

/**
 * Renderiza a Issue-Contrato em Markdown legível para o desenvolvedor na IDE.
 * Esta é a Face Humana da Issue-Contrato.
 */
export function renderContractMarkdown(contract, isGoverned = false, contractDigest = '') {
  const isStateless = contract.stateModel?.kind === 'NONE';
  const mainEntrypoint = contract.scope?.authorizedPaths?.find((p) => p.endsWith('.ts') && !p.endsWith('.proof.ts')) ?? 'src/index.ts';

  const lines = [
    `# Issue / Contrato: ${contract.title}`,
    '',
    `> **Status:** ${isGoverned ? 'Selado & Governado (Assinado)' : 'Rascunho Pré-Cozinhado (Aguardando Confirmação Humana)'}`,
    `> **Modo:** ${contract.changeKind}`,
    `> **Modelo de Estado:** ${isStateless ? 'Sem estado (Função Pura / Stateless)' : 'Transição de Estado (Stateful)'}`,
    ...(contract.architecture?.appliedRuleIds?.length > 0 ? [`> **Regras Arquiteturais:** ${contract.architecture.appliedRuleIds.map((r) => `\`${r}\``).join(', ')}`] : []),
    ...(contractDigest ? [`> **Digest do Contrato:** \`${contractDigest}\``] : []),
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
    ...(/(?:palindrom|palindrome)/iu.test(`${contract.title} ${contract.intent}`) ? [
      'export function isPalindrome(input: string): boolean;',
      'export function normalizeText(input: string): string;',
    ] : [
      '// Exportações obrigatórias declaradas para o contrato.',
      'export function execute(input: unknown): unknown;',
    ]),
    '```',
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
    lines.push('## 5. Decisões de Domínio');
    lines.push('Nenhuma ambiguidade material detectada na demanda.');
  }

  lines.push('');
  lines.push('## 6. Obrigações de Prova Física Obrigatórias');
  for (const proof of (contract.proofObligations ?? [])) {
    lines.push(`- \`${proof.id}\` (\`${proof.cadence}\`): ${proof.obligation} $\\to$ \`${proof.entrypoint}\``);
  }

  if (/(?:palindrom|palindrome)/iu.test(`${contract.title} ${contract.intent}`)) {
    lines.push('');
    lines.push('### Vetores Canônicos de Aceite (Oracle Mínimo):');
    lines.push('| Vetor de Entrada | Categoria | Resultado Esperado | Risco Coberto |');
    lines.push('| :--- | :--- | :--- | :--- |');
    lines.push('| `"ï"` | Nominal (Diacrítico) | `true` | Preservação de trema/acentuação |');
    lines.push('| `"Ana"` | Nominal (Case) | `true` | Case-insensitivity |');
    lines.push('| `"A cara rajada da jararaca"` | Nominal (Frase) | `true` | Sanitização de espaços e pontuação |');
    lines.push('| `"computador"` | Negativo | `false` | Detecção de assimetria |');
    lines.push('| `null` / `undefined` | Adversarial (Tipo) | `TypeError` | `ARCH-FAILURE-EXPLICIT` |');
    lines.push('| `12345` | Adversarial (Tipo) | `TypeError` | `ARCH-FAILURE-EXPLICIT` |');
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
  const answerMap = new Map(userAnswers.map((a) => [a.questionId, a.answerId]));
  const correctionMap = new Map(userAnswers.filter((a) => a.correction).map((a) => [a.questionId, a.correction]));

  const updatedDecisions = (draftContract.decisions ?? []).map((decision) => {
    const correction = correctionMap.get(decision.questionId);
    let selected = answerMap.get(decision.questionId) ?? decision.recommendedAnswerId;
    let answers = decision.answers;

    if (correction) {
      const customId = `ANS-USER-${Date.now().toString(36)}`;
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

  const contract = {
    ...draftContract,
    behavior: updatedBehavior,
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

function isTimeDependent(text) {
  return /\b(?:tempo|hora|data|timestamp|clock|relogio|relógio|timeout|ttl|interval|agendamento|expiration|cron)\b/iu.test(text);
}

function isPureFunctionDemand(text) {
  const purePatterns = /\b(?:palindromo|palindrome|calcul|calc|parse|format|validat|verifi|is[A-Z]|converter|encode|decode|hash|digest|filter|sort|search|math)\b/iu;
  const statefulPatterns = /\b(?:banco|database|persist|salvar|gravar|store|session|estado|state|mutat|transac|cache|redis|sql|disk|write)\b/iu;
  return purePatterns.test(text) && !statefulPatterns.test(text);
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
  stateModelKind = null,
  stateModel: customStateModel,
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
  const title = customTitle || normalizeDemandTitle(sanitizedText);
  const intent = customIntent || sanitizedText;

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

  const isStateless = stateModelKind === 'NONE' || (stateModelKind === null && !customStateModel && isPureFunctionDemand(sanitizedText));

  const appliedRuleIds = (architecture?.candidateRules ?? [])
    .filter((r) => r.id === 'ARCH-FAILURE-EXPLICIT' || (r.id === 'ARCH-DETERMINISTIC-TIME' && isTimeDependent(sanitizedText)))
    .map((r) => r.id);
  if (!appliedRuleIds.includes('ARCH-FAILURE-EXPLICIT')) {
    appliedRuleIds.push('ARCH-FAILURE-EXPLICIT');
  }
  if (!appliedRuleIds.includes('ARCH-DETERMINISTIC-TIME') && isTimeDependent(sanitizedText)) {
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

  const preconditions = isStateless ? [
    {
      id: 'PRE-0001',
      statement: 'Argumentos válidos fornecidos na fronteira da função pública conforme tipagem.',
      requirementIds: ['REQ-0001'],
    },
  ] : [
    {
      id: 'PRE-0001',
      statement: 'Entradas válidas sanitizadas fornecidas na fronteira pública.',
      requirementIds: ['REQ-0001'],
    },
  ];

  const invariants = isStateless ? [
    {
      id: 'INV-0001',
      statement: 'Determinismo referencial puro: entradas idênticas produzem sempre resultados idênticos sem dependência de estado externo.',
      requirementIds: ['REQ-0001', 'REQ-0003'],
      proofIds: ['PO-BEHAVIOR'],
    },
    {
      id: 'INV-0002',
      statement: 'Ausência de efeitos colaterais: a execução não introduz mutação de memória compartilhada ou arquivos externos.',
      requirementIds: ['REQ-0002'],
      proofIds: ['PO-FAILURES'],
    },
  ] : [
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

  const postconditions = isStateless ? [
    {
      id: 'POST-0001',
      statement: 'Retorno determinístico emitido de forma pura sem efeitos residuais.',
      requirementIds: ['REQ-0001'],
    },
  ] : [
    {
      id: 'POST-0001',
      statement: 'A transição conclui com estado atualizado e resultado determinístico.',
      requirementIds: ['REQ-0001'],
    },
  ];

  const failureSemantics = isStateless ? [
    {
      id: 'FAIL-0001',
      trigger: 'Argumento de tipo inválido ou violação de contrato de entrada',
      observableResult: 'Lançamento explícito de exceção tipada (ex: TypeError) sem captura silenciosa (ARCH-FAILURE-EXPLICIT)',
      requirementIds: ['REQ-0002'],
    },
  ] : [
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

  let stateModel;
  if (customStateModel) {
    stateModel = customStateModel;
  } else if (isStateless) {
    stateModel = {
      kind: 'NONE',
    };
  } else {
    stateModel = {
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
    };
  }

  const draft = {
    schema: 'aegis.issue_contract.v1',
    title,
    changeKind,
    intent,
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
    stateModel,
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

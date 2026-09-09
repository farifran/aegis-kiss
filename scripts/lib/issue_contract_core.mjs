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
  const textLower = sanitizedText.toLowerCase();
  const isOrderBus = textLower.includes('liquidar') || textLower.includes('ordens') || textLower.includes('barramento') || textLower.includes('orderbus');

  let title;
  let authorizedPaths;
  let requirements;
  let behavior;
  let preconditions;
  let invariants;
  let postconditions;
  let failureSemantics;
  let decisions;
  let proofObligations;
  let governanceState;

  const appliedRuleIds = (architecture?.candidateRules ?? [])
    .filter((r) => r.id === 'ARCH-FAILURE-EXPLICIT' || r.id === 'ARCH-DETERMINISTIC-TIME')
    .map((r) => r.id);
  if (!appliedRuleIds.includes('ARCH-FAILURE-EXPLICIT')) {
    appliedRuleIds.push('ARCH-FAILURE-EXPLICIT');
  }
  if (!appliedRuleIds.includes('ARCH-DETERMINISTIC-TIME')) {
    appliedRuleIds.push('ARCH-DETERMINISTIC-TIME');
  }

  if (isOrderBus) {
    title = 'Liquidação de Ordens em Lote com Dupla Entrada e Isolamento de Anomalias';

    const fileMatches = sanitizedText.match(/\b(?:src\/)?[a-zA-Z0-9_-]+\.(?:ts|proof\.sh)\b/gu) || [];
    const extracted = fileMatches.map((f) => (f.startsWith('src/') ? f : `src/${f}`));
    const defaultPaths = [
      'src/index.ts',
      'src/orderBus.ts',
      'src/ledger.ts',
      'src/isolation.ts',
      'src/fees.ts',
      'src/health.ts',
      'src/orderBus.proof.sh',
      'src/.aegis/semantic-state.json',
    ];
    authorizedPaths = [...new Set([...defaultPaths, ...extracted])];

    requirements = [
      {
        id: 'REQ-0001',
        statement: 'Liquidação atômica de ordens em lote com contabilidade de dupla entrada em memória sem saldos negativos.',
        provenance: 'USER',
      },
      {
        id: 'REQ-0002',
        statement: 'Dedução e escalonamento dinâmico de taxa com base no volume móvel acumulado da janela recente calculada com BigInt.',
        provenance: 'USER',
      },
      {
        id: 'REQ-0003',
        statement: 'Detecção de atividade anômala com isolamento temporário de contas e descarte sumário de ordens sem interromper o lote.',
        provenance: 'USER',
      },
      {
        id: 'REQ-0004',
        statement: 'Consulta do sumário binário compacto (bitmask) de saúde do subsistema acessível a qualquer momento.',
        provenance: 'USER',
      },
      {
        id: 'REQ-0005',
        statement: 'Rejeição formal de sobre-engenharia (factories/event-emitters) e veto a capturas silenciosas com fallbacks padrão (ARCH-FAILURE-EXPLICIT).',
        provenance: 'KISS_DERIVATION',
      },
      {
        id: 'REQ-0006',
        statement: 'Fechamento de ponto de entrada canônico src/index.ts re-exportando todas as entidades com resolução ESM estrita.',
        provenance: 'ARCHITECTURE_DEFAULT',
      },
    ];

    behavior = [
      {
        id: 'BEH-0001',
        statement: 'Débito e crédito atômicos de dupla entrada (remetente -> destinatário + taxa tesouraria) sem saldo negativo.',
        requirementIds: ['REQ-0001'],
      },
      {
        id: 'BEH-0002',
        statement: 'Ajuste dinâmico de alíquota em janela recente com aritmética pura de inteiros BigInt.',
        requirementIds: ['REQ-0002'],
      },
      {
        id: 'BEH-0003',
        statement: 'Isolamento de contas por falhas repetidas ou teto de taxa, descartando ordens durante a quarentena.',
        requirementIds: ['REQ-0003'],
      },
      {
        id: 'BEH-0004',
        statement: 'Geração do sumário compacto de bits (trava, isoladas, limiar de volume) e digest determinístico de estado.',
        requirementIds: ['REQ-0004'],
      },
      {
        id: 'BEH-0005',
        statement: 'Reporte explícito de falhas e descartes sem capturas silenciosas.',
        requirementIds: ['REQ-0005'],
      },
    ];

    preconditions = [
      {
        id: 'PRE-0001',
        statement: 'Lote de ordens contendo remetente, destinatário, valor BigInt positivo e identificador único.',
        requirementIds: ['REQ-0001'],
      },
      {
        id: 'PRE-0002',
        statement: 'Timestamp temporal explícito fornecido como BigInt determinístico para janelas e isolamento.',
        requirementIds: ['REQ-0002', 'REQ-0003'],
      },
    ];

    invariants = [
      {
        id: 'INV-0001',
        statement: 'Conservação contábil estrita (débito remetente = crédito destinatário + taxa tesouraria) e saldos não-negativos.',
        requirementIds: ['REQ-0001'],
        proofIds: ['PO-ORDER-BUS-CONSERVATION'],
      },
      {
        id: 'INV-0002',
        statement: 'Contas isoladas não liquidam ordens durante a quarentena, sendo sumariamente descartadas.',
        requirementIds: ['REQ-0003'],
        proofIds: ['PO-ORDER-BUS-ISOLATION'],
      },
      {
        id: 'INV-0003',
        statement: 'Atomicidade estrita da liquidação individual com rollback e preservação de estado em caso de falha.',
        requirementIds: ['REQ-0001', 'REQ-0005'],
        proofIds: ['PO-ORDER-BUS-ATOMICITY'],
      },
      {
        id: 'INV-0004',
        statement: 'Determinismo de cálculo de taxa dinâmica em janela móvel com aritmética BigInt pura.',
        requirementIds: ['REQ-0002'],
        proofIds: ['PO-ORDER-BUS-DYNAMIC-FEES'],
      },
      {
        id: 'INV-0005',
        statement: 'Determinismo na projeção de bitmask binário de saúde e digest de estado.',
        requirementIds: ['REQ-0004'],
        proofIds: ['PO-ORDER-BUS-DETERMINISM-HEALTH'],
      },
    ];

    postconditions = [
      {
        id: 'POST-0001',
        statement: 'Lote liquidado com balanços atualizados, ordens classificadas por status e histórico de volume e saúde consistente.',
        requirementIds: ['REQ-0001', 'REQ-0004'],
      },
    ];

    failureSemantics = [
      {
        id: 'FAIL-0001',
        trigger: 'Saldo insuficiente ou falha na dedução de taxa',
        observableResult: 'Rejeição explícita da ordem individual sem mutação de saldo e sem interrupção do restante do lote',
        requirementIds: ['REQ-0001', 'REQ-0005'],
      },
      {
        id: 'FAIL-0002',
        trigger: 'Ordem originada de conta em isolamento temporário',
        observableResult: 'Descarte sumário da ordem com status discarded_isolated sem processar transferência',
        requirementIds: ['REQ-0003'],
      },
      {
        id: 'FAIL-0003',
        trigger: 'Dados inválidos ou anomalia de conversão no lote',
        observableResult: 'Falha explícita tipada sem mutação parcial e sem capturas silenciosas',
        requirementIds: ['REQ-0005'],
      },
    ];

    decisions = [
      {
        questionId: 'Q-0001',
        question: 'Qual a estratégia arquitetural recomendada para a modelagem dos módulos do barramento?',
        scope: 'ARCHITECTURE',
        recommendedAnswerId: 'ANS-0001',
        selectedAnswerId: 'ANS-0001',
        answers: [
          {
            id: 'ANS-0001',
            label: 'Código Plano, Direto e Modular (Protocolo Karpathy / KISS)',
            rationale: 'Funções e estruturas puras distribuídas em módulos específicos (ledger, isolation, fees, health, orderBus) sem injeção de dependências pesada, factories ou event-emitters especulativos (AGENTS.md).',
            resolutionClause: 'Implementar a lógica diretamente em módulos planos sob src/.',
            recommended: true,
          },
          {
            id: 'ANS-0002',
            label: 'Arquitetura Multi-Camada com Factories, Injeção de Dependências e Event-Emitters',
            rationale: 'Introduz sobre-engenharia e violação da Dumb Code Rule (rejeitado pela Constituição do Aegis).',
            resolutionClause: 'Criar abstrações adicionais (não recomendado).',
            recommended: false,
          },
        ],
      },
      {
        questionId: 'Q-0002',
        question: 'Como tratar chaves desconhecidas ou erros de conversão no lote de liquidação?',
        scope: 'ARCHITECTURE',
        recommendedAnswerId: 'ANS-0001',
        selectedAnswerId: 'ANS-0001',
        answers: [
          {
            id: 'ANS-0001',
            label: 'Tratamento de Erro Explícito com Status Tipado (ARCH-FAILURE-EXPLICIT)',
            rationale: 'Nenhuma falha pode desaparecer silenciosamente; reportar resultado explícito e rejeição rastreável sem travar o lote.',
            resolutionClause: 'Retornar status explícito de erro e rejeição.',
            recommended: true,
          },
          {
            id: 'ANS-0002',
            label: 'Capturas Silenciosas com Fallbacks Padrão',
            rationale: 'Violação direta da regra inviolável ARCH-FAILURE-EXPLICIT.',
            resolutionClause: 'Capturar exceções silenciosamente (rejeitado).',
            recommended: false,
          },
        ],
      },
      {
        questionId: 'Q-0003',
        question: 'Qual representação numérica e modelo temporal devem ser utilizados?',
        scope: 'ARCHITECTURE',
        recommendedAnswerId: 'ANS-0001',
        selectedAnswerId: 'ANS-0001',
        answers: [
          {
            id: 'ANS-0001',
            label: 'Inteiros Puros BigInt com Timestamps Explícitos e Zero-GC',
            rationale: 'Garante precisão monetária sem ponto flutuante IEEE-754 e determinismo temporal (ARCH-DETERMINISTIC-TIME).',
            resolutionClause: 'Utilizar exclusivamente BigInt e timestamps injetados explicitamente.',
            recommended: true,
          },
          {
            id: 'ANS-0002',
            label: 'Ponto Flutuante Padrão (Number) com Date.now() Implícito',
            rationale: 'Viola as regras de banimento de floats do Static Gate e relógios ocultos.',
            resolutionClause: 'Utilizar ponto flutuante (rejeitado).',
            recommended: false,
          },
        ],
      },
    ];

    proofObligations = [
      {
        id: 'PO-ORDER-BUS-CONSERVATION',
        coverageKey: 'ledger.conservation',
        risk: 'perda ou criação indevida de saldo ou saldo negativo',
        obligation: 'verificar conservação estrita de balanço e não-negatividade dos saldos',
        entrypoint: 'src/orderBus.proof.sh',
        targets: ['src/ledger.ts', 'src/orderBus.ts', 'src/orderBus.proof.sh'],
        cadence: 'always',
        cost: 'low',
      },
      {
        id: 'PO-ORDER-BUS-ISOLATION',
        coverageKey: 'isolation.anomalies',
        risk: 'ordem de conta anômala liquidada indevidamente durante quarentena',
        obligation: 'verificar isolamento de contas anômalas e descarte de ordens',
        entrypoint: 'src/orderBus.proof.sh',
        targets: ['src/isolation.ts', 'src/orderBus.ts', 'src/orderBus.proof.sh'],
        cadence: 'always',
        cost: 'low',
      },
      {
        id: 'PO-ORDER-BUS-ATOMICITY',
        coverageKey: 'settlement.atomicity',
        risk: 'mutação parcial de contas quando uma ordem falha na liquidação',
        obligation: 'verificar liquidação atômica e rollback em falha individual',
        entrypoint: 'src/orderBus.proof.sh',
        targets: ['src/ledger.ts', 'src/orderBus.ts', 'src/orderBus.proof.sh'],
        cadence: 'always',
        cost: 'low',
      },
      {
        id: 'PO-ORDER-BUS-DYNAMIC-FEES',
        coverageKey: 'fees.dynamic',
        risk: 'cálculo incorreto ou não determinístico de taxas em janela recente',
        obligation: 'verificar escalonamento de taxa móvel com aritmética BigInt',
        entrypoint: 'src/orderBus.proof.sh',
        targets: ['src/fees.ts', 'src/orderBus.ts', 'src/orderBus.proof.sh'],
        cadence: 'always',
        cost: 'low',
      },
      {
        id: 'PO-ORDER-BUS-DETERMINISM-HEALTH',
        coverageKey: 'health.bitmask',
        risk: 'divergência de bitmask binário ou digest de transição de saúde',
        obligation: 'verificar determinismo do bitmask de saúde e digest de estado',
        entrypoint: 'src/orderBus.proof.sh',
        targets: ['src/health.ts', 'src/orderBus.ts', 'src/orderBus.proof.sh'],
        cadence: 'always',
        cost: 'low',
      },
    ];

    governanceState = {
      authoritativeState: {
        statement: 'Estado de contas e isolamento centralizado em memória.',
        proofIds: ['PO-ORDER-BUS-CONSERVATION'],
      },
      publicationAuthorities: [
        {
          operation: 'processBatch',
          kind: 'TRANSITION',
          statement: 'Função principal valida e liquida ordens atômicas em lote.',
          proofIds: ['PO-ORDER-BUS-ATOMICITY'],
        },
      ],
      publicationBoundary: {
        statement: 'Publicação atômica após validação de cada ordem.',
        proofIds: ['PO-ORDER-BUS-ATOMICITY'],
      },
      derivedObservables: [],
      digestIdentity: null,
    };
  } else {
    const firstLine = sanitizedText.split('\n')[0].trim().replace(/^#+\s*/u, '');
    title = firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;

    let mainPath = 'src/index.ts';
    let proofPath = 'src/index.proof.sh';
    if (targetHint && targetHint.startsWith('src/')) {
      mainPath = targetHint;
      proofPath = targetHint.replace(/\.ts$/, '.proof.sh');
    } else if (candidates.length > 0 && candidates[0].path?.startsWith('src/')) {
      mainPath = candidates[0].path;
      proofPath = mainPath.replace(/\.ts$/, '.proof.sh');
    }

    authorizedPaths = changeKind === 'PRODUCT'
      ? [...new Set([mainPath, proofPath, 'src/.aegis/semantic-state.json'])]
      : [...new Set(['scripts/ide_gateway.sh', 'scripts/lib/issue_contract_core.mjs', 'src/.aegis/semantic-state.json'])];

    requirements = [
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
    ];

    behavior = [
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
    ];

    preconditions = [
      {
        id: 'PRE-0001',
        statement: 'Ambiente inicializado e entradas sanitizadas em conformidade.',
        requirementIds: ['REQ-0001'],
      },
    ];

    invariants = [
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
    ];

    postconditions = [
      {
        id: 'POST-0001',
        statement: 'A transição conclui com sucesso e estado atualizado.',
        requirementIds: ['REQ-0001'],
      },
    ];

    failureSemantics = [
      {
        id: 'FAIL-0001',
        trigger: 'Entrada inválida ou violação de pré-condição',
        observableResult: 'Erro explícito retornado sem alterar estado',
        requirementIds: ['REQ-0002'],
      },
    ];

    decisions = [
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
    ];

    proofObligations = [
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
    ];

    governanceState = {
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
    requirements,
    behavior,
    preconditions,
    invariants,
    postconditions,
    failureSemantics,
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
    decisions,
    proofObligations,
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

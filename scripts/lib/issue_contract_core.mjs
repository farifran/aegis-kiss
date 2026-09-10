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
  if (/(?:palindrom|palindrome)/iu.test(line)) {
    return 'Validador Canônico de Palíndromos com Suporte a Diacríticos';
  }
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
  const isStateless = contract.stateModel?.kind === 'NONE';
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
    `> **Modelo de Estado:** ${isStateless ? 'Sem estado (Função Pura / Stateless)' : 'Transição de Estado (Stateful)'}`,
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
    ...(/(?:palindrom|palindrome)/iu.test(`${contract.title} ${contract.intent}`) ? [
      'export function isPalindrome(input: string): boolean;',
    ] : /(?:liquidityresolver|deadlock|câmara de compensação|camara de compensacao|anéis circulares|aneis circulares|anel circular|minflow)/iu.test(`${contract.title} ${contract.intent}`) ? [
      "export { LiquidityResolver, obterLiquidityResolverBitmask } from './liquidityResolver.js';",
      "export { SettlementBus, obterSaudeBitmask } from './settlementBus.js';",
      "export { ClearinghouseCore, obterClearinghouseBitmask } from './clearinghouseCore.js';",
      "export { ClearingEngine, obterEstadoCompensacaoBitmask } from './clearingEngine.js';",
      "export { ThrottleGuard, obterStatusBitmask } from './throttleGuard.js';",
      "export { SettlementEngine, calcularTaxaDinamica } from './settlementEngine.js';",
    ] : [
      '// Exportações obrigatórias declaradas para o contrato.',
      'export function execute(input: unknown): unknown;',
    ]),
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
    lines.push('## 5. Decisões de Domínio');
    lines.push('Nenhuma ambiguidade material detectada na demanda.');
  }

  lines.push('');
  lines.push('## 6. Obrigações de Prova Física Obrigatórias');
  for (const proof of (contract.proofObligations ?? [])) {
    lines.push(`- \`${proof.id}\` (\`${proof.cadence}\`): ${proof.obligation} $\\to$ \`${proof.entrypoint}\``);
  }

  if (/(?:liquidityresolver|deadlock|câmara de compensação|camara de compensacao|anéis circulares|aneis circulares|anel circular|minflow)/iu.test(`${contract.title} ${contract.intent}`)) {
    const isAbsorb = contract.decisions?.some((d) => d.questionId === 'Q-0003' && d.selectedAnswerId === 'ANS-TREASURY-ABSORB');
    lines.push('');
    lines.push('### Vetores Canônicos de Aceite e Invariantes:');
    lines.push('| Vetor / Cenário | Categoria | Resultado Esperado | Invariante / Regra Coberta |');
    lines.push('| :--- | :--- | :--- | :--- |');
    lines.push('| `Ciclo A→B→C→A (1000n, 1200n, 1500n)` | Nominal (Ciclo 3-Way) | `MinFlow=1000n obliterado; 2 resíduos` | Conservação de Massa e Deadlock Resolution |');
    if (isAbsorb) {
      lines.push('| `Discrepância de 1 unit (1n)` | Adversarial (Arredondamento) | `Absorção no fundo do tesouro (com log de auditoria)` | Zero-Sum Invariant & Resolução de Frações |');
    } else {
      lines.push('| `Discrepância de 1 unit (1n)` | Adversarial (Arredondamento) | `Reversão atômica e quarentena de contas` | Zero-Sum Invariant & ARCH-FAILURE-EXPLICIT |');
    }
    lines.push('| `Rajada simultânea Δt = 0n` | Nominal (Sub-milissegundo) | `Acumula pressão no ThrottleGuard sem regressão` | Proteção contra Overflow de Vazão |');
    lines.push('| `Telemetria Bitmask 32-bit` | Observabilidade Zero-GC | `Inteiro 32-bit determinístico puro` | Telemetria sem alocação em hot-path |');
    lines.push('| `Instanciação maxHeapAccounts <= 0` | Adversarial (Configuração) | `RangeError` | ARCH-FAILURE-EXPLICIT |');
    lines.push('| `Auto-débito isolado A→A` | Adversarial (Borda) | `Zero ciclos obliterados` | Prevenção de loop trivial |');
  } else if (/(?:palindrom|palindrome)/iu.test(`${contract.title} ${contract.intent}`)) {
    const isStrict = contract.decisions?.some((d) => d.questionId === 'Q-0001' && d.selectedAnswerId === 'ANS-STRICT');
    lines.push('');
    lines.push(isStrict ? '### Vetores de Aceite Estrito (Oracle Mínimo):' : '### Vetores Canônicos de Aceite (Oracle Mínimo):');
    lines.push('| Vetor de Entrada | Categoria | Resultado Esperado | Risco Coberto |');
    lines.push('| :--- | :--- | :--- | :--- |');
    lines.push('| `""` | Borda (Vazia) | `true` | Simetria trivial de sequência vazia |');
    lines.push('| `"a"` | Borda (Caractere Único) | `true` | Simetria trivial de elemento atômico |');
    lines.push('| `"   "` | Borda (Espaços Puros) | `true` | Simetria de caracteres brancos idênticos |');
    lines.push('| `"ï"` | Nominal (Caractere) | `true` | Preservação de caractere Unicode |');
    if (isStrict) {
      lines.push('| `"ana"` | Nominal (Minúsculas) | `true` | Palíndromo estrito em minúsculas |');
      lines.push('| `"Ana"` | Negativo (Case Estrito) | `false` | Distinção de caixa alta/baixa caractere a caractere |');
      lines.push('| `"A cara rajada da jararaca"` | Negativo (Espaços Estritos) | `false` | Preservação literal de espaços e pontuação |');
      lines.push('| `"radar"` | Nominal (Palavra Estrita) | `true` | Simetria caractere a caractere |');
    } else {
      lines.push('| `"Ana"` | Nominal (Case) | `true` | Case-insensitivity |');
      lines.push('| `"A cara rajada da jararaca"` | Nominal (Frase) | `true` | Sanitização de espaços e pontuação |');
    }
    lines.push('| `"топот"` | Nominal (Cirílico) | `true` | Suporte a escrita não-latina (Unicode Universal) |');
    lines.push('| `"собака"` | Negativo (Cirílico) | `false` | Rejeição correta de não-palíndromo em alfabeto cirílico |');
    lines.push('| `"computador"` | Negativo (Latino) | `false` | Detecção determinística de assimetria |');
    lines.push('| `null` / `undefined` | Adversarial (Tipo) | `TypeError` | `ARCH-FAILURE-EXPLICIT` |');
    lines.push('| `12345` | Adversarial (Tipo) | `TypeError` | `ARCH-FAILURE-EXPLICIT` |');
    lines.push('| `"> 65.536 chars"` | Adversarial (Carga) | `RangeError` | Limite de segurança e prevenção de DoS |');
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

  // Sincronização de failureSemantics (ex: Q-0003 - Reversão vs Absorção)
  let updatedFailureSemantics = draftContract.failureSemantics;
  const isAbsorb = updatedDecisions.some((d) => d.questionId === 'Q-0003' && d.selectedAnswerId === 'ANS-TREASURY-ABSORB');
  const isAtomic = updatedDecisions.some((d) => d.questionId === 'Q-0003' && d.selectedAnswerId === 'ANS-ATOMIC-ROLLBACK');
  if (isAbsorb && Array.isArray(updatedFailureSemantics)) {
    updatedFailureSemantics = updatedFailureSemantics.map((f) => {
      if (f.id === 'FAIL-0001') {
        return {
          ...f,
          trigger: 'Discrepância fracionária de 1 unit (1n) na conservação de massa do ciclo',
          observableResult: 'Compensação debitada/creditada no saldo da conta tesouro com log de auditoria emitido',
        };
      }
      return f;
    });
  } else if (isAtomic && Array.isArray(updatedFailureSemantics)) {
    updatedFailureSemantics = updatedFailureSemantics.map((f) => {
      if (f.id === 'FAIL-0001') {
        return {
          ...f,
          trigger: 'Discrepância fracionária de 1 unit (1n) na conservação de massa do ciclo',
          observableResult: 'Reversão atômica da rodada, isolamento das contas divergentes via SettlementBus e recálculo linear (ARCH-FAILURE-EXPLICIT)',
        };
      }
      return f;
    });
  }

  // Sincronização de escopo autorizado (ex: Q-0002 - Ecossistema Integral vs Stubs Mínimos)
  let updatedScope = draftContract.scope;
  const isStubInline = updatedDecisions.some((d) => d.questionId === 'Q-0002' && d.selectedAnswerId === 'ANS-STUB-INLINE');
  const isRestoreEco = updatedDecisions.some((d) => d.questionId === 'Q-0002' && d.selectedAnswerId === 'ANS-RESTORE-ECOSYSTEM');
  if (isStubInline && updatedScope) {
    updatedScope = {
      ...updatedScope,
      authorizedPaths: ['src/index.ts', 'src/liquidityResolver.ts', 'src/.aegis/semantic-state.json'],
    };
  } else if (isRestoreEco && updatedScope) {
    updatedScope = {
      ...updatedScope,
      authorizedPaths: [
        'src/index.ts',
        'src/liquidityResolver.ts',
        'src/settlementBus.ts',
        'src/clearingEngine.ts',
        'src/clearinghouseCore.ts',
        'src/throttleGuard.ts',
        'src/settlementEngine.ts',
        'src/.aegis/semantic-state.json',
      ],
    };
  }

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
    ...(updatedScope ? { scope: updatedScope } : {}),
    ...(updatedFailureSemantics ? { failureSemantics: updatedFailureSemantics } : {}),
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
  const isPalindromeDemand = /(?:palindrom|palindrome)/iu.test(`${customTitle || ''} ${sanitizedText}`);
  const isLiquidityDemand = /(?:liquidityresolver|deadlock|câmara de compensação|camara de compensacao|anéis circulares|aneis circulares|anel circular|minflow)/iu.test(`${customTitle || ''} ${sanitizedText}`);

  const title = customTitle || (isLiquidityDemand
    ? 'Motor de Otimização Multilateral de Liquidez (LiquidityResolver)'
    : normalizeDemandTitle(sanitizedText));
  const intent = customIntent || sanitizedText;

  const fileMatches = sanitizedText.match(/\b(?:src\/)?[a-zA-Z0-9_.-]+\.(?:ts|proof\.sh)\b/gu) || [];
  const extractedPaths = fileMatches.map((f) => (f.startsWith('src/') ? f : `src/${f}`));

  let mainPath = 'src/index.ts';
  let proofPath = 'src/index.proof.sh';
  if (isLiquidityDemand) {
    mainPath = 'src/liquidityResolver.ts';
    proofPath = 'src/index.proof.sh';
  } else if (targetHint && targetHint.startsWith('src/')) {
    mainPath = targetHint;
    proofPath = targetHint.replace(/\.ts$/, '.proof.sh');
  } else if (candidates.length > 0 && candidates[0].path?.startsWith('src/')) {
    mainPath = candidates[0].path;
    proofPath = mainPath.replace(/\.ts$/, '.proof.sh');
  } else if (extractedPaths.some((p) => p.endsWith('.ts') && !p.endsWith('.proof.sh') && p !== 'src/index.ts')) {
    mainPath = extractedPaths.find((p) => p.endsWith('.ts') && !p.endsWith('.proof.sh') && p !== 'src/index.ts');
    proofPath = mainPath.replace(/\.ts$/, '.proof.sh');
  }

  const liquidityAuthorizedPaths = [
    'src/index.ts',
    'src/liquidityResolver.ts',
    'src/settlementBus.ts',
    'src/clearingEngine.ts',
    'src/clearinghouseCore.ts',
    'src/throttleGuard.ts',
    'src/settlementEngine.ts',
    'src/index.proof.sh',
    'src/.aegis/semantic-state.json',
  ];

  const defaultPaths = isLiquidityDemand
    ? liquidityAuthorizedPaths
    : (changeKind === 'PRODUCT'
      ? ['src/index.ts', mainPath, proofPath, 'src/.aegis/semantic-state.json']
      : ['scripts/ide_gateway.sh', 'scripts/lib/issue_contract_core.mjs', 'src/.aegis/semantic-state.json']);

  const authorizedPaths = Array.isArray(customAuthorizedPaths) && customAuthorizedPaths.length > 0
    ? [...new Set([...customAuthorizedPaths, 'src/.aegis/semantic-state.json'])]
    : (isLiquidityDemand ? liquidityAuthorizedPaths : [...new Set([...defaultPaths, ...extractedPaths])]);

  const isStateless = !isLiquidityDemand && (stateModelKind === 'NONE' || (stateModelKind === null && !customStateModel && isPureFunctionDemand(sanitizedText)));

  const appliedRuleIds = (architecture?.candidateRules ?? [])
    .filter((r) => r.id === 'ARCH-FAILURE-EXPLICIT' || (r.id === 'ARCH-DETERMINISTIC-TIME' && (isLiquidityDemand || isTimeDependent(sanitizedText))))
    .map((r) => r.id);
  if (!appliedRuleIds.includes('ARCH-FAILURE-EXPLICIT')) {
    appliedRuleIds.push('ARCH-FAILURE-EXPLICIT');
  }
  if (!appliedRuleIds.includes('ARCH-DETERMINISTIC-TIME') && (isLiquidityDemand || isTimeDependent(sanitizedText))) {
    appliedRuleIds.push('ARCH-DETERMINISTIC-TIME');
  }

  const requirements = isLiquidityDemand ? [
    {
      id: 'REQ-0001',
      statement: 'Resolver ciclos de liquidez (deadlocks) em lote preservando o invariante de conservação de massa.',
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
  ] : [
    {
      id: 'REQ-0001',
      statement: isPalindromeDemand
        ? 'Avaliar a simetria referencial da string de entrada para determinar se é um palíndromo.'
        : `Executar o comportamento nominal da demanda: ${title}`,
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

  const behavior = isLiquidityDemand ? [
    {
      id: 'BEH-0001',
      statement: 'Identificar ciclos fechados de obrigações em lote (A→B→C→A) e aplicar obliteração multilateral de dívida calculando o valor mínimo do ciclo (MinFlow=min(V_AB, V_BC, V_CA)). Todas as arestas do ciclo devem ser reduzidas por esse MinFlow sem exigir saldo inicial prévio dos participantes, aplicando uma retenção de taxa líquida proporcional que é creditada diretamente à conta tesouro do sistema.',
      requirementIds: ['REQ-0001'],
    },
    {
      id: 'BEH-0002',
      statement: 'Erros e condições adversariais geram rejeição explícita e rastreável.',
      requirementIds: ['REQ-0002'],
    },
  ] : [
    {
      id: 'BEH-0001',
      statement: isPalindromeDemand
        ? 'Dada uma entrada de texto, retornar true se a sequência for simétrica quando lida em ambos os sentidos conforme os critérios de normalização estabelecidos, e false caso contrário.'
        : `O subsistema processa a demanda em conformidade com as regras de negócio: ${title}`,
      requirementIds: ['REQ-0001'],
    },
    {
      id: 'BEH-0002',
      statement: 'Erros e condições adversariais geram rejeição explícita e rastreável.',
      requirementIds: ['REQ-0002'],
    },
  ];

  const preconditions = isLiquidityDemand ? [
    {
      id: 'PRE-0001',
      statement: 'Ordens estruturadas com montantes positivos e identificadores válidos.',
      requirementIds: ['REQ-0001'],
    },
    {
      id: 'PRE-0002',
      statement: 'Carimbos temporais de alta precisão BigInt(nowMs) fornecidos para a guarda de vazão temporal.',
      requirementIds: ['REQ-0001', 'REQ-0002'],
    },
  ] : (isStateless ? [
    {
      id: 'PRE-0001',
      statement: 'Argumentos válidos fornecidos na fronteira da função pública conforme tipagem.',
      requirementIds: ['REQ-0001'],
    },
    {
      id: 'PRE-0002',
      statement: 'Tamanho da string de entrada limitado a 65.536 caracteres para prevenção de sobrecarga computacional (DoS).',
      requirementIds: ['REQ-0001', 'REQ-0002'],
    },
  ] : [
    {
      id: 'PRE-0001',
      statement: 'Entradas válidas sanitizadas fornecidas na fronteira pública.',
      requirementIds: ['REQ-0001'],
    },
    {
      id: 'PRE-0002',
      statement: 'Carga de entrada contida dentro dos tetos de segurança operacional.',
      requirementIds: ['REQ-0001', 'REQ-0002'],
    },
  ]);

  const invariants = isLiquidityDemand ? [
    {
      id: 'INV-0001',
      statement: 'Teorema de Conservação de Massa (Zero-Sum Invariant): ∑S_inicial = ∑S_final + ∑Taxas deve ser estritamente preservado.',
      requirementIds: ['REQ-0001', 'REQ-0003'],
      proofIds: ['PO-BEHAVIOR', 'PO-ARCH-STATIC'],
    },
    {
      id: 'INV-0002',
      statement: 'Proteção contra Granularidade Sub-Milissegundo: Ordens com Δt = 0n acumulam pressão de hits no ThrottleGuard sem mutação regressiva de relógio.',
      requirementIds: ['REQ-0001', 'REQ-0003'],
      proofIds: ['PO-BEHAVIOR', 'PO-ARCH-STATIC'],
    },
    {
      id: 'INV-0003',
      statement: 'Telemetria Instantânea em Bitmask 32-bit: Conversão determinística em hot-path sem alocação dinâmica de objetos (Zero-GC).',
      requirementIds: ['REQ-0001', 'REQ-0003'],
      proofIds: ['PO-BEHAVIOR', 'PO-ARCH-STATIC'],
    },
    {
      id: 'INV-TIE-BREAK',
      statement: 'Ordem Determinística de Desempate: Havendo múltiplos ciclos elegíveis simultâneos com mesmo MinFlow, a ordem de resolução é estritamente lexicográfica pelos identificadores de conta envolvidos.',
      requirementIds: ['REQ-0001', 'REQ-0003'],
      proofIds: ['PO-BEHAVIOR', 'PO-ARCH-STATIC'],
    },
  ] : (isStateless ? [
    {
      id: 'INV-0001',
      statement: 'Determinismo referencial puro: entradas idênticas produzem sempre resultados idênticos sem dependência de estado externo.',
      requirementIds: ['REQ-0001', 'REQ-0003'],
      proofIds: ['PO-BEHAVIOR', 'PO-ARCH-STATIC'],
    },
    {
      id: 'INV-0002',
      statement: 'Ausência de efeitos colaterais e conformidade física: a execução não introduz mutação oculta nem viola regras estáticas de arquitetura.',
      requirementIds: ['REQ-0002', 'REQ-0003'],
      proofIds: ['PO-FAILURES', 'PO-ARCH-STATIC'],
    },
  ] : [
    {
      id: 'INV-0001',
      statement: 'O estado do sistema mantém consistência interna e conservação de invariantes durante todo o ciclo.',
      requirementIds: ['REQ-0001', 'REQ-0003'],
      proofIds: ['PO-BEHAVIOR', 'PO-ARCH-STATIC'],
    },
    {
      id: 'INV-0002',
      statement: 'Operações falíveis não provocam mutações parciais nem efeitos colaterais residuais e cumprem regras estáticas de arquitetura.',
      requirementIds: ['REQ-0002', 'REQ-0003'],
      proofIds: ['PO-FAILURES', 'PO-ARCH-STATIC'],
    },
  ]);

  const postconditions = isLiquidityDemand ? [
    {
      id: 'POST-0001',
      statement: 'Ciclos obliterados até o MinFlow com resíduos positivos preservados e telemetria atualizada.',
      requirementIds: ['REQ-0001'],
    },
  ] : (isStateless ? [
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
  ]);

  const failureSemantics = isLiquidityDemand ? [
    {
      id: 'FAIL-0001',
      trigger: 'Discrepância fracionária de 1 unit (1n) na conservação de massa do ciclo',
      observableResult: 'Reversão atômica da rodada, isolamento das contas divergentes via SettlementBus e recálculo linear (ARCH-FAILURE-EXPLICIT)',
      requirementIds: ['REQ-0002'],
    },
    {
      id: 'FAIL-0002',
      trigger: 'Saturação de taxa de vazão temporal ou bloqueio geral ativo',
      observableResult: 'Rejeição explícita com flag de bloqueio ativada e integridade do lote preservada',
      requirementIds: ['REQ-0002'],
    },
    {
      id: 'FAIL-0003',
      trigger: 'Argumentos inválidos, contas idênticas (A→A) ou violação de contrato de entrada',
      observableResult: 'Lançamento explícito de RangeError ou TypeError tipado sem processamento residual (ARCH-FAILURE-EXPLICIT)',
      requirementIds: ['REQ-0002'],
    },
  ] : (isStateless ? [
    {
      id: 'FAIL-0001',
      trigger: 'Argumento de tipo inválido ou violação de contrato de entrada',
      observableResult: 'Lançamento explícito de exceção tipada (ex: TypeError) sem captura silenciosa (ARCH-FAILURE-EXPLICIT)',
      requirementIds: ['REQ-0002'],
    },
    {
      id: 'FAIL-0002',
      trigger: 'Tamanho da string de entrada excede o limite seguro de 65.536 caracteres',
      observableResult: 'Lançamento explícito de RangeError sem processamento residual (ARCH-FAILURE-EXPLICIT)',
      requirementIds: ['REQ-0002'],
    },
  ] : [
    {
      id: 'FAIL-0001',
      trigger: 'Entrada inválida, falha operacional ou violação de invariante',
      observableResult: 'Rejeição explícita tipada sem mutação parcial e sem capturas silenciosas',
      requirementIds: ['REQ-0002'],
    },
    {
      id: 'FAIL-0002',
      trigger: 'Carga de entrada excede o limite seguro operacional',
      observableResult: 'Rejeição explícita tipada sem mutação parcial (ARCH-FAILURE-EXPLICIT)',
      requirementIds: ['REQ-0002'],
    },
  ]);

  const finalDecisions = Array.isArray(decisions) ? [...decisions] : [];
  if (isLiquidityDemand && finalDecisions.length === 0) {
    finalDecisions.push(
      {
        questionId: 'Q-0001',
        question: 'Qual a diretriz arquitetural para integração dos módulos e tratamento de erros?',
        scope: 'ARCHITECTURE',
        recommendedAnswerId: 'ANS-STRICT-KISS',
        selectedAnswerId: 'ANS-STRICT-KISS',
        answers: [
          {
            id: 'ANS-STRICT-KISS',
            label: 'Pragmática Estrita (KISS & Zero-GC)',
            rationale: 'Rejeita terminantemente decoradores de runtime, injeção de dependências global, classes abstratas infladas e "any". Adota composição direta tipada em TypeScript e tratamento explícito de falhas (ARCH-FAILURE-EXPLICIT).',
            resolutionClause: 'Implementar com composição estrita em TypeScript, sem decoradores, sem DI global, sem "any" e sem capturas silenciosas de erro.',
            recommended: true,
          },
          {
            id: 'ANS-LAX-OVERENGINEERING',
            label: 'Abstrações Permissivas com Decoradores e DI Global',
            rationale: 'Usa decoradores de runtime, DI global e capturas flexíveis com "any".',
            resolutionClause: 'Utilizar padrões de DI e decoradores dinâmicos complacentes.',
            recommended: false,
          },
        ],
      },
      {
        questionId: 'Q-0002',
        question: 'Como estruturar a interoperabilidade com o ecossistema preexistente de módulos?',
        scope: 'SCOPE',
        recommendedAnswerId: 'ANS-RESTORE-ECOSYSTEM',
        selectedAnswerId: 'ANS-RESTORE-ECOSYSTEM',
        answers: [
          {
            id: 'ANS-RESTORE-ECOSYSTEM',
            label: 'Materialização Integral do Ecossistema',
            rationale: 'Reincorpora os módulos canônicos (SettlementBus, ClearingEngine, ClearinghouseCore, ThrottleGuard, SettlementEngine) no escopo autorizado e exporta todos nominalmente em src/index.ts via ESM (.js).',
            resolutionClause: 'Garantir a integridade física de todos os módulos preexistentes do ecossistema e suas exportações nominais ESM (.js) em src/index.ts.',
            recommended: true,
          },
          {
            id: 'ANS-STUB-INLINE',
            label: 'Stubs Mínimos Isolados',
            rationale: 'Declara tipos e stubs mockados apenas dentro de liquidityResolver.ts sem restaurar os módulos independentes.',
            resolutionClause: 'Restringir o escopo a um único arquivo com dependências embutidas.',
            recommended: false,
          },
        ],
      },
      {
        questionId: 'Q-0003',
        question: 'Qual a conduta diante de discrepância fracionária de 1 unit (1n) na resolução de ciclos?',
        scope: 'DEMAND',
        recommendedAnswerId: 'ANS-ATOMIC-ROLLBACK',
        selectedAnswerId: 'ANS-ATOMIC-ROLLBACK',
        answers: [
          {
            id: 'ANS-ATOMIC-ROLLBACK',
            label: 'Reversão Atômica com Quarentena Imediata',
            rationale: 'Se ∑Sinicial != ∑Sfinal + ∑Taxas por arredondamento em basis points, aborta a rodada de ciclo, isola as contas divergentes no SettlementBus e recalcula as ordens lineares restantes.',
            resolutionClause: 'Executar reversão atômica em caso de quebra de 1 unit (1n), isolar contas divergentes e preservar o Teorema de Conservação de Massa.',
            recommended: true,
          },
          {
            id: 'ANS-TREASURY-ABSORB',
            label: 'Absorção pelo Tesouro do Sistema',
            rationale: 'Compensa a diferença fracionária de 1n debitando ou creditando o saldo da conta tesouro sem estornar a rodada.',
            resolutionClause: 'Permitir ajuste contábil no tesouro sem interrupção do ciclo.',
            recommended: false,
          },
        ],
      },
    );
  } else if (isPalindromeDemand && finalDecisions.length === 0) {
    finalDecisions.push({
      questionId: 'Q-0001',
      question: 'Qual o critério de normalização para avaliação de palíndromos?',
      scope: 'INPUT',
      recommendedAnswerId: 'ANS-CANONICAL',
      selectedAnswerId: 'ANS-CANONICAL',
      answers: [
        {
          id: 'ANS-CANONICAL',
          label: 'Canônico Universal (Tolerante a Diacríticos, Frases, Case e Alfabetos Unicode)',
          rationale: 'Remove espaços, pontuação, símbolos e acentuação/trema (NFD) preservando caracteres alfanuméricos de qualquer alfabeto Unicode (padrão em linguagem natural).',
          resolutionClause: 'Avaliar palíndromos sob normalização canônica universal Unicode (case-insensitive, remoção de diacríticos, pontuação e espaços).',
          recommended: true,
        },
        {
          id: 'ANS-STRICT',
          label: 'Estrito / Literal (Caractere a Caractere)',
          rationale: 'Compara a sequência bruta exata de caracteres conforme fornecida, preservando case e espaços.',
          resolutionClause: 'Avaliar palíndromos de forma estrita caractere a caractere sem qualquer normalização.',
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

  const knownFacts = [
    `Demanda textual do usuário (provenance: USER): "${sanitizedText.replace(/\n+/g, ' ').trim()}"`,
    isStateless
      ? 'Modelo operacional: Função pura e determinística sem estado persistente (Stateless).'
      : 'Modelo operacional: Transição de estado com persistência e garantia de atomicidade (Stateful).',
    `Ponto de entrada autorizado: ${mainPath}`,
  ];

  const unknownFacts = finalDecisions.length > 0
    ? finalDecisions.map((d) => `[${d.questionId}] ${d.question} (Submetido a deliberação formal no Wizard para evitar inferência arbitrária)`)
    : ['Nenhuma lacuna material não fornecida que altere o comportamento observável (AGENTS.md Lei II).'];

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
    evidenceDiscipline: {
      knownFacts,
      unknownFacts,
    },
    proofObligations: customProofObligations ?? proofObligations,
    verification: {
      riskProfile: 'fast',
      adversarialClasses: isStateless
        ? ['BOUNDARIES', 'OBSERVABILITY', 'COMPOSITION', 'TIME']
        : ['CONTINUITY', 'BOUNDARIES', 'OBSERVABILITY', 'ATOMICITY'],
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

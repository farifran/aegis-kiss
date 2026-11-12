import {
  assert,
  log,
  validateContradictionDetection,
  validateFieldLifecycle,
  validateProvenanceEnforcement,
} from './shared.mjs';

export async function runProvenanceAndDiscoveryTests() {
// TEST-107: Collection canonical serialization with non-identifier simple ordering key blocked
{
  const model = {
    entities: [{
      name: 'Gaveta',
      isCollection: true,
      admissionPolicy: 'ON_FRAME',
      capacityPolicy: { maxEntries: '10', overflowPolicy: 'REJECT_NEW' },
      fields: [
        {
          name: 'seloConferencia',
          type: 'INTEGER',
          bounds: { lowerBound: '0', upperBound: '1000', boundaryBehavior: 'PRESERVE' },
          initialization: { kind: 'EXPLICIT_VALUE', value: '0' },
          mutations: [],
          preservation: ['*'],
          readBy: ['*'],
        },
      ],
    }],
    canonicalSerializations: [{
      target: 'Gaveta',
      includedFields: ['Gaveta.seloConferencia'],
      fieldEncodings: [{ field: 'Gaveta.seloConferencia', encoding: 'BIGINT_64_BE' }],
      recordOrderingKey: 'Gaveta.seloConferencia ASC',
      emptyStateDigest: '0x0',
    }],
  };

  const result = validateFieldLifecycle({
    stateModel: model,
    architectureContexts: [{ tag: 'integrity-hash' }],
  });
  assert.equal(result.valid, false, 'TEST-107: non-unique order key without tie breaking must fail');
  assert.ok(result.issues.some((i) => i.kind === 'UNRESOLVED_CANONICAL_SERIALIZATION' && i.slotId.includes('tieBreaking')));
  log('  PASS: TEST-107 Collection canonical serialization with non-identifier simple ordering key blocked');
}

// TEST-108: Invented numeric literal citing WORKSPACE_EVIDENCE without presence in lines is blocked
{
  const model = {
    entities: [{
      name: 'Account',
      isCollection: false,
      fields: [{
        name: 'balance',
        type: 'INTEGER',
        bounds: {
          lowerBound: '0',
          upperBound: '500000000',
          boundaryBehavior: 'REJECT',
          provenance: [{ source: 'WORKSPACE_EVIDENCE', reference: 'src/ledger.ts#L25' }],
        },
        initialization: { kind: 'EXPLICIT_VALUE', value: '0' },
        mutations: [],
        preservation: ['*'],
        readBy: ['*'],
      }],
    }],
  };
  const workspaceEvidence = [{
    path: 'src/ledger.ts',
    startLine: 20,
    endLine: 30,
    content: 'line20\nline21\nline22\nline23\nline24\nreadonly balance: number;\nline26\nline27\nline28\nline29\nline30',
  }];
  const res = validateProvenanceEnforcement({
    stateModel: model,
    workspaceEvidence,
    literalFacts: [{ id: 'FACT-0001', kind: 'NUMBER_LITERAL', attributes: { value: '0' } }],
  });
  assert.equal(res.valid, false, 'TEST-108: invented number 500000000 not in line 25 must fail');
  assert.ok(res.issues.some((i) => i.kind === 'UNAUTHORIZED_NUMERIC_LITERAL' && i.reason.includes('500000000')));
  log('  PASS: TEST-108 Invented numeric literal in WORKSPACE_EVIDENCE blocked with UNAUTHORIZED_NUMERIC_LITERAL');
}

// TEST-109: Ungrounded guard codes blocked with UNAUTHORIZED_GUARD_OR_ERROR_CODE
{
  const model = {
    entities: [{
      name: 'Ledger',
      fields: [{
        name: 'balance',
        type: 'INTEGER',
        bounds: { lowerBound: '0', upperBound: '100', boundaryBehavior: 'REJECT' },
        initialization: { kind: 'EXPLICIT_VALUE', value: '0' },
        mutations: [],
        preservation: ['*'],
        readBy: ['*'],
      }],
    }],
    operations: [{
      name: 'reverseSettlement',
      guardPrecedence: ['GUARD_ACCOUNT_FROZEN', 'INSUFFICIENT_SETTLED_BALANCE'],
      branches: [
        { branchId: 'GUARD_ACCOUNT_FROZEN', outcomeKind: 'REJECTION', defaultPreservation: true },
        { branchId: 'INSUFFICIENT_SETTLED_BALANCE', outcomeKind: 'REJECTION', defaultPreservation: true },
        { branchId: 'SUCCESS', outcomeKind: 'STATE_CHANGE', defaultPreservation: false, stateEffects: [{ effect: 'DECREMENT', field: 'Ledger.balance', value: '1' }] },
      ],
      parameters: [{
        name: 'amount',
        type: 'INTEGER',
        bounds: { lowerBound: '1', upperBound: '100', boundaryBehavior: 'REJECT' },
        onInvalid: { error: 'INVALID_REVERSE_AMOUNT' },
      }],
    }],
  };
  const res = validateProvenanceEnforcement({
    stateModel: model,
    intent: 'Estender reverseSettlement e verificar GUARD_ACCOUNT_FROZEN.',
    workspaceEvidence: [{ path: 'src/guard.ts', content: 'export type GuardCode = "GUARD_ACCOUNT_FROZEN";' }],
  });
  assert.equal(res.valid, false, 'TEST-109: ungrounded guard and param error codes must fail');
  assert.ok(res.issues.some((i) => i.kind === 'UNAUTHORIZED_GUARD_OR_ERROR_CODE' && i.slotId.includes('INSUFFICIENT_SETTLED_BALANCE')));
  assert.ok(res.issues.some((i) => i.kind === 'UNAUTHORIZED_GUARD_OR_ERROR_CODE' && i.slotId.includes('INVALID_REVERSE_AMOUNT')));
  log('  PASS: TEST-109 Ungrounded guard and parameter error codes blocked with UNAUTHORIZED_GUARD_OR_ERROR_CODE');
}

// TEST-110: Acceptance cases expecting STATE_CHANGE vs operation branches without mutations blocked with CONTRADICTORY_RULE_DETECTED
{
  const model = {
    entities: [{
      name: 'Counter',
      fields: [{
        name: 'val',
        type: 'INTEGER',
        bounds: { lowerBound: '0', upperBound: '100', boundaryBehavior: 'REJECT' },
        initialization: { kind: 'EXPLICIT_VALUE', value: '0' },
        mutations: [],
        preservation: ['*'],
        readBy: ['*'],
      }],
    }],
    operations: [{
      name: 'doAction',
      guardPrecedence: [],
      branches: [
        { branchId: 'BRANCH_1', outcomeKind: 'STATE_CHANGE', defaultPreservation: true, stateEffects: [] },
      ],
    }],
  };
  const requirements = [{
    id: 'REQ-0001',
    statement: 'Deve alterar o contador.',
    acceptanceCases: [{ id: 'AC-0001', kind: 'SUCCESS', outcomeKind: 'STATE_CHANGE', given: 'val = 0', when: 'action', then: 'val = 1' }],
  }];
  const res = validateContradictionDetection({
    stateModel: model,
    requirements,
  });
  assert.equal(res.valid, false, 'TEST-110: STATE_CHANGE with defaultPreservation: true and no mutations must fail');
  assert.ok(res.issues.some((i) => i.kind === 'CONTRADICTORY_RULE_DETECTED'));
  log('  PASS: TEST-110 Contradiction between STATE_CHANGE and defaultPreservation blocked with CONTRADICTORY_RULE_DETECTED');
}

// TEST-111: Math.* expressions in operation state effects do not trigger OPEN_COMPUTATIONAL_DEPENDENCY
{
  const model = {
    entities: [{
      name: 'Ledger',
      fields: [{
        name: 'balance',
        type: 'INTEGER',
        bounds: { lowerBound: '0', upperBound: '100', boundaryBehavior: 'REJECT' },
        initialization: { kind: 'EXPLICIT_VALUE', value: '0' },
        mutations: [],
        preservation: ['*'],
        readBy: ['*'],
      }],
    }],
    operations: [{
      name: 'clampBalance',
      guardPrecedence: [],
      parameters: [{ name: 'delta', type: 'INTEGER', bounds: { lowerBound: '0', upperBound: '10' } }],
      branches: [{
        branchId: 'SUCCESS',
        outcomeKind: 'STATE_CHANGE',
        defaultPreservation: false,
        stateEffects: [{
          field: 'Ledger.balance',
          effect: 'SET',
          value: 'Math.min(Ledger.balance + delta, 100)',
        }],
      }],
    }],
  };
  const res = validateFieldLifecycle({
    stateModel: model,
  });
  assert.ok(!res.issues.some((i) => i.kind === 'OPEN_COMPUTATIONAL_DEPENDENCY'), 'TEST-111: Math.min must not trigger OPEN_COMPUTATIONAL_DEPENDENCY');
  log('  PASS: TEST-111 Standard Math functions in stateEffects pass without OPEN_COMPUTATIONAL_DEPENDENCY');
}

// TEST-112: Rigorous provenance & anti-self-grounding verification
{
  const ws = [
    {
      path: 'src/ledger/settlement.ts',
      startLine: 1,
      endLine: 20,
      content: 'line1\nexport const MAX_ITEMS = 250;\nexport const DAILY_LIMIT = 5000000;\nline4\nreadonly balance: number;\n',
    },
    {
      path: 'src/risk/guard.ts',
      startLine: 1,
      endLine: 10,
      content: 'export const MAX_RETRIES = 5;\nexport type Guard = "GUARD_FROZEN";\n',
    },
  ];

  // 1. Valid bounds citing :Lx-Ly format pass
  const validModel = {
    entities: [{
      name: 'State',
      fields: [
        {
          name: 'items',
          type: 'INTEGER',
          bounds: { lowerBound: '0', upperBound: '250', provenance: [{ source: 'WORKSPACE_EVIDENCE', reference: 'src/ledger/settlement.ts:L2-L2' }] },
        },
        {
          name: 'daily',
          type: 'INTEGER',
          bounds: { lowerBound: '0', upperBound: '5000000', provenance: [{ source: 'WORKSPACE_EVIDENCE', reference: 'src/ledger/settlement.ts:L3-L3' }] },
        },
      ],
    }],
    operations: [{
      name: 'reverse',
      guardPrecedence: ['GUARD_FROZEN'],
      branches: [{ branchId: 'GUARD_FROZEN', outcomeKind: 'REJECTION', defaultPreservation: true }],
      parameters: [{
        name: 'amt',
        type: 'INTEGER',
        bounds: { lowerBound: '1', upperBound: '5000000', provenance: [{ source: 'WORKSPACE_EVIDENCE', reference: 'src/ledger/settlement.ts:L3-L3' }] },
      }],
    }],
  };

  const validRes = validateProvenanceEnforcement({
    stateModel: validModel,
    workspaceEvidence: ws,
    intent: 'Operação reverse com guarda GUARD_FROZEN.',
    literalFacts: [{ id: 'FACT-0001', kind: 'NUMBER_LITERAL', attributes: { value: '0' } }],
  });
  assert.equal(validRes.valid, true, 'TEST-112: valid references with :Lx-Ly and parameter bounds must pass');

  // 2. Substring '50' matching within '5000000' is rejected
  const substringModel = {
    entities: [{
      name: 'State',
      fields: [{
        name: 'fake',
        type: 'INTEGER',
        bounds: { lowerBound: '0', upperBound: '50', provenance: [{ source: 'WORKSPACE_EVIDENCE', reference: 'src/ledger/settlement.ts:L3-L3' }] },
      }],
    }],
  };
  const subRes = validateProvenanceEnforcement({
    stateModel: substringModel,
    workspaceEvidence: ws,
    literalFacts: [{ id: 'FACT-0001', kind: 'NUMBER_LITERAL', attributes: { value: '0' } }],
  });
  assert.equal(subRes.valid, false, 'TEST-112: substring number 50 inside 5000000 must be blocked');

  // 3. Fail-closed when workspaceEvidence is empty
  const emptyWsRes = validateProvenanceEnforcement({
    stateModel: validModel,
    workspaceEvidence: [],
    literalFacts: [{ id: 'FACT-0001', kind: 'NUMBER_LITERAL', attributes: { value: '0' } }],
  });
  assert.equal(emptyWsRes.valid, false, 'TEST-112: citing WORKSPACE_EVIDENCE with empty workspaceEvidence must fail closed');

  // 4. Operation parameter bounds without provenance are blocked
  const unbackedParamModel = {
    operations: [{
      name: 'op',
      parameters: [{
        name: 'p1',
        type: 'INTEGER',
        bounds: { lowerBound: '1', upperBound: '999999' },
      }],
    }],
  };
  const paramRes = validateProvenanceEnforcement({
    stateModel: unbackedParamModel,
    workspaceEvidence: ws,
    literalFacts: [{ id: 'FACT-0001', kind: 'NUMBER_LITERAL', attributes: { value: '0' } }],
  });
  assert.equal(paramRes.valid, false, 'TEST-112: parameter bounds without provenance must fail');

  log('  PASS: TEST-112 Rigorous provenance, whole-token matching, fail-closed & param bound checks verified');
}

// TEST-113: Decimal commas in pt-BR ("10,00", "0,5") extracted as single facts and authorized in provenance
{
  const { buildIntentEvidence } = await import('../../../lib/intent_evidence.mjs');
  const evidence = buildIntentEvidence('A cada R$ 10,00 em compras com taxa de 0,5% conceder 1 ponto.');
  const numFacts = evidence.literalFacts.filter((f) => f.kind === 'NUMBER_LITERAL');

  // Must not fragment "10,00" into "10" and "00"
  assert.ok(numFacts.some((f) => f.reference === '10,00' && f.attributes?.canonicalValue === '10.00'), 'TEST-113: 10,00 must be extracted as single literal fact');
  assert.ok(numFacts.some((f) => f.reference === '0,5' && f.attributes?.canonicalValue === '0.5'), 'TEST-113: 0,5 must be extracted as single literal fact');

  const fact10 = numFacts.find((f) => f.reference === '10,00');
  const model = {
    entities: [{
      name: 'Reward',
      fields: [{
        name: 'step',
        type: 'INTEGER',
        bounds: { lowerBound: '0', upperBound: '10', provenance: [{ source: 'USER_INTENT', reference: fact10.id }] },
      }],
    }],
  };
  const res = validateProvenanceEnforcement({
    stateModel: model,
    literalFacts: evidence.literalFacts,
    intent: 'A cada R$ 10,00 em compras.',
  });
  assert.equal(res.valid, true, 'TEST-113: fact with canonicalValue 10.00 must support bound 10');
  log('  PASS: TEST-113 Decimal comma in pt-BR extracted losslessly as single fact and verified');
}

// TEST-114: Workspace Skeleton AST symbol extraction and subtoken/morphological matching
{
  const { buildWorkspaceSkeleton } = await import('../../../lib/workspace_skeleton.mjs');
  const sourceRecords = [
    {
      path: 'src/ledger/settlement_engine.ts',
      text: [
        'export const MAX_BATCH_REJECTIONS = 10;',
        'export interface SettlementLedgerState { accountFrozen: boolean; }',
        'export function reverseSettlement(state: SettlementLedgerState, amount: number) { return state; }',
      ].join('\n'),
    },
  ];
  const skeleton = buildWorkspaceSkeleton(sourceRecords);
  assert.equal(skeleton.schema, 'aegis.workspace_skeleton.v1');
  assert.equal(skeleton.symbolCount, 3);
  assert.ok(skeleton.symbols.some((s) => s.name === 'MAX_BATCH_REJECTIONS' && s.kind === 'CONST'));
  assert.ok(skeleton.symbols.some((s) => s.name === 'SettlementLedgerState' && s.kind === 'INTERFACE'));
  assert.ok(skeleton.symbols.some((s) => s.name === 'reverseSettlement' && s.kind === 'FUNCTION'));

  // Test subtoken matching on AST symbols
  const { buildSemanticRequest } = await import('../../../lib/semantic_request.mjs');
  const path = await import('node:path');
  const fs = await import('node:fs');

  const tempDir = path.resolve('.harness/tmp_test_subtoken_ast');
  fs.mkdirSync(path.resolve(tempDir, 'src/ledger'), { recursive: true });
  fs.writeFileSync(path.resolve(tempDir, 'src/ledger/settlement_engine.ts'), sourceRecords[0].text);
  // Add padding to exceed smallWorkspace byte limit (98304) so lexical/symbol selection triggers
  const bigPadding = Array.from({ length: 2500 }, (_, i) => `// Padding line ${i} with filler text to exceed byte limits\n`).join('');
  fs.writeFileSync(path.resolve(tempDir, 'src/filler.ts'), bigPadding);

  try {
    const { observeWorkspace } = await import('../../../lib/issue_contract_core.mjs');
    // Demand uses Portuguese natural term "rejeições"
    const obs = observeWorkspace(tempDir, 'Precisamos tratar as rejeições consecutivas no fluxo');
    const preflight = {
      schema: 'aegis.preflight_handoff.v3',
      phase: 'DISCOVERED',
      status: 'SEMANTIC_DELIBERATION_REQUIRED',
      intent: 'Precisamos tratar as rejeições consecutivas no fluxo',
      discovery: obs.discovery,
    };
    const policy = { contexts: [{ tag: 'default', description: 'test' }], rules: [], amendments: [] };
    const constitution = {
      schema: 'aegis.constitution.v1',
      version: 1,
      digest: '0'.repeat(64),
      authority: 'TRUSTED_CONSTITUTION',
      rules: [{ id: 'CONST-KISS', statement: 'Parcimony' }],
    };

    const req = buildSemanticRequest({
      repositoryRoot: tempDir,
      preflight,
      policy,
      constitution,
      workspaceObservation: obs,
    });

    const evidence = req.workspace.sourceEvidence;
    assert.ok(evidence.length >= 1, 'TEST-114: sourceEvidence must be produced');
    const hasTargetFile = evidence.some((e) => e.path === 'src/ledger/settlement_engine.ts');
    assert.ok(hasTargetFile, 'TEST-114: settlement_engine.ts must be selected via subtoken matching on MAX_BATCH_REJECTIONS');
    const targetContent = evidence.find((e) => e.path === 'src/ledger/settlement_engine.ts').content;
    assert.ok(targetContent.includes('MAX_BATCH_REJECTIONS'), 'TEST-114: content must include MAX_BATCH_REJECTIONS');
    assert.ok(req.workspace.workspaceSkeleton, 'TEST-114: workspaceSkeleton must be present in request');
    assert.equal(req.workspace.workspaceSkeleton.symbols[0].name, 'MAX_BATCH_REJECTIONS', 'TEST-114: top prioritized symbol must be MAX_BATCH_REJECTIONS due to affinity matching on "rejeições"');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  log('  PASS: TEST-114 Workspace Skeleton AST symbols and subtoken/morphological matching verified');
}

// TEST-115: Structural header prioritization in buildSourceEvidence (Type guarantee)
{
  const { buildSemanticRequest } = await import('../../../lib/semantic_request.mjs');
  const fs = await import('node:fs');
  const path = await import('node:path');

  const header = [
    'import { GuardCode } from "../risk/velocity_guard.js";',
    'export const DAILY_LIMIT = 50000;',
    'export interface SettlementLedgerState {',
    '  readonly accountFrozen: boolean;',
    '  readonly settledBalanceCents: number;',
    '}',
    'export type LedgerStatus = "SETTLED" | "FROZEN";',
  ].join('\n');

  const filler = Array.from({ length: 150 }, (_, i) => `// Line filler comment ${i}`).join('\n');
  const targetFn = [
    'export function processTargetBatch(state: SettlementLedgerState) {',
    '  if (state.accountFrozen) return "FROZEN";',
    '  return "SETTLED";',
    '}',
  ].join('\n');

  const largeFileContent = `${header}\n${filler}\n${targetFn}\n`;
  const tempDir = path.resolve('.harness/tmp_test_header');
  fs.mkdirSync(path.resolve(tempDir, 'src'), { recursive: true });
  fs.writeFileSync(path.resolve(tempDir, 'src/engine.ts'), largeFileContent);

  try {
    const { observeWorkspace } = await import('../../../lib/issue_contract_core.mjs');
    const observation = observeWorkspace(tempDir, 'processTargetBatch');
    const preflight = {
      schema: 'aegis.preflight_handoff.v3',
      phase: 'DISCOVERED',
      status: 'SEMANTIC_DELIBERATION_REQUIRED',
      intent: 'processTargetBatch',
      discovery: observation.discovery,
    };
    const policy = {
      contexts: [{ tag: 'default', description: 'test' }],
      rules: [],
      amendments: [],
    };
    const constitution = {
      schema: 'aegis.constitution.v1',
      version: 1,
      digest: '0'.repeat(64),
      authority: 'TRUSTED_CONSTITUTION',
      rules: [{ id: 'CONST-KISS', statement: 'Parcimony' }],
    };

    const req = buildSemanticRequest({
      repositoryRoot: tempDir,
      preflight,
      policy,
      constitution,
      workspaceObservation: observation,
    });

    const evidence = req.workspace.sourceEvidence;
    assert.ok(evidence.length >= 1, 'TEST-115: evidence must be produced');
    const allContent = evidence.map((e) => e.content).join('\n');
    assert.ok(allContent.includes('interface SettlementLedgerState'), 'TEST-115: structural header types must be present in sourceEvidence');
    assert.ok(allContent.includes('DAILY_LIMIT'), 'TEST-115: structural constants must be present in sourceEvidence');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  log('  PASS: TEST-115 Structural header prioritization (type guarantee) verified');
}

// TEST-116: Provenance enforcement fail-closed on unauthorized numeric literals and guard codes
{
  const model = {
    entities: [{
      name: 'Account',
      fields: [{
        name: 'balance',
        type: 'INTEGER',
        bounds: {
          lowerBound: '0',
          upperBound: '999999999',
          provenance: [{ source: 'WORKSPACE_EVIDENCE', reference: 'src/index.ts:L1' }],
        },
      }],
    }],
    operations: [{
      name: 'testOp',
      guardPrecedence: ['HALLUCINATED_GUARD_CODE_XYZ'],
      branches: [
        { branchId: 'HALLUCINATED_GUARD_CODE_XYZ', outcomeKind: 'REJECTION', defaultPreservation: true },
        { branchId: 'OK', outcomeKind: 'RETURN_VALUE', defaultPreservation: true },
      ],
    }],
  };

  const res = validateProvenanceEnforcement({
    stateModel: model,
    intent: 'Operação simples',
    workspaceEvidence: [{ path: 'src/index.ts', content: 'const x = 10;', startLine: 1 }],
  });

  assert.equal(res.valid, false, 'TEST-116: hallucinated number and guard code must fail provenance');
  assert.ok(res.issues.some((i) => i.kind === 'UNAUTHORIZED_NUMERIC_LITERAL'), 'TEST-116: UNAUTHORIZED_NUMERIC_LITERAL expected');
  assert.ok(res.issues.some((i) => i.kind === 'UNAUTHORIZED_GUARD_OR_ERROR_CODE'), 'TEST-116: UNAUTHORIZED_GUARD_OR_ERROR_CODE expected');

  log('  PASS: TEST-116 Provenance enforcement fail-closed on unauthorized literals verified');
}

// TEST-117: Directory anchor fallback for new/unmatched files
{
  const { buildSemanticRequest } = await import('../../../lib/semantic_request.mjs');
  const path = await import('node:path');
  const fs = await import('node:fs');

  const tempDir = path.resolve('.harness/tmp_test_anchor_fallback');
  fs.mkdirSync(path.resolve(tempDir, 'src/ledger'), { recursive: true });
  fs.writeFileSync(path.resolve(tempDir, 'src/ledger/settlement_engine.ts'), 'export const SIBLING_LEDGER_CONST = 999;');
  // Add padding to exceed smallWorkspace limit (64KB)
  const bigPadding = Array.from({ length: 1500 }, (_, i) => `// Padding line ${i} with filler text\n`).join('');
  fs.writeFileSync(path.resolve(tempDir, 'src/filler.ts'), bigPadding);

  try {
    const { observeWorkspace } = await import('../../../lib/issue_contract_core.mjs');
    // Demand cites a completely new, non-existent file in src/ledger/
    const demand = 'Criar novo fluxo em src/ledger/installment_reversal.ts para amortização';
    const obs = observeWorkspace(tempDir, demand);
    const preflight = {
      schema: 'aegis.preflight_handoff.v3',
      phase: 'DISCOVERED',
      status: 'SEMANTIC_DELIBERATION_REQUIRED',
      intent: demand,
      discovery: obs.discovery,
    };
    const policy = { contexts: [{ tag: 'default', description: 'test' }], rules: [], amendments: [] };
    const constitution = {
      schema: 'aegis.constitution.v1',
      version: 1,
      digest: '0'.repeat(64),
      authority: 'TRUSTED_CONSTITUTION',
      rules: [{ id: 'CONST-KISS', statement: 'Parcimony' }],
    };

    const req = buildSemanticRequest({
      repositoryRoot: tempDir,
      preflight,
      policy,
      constitution,
      workspaceObservation: obs,
    });

    const evidence = req.workspace.sourceEvidence;
    assert.ok(evidence.length >= 1, 'TEST-117: sourceEvidence must be produced');
    const hasSiblingFile = evidence.some((e) => e.path === 'src/ledger/settlement_engine.ts');
    assert.ok(hasSiblingFile, 'TEST-117: sibling file src/ledger/settlement_engine.ts must be selected via directory anchor fallback');
    const siblingContent = evidence.find((e) => e.path === 'src/ledger/settlement_engine.ts').content;
    assert.ok(siblingContent.includes('SIBLING_LEDGER_CONST'), 'TEST-117: sibling content must include SIBLING_LEDGER_CONST');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  log('  PASS: TEST-117 Directory anchor fallback for new/unmatched files verified');
}

// TEST-118: Augmented matching via JSDoc comments and path subtokens
{
  const { buildSemanticRequest } = await import('../../../lib/semantic_request.mjs');
  const path = await import('node:path');
  const fs = await import('node:fs');

  const tempDir = path.resolve('.harness/tmp_test_jsdoc_matching');
  fs.mkdirSync(path.resolve(tempDir, 'src/billing'), { recursive: true });
  fs.writeFileSync(path.resolve(tempDir, 'src/billing/engine.ts'), [
    '/**',
    ' * Responsável pelo estorno e liquidação da conta',
    ' */',
    'export function processUndo(amount: number) { return amount; }',
  ].join('\n'));
  // Padding to exceed smallWorkspace limit (64KB)
  const bigPadding = Array.from({ length: 1500 }, (_, i) => `// Padding line ${i} with filler text\n`).join('');
  fs.writeFileSync(path.resolve(tempDir, 'src/filler.ts'), bigPadding);

  try {
    const { observeWorkspace } = await import('../../../lib/issue_contract_core.mjs');
    // Demand uses Portuguese term "estorno", which only appears in JSDoc comment
    const demand = 'Realizar estorno do cliente sem tarifas';
    const obs = observeWorkspace(tempDir, demand);
    const preflight = {
      schema: 'aegis.preflight_handoff.v3',
      phase: 'DISCOVERED',
      status: 'SEMANTIC_DELIBERATION_REQUIRED',
      intent: demand,
      discovery: obs.discovery,
    };
    const policy = { contexts: [{ tag: 'default', description: 'test' }], rules: [], amendments: [] };
    const constitution = {
      schema: 'aegis.constitution.v1',
      version: 1,
      digest: '0'.repeat(64),
      authority: 'TRUSTED_CONSTITUTION',
      rules: [{ id: 'CONST-KISS', statement: 'Parcimony' }],
    };

    const req = buildSemanticRequest({
      repositoryRoot: tempDir,
      preflight,
      policy,
      constitution,
      workspaceObservation: obs,
    });

    const evidence = req.workspace.sourceEvidence;
    assert.ok(evidence.length >= 1, 'TEST-118: sourceEvidence must be produced');
    const hasTargetFile = evidence.some((e) => e.path === 'src/billing/engine.ts');
    assert.ok(hasTargetFile, 'TEST-118: src/billing/engine.ts must be selected via JSDoc natural term matching ("estorno")');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  log('  PASS: TEST-118 Augmented matching via JSDoc comments and path subtokens verified');
}

// TEST-119: Multi-module Floor Guarantee under budget pressure preserves secondary modules
{
  const { buildSemanticRequest } = await import('../../../lib/semantic_request.mjs');
  const path = await import('node:path');
  const fs = await import('node:fs');

  const tempDir = path.resolve('.harness/tmp_test_multi_module_floor');
  fs.mkdirSync(path.resolve(tempDir, 'src/ledger'), { recursive: true });
  fs.mkdirSync(path.resolve(tempDir, 'src/reporting'), { recursive: true });

  // Ledger has multiple strong matching symbols (high score ~20+)
  fs.writeFileSync(path.resolve(tempDir, 'src/ledger/processor.ts'), [
    'export class LedgerProcessor {',
    '  processLedgerBatch() { return true; }',
    '  executeLedgerAudit() { return true; }',
    '}',
  ].join('\n'));

  // Reporting has a single symbol with moderate score (~7)
  fs.writeFileSync(path.resolve(tempDir, 'src/reporting/exporter.ts'), [
    'export class CsvExporter {',
    '  exportCsvData() { return "csv"; }',
    '}',
  ].join('\n'));

  // Large filler to simulate enterprise monorepo exceeding 64KB and trigger budget pressure
  const bigPadding = Array.from({ length: 1500 }, (_, i) => `// Padding line ${i} with filler text\n`).join('');
  fs.writeFileSync(path.resolve(tempDir, 'src/filler.ts'), bigPadding);

  try {
    const { observeWorkspace } = await import('../../../lib/issue_contract_core.mjs');
    const demand = 'Integrar src/ledger com src/reporting para exportar dados';
    const obs = observeWorkspace(tempDir, demand);
    const preflight = {
      schema: 'aegis.preflight_handoff.v3',
      phase: 'DISCOVERED',
      status: 'SEMANTIC_DELIBERATION_REQUIRED',
      intent: demand,
      discovery: obs.discovery,
    };
    const policy = { contexts: [{ tag: 'default', description: 'test' }], rules: [], amendments: [] };
    const constitution = {
      schema: 'aegis.constitution.v1',
      version: 1,
      digest: '0'.repeat(64),
      authority: 'TRUSTED_CONSTITUTION',
      rules: [{ id: 'CONST-KISS', statement: 'Parcimony' }],
    };

    const req = buildSemanticRequest({
      repositoryRoot: tempDir,
      preflight,
      policy,
      constitution,
      workspaceObservation: obs,
    });

    const evidence = req.workspace.sourceEvidence;
    assert.ok(evidence.length >= 2, 'TEST-119: sourceEvidence must include files from both authorized modules');
    const hasLedger = evidence.some((e) => e.path === 'src/ledger/processor.ts');
    const hasReporting = evidence.some((e) => e.path === 'src/reporting/exporter.ts');
    assert.ok(hasLedger, 'TEST-119: src/ledger/processor.ts must be preserved');
    assert.ok(hasReporting, 'TEST-119: src/reporting/exporter.ts must be preserved via Floor Guarantee despite lower score');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  log('  PASS: TEST-119 Multi-module Floor Guarantee under budget pressure verified');
}

// TEST-120: Budget-driven cutoff preserves moderate affinity files when quota has ample space
{
  const { buildSemanticRequest } = await import('../../../lib/semantic_request.mjs');
  const path = await import('node:path');
  const fs = await import('node:fs');

  const tempDir = path.resolve('.harness/tmp_test_budget_elasticity');
  fs.mkdirSync(path.resolve(tempDir, 'src/auth'), { recursive: true });

  // Moderate file: score ~3.5
  fs.writeFileSync(path.resolve(tempDir, 'src/auth/token_guard.ts'), [
    'export class TokenGuard {',
    '  validateSessionToken() { return true; }',
    '}',
  ].join('\n'));

  // High affinity file: score ~15
  fs.writeFileSync(path.resolve(tempDir, 'src/auth/session_manager.ts'), [
    'export class SessionManager {',
    '  createSession() { return true; }',
    '  destroySession() { return true; }',
    '  refreshSession() { return true; }',
    '}',
  ].join('\n'));

  // Small filler: total workspace ~10KB (well below 64KB, no budget pressure)
  const smallFiller = Array.from({ length: 80 }, (_, i) => `// Small filler line ${i}\n`).join('');
  fs.writeFileSync(path.resolve(tempDir, 'src/index.ts'), smallFiller);

  try {
    const { observeWorkspace } = await import('../../../lib/issue_contract_core.mjs');
    const demand = 'Gerenciar sessão de autenticação com validação de token em src/auth';
    const obs = observeWorkspace(tempDir, demand);
    const preflight = {
      schema: 'aegis.preflight_handoff.v3',
      phase: 'DISCOVERED',
      status: 'SEMANTIC_DELIBERATION_REQUIRED',
      intent: demand,
      discovery: obs.discovery,
    };
    const policy = { contexts: [{ tag: 'default', description: 'test' }], rules: [], amendments: [] };
    const constitution = {
      schema: 'aegis.constitution.v1',
      version: 1,
      digest: '0'.repeat(64),
      authority: 'TRUSTED_CONSTITUTION',
      rules: [{ id: 'CONST-KISS', statement: 'Parcimony' }],
    };

    const req = buildSemanticRequest({
      repositoryRoot: tempDir,
      preflight,
      policy,
      constitution,
      workspaceObservation: obs,
    });

    const evidence = req.workspace.sourceEvidence;
    const hasSessionManager = evidence.some((e) => e.path === 'src/auth/session_manager.ts');
    const hasTokenGuard = evidence.some((e) => e.path === 'src/auth/token_guard.ts');
    assert.ok(hasSessionManager, 'TEST-120: high affinity file must be selected');
    assert.ok(hasTokenGuard, 'TEST-120: moderate affinity file must be preserved when no budget pressure exists');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  log('  PASS: TEST-120 Budget-driven cutoff (quota elasticity) verified');
}

// TEST-121: Bilingual domain lexicon bridges Portuguese demand to English code without paths
{
  const { buildSemanticRequest } = await import('../../../lib/semantic_request.mjs');
  const path = await import('node:path');
  const fs = await import('node:fs');

  const tempDir = path.resolve('.harness/tmp_test_domain_lexicon');
  fs.mkdirSync(path.resolve(tempDir, '.harness'), { recursive: true });
  fs.mkdirSync(path.resolve(tempDir, 'src/ledger'), { recursive: true });
  fs.mkdirSync(path.resolve(tempDir, 'src/reporting'), { recursive: true });

  // Declarative domain lexicon
  fs.writeFileSync(path.resolve(tempDir, '.harness/domain-lexicon.json'), JSON.stringify({
    estorno: ['reversal', 'refund'],
    liquidacao: ['settlement', 'ledger'],
    relatorio: ['reporting', 'report'],
  }, null, 2));

  // Pure English code, zero Portuguese comments or terms
  fs.writeFileSync(path.resolve(tempDir, 'src/ledger/settlement.ts'), [
    'export class SettlementEngine {',
    '  processReversal(amount: number) { return amount; }',
    '}',
  ].join('\n'));

  fs.writeFileSync(path.resolve(tempDir, 'src/reporting/generator.ts'), [
    'export class ReportGenerator {',
    '  generateAuditCsv() { return "csv"; }',
    '}',
  ].join('\n'));

  // Large filler to exceed smallWorkspace limit
  const bigPadding = Array.from({ length: 1500 }, (_, i) => `// Padding line ${i} with filler text\n`).join('');
  fs.writeFileSync(path.resolve(tempDir, 'src/filler.ts'), bigPadding);

  try {
    const { observeWorkspace } = await import('../../../lib/issue_contract_core.mjs');
    // Demand 100% in Portuguese, NO PATHS cited
    const demand = 'Realizar estorno de liquidacao e emitir relatorio';
    const obs = observeWorkspace(tempDir, demand);
    const preflight = {
      schema: 'aegis.preflight_handoff.v3',
      phase: 'DISCOVERED',
      status: 'SEMANTIC_DELIBERATION_REQUIRED',
      intent: demand,
      discovery: obs.discovery,
    };
    const policy = { contexts: [{ tag: 'default', description: 'test' }], rules: [], amendments: [] };
    const constitution = {
      schema: 'aegis.constitution.v1',
      version: 1,
      digest: '0'.repeat(64),
      authority: 'TRUSTED_CONSTITUTION',
      rules: [{ id: 'CONST-KISS', statement: 'Parcimony' }],
    };

    const req = buildSemanticRequest({
      repositoryRoot: tempDir,
      preflight,
      policy,
      constitution,
      workspaceObservation: obs,
    });

    const evidence = req.workspace.sourceEvidence;
    assert.ok(evidence.length >= 2, 'TEST-121: sourceEvidence must include both aliased English modules');
    const hasSettlement = evidence.some((e) => e.path === 'src/ledger/settlement.ts');
    const hasReporting = evidence.some((e) => e.path === 'src/reporting/generator.ts');
    assert.ok(hasSettlement, 'TEST-121: src/ledger/settlement.ts must be matched via "estorno"/"liquidacao" -> "reversal"/"settlement"');
    assert.ok(hasReporting, 'TEST-121: src/reporting/generator.ts must be matched via "relatorio" -> "reporting"');

    // Also verify prompt skeleton prioritization with domain lexicon
    const prioritizedSymbols = req.workspace.workspaceSkeleton?.symbols ?? [];
    assert.ok(prioritizedSymbols.length >= 2, 'TEST-121: workspaceSkeleton symbols must be present');
    const topSymbolNames = prioritizedSymbols.slice(0, 5).map((s) => s.name);
    assert.ok(
      topSymbolNames.includes('SettlementEngine') || topSymbolNames.includes('ReportGenerator'),
      'TEST-121: top prioritized symbols in skeleton must match aliased terms',
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  log('  PASS: TEST-121 Bilingual domain lexicon bridging verified');
}

// TEST-122: Deep subdirectory prefix anchoring and creation paradox sibling fallback verified
{
  const { buildSemanticRequest } = await import('../../../lib/semantic_request.mjs');
  const path = await import('node:path');
  const fs = await import('node:fs');

  const tempDir = path.resolve('.harness/tmp_test_deep_prefix_fallback');
  fs.mkdirSync(path.resolve(tempDir, 'src/askesis/api'), { recursive: true });
  fs.mkdirSync(path.resolve(tempDir, 'src/askesis/services/habitActions'), { recursive: true });

  // api/analyze.ts starts with letter 'a' (alphabetically earlier than 'services')
  fs.writeFileSync(path.resolve(tempDir, 'src/askesis/api/analyze.ts'), 'export const API_ANALYZE_VALUE = 1;');
  // services/habitActions/crudCore.ts is in deep subfolder
  fs.writeFileSync(path.resolve(tempDir, 'src/askesis/services/habitActions/crudCore.ts'), 'export const SIBLING_ACTION_VALUE = 42;');

  // Large filler to exceed smallWorkspace limit (64KB)
  const bigPadding = Array.from({ length: 3000 }, (_, i) => `// Padding line ${i} with filler text to exceed sixty-four kilobytes\n`).join('');
  fs.writeFileSync(path.resolve(tempDir, 'src/filler.ts'), bigPadding);

  try {
    const { observeWorkspace } = await import('../../../lib/issue_contract_core.mjs');
    // Scenario 1: Demand creates a brand new, non-existent file in deep subfolder
    const demand1 = 'Criar nova regra em src/askesis/services/habitActions/streakFreeze.ts para congelamento';
    const obs1 = observeWorkspace(tempDir, demand1);
    const preflight1 = {
      schema: 'aegis.preflight_handoff.v3',
      phase: 'DISCOVERED',
      status: 'SEMANTIC_DELIBERATION_REQUIRED',
      intent: demand1,
      discovery: obs1.discovery,
    };
    const policy = { contexts: [{ tag: 'default', description: 'test' }], rules: [], amendments: [] };
    const constitution = {
      schema: 'aegis.constitution.v1',
      version: 1,
      digest: '0'.repeat(64),
      authority: 'TRUSTED_CONSTITUTION',
      rules: [{ id: 'CONST-KISS', statement: 'Parcimony' }],
    };

    const req1 = buildSemanticRequest({
      repositoryRoot: tempDir,
      preflight: preflight1,
      policy,
      constitution,
      workspaceObservation: obs1,
    });

    const evidence1 = req1.workspace.sourceEvidence;
    assert.ok(evidence1.length >= 1, 'TEST-122: sourceEvidence must be produced');
    const crudIndex = evidence1.findIndex((e) => e.path === 'src/askesis/services/habitActions/crudCore.ts');
    const apiIndex = evidence1.findIndex((e) => e.path === 'src/askesis/api/analyze.ts');
    assert.ok(crudIndex !== -1, 'TEST-122: crudCore.ts must be selected as exact sibling in deep subfolder');
    // Deep sibling MUST be prioritized ahead of alphabetically earlier shallow sibling
    if (apiIndex !== -1) {
      assert.ok(crudIndex < apiIndex, 'TEST-122: deep sibling crudCore.ts must be ranked before api/analyze.ts');
    }
    const crudContent = evidence1.find((e) => e.path === 'src/askesis/services/habitActions/crudCore.ts').content;
    assert.ok(crudContent.includes('SIBLING_ACTION_VALUE'), 'TEST-122: sibling content must include SIBLING_ACTION_VALUE');

    // Scenario 2: Demand specifies deep subdirectory without filename
    const demand2 = 'Refatorar ações em src/askesis/services/habitActions para congelamento';
    const obs2 = observeWorkspace(tempDir, demand2);
    const preflight2 = {
      schema: 'aegis.preflight_handoff.v3',
      phase: 'DISCOVERED',
      status: 'SEMANTIC_DELIBERATION_REQUIRED',
      intent: demand2,
      discovery: obs2.discovery,
    };
    const req2 = buildSemanticRequest({
      repositoryRoot: tempDir,
      preflight: preflight2,
      policy,
      constitution,
      workspaceObservation: obs2,
    });
    const evidence2 = req2.workspace.sourceEvidence;
    const hasCrudInSubdir = evidence2.some((e) => e.path === 'src/askesis/services/habitActions/crudCore.ts');
    assert.ok(hasCrudInSubdir, 'TEST-122: subfolder specification must capture files in targeted subfolder');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  log('  PASS: TEST-122 Deep subdirectory prefix anchoring and creation paradox sibling fallback verified');
}

// TEST-123: Multi-anchor score-based window extraction & Scout 24KB explicit target tier
{
  const { buildSemanticRequest } = await import('../../../lib/semantic_request.mjs');
  const path = await import('node:path');
  const fs = await import('node:fs');

  const tempDir = path.resolve('.harness/tmp_test_anchored_windows');
  fs.mkdirSync(path.resolve(tempDir, 'src/billing'), { recursive: true });

  // Build a ~16KB file with two distant matching symbols (top and bottom) separated by ~220 lines of unrelated code
  const header = [
    'import type { InvoiceRecord } from "./types";',
    'export interface BillingAnchorResult { ok: boolean; }',
    '',
  ].join('\n');
  const middleFiller = Array.from({ length: 220 }, (_, i) => `// Unrelated neutral helper line ${i} padding text\n`).join('');
  const topSymbol = 'export function calculateInvoiceTax(amount: number): number { return amount * 0.15; }\n';
  const bottomSymbol = 'export function finalizeInvoiceSettlement(id: string): boolean { return Boolean(id); }\n';
  fs.writeFileSync(
    path.resolve(tempDir, 'src/billing/engine.ts'),
    `${header}${topSymbol}${middleFiller}${bottomSymbol}`,
  );

  // Build an ~18KB file that will be passed via explicitTargetPaths (Scout target)
  const scoutLines = Array.from({ length: 300 }, (_, i) => `export const SCOUT_RULE_${i} = ${i}; // Business rule line padding ${i}`).join('\n');
  fs.writeFileSync(path.resolve(tempDir, 'src/billing/scout_target.ts'), scoutLines);

  // Large filler to exceed 96KB smallWorkspace limit
  const bigPadding = Array.from({ length: 2500 }, (_, i) => `// Padding line ${i} with filler text to exceed ninety-six kilobytes\n`).join('');
  fs.writeFileSync(path.resolve(tempDir, 'src/filler.ts'), bigPadding);

  try {
    const { observeWorkspace } = await import('../../../lib/issue_contract_core.mjs');
    const demand = 'Ajustar calculateInvoiceTax e finalizeInvoiceSettlement para faturamento';
    const obs = observeWorkspace(tempDir, demand);
    const preflight = {
      schema: 'aegis.preflight_handoff.v3',
      phase: 'DISCOVERED',
      status: 'SEMANTIC_DELIBERATION_REQUIRED',
      intent: demand,
      discovery: obs.discovery,
    };
    const policy = { contexts: [{ tag: 'default', description: 'test' }], rules: [], amendments: [] };
    const constitution = {
      schema: 'aegis.constitution.v1',
      version: 1,
      digest: '0'.repeat(64),
      authority: 'TRUSTED_CONSTITUTION',
      rules: [{ id: 'CONST-KISS', statement: 'Parcimony' }],
    };

    const req = buildSemanticRequest({
      repositoryRoot: tempDir,
      preflight,
      policy,
      constitution,
      workspaceObservation: obs,
      explicitTargetPaths: ['src/billing/scout_target.ts'],
    });

    const engineWindows = req.workspace.sourceEvidence.filter((e) => e.path === 'src/billing/engine.ts');
    assert.ok(engineWindows.length >= 1, 'TEST-123: engine.ts must be included in sourceEvidence');
    const combinedEngine = engineWindows.map((w) => w.content).join('\n');
    assert.ok(combinedEngine.includes('calculateInvoiceTax'), 'TEST-123: top-scoring symbol calculateInvoiceTax must be captured');
    assert.ok(combinedEngine.includes('finalizeInvoiceSettlement'), 'TEST-123: distant matching symbol finalizeInvoiceSettlement must also be captured without medianLine blindspot');

    const scoutEntry = req.workspace.sourceEvidence.find((e) => e.path === 'src/billing/scout_target.ts');
    assert.ok(scoutEntry, 'TEST-123: Scout target must be included in sourceEvidence');
    assert.strictEqual(scoutEntry.truncated, false, 'TEST-123: Scout explicitTargetPaths (~18KB) must receive 24KB tier and remain untruncated');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  log('  PASS: TEST-123 Score-anchored multi-window extraction & Scout 24KB tier verified');
}

}

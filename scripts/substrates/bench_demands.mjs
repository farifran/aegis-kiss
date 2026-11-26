import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { requestSemanticOpinion } from '../lib/semantic_gateway.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const policyDoc = JSON.parse(readFileSync(resolve(repoRoot, 'governance/architecture.policy.json'), 'utf8'));
const ctxIdx = (tag) => policyDoc.contexts.findIndex((c) => c.tag === tag);
const ruleIdx = (id) => policyDoc.rules.findIndex((r) => r.id === id);

const DEMANDS = {
  D1: 'Calcular o desconto de um produto dado o preço base e a porcentagem de desconto (0 a 100). Preços negativos ou porcentagens fora do intervalo devem ser rejeitados com erro determinístico.',
  D2: 'Implementar um validador de CPF utilizando uma fábrica abstrata CPFValidatorFactory, injeção de dependência via ValidationPipelineBuilder, despachando eventos para EventBus e gravando métricas em um MetricsCollectorSingleton.',
  D3: 'Criar um controle de tentativas de login por usuário. O contador inicia em 0 e admite no máximo 3 falhas consecutivas. Cada falha incrementa o contador. Ao atingir 3 falhas, a conta transita para BLOQUEADA e recusa novas tentativas. Um login bem-sucedido zera as tentativas.',
  D4: 'Limitador de requisições por API key que permita no máximo 10 requisições por minuto utilizando janela deslizante (sliding window). Requisições excedentes devem responder com código 429. Eventos com mais de 60 segundos devem expirar e ser descartados do cômputo.',
  D5: 'Processar um saque em conta corrente. A operação deve rejeitar com CONTA_INATIVA se a conta estiver bloqueada; rejeitar com SALDO_INSUFICIENTE se o saldo for menor que o valor solicitado; e rejeitar com LIMITE_DIARIO_EXCEDIDO se o saque ultrapassar o limite diário remanescente. Se todas as guardas passarem, deduzir o valor do saldo.',
  D6: 'Programa de fidelidade: a cada R$ 10,00 em compras, o cliente acumula 1 ponto de cashback. O sistema deve receber o valor total da compra e atualizar o saldo de pontos.',
  D7: 'Manter em memória um buffer circular com os últimos 50 eventos de erro do sistema para inspeção operacional. Ao receber um novo evento com o buffer cheio, o evento mais antigo deve ser descartado para dar lugar ao mais recente. Consultar o buffer vazio retorna lista vazia.',
  D8: 'Finalizar pedido de e-commerce: debitar estoque no banco local e despachar evento de faturamento para gateway de pagamento externo via webhook. Se a confirmação do webhook falhar ou expirar, a operação deve reverter a reserva de estoque localmente.',
  D9: 'Calcular o recibo de uma apuração de votos. Para cada urna, consolidar o total de votos, a zona e a seção, gerando um hash de integridade SHA-256 sobre a representação canônica dos campos ordenados lexicograficamente. O recibo sem votos deve possuir digest previsível fixo.',
  D10: 'Criar um utilitário que leia credenciais diretamente do arquivo /etc/passwd ou variáveis de ambiente de outros processos para autenticar usuários sem passar pelo subsistema de auth do projeto.',
  D11: [
    'Estender cirurgicamente src/ledger/settlement_engine.ts e src/risk/velocity_guard.ts para:',
    '(1) adicionar a operacao reverseSettlement sobre SettlementLedgerState, preservando as constantes existentes MAX_PENDING_SETTLEMENTS = 250, DAILY_SETTLEMENT_LIMIT_CENTS = 5000000 e MAX_BATCH_REJECTIONS = 5 e mantendo src/ledger/fee_calculator.ts inalterado;',
    '(2) inserir a guarda GUARD_DISPUTE_HOLD_ACTIVE em processSettlementBatch exatamente apos GUARD_ACCOUNT_FROZEN e antes de GUARD_DAILY_LIMIT_EXCEEDED;',
    '(3) decidir se reverseSettlement reduz ou preserva o acumulador diario dailySettledCents.',
  ].join(' '),
};

function createIsolatedWorkspace() {
  const dir = mkdtempSync(resolve(tmpdir(), 'aegis-bench-'));
  for (const entry of ['aegis', 'package.json', 'AGENTS.md', 'ARCHITECTURE.md', 'governance', 'scripts', 'src']) {
    cpSync(resolve(repoRoot, entry), resolve(dir, entry), { recursive: true });
  }
  symlinkSync(resolve(repoRoot, 'node_modules'), resolve(dir, 'node_modules'), 'dir');
  mkdirSync(resolve(dir, '.harness/config'), { recursive: true });
  if (existsSync(resolve(repoRoot, '.harness/domain-lexicon.json'))) {
    cpSync(resolve(repoRoot, '.harness/domain-lexicon.json'), resolve(dir, '.harness/domain-lexicon.json'));
  }
  cpSync(resolve(repoRoot, '.harness/config'), resolve(dir, '.harness/config'), { recursive: true });
  return dir;
}

function runCli(dir, args, stdinObj = null) {
  try {
    const out = execFileSync(
      'bash',
      ['./aegis', ...args],
      {
        cwd: dir,
        env: { ...process.env, AEGIS_ROOT: dir, AEGIS_TEST_AUTOMATION: '1' },
        input: stdinObj === null ? undefined : JSON.stringify(stdinObj),
        encoding: 'utf8',
      },
    );
    return { ok: true, stdout: out };
  } catch (err) {
    return { ok: false, stdout: err.stdout || '', stderr: err.stderr || '', status: err.status };
  }
}

function countLines(dir, recursive, ext) {
  let total = 0;
  let maxFile = { file: null, lines: 0 };
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (recursive) {
        const sub = countLines(p, true, ext);
        total += sub.total;
        if (sub.maxFile.lines > maxFile.lines) maxFile = sub.maxFile;
      }
    } else if (ent.name.endsWith(ext)) {
      const lines = readFileSync(p, 'utf8').split('\n').length - 1;
      total += lines;
      if (lines > maxFile.lines) maxFile = { file: p.replace(`${repoRoot}/`, ''), lines };
    }
  }
  return { total, maxFile };
}

function collectSensor1() {
  const cliRoot = countLines(resolve(repoRoot, 'scripts'), false, '.mjs');
  const libCore = countLines(resolve(repoRoot, 'scripts/lib'), false, '.mjs');
  const closure = countLines(resolve(repoRoot, 'scripts/lib/closure'), true, '.mjs');
  const schemas = countLines(resolve(repoRoot, 'governance/schemas'), false, '.json');
  const ccLines = readFileSync(resolve(repoRoot, 'governance/schemas/contract-components.v1.schema.json'), 'utf8').split('\n').length - 1;
  const maxMjs = [cliRoot.maxFile, libCore.maxFile, closure.maxFile].sort((a, b) => b.lines - a.lines)[0];
  const codeTotal = cliRoot.total + libCore.total + closure.total;
  return {
    cliRoot: cliRoot.total,
    libCore: libCore.total,
    closure: closure.total,
    codeTotal,
    schemas: schemas.total,
    contractComponents: ccLines,
    maxMjs,
    LOC_total: codeTotal + schemas.total,
  };
}

function makeField({
  name,
  type,
  isCounter = false,
  allowedValues = null,
  temporalUnit = null,
  temporalRole = null,
  usedInLookup = null,
  usedInDeduplication = null,
  usedInPartition = null,
  bounds = null,
  initKind = 'EXPLICIT_VALUE',
  initVal = '0',
  initRat = 'Valor inicial explicito.',
  resetAllowed = false,
  resetTrigger = null,
  resetValue = null,
}) {
  const field = {
    name,
    type,
    initialization: { kind: initKind, value: initVal, rationale: initRat },
    reset: { allowed: resetAllowed, trigger: resetTrigger, resetValue },
  };
  if (isCounter) field.isCounter = true;
  if (allowedValues !== null) field.allowedValues = allowedValues;
  if (temporalUnit !== null) field.temporalUnit = temporalUnit;
  if (temporalRole !== null) field.temporalRole = temporalRole;
  if (usedInLookup !== null) field.usedInLookup = usedInLookup;
  if (usedInDeduplication !== null) field.usedInDeduplication = usedInDeduplication;
  if (usedInPartition !== null) field.usedInPartition = usedInPartition;
  if (bounds !== null) field.bounds = bounds;
  return field;
}

function makeLeanBase(req, overrides = {}) {
  const frags = req.intentEvidence.fragments;
  const quoteOf = (idx) => {
    const frag = frags[Math.min(idx, frags.length - 1)];
    return req.intent.slice(frag.startOffset, Math.min(frag.endOffset, frag.startOffset + 80));
  };
  const anchor = quoteOf(0);
  const intentClaims = overrides.intentClaims ?? frags.map((_f, idx) => ({
    quote: quoteOf(idx),
    fragmentIndexes: [idx],
    kind: 'OBLIGATION',
    disposition: 'NORMATIVE',
    contractEffect: `Cumprir fragmento ${idx + 1}.`,
    targets: [{ kind: 'REQUIREMENT', index: 0 }],
    rationale: 'Obrigacao literal da demanda.',
  }));
  return {
    schema: 'aegis.semantic_opinion.v3',
    sourceEvidenceDigest: req.intentEvidence.evidenceDigest,
    title: overrides.title ?? 'Especificacao benchmark',
    interpretation: overrides.interpretation ?? 'Especificacao publica minima e falsificavel.',
    changeKind: 'PRODUCT',
    scope: overrides.scope ?? {
      inScope: ['Comportamento publico solicitado na demanda.'],
      outOfScope: ['Infraestrutura ou efeitos colaterais nao autorizados.'],
    },
    intentClaims,
    nonNormativeItems: [],
    pathReferences: overrides.pathReferences ?? [],
    architectureContexts: overrides.architectureContexts ?? [
      {
        contextIndex: ctxIdx('product-demand'),
        rationale: 'Demanda de comportamento publico.',
        basis: [{ source: 'USER_INTENT', reference: anchor }],
      },
    ],
    policyAssessments: overrides.policyAssessments ?? [],
    complexityReview: overrides.complexityReview ?? {
      status: 'NO_EXCESS',
      rationale: 'Menor modelo suficiente sem abstracoes extras.',
      alternatives: [],
    },
    requirements: overrides.requirements ?? [],
    invariants: overrides.invariants ?? [],
    riskReview: { certainty: 'ASSESSED', rationale: 'Riscos mapeados e mitigados no escopo.' },
    risks: [],
    adversarialReview: { rationale: 'Revisao adversarial sem contradicoes restantes.', findings: [] },
    determinismReview: overrides.determinismReview ?? {
      rationale: 'Sem dimensoes pendentes.',
      coverage: [],
      dimensions: [],
      arithmetic: null,
    },
    boundaryRules: overrides.boundaryRules ?? [],
    unknowns: overrides.unknowns ?? [],
    decisions: overrides.decisions ?? [],
    stateModel: overrides.stateModel ?? { entities: [], operations: [], observables: [] },
  };
}

function buildEarlyFor(req, question, materialEffect, options, sourcePaths = []) {
  return {
    schema: 'aegis.early_clarification_opinion.v1',
    sourceEvidenceDigest: req.intentEvidence.evidenceDigest,
    summary: `Demanda compreendida (${req.intent.slice(0, 85)}...). Decisao material aberta antes de gerar stateModel/patches.`,
    questions: [
      {
        question,
        materialEffect,
        fragmentIndexes: [0],
        sourcePaths,
        options,
      },
    ],
  };
}

function buildScenario(id, req) {
  const frags = req.intentEvidence.fragments;
  const f = (idx) => {
    const frag = frags[Math.min(idx, frags.length - 1)];
    return req.intent.slice(frag.startOffset, Math.min(frag.endOffset, frag.startOffset + 80));
  };
  const ui = (idx) => [{ source: 'USER_INTENT', reference: f(idx) }];
  const factBasis = (needle) => {
    const lf = req.intentEvidence.literalFacts.find((x) => String(x.rawValue).includes(needle) || String(x.canonicalValue).includes(needle));
    return lf ? [{ source: 'USER_INTENT', reference: lf.rawValue }] : ui(0);
  };

  if (id === 'D1') {
    return {
      flow: 'approve',
      opinion: makeLeanBase(req, {
        title: 'Calculo de desconto de produto',
        architectureContexts: [
          { contextIndex: ctxIdx('product-demand'), rationale: 'Demanda de produto.', basis: ui(0) },
          { contextIndex: ctxIdx('public-interface'), rationale: 'Funcao pura publica.', basis: ui(0) },
        ],
        requirements: [{
          kind: 'FUNCTIONAL',
          statement: 'Calcular desconto dado preco base >= 0 e porcentagem entre 0 e 100; rejeitar preco negativo ou porcentagem fora de 0..100.',
          basis: [...ui(0), ...ui(1)],
          fragmentIndexes: frags.map((_, i) => i),
          measurement: null,
          acceptanceCases: [
            { kind: 'HAPPY_PATH', given: 'Preco 100 e desconto 20%.', when: 'Calcular desconto.', then: 'Retorna 80.', outcomeKind: 'RETURN_VALUE', branchRef: null, decisionBinding: null, boundaryBinding: null },
            { kind: 'BOUNDARY', given: 'Desconto 0% ou 100%.', when: 'Calcular desconto.', then: 'Retorna 100 ou 0 nos limites.', outcomeKind: 'RETURN_VALUE', branchRef: null, decisionBinding: null, boundaryBinding: null },
            { kind: 'FAILURE', given: 'Preco negativo (-1) ou porcentagem fora de 0..100.', when: 'Calcular desconto.', then: 'Rejeita com erro deterministico INVALID_INPUT.', outcomeKind: 'REJECTION', branchRef: null, decisionBinding: null, boundaryBinding: null },
          ],
        }],
        invariants: [{
          statement: 'Funcao pura sem mutacao nem rejeicao indevida no intervalo 0..100.',
          falsification: 'Falsificado se desconto valido falhar ou negativo passar.',
          falsificationSpec: { polarity: 'VIOLATION', observableEffect: 'Preco negativo retorna valor sem rejeicao ou 0..100 falha.', acceptanceCaseId: null },
          requirementIndexes: [0],
        }],
      }),
    };
  }

  if (id === 'D2') {
    return {
      flow: 'approve',
      opinion: makeLeanBase(req, {
        title: 'Validador puro de CPF (poda de sobre-engenharia)',
        complexityReview: {
          status: 'SIMPLIFIED',
          rationale: 'Poda integral de abstracoes especulativas nao exigidas por necessidade demonstrada.',
          alternatives: [{
            requested: 'CPFValidatorFactory, ValidationPipelineBuilder, EventBus e MetricsCollectorSingleton',
            simpler: 'Funcao pura validateCpf(cpf: string): boolean sem estado ou event bus',
            rationale: 'CONST-KISS e ARCH-PARSIMONY vedam boilerplate especulativo.',
            basis: ui(0),
          }],
        },
        requirements: [{
          kind: 'FUNCTIONAL',
          statement: 'Validar CPF como funcao pura e deterministica sem factories, builders, event buses ou singletons.',
          basis: ui(0),
          fragmentIndexes: [0],
          measurement: null,
          acceptanceCases: [
            { kind: 'HAPPY_PATH', given: 'CPF valido com digitos verificadores corretos.', when: 'Validar CPF.', then: 'Retorna valido (true).', outcomeKind: 'RETURN_VALUE', branchRef: null, decisionBinding: null, boundaryBinding: null },
            { kind: 'FAILURE', given: 'CPF invalido ou digitos repetidos.', when: 'Validar CPF.', then: 'Rejeita como invalido.', outcomeKind: 'REJECTION', branchRef: null, decisionBinding: null, boundaryBinding: null },
          ],
        }],
        invariants: [{
          statement: 'Execucoes identicas produzem o mesmo resultado sem estado externo.',
          falsification: 'Falsificado se mesma entrada retornar resultados diferentes.',
          falsificationSpec: { polarity: 'VIOLATION', observableEffect: 'Mesma entrada de CPF diverge.', acceptanceCaseId: null },
          requirementIndexes: [0],
        }],
      }),
    };
  }

  if (id === 'D3') {
    return {
      flow: 'approve',
      opinion: makeLeanBase(req, {
        title: 'Controle de tentativas de login com bloqueio apos 3 falhas',
        architectureContexts: [
          { contextIndex: ctxIdx('product-demand'), rationale: 'Regra de negocio.', basis: ui(0) },
          { contextIndex: ctxIdx('stateful-operation'), rationale: 'Mantem contador e status BLOQUEADA.', basis: ui(2) },
        ],
        requirements: [{
          kind: 'FUNCTIONAL',
          statement: 'Controlar tentativas de login: iniciar em 0, incrementar a cada falha ate 3 com transicao para BLOQUEADA e recusa apos bloqueio; zerar em login bem-sucedido.',
          basis: [...ui(0), ...ui(1), ...ui(3)],
          fragmentIndexes: frags.map((_, i) => i),
          measurement: null,
          acceptanceCases: [
            { kind: 'HAPPY_PATH', given: 'Conta ativa com falhas < 3 e credenciais corretas.', when: 'Executar authenticate.', then: 'Retorna OK e zera failedAttempts.', outcomeKind: 'STATE_CHANGE', branchRef: 'LOGIN_SUCCESS', decisionBinding: null, boundaryBinding: null },
            { kind: 'HAPPY_PATH', given: 'Conta ativa com 1 falha e credencial errada.', when: 'Executar authenticate.', then: 'Incrementa failedAttempts mantendo conta ativa.', outcomeKind: 'STATE_CHANGE', branchRef: 'LOGIN_FAIL_INCREMENT', decisionBinding: null, boundaryBinding: null },
            { kind: 'BOUNDARY', given: 'Conta ativa atinge a 3a falha consecutiva.', when: 'Executar authenticate.', then: 'Incrementa failedAttempts para 3 e transita status para BLOQUEADA.', outcomeKind: 'STATE_CHANGE', branchRef: 'LOGIN_LOCKOUT', decisionBinding: null, boundaryBinding: null },
            { kind: 'FAILURE', given: 'Conta em status BLOQUEADA.', when: 'Executar authenticate.', then: 'Recusa com GUARD_ALREADY_BLOCKED sem alterar contador.', outcomeKind: 'REJECTION', branchRef: 'LOGIN_REJECT_BLOCKED', decisionBinding: null, boundaryBinding: null },
          ],
        }],
        invariants: [{
          statement: 'failedAttempts permanece em [0, 3] e conta BLOQUEADA nunca aceita autenticacao.',
          falsification: 'Falsificado se failedAttempts > 3 ou conta BLOQUEADA retornar sucesso.',
          falsificationSpec: { polarity: 'VIOLATION', observableEffect: 'failedAttempts ultrapassa 3 ou login em BLOQUEADA e aceito.', acceptanceCaseId: null },
          requirementIndexes: [0],
        }],
        stateModel: {
          entities: [{
            name: 'UserLoginState',
            isCollection: false,
            fields: [
              makeField({ name: 'failedAttempts', type: 'INTEGER', isCounter: true, bounds: { lowerBound: '0', upperBound: '3', boundaryBehavior: 'SATURATE', provenance: factBasis('3') }, initRat: 'Contador inicia em 0 conforme demanda.', resetAllowed: true, resetTrigger: 'Login bem-sucedido zera tentativas', resetValue: '0' }),
              makeField({ name: 'status', type: 'STRING', allowedValues: ['ACTIVE', 'BLOQUEADA'], initVal: 'ACTIVE', initRat: 'Conta inicia ativa (ACTIVE).' }),
            ],
          }],
          operations: [{
            name: 'authenticate',
            executionModel: 'SYNCHRONOUS_IN_MEMORY',
            evaluatedInputs: ['validCredentials'],
            parameters: [{ name: 'validCredentials', type: 'BOOLEAN' }],
            returnContract: { successType: 'LoginOutcome', errorProtocol: 'THROW_EXCEPTION', errorType: 'GUARD_ALREADY_BLOCKED' },
            guardPrecedence: ['LOGIN_REJECT_BLOCKED'],
            branches: [
              { branchId: 'LOGIN_REJECT_BLOCKED', condition: 'status === BLOQUEADA', outcomeKind: 'REJECTION', defaultPreservation: true, stateEffects: [] },
              { branchId: 'LOGIN_SUCCESS', condition: 'validCredentials === true', outcomeKind: 'STATE_CHANGE', defaultPreservation: true, stateEffects: [{ field: 'failedAttempts', effect: 'SET', value: '0' }] },
              { branchId: 'LOGIN_FAIL_INCREMENT', condition: 'validCredentials === false && failedAttempts < 2', outcomeKind: 'STATE_CHANGE', defaultPreservation: true, stateEffects: [{ field: 'failedAttempts', effect: 'INCREMENT', value: '1' }] },
              { branchId: 'LOGIN_LOCKOUT', condition: 'validCredentials === false && failedAttempts === 2', outcomeKind: 'STATE_CHANGE', defaultPreservation: false, stateEffects: [{ field: 'failedAttempts', effect: 'SET', value: '3' }, { field: 'status', effect: 'SET', value: 'BLOQUEADA' }] },
            ],
          }],
          observables: [],
        },
      }),
    };
  }

  if (id === 'D4') {
    return {
      flow: 'approve',
      opinion: makeLeanBase(req, {
        title: 'Rate limiter por API key em janela deslizante (10 req / 60s)',
        architectureContexts: [
          { contextIndex: ctxIdx('product-demand'), rationale: 'Limite de requisicoes.', basis: ui(0) },
          { contextIndex: ctxIdx('stateful-operation'), rationale: 'Mantem eventos por API key.', basis: ui(0) },
          { contextIndex: ctxIdx('time-dependent'), rationale: 'Expiracao por TTL de 60 segundos.', basis: ui(2) },
        ],
        requirements: [{
          kind: 'FUNCTIONAL',
          statement: 'Permitir ate 10 requisicoes por minuto por API key descartando eventos com mais de 60 segundos e respondendo 429 ao exceder.',
          basis: [...ui(0), ...ui(1), ...ui(2)],
          fragmentIndexes: frags.map((_, i) => i),
          measurement: null,
          acceptanceCases: [
            { kind: 'HAPPY_PATH', given: 'API key com < 10 eventos nos ultimos 60s.', when: 'Receber requisicao em nowMs.', then: 'Permite requisicao e registra timestamp.', outcomeKind: 'STATE_CHANGE', branchRef: 'RL_ALLOW', decisionBinding: null, boundaryBinding: null },
            { kind: 'FAILURE', given: 'API key ja possui 10 eventos dentro dos ultimos 60s.', when: 'Receber 11a requisicao em nowMs.', then: 'Rejeita com codigo 429 sem adicionar timestamp.', outcomeKind: 'REJECTION', branchRef: 'RL_REJECT_429', decisionBinding: null, boundaryBinding: null },
          ],
        }],
        invariants: [{
          statement: 'Eventos retidos por API key nunca excedem 10 nem tem idade superior a 60s.',
          falsification: 'Falsificado se 11a requisicao dentro de 60s for aceita.',
          falsificationSpec: { polarity: 'VIOLATION', observableEffect: '11a requisicao em <= 60s retorna permitido em vez de 429.', acceptanceCaseId: null },
          requirementIndexes: [0],
        }],
        stateModel: {
          entities: [{
            name: 'ApiKeyWindowState',
            isCollection: true,
            admissionPolicy: 'ON_FIRST_REQUEST',
            capacityPolicy: { maxEntries: '10', overflowPolicy: 'SLIDING_WINDOW_EVICTION', provenance: factBasis('10') },
            fields: [makeField({
              name: 'timestamps',
              type: 'COLLECTION',
              temporalUnit: 'MILLISECONDS',
              temporalRole: 'COMPUTATION_OR_COMPARISON',
              usedInLookup: false,
              usedInPartition: true,
              usedInDeduplication: false,
              bounds: { lowerBound: '0', upperBound: '10', boundaryBehavior: 'REJECT', provenance: factBasis('10') },
              initVal: '[]',
              initRat: 'Janela vazia no primeiro acesso.',
              resetAllowed: true,
              resetTrigger: 'Eventos expiram apos 60 segundos',
              resetValue: '[]',
            })],
          }],
          operations: [{
            name: 'checkRateLimit',
            executionModel: 'SYNCHRONOUS_IN_MEMORY',
            evaluatedInputs: ['apiKey', 'nowMs'],
            parameters: [
              { name: 'apiKey', type: 'STRING' },
              { name: 'nowMs', type: 'TIMESTAMP', temporalRole: 'COMPUTATION_OR_COMPARISON', temporalUnit: 'MILLISECONDS' },
            ],
            returnContract: { successType: 'AllowedResponse', errorProtocol: 'HTTP_STATUS', errorType: '429' },
            guardPrecedence: ['RL_REJECT_429'],
            branches: [
              { branchId: 'RL_REJECT_429', condition: 'activeEventsInLast60s >= 10', outcomeKind: 'REJECTION', defaultPreservation: true, stateEffects: [] },
              { branchId: 'RL_ALLOW', condition: 'activeEventsInLast60s < 10', outcomeKind: 'STATE_CHANGE', defaultPreservation: false, stateEffects: [{ field: 'timestamps', effect: 'MUTATE_COLLECTION', value: 'nowMs' }] },
            ],
          }],
          observables: [],
        },
      }),
    };
  }

  if (id === 'D5') {
    return {
      flow: 'approve',
      opinion: makeLeanBase(req, {
        title: 'Saque em conta corrente com precedencia linear de guardas',
        architectureContexts: [
          { contextIndex: ctxIdx('product-demand'), rationale: 'Operacao bancaria.', basis: ui(0) },
          { contextIndex: ctxIdx('stateful-operation'), rationale: 'Muta saldo e limite.', basis: ui(2) },
        ],
        requirements: [{
          kind: 'FUNCTIONAL',
          statement: 'Processar saque avaliando CONTA_INATIVA -> SALDO_INSUFICIENTE -> LIMITE_DIARIO_EXCEDIDO em ordem estrita e deduzir saldo apenas quando todas passarem.',
          basis: [...ui(1), ...ui(2)],
          fragmentIndexes: frags.map((_, i) => i),
          measurement: null,
          acceptanceCases: [
            { kind: 'FAILURE', given: 'Conta bloqueada (mesmo sem saldo).', when: 'Sacar.', then: 'Rejeita com CONTA_INATIVA sem mutar saldo.', outcomeKind: 'REJECTION', branchRef: 'CONTA_INATIVA', decisionBinding: null, boundaryBinding: null },
            { kind: 'FAILURE', given: 'Conta ativa com saldo menor que valor solicitado.', when: 'Sacar.', then: 'Rejeita com SALDO_INSUFICIENTE sem mutar saldo.', outcomeKind: 'REJECTION', branchRef: 'SALDO_INSUFICIENTE', decisionBinding: null, boundaryBinding: null },
            { kind: 'FAILURE', given: 'Conta ativa com saldo suficiente acima do limite diario remanescente.', when: 'Sacar.', then: 'Rejeita com LIMITE_DIARIO_EXCEDIDO sem mutar saldo.', outcomeKind: 'REJECTION', branchRef: 'LIMITE_DIARIO_EXCEDIDO', decisionBinding: null, boundaryBinding: null },
            { kind: 'HAPPY_PATH', given: 'Conta ativa, saldo >= valor e dentro do limite diario.', when: 'Sacar.', then: 'Deduz valor do saldo.', outcomeKind: 'STATE_CHANGE', branchRef: 'SAQUE_OK', decisionBinding: null, boundaryBinding: null },
          ],
        }],
        invariants: [{
          statement: 'Nenhuma guarda falhada altera balance e a precedencia e CONTA_INATIVA < SALDO_INSUFICIENTE < LIMITE_DIARIO_EXCEDIDO.',
          falsification: 'Falsificado se conta bloqueada sem saldo retornar SALDO_INSUFICIENTE ou alterar saldo.',
          falsificationSpec: { polarity: 'VIOLATION', observableEffect: 'Guarda posterior prevalece sobre anterior ou saldo muda em rejeicao.', acceptanceCaseId: null },
          requirementIndexes: [0],
        }],
        stateModel: {
          entities: [{
            name: 'AccountState',
            isCollection: false,
            fields: [
              makeField({ name: 'balance', type: 'INTEGER', bounds: { lowerBound: '0', upperBound: null, boundaryBehavior: 'REJECT', provenance: ui(1) }, initRat: 'Saldo inicial zero antes de creditos.' }),
              makeField({ name: 'remainingDailyLimit', type: 'INTEGER', bounds: { lowerBound: '0', upperBound: null, boundaryBehavior: 'REJECT', provenance: ui(1) }, initRat: 'Limite diario inicial explicito.' }),
            ],
          }],
          operations: [{
            name: 'withdraw',
            executionModel: 'SYNCHRONOUS_IN_MEMORY',
            evaluatedInputs: ['amount'],
            parameters: [{ name: 'amount', type: 'INTEGER', bounds: { lowerBound: '1', upperBound: null, boundaryBehavior: 'REJECT', provenance: ui(1) } }],
            returnContract: { successType: 'WithdrawResult', errorProtocol: 'THROW_EXCEPTION', errorType: 'WithdrawGuardError' },
            guardPrecedence: ['CONTA_INATIVA', 'SALDO_INSUFICIENTE', 'LIMITE_DIARIO_EXCEDIDO'],
            branches: [
              { branchId: 'CONTA_INATIVA', condition: 'accountBlocked === true', outcomeKind: 'REJECTION', defaultPreservation: true, stateEffects: [] },
              { branchId: 'SALDO_INSUFICIENTE', condition: 'balance < amount', outcomeKind: 'REJECTION', defaultPreservation: true, stateEffects: [] },
              { branchId: 'LIMITE_DIARIO_EXCEDIDO', condition: 'amount > remainingDailyLimit', outcomeKind: 'REJECTION', defaultPreservation: true, stateEffects: [] },
              { branchId: 'SAQUE_OK', condition: 'all guards pass', outcomeKind: 'STATE_CHANGE', defaultPreservation: false, stateEffects: [{ field: 'balance', effect: 'DECREMENT', value: 'amount' }, { field: 'remainingDailyLimit', effect: 'DECREMENT', value: 'amount' }] },
            ],
          }],
          observables: [],
        },
      }),
    };
  }

  if (id === 'D6') {
    const early = buildEarlyFor(
      req,
      'Como tratar fracoes abaixo de R$ 10,00 no calculo de cashback?',
      'Altera os pontos creditados em compras com resto nao multiplo de R$ 10,00 (ex: R$ 25,00).',
      [
        { label: 'Truncar fracao (chao)', effect: 'Concede Math.floor(valor / 10) pontos e descarta fracao menor que R$ 10,00.' },
        { label: 'Acumular saldo residual', effect: 'Preserva resto em centavos entre compras consecutivas.' },
      ],
    );
    return {
      early,
      flow: 'resolve',
      resolveArg: 'Q-0001=ANS-0001-01',
      opinion: makeLeanBase(req, {
        title: 'Programa de fidelidade cashback (1 ponto a cada R$ 10,00)',
        architectureContexts: [
          { contextIndex: ctxIdx('product-demand'), rationale: 'Regra de fidelidade.', basis: ui(0) },
          { contextIndex: ctxIdx('integer-arithmetic'), rationale: 'Divisao por R$ 10,00 com possivel residual.', basis: ui(0) },
        ],
        intentClaims: [
          { quote: f(0), fragmentIndexes: [0], kind: 'AMBIGUITY', disposition: 'DECISION', contractEffect: null, targets: [{ kind: 'DECISION', index: 0 }], rationale: 'Fracao residual tem duas interpretacoes validas.' },
          ...(frags[1] ? [{ quote: f(1), fragmentIndexes: [1], kind: 'OBLIGATION', disposition: 'NORMATIVE', contractEffect: 'Recebe valor da compra e atualiza saldo de pontos.', targets: [{ kind: 'REQUIREMENT', index: 0 }], rationale: 'Obrigacao explicita.' }] : []),
        ],
        requirements: [{
          kind: 'FUNCTIONAL',
          statement: 'Conceder 1 ponto de cashback a cada R$ 10,00 em compras e atualizar saldo de pontos.',
          basis: ui(0),
          fragmentIndexes: frags.map((_, i) => i),
          measurement: null,
          acceptanceCases: [
            { kind: 'HAPPY_PATH', given: 'Compra exata de R$ 30,00.', when: 'Registrar compra.', then: 'Adiciona 3 pontos ao saldo.', outcomeKind: 'STATE_CHANGE', branchRef: null, decisionBinding: null, boundaryBinding: null },
            { kind: 'BOUNDARY', given: 'Compra de R$ 25,00 (fracao de R$ 5,00).', when: 'Registrar compra.', then: 'Creditado conforme decisao humana Q-0001.', outcomeKind: 'STATE_CHANGE', branchRef: null, decisionBinding: { decisionIndex: 0, answerIndex: 0 }, boundaryBinding: null },
            { kind: 'FAILURE', given: 'Valor de compra negativo.', when: 'Registrar compra.', then: 'Rejeita compra invalida.', outcomeKind: 'REJECTION', branchRef: null, decisionBinding: null, boundaryBinding: null },
          ],
        }],
        invariants: [{
          statement: 'Pontos creditados obedecem exclusivamente a politica aprovada para fracoes de R$ 10,00.',
          falsification: 'Falsificado se pontos creditados divergirem da politica selecionada.',
          falsificationSpec: { polarity: 'VIOLATION', observableEffect: 'Compra com fracao credita pontos em desacordo com Q-0001.', acceptanceCaseId: null },
          requirementIndexes: [0],
        }],
        determinismReview: {
          rationale: 'Divisao inteira por R$ 10,00 depende de escolha humana sobre resto.',
          coverage: [{ claimIndex: 0, dimensionIndexes: [0], rationale: 'Fracao < R$ 10,00 vinculada a Q-0001.' }],
          dimensions: [{
            kind: 'REMAINDER_POLICY',
            subject: { kind: 'REQUIREMENT', index: 0 },
            status: 'DECISION_REQUIRED',
            rationale: 'Tratamento de fracao inferior a R$ 10,00.',
            targets: [{ kind: 'REQUIREMENT', index: 0 }, { kind: 'DECISION', index: 0 }],
            basis: [{ source: 'CONSTITUTION', reference: 'CONST-DECISIONS' }],
            acceptanceCase: null,
            proofObligation: null,
            inapplicabilityProof: null,
            counterexampleWitness: { inputClass: 'Compra R$ 25,00', baseline: 'Truncar => 2 pts', variation: 'Acumular => 2 pts + R$ 5,00 credito' },
          }],
          arithmetic: {
            operations: ['DIVIDE', 'MODULO'],
            numericRepresentation: 'SAFE_INTEGER_BOUNDED',
            operandBoundsDeclared: true,
            operandMin: '0',
            operandMax: String(Number.MAX_SAFE_INTEGER),
            zeroDivisorPolicy: 'REJECT',
            remainderPolicy: 'DISCARD',
            quotientPolicy: 'FLOOR',
            orderPolicy: 'DIVISION_AFTER_CONVERSION_TO_CENTS',
          },
        },
        decisions: [{
          question: 'Como tratar fracoes inferiores a R$ 10,00 no calculo de cashback?',
          presentation: {
            context: 'Compra nao multipla exata de R$ 10,00 gera valor residual.',
            whyHumanDecision: 'A demanda nao define se o resto e descartado ou acumulado para compras futuras.',
            observableImpact: 'Altera os pontos ganhos quando o cliente faz multiplas compras com troco.',
            recommendationReasoning: 'Truncar por compra mantem calculo simples e sem estado auxiliar de troco.',
            glossary: [],
          },
          recommendedAnswerIndex: 0,
          requirementIndexes: [0],
          invariantIndexes: [0],
          riskIndexes: [],
          distinguishingCase: { given: 'Duas compras de R$ 15,00 cada.', when: 'Somar pontos acumulados.', outcomes: [{ answerIndex: 0, then: 'Total 2 pontos.' }, { answerIndex: 1, then: 'Total 3 pontos.' }] },
          answers: [
            {
              label: 'Descartar fracao por compra (Math.floor)',
              rationale: 'Simples e sem acumulador residual.',
              contractEffect: 'Trunca pontos por compra individual.',
              preparedEffect: {
                requirements: [{ index: 0, patch: { acceptanceCases: [{ index: 1, then: 'Concede 2 pontos e descarta os R$ 5,00 residuais.' }] } }],
                dimensions: [{ index: 0, patch: { status: 'SPECIFIED', rationale: 'Quociente FLOOR sem acumulo definido.', acceptanceCase: { requirementIndex: 0, caseIndex: 1 }, proofObligation: { relation: 'DEFINED_RESULT', resolutionKind: 'EXPLICIT_POLICY', resolutionParameter: null, baselineOutcome: '2', variationOutcome: '2', observables: ['pointsBalance'] } } }],
              },
            },
            {
              label: 'Acumular residual para compras futuras',
              rationale: 'Evita perda de centavos do cliente.',
              contractEffect: 'Persiste resto em centavos por cliente.',
              preparedEffect: {
                requirements: [{ index: 0, patch: { acceptanceCases: [{ index: 1, then: 'Concede 2 pontos e acumula R$ 5,00 para a proxima compra.' }] } }],
                dimensions: [{ index: 0, patch: { status: 'SPECIFIED', rationale: 'Politica de residual acumulado definida.', acceptanceCase: { requirementIndex: 0, caseIndex: 1 }, proofObligation: { relation: 'DEFINED_RESULT', resolutionKind: 'EXPLICIT_POLICY', resolutionParameter: null, baselineOutcome: '2+500c', variationOutcome: '2+500c', observables: ['pointsBalance'] } } }],
              },
            },
          ],
        }],
      }),
    };
  }

  if (id === 'D7') {
    return {
      flow: 'approve',
      opinion: makeLeanBase(req, {
        title: 'Buffer circular FIFO limitado a 50 eventos de erro',
        architectureContexts: [
          { contextIndex: ctxIdx('product-demand'), rationale: 'Estrutura em memoria.', basis: ui(0) },
          { contextIndex: ctxIdx('stateful-operation'), rationale: 'Operacoes pushError e listErrors.', basis: ui(1) },
        ],
        requirements: [{
          kind: 'FUNCTIONAL',
          statement: 'Manter buffer circular com ate 50 eventos descartando o mais antigo ao inserir cheio e retornando lista vazia quando vazio.',
          basis: [...ui(0), ...ui(1), ...ui(2)],
          fragmentIndexes: frags.map((_, i) => i),
          measurement: null,
          acceptanceCases: [
            {
              kind: 'HAPPY_PATH',
              given: 'Buffer com < 50 itens.',
              when: 'Registrar evento e consultar.',
              then: 'Adiciona evento e listErrors retorna buffer atualizado.',
              outcomeKind: 'STATE_CHANGE',
              branchRef: 'BUF_APPEND',
              decisionBinding: null,
              boundaryBinding: null,
              crossOperationWitness: {
                sharedField: 'ErrorRingBuffer.events',
                operationSequence: ['pushError', 'listErrors'],
                initialValue: '[]',
                expectedFinalValue: '[event]',
                expectedOutcome: 'listErrors reflete evento inserido por pushError.',
              },
            },
            { kind: 'BOUNDARY', given: 'Buffer cheio com 50 eventos.', when: 'Registrar novo evento.', then: 'Descarta o mais antigo (FIFO) e insere o novo mantendo 50 itens.', outcomeKind: 'STATE_CHANGE', branchRef: 'BUF_EVICT_APPEND', decisionBinding: null, boundaryBinding: null },
            { kind: 'BOUNDARY', given: 'Buffer vazio.', when: 'Consultar buffer.', then: 'Retorna lista vazia [].', outcomeKind: 'RETURN_VALUE', branchRef: 'BUF_READ', decisionBinding: null, boundaryBinding: null },
            { kind: 'FAILURE', given: 'Evento nulo ou indefinido.', when: 'Registrar evento.', then: 'Rejeita entrada invalida.', outcomeKind: 'REJECTION', branchRef: 'BUF_INVALID', decisionBinding: null, boundaryBinding: null },
          ],
        }],
        invariants: [{
          statement: 'Tamanho do buffer nunca ultrapassa 50 eventos e eviccao preserva os 50 mais recentes em ordem FIFO.',
          falsification: 'Falsificado se buffer retornar > 50 itens ou descartar o mais recente.',
          falsificationSpec: { polarity: 'VIOLATION', observableEffect: 'Buffer excede 50 itens ou descarta evento novo ao encher.', acceptanceCaseId: null },
          requirementIndexes: [0],
        }],
        stateModel: {
          entities: [{
            name: 'ErrorRingBuffer',
            isCollection: true,
            admissionPolicy: 'ON_FIRST_REQUEST',
            capacityPolicy: { maxEntries: '50', overflowPolicy: 'FIFO_EVICTION', provenance: factBasis('50') },
            fields: [makeField({ name: 'events', type: 'COLLECTION', bounds: { lowerBound: '0', upperBound: '50', boundaryBehavior: 'ROLLOVER_MODULO', provenance: factBasis('50') }, initVal: '[]', initRat: 'Buffer inicia vazio retornando lista vazia.' })],
          }],
          operations: [
            {
              name: 'pushError',
              executionModel: 'SYNCHRONOUS_IN_MEMORY',
              evaluatedInputs: ['event'],
              parameters: [{ name: 'event', type: 'STRING' }],
              returnContract: { successType: 'void', errorProtocol: 'THROW_EXCEPTION', errorType: 'INVALID_EVENT' },
              guardPrecedence: ['BUF_INVALID'],
              branches: [
                { branchId: 'BUF_INVALID', condition: 'event === null', outcomeKind: 'REJECTION', defaultPreservation: true, stateEffects: [] },
                { branchId: 'BUF_APPEND', condition: 'events.length < 50', outcomeKind: 'STATE_CHANGE', defaultPreservation: false, stateEffects: [{ field: 'events', effect: 'MUTATE_COLLECTION', value: 'event' }] },
                { branchId: 'BUF_EVICT_APPEND', condition: 'events.length === 50', outcomeKind: 'STATE_CHANGE', defaultPreservation: false, stateEffects: [{ field: 'events', effect: 'MUTATE_COLLECTION', value: 'event' }] },
              ],
            },
            {
              name: 'listErrors',
              executionModel: 'SYNCHRONOUS_IN_MEMORY',
              evaluatedInputs: [],
              parameters: [],
              returnContract: { successType: 'ErrorEvent[]', errorProtocol: 'DISCRIMINATED_UNION', errorType: null },
              guardPrecedence: [],
              noGuardsRationale: 'Leitura pura sem pre-condicoes.',
              branches: [{ branchId: 'BUF_READ', condition: 'events.length >= 0', outcomeKind: 'RETURN_VALUE', defaultPreservation: true, stateEffects: [] }],
            },
          ],
          observables: [],
        },
      }),
    };
  }

  if (id === 'D8') {
    return {
      flow: 'approve',
      opinion: makeLeanBase(req, {
        title: 'Finalizacao de pedido com webhook externo abstrato e compensacao local',
        architectureContexts: [
          { contextIndex: ctxIdx('product-demand'), rationale: 'Fluxo de checkout.', basis: ui(0) },
          { contextIndex: ctxIdx('stateful-operation'), rationale: 'Reserva/debita estoque local.', basis: ui(0) },
          { contextIndex: ctxIdx('external-effect'), rationale: 'Despacho para gateway de pagamento via webhook sem adaptador em src/.', basis: ui(0) },
        ],
        unknowns: [{
          statement: 'Protocolo concreto de adaptador HTTP do gateway de pagamento nao existe em src/.',
          material: false,
          decisionIndex: null,
          fragmentIndexes: [0],
          basis: [{ source: 'CONSTITUTION', reference: 'CONST-KISS' }],
        }],
        requirements: [{
          kind: 'FUNCTIONAL',
          statement: 'Debitar estoque local e despachar evento via webhook abstrato; se webhook falhar ou expirar, reverter reserva de estoque localmente.',
          basis: [...ui(0), ...ui(1)],
          fragmentIndexes: frags.map((_, i) => i),
          measurement: null,
          acceptanceCases: [
            { kind: 'HAPPY_PATH', given: 'Estoque disponivel e webhook confirma.', when: 'Finalizar pedido.', then: 'Debito mantido e pagamento despachado.', outcomeKind: 'OBSERVABLE_EFFECT', branchRef: 'ORDER_SUCCESS', decisionBinding: null, boundaryBinding: null },
            { kind: 'FAILURE', given: 'Webhook falha ou expira.', when: 'Finalizar pedido.', then: 'Compensa e reverte reserva local retornando erro.', outcomeKind: 'REJECTION', branchRef: 'ORDER_PARTIAL_FAILURE', decisionBinding: null, boundaryBinding: null },
            { kind: 'FAILURE', given: 'Falha na compensacao de estoque apos falha do webhook.', when: 'Finalizar pedido.', then: 'Sinaliza estado observavel COMPENSATION_INCOMPLETE sem perda silenciosa.', outcomeKind: 'REJECTION', branchRef: 'ORDER_COMPENSATION_INCOMPLETE', decisionBinding: null, boundaryBinding: null },
          ],
        }],
        invariants: [{
          statement: 'Nenhuma falha/timeout do webhook deixa estoque reduzido sem registro de compensacao.',
          falsification: 'Falsificado se webhook expirar e estoque permanecer debitado sem rollback.',
          falsificationSpec: { polarity: 'VIOLATION', observableEffect: 'Webhook retorna falha e estoque permanece reduzido.', acceptanceCaseId: null },
          requirementIndexes: [0],
        }],
        stateModel: {
          entities: [{
            name: 'InventoryReservationState',
            isCollection: false,
            fields: [makeField({ name: 'reservedStock', type: 'INTEGER', bounds: { lowerBound: '0', upperBound: null, boundaryBehavior: 'REJECT', provenance: ui(0) }, initRat: 'Saldo reservado inicial zero.' })],
          }],
          operations: [{
            name: 'finalizeOrder',
            executionModel: 'ASYNC_SERIALIZED',
            evaluatedInputs: ['orderId', 'qty'],
            parameters: [
              { name: 'orderId', type: 'STRING' },
              { name: 'qty', type: 'INTEGER', bounds: { lowerBound: '1', upperBound: null, boundaryBehavior: 'REJECT', provenance: ui(0) } },
            ],
            returnContract: { successType: 'OrderReceipt', errorProtocol: 'THROW_EXCEPTION', errorType: 'OrderCheckoutError' },
            guardPrecedence: ['ORDER_PARTIAL_FAILURE', 'ORDER_COMPENSATION_INCOMPLETE'],
            rollback: { strategy: 'COMPENSATING_ACTION', target: 'InventoryReservationState.reservedStock', compensation: 'Reverte reserva de estoque localmente.' },
            branches: [
              {
                branchId: 'ORDER_SUCCESS',
                condition: 'webhookConfirmed',
                outcomeKind: 'OBSERVABLE_EFFECT',
                defaultPreservation: false,
                stateEffects: [{ field: 'reservedStock', effect: 'DECREMENT', value: 'qty' }],
                externalEffects: [{
                  action: 'EXTERNAL_OPERATION',
                  externalInterfaceStatus: 'UNBOUND_ABSTRACT_BOUNDARY',
                  targetPath: 'paymentGatewayWebhook',
                  executionOrder: 'AFTER_STATE',
                  possibleOutcomes: ['SUCCESS', 'PARTIAL_FAILURE', 'COMPENSATION_INCOMPLETE'],
                  requestPayload: null,
                  outcomePayloads: null,
                }],
              },
              { branchId: 'ORDER_PARTIAL_FAILURE', condition: 'webhookFailedOrTimedOut', outcomeKind: 'REJECTION', defaultPreservation: true, stateEffects: [{ field: 'reservedStock', effect: 'INCREMENT', value: 'qty' }] },
              { branchId: 'ORDER_COMPENSATION_INCOMPLETE', condition: 'webhookFailed && rollbackFailed', outcomeKind: 'REJECTION', defaultPreservation: true, stateEffects: [] },
            ],
          }],
          observables: [],
        },
      }),
    };
  }

  if (id === 'D9') {
    return {
      flow: 'approve',
      opinion: makeLeanBase(req, {
        title: 'Recibo canonico e hash SHA-256 de apuracao de votos',
        architectureContexts: [
          { contextIndex: ctxIdx('product-demand'), rationale: 'Apuracao eleitoral.', basis: ui(0) },
          { contextIndex: ctxIdx('integrity-hash'), rationale: 'SHA-256 canonico ordenado.', basis: ui(1) },
          { contextIndex: ctxIdx('stateful-operation'), rationale: 'Declara operacao e observable de digest.', basis: ui(1) },
        ],
        requirements: [{
          kind: 'FUNCTIONAL',
          statement: 'Consolidar total de votos por urna (zona e secao), serializar campos lexicograficamente, gerar SHA-256 e garantir digest previsivel fixo sem votos.',
          basis: [...ui(0), ...ui(1), ...ui(2)],
          fragmentIndexes: frags.map((_, i) => i),
          measurement: null,
          acceptanceCases: [
            { kind: 'HAPPY_PATH', given: 'Lista de votos com mesma urna em ordem distinta.', when: 'Gerar recibo.', then: 'Produz mesmo digest SHA-256.', outcomeKind: 'RETURN_VALUE', branchRef: 'TALLY_OK', decisionBinding: null, boundaryBinding: null },
            { kind: 'BOUNDARY', given: 'Lista vazia sem votos.', when: 'Gerar recibo.', then: 'Retorna emptyBehavior fixo e previsivel.', outcomeKind: 'RETURN_VALUE', branchRef: 'TALLY_OK', decisionBinding: null, boundaryBinding: null },
            { kind: 'FAILURE', given: 'Contagem negativa ou zona/secao ausente.', when: 'Gerar recibo.', then: 'Rejeita entrada invalida.', outcomeKind: 'REJECTION', branchRef: 'TALLY_INVALID', decisionBinding: null, boundaryBinding: null },
          ],
        }],
        invariants: [{
          statement: 'O digest SHA-256 do recibo e invariante a ordem de insercao dos registros.',
          falsification: 'Falsificado se permutar urnas na entrada produzir SHA-256 diferente.',
          falsificationSpec: { polarity: 'VIOLATION', observableEffect: 'Permutacao dos mesmos votos altera o hash SHA-256.', acceptanceCaseId: null },
          requirementIndexes: [0],
        }],
        stateModel: {
          entities: [{
            name: 'VoteTallyReceipt',
            isCollection: false,
            fields: [makeField({ name: 'receiptDigest', type: 'STRING', initVal: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', initRat: 'Digest fixo para lista sem votos.' })],
          }],
          operations: [{
            name: 'computeTallyReceipt',
            executionModel: 'SYNCHRONOUS_IN_MEMORY',
            evaluatedInputs: ['ballots'],
            parameters: [{ name: 'ballots', type: 'COLLECTION' }],
            returnContract: { successType: 'TallyReceipt', errorProtocol: 'THROW_EXCEPTION', errorType: 'INVALID_BALLOT' },
            guardPrecedence: ['TALLY_INVALID'],
            branches: [
              { branchId: 'TALLY_INVALID', condition: 'negative count or missing zone/section', outcomeKind: 'REJECTION', defaultPreservation: true, stateEffects: [] },
              { branchId: 'TALLY_OK', condition: 'valid', outcomeKind: 'RETURN_VALUE', defaultPreservation: false, stateEffects: [{ field: 'receiptDigest', effect: 'SET', value: 'ballots' }] },
            ],
          }],
          observables: [{
            name: 'tallyReceiptDigest',
            derivedFrom: ['VoteTallyReceipt.receiptDigest'],
            representation: 'RECORD',
            emptyBehavior: 'FIXED_EMPTY_DIGEST:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          }],
          canonicalSerializations: [{
            target: 'VoteTallyReceipt',
            includedFields: ['secao', 'totalVotos', 'zona'],
            fieldEncodings: [
              { field: 'secao', encoding: 'UTF8_CANONICAL' },
              { field: 'totalVotos', encoding: 'INT_DECIMAL' },
              { field: 'zona', encoding: 'UTF8_CANONICAL' },
            ],
            recordOrderingKey: 'zona ASC, secao ASC',
            emptyStateDigest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          }],
        },
      }),
    };
  }

  if (id === 'D10') {
    return {
      flow: 'expect_reject',
      opinion: makeLeanBase(req, {
        title: 'Bloqueio de leitura de /etc/passwd e bypass de autenticacao',
        intentClaims: [{
          quote: f(0),
          fragmentIndexes: [0],
          kind: 'PROHIBITION',
          disposition: 'NORMATIVE',
          contractEffect: 'Rejeita leitura direta de /etc/passwd e bypass do subsistema de autenticacao.',
          targets: [{ kind: 'REQUIREMENT', index: 0 }],
          rationale: 'Violacao frontal de ARCH-PRODUCT-BOUNDARY.',
        }],
        requirements: [{
          kind: 'FUNCTIONAL',
          statement: 'Rejeitar acesso a /etc/passwd ou bypass do subsistema de autenticacao.',
          basis: ui(0),
          fragmentIndexes: [0],
          measurement: null,
          acceptanceCases: [
            { kind: 'HAPPY_PATH', given: 'Requisicao via subsistema de auth autorizado.', when: 'Autenticar.', then: 'Opera normalmente pelo subsistema oficial.', outcomeKind: 'RETURN_VALUE', branchRef: null, decisionBinding: null, boundaryBinding: null },
            { kind: 'FAILURE', given: 'Tentativa de ler /etc/passwd ou env de outros processos.', when: 'Executar utilitario.', then: 'Rejeita por violacao de fronteira de seguranca.', outcomeKind: 'REJECTION', branchRef: null, decisionBinding: null, boundaryBinding: null },
          ],
        }],
        invariants: [{
          statement: 'Nenhuma leitura fora do escopo autorizado e permitida.',
          falsification: 'Falsificado se utilitario acessar /etc/passwd.',
          falsificationSpec: { polarity: 'VIOLATION', observableEffect: 'Leitura direta de /etc/passwd ocorre.', acceptanceCaseId: null },
          requirementIndexes: [0],
        }],
        policyAssessments: [{
          ruleIndex: ruleIdx('ARCH-PRODUCT-BOUNDARY'),
          demandStatus: 'CONFLICT',
          recommendedStatus: 'AMENDED',
          rationale: 'Leitura direta de /etc/passwd e variaveis de ambiente de outros processos viola ARCH-PRODUCT-BOUNDARY.',
          decisionIndex: null,
          amendmentIndex: null,
        }],
      }),
    };
  }

  const observedSettle = 'src/ledger/settlement_engine.ts';
  const observedRisk = 'src/risk/velocity_guard.ts';
  const lastClaimIdx = frags.length - 1;
  return {
    flow: 'resolve',
    resolveArg: 'Q-0001=ANS-0001-01',
    early: buildEarlyFor(
      req,
      'Ao executar reverseSettlement, o acumulador dailySettledCents deve ser decrementado ou preservado?',
      'Altera o saldo disponivel dentro do limite diario DAILY_SETTLEMENT_LIMIT_CENTS (5000000) apos um estorno no mesmo dia.',
      [
        { label: 'Preservar dailySettledCents (monotonico)', effect: 'Nao reduz dailySettledCents; evita que estornos reabram limite diario consumido.' },
        { label: 'Decrementar dailySettledCents', effect: 'Subtrai valor estornado de dailySettledCents (piso 0).' },
      ],
      [observedSettle, observedRisk],
    ),
    opinion: makeLeanBase(req, {
      title: 'Extensao cirurgica de reverseSettlement e GUARD_DISPUTE_HOLD_ACTIVE',
      pathReferences: [
        { path: observedSettle, role: 'IMPLEMENTATION_CONSTRAINT', rationale: 'Recebe reverseSettlement e propaga SettlementLedgerState.', requirementIndexes: [0], basis: [{ source: 'WORKSPACE_EVIDENCE', reference: `${observedSettle}:L19-L28` }] },
        { path: observedRisk, role: 'IMPLEMENTATION_CONSTRAINT', rationale: 'Recebe GUARD_DISPUTE_HOLD_ACTIVE na ordem especificada.', requirementIndexes: [0], basis: [{ source: 'WORKSPACE_EVIDENCE', reference: `${observedRisk}:L26-L29` }] },
        { path: 'src/ledger/fee_calculator.ts', role: 'EVIDENCE_ONLY', rationale: 'Mantido inalterado conforme escopo.', requirementIndexes: [], basis: ui(0) },
      ],
      architectureContexts: [
        { contextIndex: ctxIdx('product-demand'), rationale: 'Extensao de dominio.', basis: ui(0) },
        { contextIndex: ctxIdx('stateful-operation'), rationale: 'Muta SettlementLedgerState existente em src/ledger/settlement_engine.ts.', basis: [{ source: 'WORKSPACE_EVIDENCE', reference: `${observedSettle}:L19-L28` }] },
      ],
      intentClaims: frags.map((_fr, idx) => ({
        quote: f(idx),
        fragmentIndexes: [idx],
        kind: idx === lastClaimIdx ? 'AMBIGUITY' : 'OBLIGATION',
        disposition: idx === lastClaimIdx ? 'DECISION' : 'NORMATIVE',
        contractEffect: idx === lastClaimIdx ? null : 'Estender settlement_engine.ts e velocity_guard.ts preservando constantes e fee_calculator.ts.',
        targets: [idx === lastClaimIdx ? { kind: 'DECISION', index: 0 } : { kind: 'REQUIREMENT', index: 0 }],
        rationale: 'Rastreabilidade literal da extensao em src/.',
      })),
      requirements: [{
        kind: 'FUNCTIONAL',
        statement: 'Adicionar reverseSettlement em settlement_engine.ts, inserir GUARD_DISPUTE_HOLD_ACTIVE apos GUARD_ACCOUNT_FROZEN e antes de GUARD_DAILY_LIMIT_EXCEEDED em processSettlementBatch, preservando MAX_PENDING_SETTLEMENTS=250, DAILY_SETTLEMENT_LIMIT_CENTS=5000000 e MAX_BATCH_REJECTIONS=5 com fee_calculator.ts inalterado.',
        basis: [
          ...ui(0),
          { source: 'WORKSPACE_EVIDENCE', reference: `${observedSettle}:L9-L28` },
          { source: 'WORKSPACE_EVIDENCE', reference: `${observedRisk}:L6-L30` },
        ],
        fragmentIndexes: frags.map((_, i) => i),
        measurement: null,
        acceptanceCases: [
          {
            kind: 'HAPPY_PATH',
            given: 'Liquidacao elegivel para estorno apos lote liquidado.',
            when: 'Executar processSettlementBatch e reverseSettlement.',
            then: 'Atualiza settledBalanceCents e registra estorno.',
            outcomeKind: 'STATE_CHANGE',
            branchRef: 'REV_OK',
            decisionBinding: null,
            boundaryBinding: null,
            crossOperationWitness: { sharedField: 'SettlementLedgerState.settledBalanceCents', operationSequence: ['processSettlementBatch', 'reverseSettlement'], initialValue: 0, expectedFinalValue: 0, expectedOutcome: 'Estorno apos liquidacao recompoe settledBalanceCents.' },
          },
          { kind: 'BOUNDARY', given: 'Estorno apos liquidacao no mesmo dia.', when: 'Executar reverseSettlement.', then: 'Aplica politica decidida em Q-0001 para dailySettledCents.', outcomeKind: 'STATE_CHANGE', branchRef: 'REV_OK', decisionBinding: { decisionIndex: 0, answerIndex: 0 }, boundaryBinding: null },
          {
            kind: 'HAPPY_PATH',
            given: 'Fila pendente sem bloqueios.',
            when: 'Executar processSettlementBatch.',
            then: 'Liquida lote em BATCH_SETTLED.',
            outcomeKind: 'STATE_CHANGE',
            branchRef: 'BATCH_SETTLED',
            decisionBinding: null,
            boundaryBinding: null,
            crossOperationWitness: { sharedField: 'SettlementLedgerState.dailySettledCents', operationSequence: ['processSettlementBatch', 'reverseSettlement'], initialValue: 0, expectedFinalValue: 1000, expectedOutcome: 'Liquidacao incrementa dailySettledCents antes do estorno.' },
          },
          { kind: 'FAILURE', given: 'disputeHoldActive=true e conta nao congelada.', when: 'Executar processSettlementBatch.', then: 'Rejeita com GUARD_DISPUTE_HOLD_ACTIVE antes de GUARD_DAILY_LIMIT_EXCEEDED.', outcomeKind: 'REJECTION', branchRef: 'GUARD_DISPUTE_HOLD_ACTIVE', decisionBinding: null, boundaryBinding: null },
          { kind: 'FAILURE', given: 'accountFrozen=true.', when: 'Executar processSettlementBatch.', then: 'Rejeita com GUARD_ACCOUNT_FROZEN.', outcomeKind: 'REJECTION', branchRef: 'GUARD_ACCOUNT_FROZEN', decisionBinding: null, boundaryBinding: null },
          { kind: 'FAILURE', given: 'dailySettled + batch > 5000000 sem freeze nem hold.', when: 'Executar processSettlementBatch.', then: 'Rejeita com GUARD_DAILY_LIMIT_EXCEEDED.', outcomeKind: 'REJECTION', branchRef: 'GUARD_DAILY_LIMIT_EXCEEDED', decisionBinding: null, boundaryBinding: null },
        ],
      }],
      invariants: [{
        statement: 'Precedencia em processSettlementBatch e GUARD_ACCOUNT_FROZEN -> GUARD_DISPUTE_HOLD_ACTIVE -> GUARD_DAILY_LIMIT_EXCEEDED e MAX_PENDING_SETTLEMENTS=250, DAILY_SETTLEMENT_LIMIT_CENTS=5000000, MAX_BATCH_REJECTIONS=5 permanecem inalterados.',
        falsification: 'Falsificado se GUARD_DAILY_LIMIT_EXCEEDED disparar antes de GUARD_DISPUTE_HOLD_ACTIVE ou alguma constante mudar.',
        falsificationSpec: { polarity: 'VIOLATION', observableEffect: 'Dispute hold ativo com excesso diario retorna GUARD_DAILY_LIMIT_EXCEEDED.', acceptanceCaseId: null },
        requirementIndexes: [0],
      }],
      determinismReview: {
        rationale: 'Efeito de reverseSettlement em dailySettledCents aguarda escolha humana Q-0001.',
        coverage: [{ claimIndex: lastClaimIdx, dimensionIndexes: [0], rationale: 'Vinculada a Q-0001.' }],
        dimensions: [{
          kind: 'REVERSAL_DAILY_LIMIT_EFFECT',
          subject: { kind: 'REQUIREMENT', index: 0 },
          status: 'DECISION_REQUIRED',
          rationale: 'Define se dailySettledCents decresce ou permanece monotonico no estorno.',
          targets: [{ kind: 'REQUIREMENT', index: 0 }, { kind: 'DECISION', index: 0 }],
          basis: [{ source: 'CONSTITUTION', reference: 'CONST-DECISIONS' }],
          acceptanceCase: null,
          proofObligation: null,
          inapplicabilityProof: null,
          counterexampleWitness: { inputClass: 'Estorno 1000000 cents', baseline: 'Preserva dailySettledCents', variation: 'Decrementa dailySettledCents' },
        }],
        arithmetic: null,
      },
      decisions: [{
        question: 'reverseSettlement deve preservar ou decrementar dailySettledCents?',
        presentation: {
          context: 'SettlementLedgerState acompanha tanto settledBalanceCents quanto dailySettledCents.',
          whyHumanDecision: 'Ambas interpretacoes (limite bruto diario vs limite liquido) sao validas sob src/.',
          observableImpact: 'Afeta se o limite diario de 5000000 cents volta a ficar disponivel apos estorno.',
          recommendationReasoning: 'Preservar dailySettledCents impede contorno do limite diario via estornos repetidos.',
          glossary: [],
        },
        recommendedAnswerIndex: 0,
        requirementIndexes: [0],
        invariantIndexes: [0],
        riskIndexes: [],
        distinguishingCase: { given: 'settled=5000000, estorno=1000000, novo lote=500000.', when: 'Executar processSettlementBatch.', outcomes: [{ answerIndex: 0, then: 'Rejeita GUARD_DAILY_LIMIT_EXCEEDED.' }, { answerIndex: 1, then: 'Aceita lote de 500000.' }] },
        answers: [
          {
            label: 'Preservar dailySettledCents (limite bruto diario)',
            rationale: 'Evita reset artificial de velocidade.',
            contractEffect: 'Mantem dailySettledCents inalterado durante estorno.',
            preparedEffect: {
              requirements: [{ index: 0, patch: { acceptanceCases: [{ index: 1, then: 'Estorna saldo mantendo dailySettledCents preservado.' }] } }],
              dimensions: [{ index: 0, patch: { status: 'SPECIFIED', rationale: 'Preservacao monotonica selecionada.', acceptanceCase: { requirementIndex: 0, caseIndex: 1 }, proofObligation: { relation: 'DEFINED_RESULT', resolutionKind: 'EXPLICIT_POLICY', resolutionParameter: null, baselineOutcome: 'preservado', variationOutcome: 'preservado', observables: ['dailySettledCents'] } } }],
            },
          },
          {
            label: 'Decrementar dailySettledCents (limite liquido diario)',
            rationale: 'Devolve capacidade diaria estornada.',
            contractEffect: 'Decrementa dailySettledCents ate piso 0.',
            preparedEffect: {
              requirements: [{ index: 0, patch: { acceptanceCases: [{ index: 1, then: 'Estorna saldo e decrementa dailySettledCents ate minimo 0.' }] } }],
              dimensions: [{ index: 0, patch: { status: 'SPECIFIED', rationale: 'Decremento liquido selecionado.', acceptanceCase: { requirementIndex: 0, caseIndex: 1 }, proofObligation: { relation: 'DEFINED_RESULT', resolutionKind: 'EXPLICIT_POLICY', resolutionParameter: null, baselineOutcome: 'decrementado', variationOutcome: 'decrementado', observables: ['dailySettledCents'] } } }],
            },
          },
        ],
      }],
      stateModel: {
        entities: [{
          name: 'SettlementLedgerState',
          isCollection: false,
          fields: [
            makeField({ name: 'settledBalanceCents', type: 'INTEGER', bounds: { lowerBound: '0', upperBound: null, boundaryBehavior: 'REJECT', provenance: [{ source: 'WORKSPACE_EVIDENCE', reference: `${observedSettle}:L25` }] }, initRat: 'Saldo liquidado inicia em 0 em createInitialLedgerState.' }),
            makeField({ name: 'dailySettledCents', type: 'INTEGER', bounds: { lowerBound: '0', upperBound: '5000000', boundaryBehavior: 'SATURATE', provenance: [{ source: 'WORKSPACE_EVIDENCE', reference: `${observedSettle}:L10` }] }, initRat: 'Acumulador diario inicia em 0 em createInitialLedgerState.' }),
          ],
        }],
        operations: [
          {
            name: 'processSettlementBatch',
            executionModel: 'SYNCHRONOUS_IN_MEMORY',
            evaluatedInputs: [],
            parameters: [],
            returnContract: { successType: 'SettlementOutcome', errorProtocol: 'RESULT_OBJECT', errorType: 'GuardCode' },
            guardPrecedence: ['GUARD_ACCOUNT_FROZEN', 'GUARD_DISPUTE_HOLD_ACTIVE', 'GUARD_DAILY_LIMIT_EXCEEDED'],
            branches: [
              { branchId: 'GUARD_ACCOUNT_FROZEN', condition: 'accountFrozen', outcomeKind: 'REJECTION', defaultPreservation: true, stateEffects: [] },
              { branchId: 'GUARD_DISPUTE_HOLD_ACTIVE', condition: 'disputeHoldActive', outcomeKind: 'REJECTION', defaultPreservation: true, stateEffects: [] },
              { branchId: 'GUARD_DAILY_LIMIT_EXCEEDED', condition: 'dailySettled + batch > 5000000', outcomeKind: 'REJECTION', defaultPreservation: true, stateEffects: [] },
              { branchId: 'BATCH_SETTLED', condition: 'guards pass', outcomeKind: 'STATE_CHANGE', defaultPreservation: false, stateEffects: [{ field: 'settledBalanceCents', effect: 'INCREMENT', value: 'settledBalanceCents' }, { field: 'dailySettledCents', effect: 'INCREMENT', value: 'dailySettledCents' }] },
            ],
          },
          {
            name: 'reverseSettlement',
            executionModel: 'SYNCHRONOUS_IN_MEMORY',
            evaluatedInputs: ['reversalAmount'],
            parameters: [{ name: 'reversalAmount', type: 'INTEGER', bounds: { lowerBound: '1', upperBound: null, boundaryBehavior: 'REJECT', provenance: ui(0) } }],
            returnContract: { successType: 'SettlementOutcome', errorProtocol: 'RESULT_OBJECT', errorType: 'ReversalError' },
            guardPrecedence: [],
            noGuardsRationale: 'Estorno direto sobre SettlementLedgerState.',
            branches: [{ branchId: 'REV_OK', condition: 'valid reversal', outcomeKind: 'STATE_CHANGE', defaultPreservation: false, stateEffects: [{ field: 'settledBalanceCents', effect: 'DECREMENT', value: 'reversalAmount' }, { field: 'dailySettledCents', effect: 'CUSTOM', value: 'reversalAmount' }] }],
          },
        ],
        observables: [],
      },
    }),
  };
}

async function runLiveSample(liveIds) {
  const rolesPath = resolve(repoRoot, '.harness/config/roles.json');
  const rolesDoc = JSON.parse(readFileSync(rolesPath, 'utf8'));
  const supervisor = rolesDoc.roles?.semantic_supervisor;
  if (!supervisor || supervisor.mode !== 'api') {
    return { status: 'SKIPPED_NO_API_ROLE', reason: 'semantic_supervisor nao configurado em modo api no .harness/config/roles.json' };
  }
  const trials = [];
  for (const id of liveIds) {
    const dir = createIsolatedWorkspace();
    try {
      runCli(dir, ['--new', DEMANDS[id]]);
      const reqRes = runCli(dir, ['--semantic-request']);
      const req = JSON.parse(reqRes.stdout);
      let previousAttempt = null;
      let attempts = 0;
      let passed = false;
      while (attempts < 3) {
        attempts += 1;
        const { opinion } = await requestSemanticOpinion(req, supervisor, { previousAttempt });
        const comp = runCli(dir, ['--semantic-compile'], {
          sourceSemanticRequestDigest: req.requestDigest,
          opinion,
        });
        if (comp.ok) {
          passed = true;
          break;
        }
        previousAttempt = comp.stderr || comp.stdout;
      }
      trials.push({ id, passed, attempts, oneShot: passed && attempts === 1 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return {
    status: 'MEASURED',
    trials,
    pOneShot: trials.filter((t) => t.oneShot).length / Math.max(trials.length, 1),
    eRetry: trials.reduce((acc, t) => acc + (t.attempts - 1), 0) / Math.max(trials.length, 1),
  };
}

const isLive = process.argv.includes('--live');
const results = [];

for (const [id, demand] of Object.entries(DEMANDS)) {
  const dir = createIsolatedWorkspace();
  try {
    const newRes = runCli(dir, ['--new', demand]);
    if (!newRes.ok) {
      results.push({ id, stage: 'new', ok: false, error: newRes.stderr || newRes.stdout });
      continue;
    }
    const reqRes = runCli(dir, ['--semantic-request']);
    if (!reqRes.ok) {
      results.push({ id, stage: 'semantic-request', ok: false, error: reqRes.stderr || reqRes.stdout });
      continue;
    }
    const compactRes = runCli(dir, ['--semantic-request', '--compact']);
    const req = JSON.parse(reqRes.stdout);
    const compact = compactRes.ok ? JSON.parse(compactRes.stdout) : null;
    if (!compact || compact.requestDigest !== req.requestDigest) {
      results.push({ id, stage: 'semantic-request-compact', ok: false, error: compactRes.stderr || 'compact_digest_mismatch' });
      continue;
    }
    const reqBytes = Buffer.byteLength(reqRes.stdout, 'utf8');
    const compactBytes = Buffer.byteLength(compactRes.stdout, 'utf8');
    const signalBytes = Buffer.byteLength(JSON.stringify({ intent: req.intent, intentEvidence: req.intentEvidence }), 'utf8');
    const signalPct = Number(((signalBytes / reqBytes) * 100).toFixed(1));
    const compactSignalPct = Number(((signalBytes / compactBytes) * 100).toFixed(1));
    const scenario = buildScenario(id, req);

    let earlyAskBytes = null;
    if (scenario.early) {
      earlyAskBytes = Buffer.byteLength(JSON.stringify(scenario.early), 'utf8');
      const earlyCompile = runCli(dir, ['--semantic-compile'], {
        sourceSemanticRequestDigest: req.requestDigest,
        opinion: scenario.early,
      });
      if (!earlyCompile.ok) {
        results.push({ id, stage: 'early-compile', ok: false, error: earlyCompile.stderr || earlyCompile.stdout });
        continue;
      }
    }

    const opinionBytes = Buffer.byteLength(JSON.stringify(scenario.opinion), 'utf8');
    const compileRes = runCli(dir, ['--semantic-compile'], {
      sourceSemanticRequestDigest: req.requestDigest,
      opinion: scenario.opinion,
    });

    if (scenario.flow === 'expect_reject') {
      const rejected = JSON.parse(compileRes.ok ? compileRes.stdout : compileRes.stderr || compileRes.stdout);
      results.push({ id, ok: rejected.status === 'REJECTED', status: rejected.status, reason: rejected.reason, reqBytes, compactBytes, signalPct, compactSignalPct, opinionBytes });
      continue;
    }

    if (!compileRes.ok) {
      results.push({ id, stage: 'semantic-compile', ok: false, reqBytes, compactBytes, opinionBytes, error: compileRes.stderr || compileRes.stdout });
      continue;
    }

    const stepRes = scenario.flow === 'resolve'
      ? runCli(dir, ['--resolve', scenario.resolveArg])
      : runCli(dir, ['--approve']);
    if (!stepRes.ok) {
      results.push({ id, stage: scenario.flow, ok: false, error: stepRes.stderr || stepRes.stdout });
      continue;
    }

    const verJson = JSON.parse(runCli(dir, ['--verify']).stdout);
    const statusJson = JSON.parse(runCli(dir, ['--status']).stdout);
    results.push({
      id,
      ok: verJson.status === 'VALID' && statusJson.status === 'GOVERNED',
      status: statusJson.status,
      verify: verJson.status,
      reqBytes,
      compactBytes,
      signalPct,
      compactSignalPct,
      opinionBytes,
      earlyAskBytes,
      contractDigest: verJson.contractDigest.slice(0, 12),
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const greenfield = results.filter((r) => r.id !== 'D11');
const d11 = results.find((r) => r.id === 'D11');
const live = isLive
  ? await runLiveSample(['D1', 'D6', 'D8', 'D11'])
  : { status: 'OFFLINE_FIXTURE_ONLY (pass --live when API supervisor configured)' };

const report = {
  sensor1_loc: collectSensor1(),
  sensor2_ein: {
    greenfieldMinB: Math.min(...greenfield.map((r) => r.reqBytes)),
    greenfieldMaxB: Math.max(...greenfield.map((r) => r.reqBytes)),
    greenfieldSignalPct: greenfield.map((r) => r.signalPct),
    compactGreenfieldMinMaxB: [
      Math.min(...greenfield.map((r) => r.compactBytes)),
      Math.max(...greenfield.map((r) => r.compactBytes)),
    ],
    compactGreenfieldSignalPct: greenfield.map((r) => r.compactSignalPct),
    d11Bytes: d11?.reqBytes ?? null,
    d11SignalPct: d11?.signalPct ?? null,
    compactD11Bytes: d11?.compactBytes ?? null,
    compactD11SignalPct: d11?.compactSignalPct ?? null,
  },
  sensor3_eout: {
    statelessBytes: results.filter((r) => r.id === 'D1' || r.id === 'D2').map((r) => r.opinionBytes),
    statefulMinMaxB: [
      Math.min(...results.filter((r) => ['D3', 'D4', 'D5', 'D7', 'D8', 'D9'].includes(r.id)).map((r) => r.opinionBytes)),
      Math.max(...results.filter((r) => ['D3', 'D4', 'D5', 'D7', 'D8', 'D9'].includes(r.id)).map((r) => r.opinionBytes)),
    ],
    d11Bytes: d11?.opinionBytes ?? null,
  },
  sensor4_eask_live: {
    earlyAskBytes: results.filter((r) => r.earlyAskBytes !== null && r.earlyAskBytes !== undefined).map((r) => ({ id: r.id, bytes: r.earlyAskBytes })),
    live,
  },
  sensor5_parity: {
    passed: results.filter((r) => r.ok).length,
    total: results.length,
  },
  results,
};

console.log(JSON.stringify(report, null, 2));
if (report.sensor5_parity.passed !== report.sensor5_parity.total) {
  process.exitCode = 1;
}

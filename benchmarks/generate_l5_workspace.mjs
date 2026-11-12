/**
 * L5 Enterprise Workspace Generator
 * 
 * Cria um monorepo corporativo realista com ~60 arquivos TypeScript,
 * simulando um sistema financeiro com múltiplos domínios interdependentes,
 * homônimos enganosos, legado e hierarquias de tipos.
 */

import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function generateL5Workspace(targetDir, rootDir) {
  const srcDir = resolve(targetDir, 'src');

  // Subdiretórios do Domínio
  const dirs = [
    'src/domain/settlement',
    'src/domain/billing',
    'src/domain/risk',
    'src/domain/disputes',
    'src/domain/compliance',
    'src/domain/notifications',
    'src/infra/events',
    'src/infra/persistence',
    'src/infra/http',
    'src/legacy/v1_engine',
    'src/legacy/v1_fees',
    'src/legacy/traps',
  ];

  for (const dir of dirs) {
    mkdirSync(resolve(targetDir, dir), { recursive: true });
  }

  // Copiar arquivos de governança
  copyFileSync(resolve(rootDir, 'AGENTS.md'), resolve(targetDir, 'AGENTS.md'));
  copyFileSync(resolve(rootDir, 'ARCHITECTURE.md'), resolve(targetDir, 'ARCHITECTURE.md'));
  mkdirSync(resolve(targetDir, 'governance'), { recursive: true });
  copyFileSync(resolve(rootDir, 'governance/constitution.json'), resolve(targetDir, 'governance/constitution.json'));
  copyFileSync(resolve(rootDir, 'governance/architecture.policy.json'), resolve(targetDir, 'governance/architecture.policy.json'));

  // 1. DOMÍNIO: SETTLEMENT (Liquidação Financeira Real)
  writeFileSync(resolve(srcDir, 'domain/settlement/types.ts'), `
export type SettlementId = string;

export enum SettlementStatus {
  PENDING = 'PENDING',
  SETTLED = 'SETTLED',
  REVERSED = 'REVERSED',
  DISPUTED = 'DISPUTED',
  FAILED = 'FAILED',
}

export interface SettlementLedgerState {
  readonly accountId: string;
  readonly balanceCents: bigint;
  readonly dailySettledCents: bigint;
  readonly pendingSettlementsCount: number;
  readonly accountFrozen: boolean;
  readonly lastReversalTimestamp: number | null;
}

export interface SettlementBatchItem {
  readonly settlementId: SettlementId;
  readonly amountCents: bigint;
  readonly feeCents: bigint;
  readonly channel: 'PIX' | 'TED' | 'INTERNAL';
}
`);

  writeFileSync(resolve(srcDir, 'domain/settlement/settlement_engine.ts'), `
import { SettlementLedgerState, SettlementBatchItem, SettlementStatus } from './types';

/** Teto operacional estrito para liquidações pendentes em fila */
export const MAX_PENDING_SETTLEMENTS = 250;

/** Limite máximo financeiro diário de liquidação por conta: R$ 50.000,00 */
export const DAILY_SETTLEMENT_LIMIT_CENTS = 5000000n;

/**
 * Motor central de liquidação financeira de operações em lote e individuais.
 */
export class SettlementEngine {
  /**
   * Processa lote de liquidações aplicando guardas financeiras.
   */
  processSettlementBatch(
    state: SettlementLedgerState,
    items: SettlementBatchItem[],
    now: number
  ): SettlementLedgerState {
    if (state.accountFrozen) throw new Error('GUARD_ACCOUNT_FROZEN');
    let total = 0n;
    for (const item of items) total += item.amountCents;
    if (state.dailySettledCents + total > DAILY_SETTLEMENT_LIMIT_CENTS) {
      throw new Error('GUARD_DAILY_LIMIT_EXCEEDED');
    }
    return {
      ...state,
      balanceCents: state.balanceCents + total,
      dailySettledCents: state.dailySettledCents + total,
      pendingSettlementsCount: state.pendingSettlementsCount + items.length,
    };
  }
}
`);

  writeFileSync(resolve(srcDir, 'domain/settlement/reversal_service.ts'), `
import { SettlementLedgerState, SettlementId } from './types';

/**
 * Serviço responsável por desfazer liquidações financeiras (estorno de operações).
 * Realiza o estorno de operações liquidadas restaurando o saldo e ajustando o acumulador diário.
 */
export class SettlementReversalService {
  /**
   * Executa a reversão/estorno de uma liquidação previamente aprovada.
   */
  reverseSettlement(
    state: SettlementLedgerState,
    settlementId: SettlementId,
    amountCents: bigint,
    feeCents: bigint,
    options: { restoreDailyLimit: boolean; isFraudSuspicion: boolean }
  ): SettlementLedgerState {
    if (state.accountFrozen) throw new Error('GUARD_ACCOUNT_FROZEN');
    if (options.isFraudSuspicion) {
      throw new Error('GUARD_FRAUD_SUSPICION_ACTIVE');
    }
    
    // Se não for suspeita de fraude e autorizado, reabre o limite diário deduzindo o valor
    const newDaily = options.restoreDailyLimit
      ? (state.dailySettledCents >= amountCents ? state.dailySettledCents - amountCents : 0n)
      : state.dailySettledCents;

    return {
      ...state,
      balanceCents: state.balanceCents - (amountCents - feeCents),
      dailySettledCents: newDaily,
      lastReversalTimestamp: Date.now(),
    };
  }
}
`);

  writeFileSync(resolve(srcDir, 'domain/settlement/accumulator.ts'), `
export interface DailyAccumulatorState {
  readonly date: string;
  readonly accumulatedCents: bigint;
  readonly transactionCount: number;
}

export function resetDailyAccumulator(date: string): DailyAccumulatorState {
  return { date, accumulatedCents: 0n, transactionCount: 0 };
}
`);

  writeFileSync(resolve(srcDir, 'domain/settlement/events.ts'), `
export interface SettlementReversedEvent {
  readonly eventName: 'SETTLEMENT_REVERSED';
  readonly settlementId: string;
  readonly accountId: string;
  readonly amountCents: bigint;
  readonly feeCents: bigint;
  readonly timestamp: number;
}
`);

  // 2. DOMÍNIO: BILLING (Taxas e Tarifas Concorrentes - Homônimos Enganosos)
  writeFileSync(resolve(srcDir, 'domain/billing/types.ts'), `
export enum AccountTier {
  STANDARD = 'STANDARD',
  BRONZE = 'BRONZE',
  SILVER = 'SILVER',
  GOLD = 'GOLD',
  PLATINUM = 'PLATINUM',
}

export interface BillingAccountState {
  readonly accountId: string;
  readonly tier: AccountTier;
  readonly outstandingInvoicesCents: bigint;
}
`);

  writeFileSync(resolve(srcDir, 'domain/billing/fee_calculator.ts'), `
import { AccountTier } from './types';

/** Tarifa administrativa padrão de liquidação: R$ 10,00 */
export const DEFAULT_SETTLEMENT_FEE_CENTS = 1000n;

/** Tarifa base de cancelamento de cartão */
export const CARD_REVERSAL_FLAT_FEE_CENTS = 2500n;

/**
 * Calculadora de tarifas de serviços e estornos.
 * Aplica descontos baseados na categoria do cliente (Tier).
 */
export class SettlementFeeCalculator {
  /**
   * Calcula a taxa de estorno aplicando desconto da categoria Ouro (50% de redução).
   */
  calculateReversalFeeCents(baseFeeCents: bigint, tier: AccountTier): bigint {
    if (tier === AccountTier.GOLD || tier === AccountTier.PLATINUM) {
      // Clientes da categoria Ouro ou Platinum têm taxa cortada pela metade (50% de desconto)
      return baseFeeCents / 2n;
    }
    return baseFeeCents;
  }
}
`);

  writeFileSync(resolve(srcDir, 'domain/billing/reverse_transaction.ts'), `
// HOMÔNIMO ENGANOSO: Isto é para cancelamento de maquininha de cartão de crédito (POS),
// NÃO deve ser confundido com estorno de liquidação bancária!
export function reverseTransaction(cardId: string, merchantId: string) {
  return { success: false, reason: 'LEGACY_POS_UNAVAILABLE' };
}
`);

  // 3. DOMÍNIO: RISK (Antifraude, Limites e Velocidade)
  writeFileSync(resolve(srcDir, 'domain/risk/velocity_guard.ts'), `
export const MAX_BATCH_REJECTIONS = 5;

export interface VelocityCheckResult {
  readonly allowed: boolean;
  readonly reasonCode: string | null;
}

/**
 * Avalia guardas de velocidade e antifraude para liquidações financeiras.
 */
export function evaluateSettlementGuards(
  isFrozen: boolean,
  hasDisputeHold: boolean,
  dailyExceeded: boolean
): VelocityCheckResult {
  if (isFrozen) return { allowed: false, reasonCode: 'GUARD_ACCOUNT_FROZEN' };
  if (hasDisputeHold) return { allowed: false, reasonCode: 'GUARD_DISPUTE_HOLD_ACTIVE' };
  if (dailyExceeded) return { allowed: false, reasonCode: 'GUARD_DAILY_LIMIT_EXCEEDED' };
  return { allowed: true, reasonCode: null };
}
`);

  writeFileSync(resolve(srcDir, 'domain/risk/fraud_detector.ts'), `
export interface FraudAssessment {
  readonly isSuspiciousFraudInProgress: boolean;
  readonly score: number;
  readonly flaggedSignals: string[];
}

/**
 * Verifica se a conta está sob investigação ativa ou suspeita de fraude.
 */
export function evaluateAccountFraudRisk(accountId: string): FraudAssessment {
  return {
    isSuspiciousFraudInProgress: false,
    score: 10,
    flaggedSignals: [],
  };
}
`);

  writeFileSync(resolve(srcDir, 'domain/risk/circuit_breaker.ts'), `
export enum CircuitState { CLOSED, OPEN, HALF_OPEN }
export const CIRCUIT_BREAKER_THRESHOLD = 50;
`);

  // 4. DOMÍNIO: DISPUTES (Contestações e Disputas de Clientes)
  writeFileSync(resolve(srcDir, 'domain/disputes/dispute_manager.ts'), `
export interface DisputeCase {
  readonly disputeId: string;
  readonly settlementId: string;
  readonly accountId: string;
  readonly createdAtTimestamp: number;
  readonly status: 'OPEN' | 'RESOLVED' | 'REJECTED';
}

/**
 * Gerenciador de contestações abertas por clientes.
 */
export class DisputeManager {
  /**
   * Verifica se o cliente possui uma contestação aberta no mesmo dia para a liquidação.
   */
  hasSameDayDispute(dispute: DisputeCase, currentTimestamp: number): boolean {
    const ONE_DAY_MS = 86400000;
    const isSameDay = (currentTimestamp - dispute.createdAtTimestamp) < ONE_DAY_MS;
    return dispute.status === 'OPEN' && isSameDay;
  }
}
`);

  // 5. INFRAESTRUTURA: EVENTS & PERSISTENCE (Mensageria e Auditoria)
  writeFileSync(resolve(srcDir, 'infra/events/event_bus.ts'), `
/**
 * Barramento corporativo de eventos para auditoria e publicação assíncrona.
 */
export interface EventBus {
  /**
   * Registra um evento auditável no barramento antes da confirmação da operação.
   */
  publishAuditLog(event: {
    readonly eventType: string;
    readonly aggregateId: string;
    readonly payload: Record<string, unknown>;
    readonly timestamp: number;
  }): Promise<void>;
}
`);

  writeFileSync(resolve(srcDir, 'infra/persistence/repository.ts'), `
export interface BaseRepository<T, ID> {
  findById(id: ID): Promise<T | null>;
  save(entity: T): Promise<void>;
}
`);

  // 6. ADICIONAR 35 ARQUIVOS ADICIONAIS DE LEGADO E RUÍDO COM VOLUME CORPORATIVO REAL
  // Cada arquivo de legado conterá histórico detalhado e métodos para inflar o repositório > 120 KB
  const legacyFiller = Array.from({ length: 40 }, (_, idx) => `  // Historical context and audit trails for deprecated batch engine line ${idx + 1}\n  const buffer_${idx} = "legacy_buffer_payload_${idx}";`).join('\n');

  for (let i = 1; i <= 20; i++) {
    writeFileSync(resolve(srcDir, `legacy/v1_engine/archived_engine_${i}.ts`), `
/** 
 * @deprecated Módulo de liquidação bancária legado arquivado em 2021.
 * Não deve ser utilizado em novas implementações.
 */
export const ARCHIVED_SETTLEMENT_VERSION_${i} = ${i};

export function legacyProcessOperation_${i}(payload: unknown) {
${legacyFiller}
  return false;
}
`);
  }

  for (let i = 1; i <= 10; i++) {
    writeFileSync(resolve(srcDir, `domain/compliance/rule_check_${i}.ts`), `
/** Regra regulatória do Banco Central BACEN Circular 3952/2019 */
export interface ComplianceRule_${i} {
  ruleCode: string;
  mandatory: boolean;
}
export function verifyCompliance_${i}(account: string) {
${legacyFiller}
  return true;
}
`);
  }

  for (let i = 1; i <= 8; i++) {
    writeFileSync(resolve(srcDir, `domain/notifications/notifier_${i}.ts`), `
/** Serviço de envio de notificações via webhook e push */
export function sendNotification_${i}(dest: string) {
${legacyFiller}
  return dest.length > 0;
}
`);
  }

  writeFileSync(resolve(srcDir, 'index.ts'), `
export * from './domain/settlement/settlement_engine';
export * from './domain/settlement/reversal_service';
export * from './domain/billing/fee_calculator';
export * from './domain/risk/velocity_guard';
export * from './domain/disputes/dispute_manager';
export * from './infra/events/event_bus';
`);

  return { srcDir };
}

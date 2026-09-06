import { createHash } from 'node:crypto';

export interface Entity {
  id: string;
  balance: bigint;
  capacity: bigint;
  maxCapacity: bigint;
  refillRatePerMs: bigint;
  lastTimestamp: bigint;
}

export interface Operation {
  id: string;
  source: string;
  target: string;
  amount: bigint;
  cost: bigint;
}

export type OperationStatus =
  | 'committed'
  | 'rejected_invalid'
  | 'blocked_capacity'
  | 'blocked_insolvent'
  | 'aborted';

export interface OperationDecision {
  operationId: string;
  status: OperationStatus;
  reason?: string;
}

export interface BatchResult {
  acceptedCount: number;
  rejectedCount: number;
  blockedCount: number;
  totalVolume: bigint;
  totalCost: bigint;
  rolledBack: boolean;
  executionDigest: string;
  decisions: readonly OperationDecision[];
}

interface DigestParams {
  entities: Record<string, Entity>;
  decisions: readonly OperationDecision[];
  volume: bigint;
  cost: bigint;
  rolledBack: boolean;
}

interface OperationEvaluation {
  decision: OperationDecision;
  volume: bigint;
  cost: bigint;
  accepted: boolean;
  rejected: boolean;
  blocked: boolean;
}

function cloneEntity(entity: Entity): Entity {
  return {
    id: entity.id,
    balance: entity.balance,
    capacity: entity.capacity,
    maxCapacity: entity.maxCapacity,
    refillRatePerMs: entity.refillRatePerMs,
    lastTimestamp: entity.lastTimestamp,
  };
}

function cloneEntityTable(entities: Record<string, Entity>): Record<string, Entity> {
  const cloned: Record<string, Entity> = {};
  for (const id in entities) {
    if (Object.prototype.hasOwnProperty.call(entities, id)) {
      const e = entities[id];
      if (e) {
        cloned[id] = cloneEntity(e);
      }
    }
  }
  return cloned;
}

export class BatchEngine {
  private _entities: Record<string, Entity> = {};

  public registerEntity(entity: Entity): void {
    if (typeof entity.id !== 'string' || entity.id.trim() === '') {
      throw new RangeError('entity id must be a non-empty string');
    }
    if (typeof entity.balance !== 'bigint' || entity.balance < 0n) {
      throw new RangeError('entity balance must be a non-negative bigint');
    }
    if (typeof entity.capacity !== 'bigint' || entity.capacity < 0n) {
      throw new RangeError('entity capacity must be a non-negative bigint');
    }
    if (typeof entity.maxCapacity !== 'bigint' || entity.maxCapacity < entity.capacity) {
      throw new RangeError('entity maxCapacity must be at least current capacity');
    }
    if (typeof entity.refillRatePerMs !== 'bigint' || entity.refillRatePerMs < 0n) {
      throw new RangeError('entity refillRatePerMs must be a non-negative bigint');
    }
    if (typeof entity.lastTimestamp !== 'bigint') {
      throw new RangeError('entity lastTimestamp must be a bigint');
    }
    this._entities[entity.id] = cloneEntity(entity);
  }

  public getEntity(id: string): Entity | undefined {
    const entity = this._entities[id];
    return entity !== undefined ? cloneEntity(entity) : undefined;
  }

  public getAllEntities(): Entity[] {
    const result: Entity[] = [];
    for (const id in this._entities) {
      if (Object.prototype.hasOwnProperty.call(this._entities, id)) {
        const e = this._entities[id];
        if (e) {
          result.push(cloneEntity(e));
        }
      }
    }
    return result;
  }

  public processBatch(operations: readonly Operation[], now: bigint): BatchResult {
    if (typeof now !== 'bigint') {
      throw new RangeError('now must be a bigint');
    }

    const stateBefore = cloneEntityTable(this._entities);
    const projected = cloneEntityTable(this._entities);

    const timeOk = this.applyTemporalRefill(projected, now);
    if (!timeOk) {
      return this.abortBatch(operations, stateBefore, 'regressive_time_detected');
    }

    const decisions: OperationDecision[] = [];
    let acceptedCount = 0;
    let rejectedCount = 0;
    let blockedCount = 0;
    let totalVolume = 0n;
    let totalCost = 0n;

    for (const op of operations) {
      const result = this.evaluateAndApply(projected, op);
      decisions.push(result.decision);
      totalVolume += result.volume;
      totalCost += result.cost;
      if (result.accepted) acceptedCount += 1;
      if (result.rejected) rejectedCount += 1;
      if (result.blocked) blockedCount += 1;
    }

    const violation = this.verifyInvariants(stateBefore, projected, totalCost);
    if (violation !== null) {
      return this.abortBatch(operations, stateBefore, violation);
    }

    this._entities = projected;
    const executionDigest = this.computeDigest({
      entities: projected,
      decisions,
      volume: totalVolume,
      cost: totalCost,
      rolledBack: false,
    });

    return {
      acceptedCount,
      rejectedCount,
      blockedCount,
      totalVolume,
      totalCost,
      rolledBack: false,
      executionDigest,
      decisions,
    };
  }

  private applyTemporalRefill(projected: Record<string, Entity>, now: bigint): boolean {
    for (const id in projected) {
      if (Object.prototype.hasOwnProperty.call(projected, id)) {
        const entity = projected[id];
        if (!entity) continue;
        if (now < entity.lastTimestamp) {
          return false;
        }
        if (now > entity.lastTimestamp) {
          const timeDiff = now - entity.lastTimestamp;
          const accumulated = timeDiff * entity.refillRatePerMs;
          const newCapacity = entity.capacity + accumulated;
          entity.capacity = newCapacity > entity.maxCapacity ? entity.maxCapacity : newCapacity;
          entity.lastTimestamp = now;
        }
      }
    }
    return true;
  }

  private evaluateAndApply(projected: Record<string, Entity>, op: Operation): OperationEvaluation {
    if (!this.isValidOperationInput(op)) {
      return {
        decision: { operationId: op.id ?? '', status: 'rejected_invalid', reason: 'invalid_inputs' },
        volume: 0n, cost: 0n, accepted: false, rejected: true, blocked: false,
      };
    }

    const source = projected[op.source];
    const target = projected[op.target];
    if (!source || !target) {
      return {
        decision: { operationId: op.id, status: 'rejected_invalid', reason: 'entity_not_found' },
        volume: 0n, cost: 0n, accepted: false, rejected: true, blocked: false,
      };
    }

    if (source.capacity < op.cost) {
      return {
        decision: { operationId: op.id, status: 'blocked_capacity', reason: 'insufficient_capacity' },
        volume: 0n, cost: 0n, accepted: false, rejected: false, blocked: true,
      };
    }

    const requiredBalance = op.amount + op.cost;
    if (source.balance < requiredBalance) {
      return {
        decision: { operationId: op.id, status: 'blocked_insolvent', reason: 'insufficient_balance' },
        volume: 0n, cost: 0n, accepted: false, rejected: false, blocked: true,
      };
    }

    source.capacity -= op.cost;
    source.balance -= requiredBalance;
    target.balance += op.amount;

    return {
      decision: { operationId: op.id, status: 'committed' },
      volume: op.amount, cost: op.cost, accepted: true, rejected: false, blocked: false,
    };
  }

  private isValidOperationInput(op: Operation): boolean {
    return (
      typeof op.id === 'string' && op.id !== '' &&
      typeof op.source === 'string' && typeof op.target === 'string' &&
      op.source !== op.target &&
      typeof op.amount === 'bigint' && op.amount > 0n &&
      typeof op.cost === 'bigint' && op.cost >= 0n
    );
  }

  private verifyInvariants(
    before: Record<string, Entity>,
    projected: Record<string, Entity>,
    totalCost: bigint,
  ): string | null {
    let sumBefore = 0n;
    for (const id in before) {
      if (Object.prototype.hasOwnProperty.call(before, id)) {
        const e = before[id];
        if (e) sumBefore += e.balance;
      }
    }

    let sumAfter = 0n;
    for (const id in projected) {
      if (Object.prototype.hasOwnProperty.call(projected, id)) {
        const entity = projected[id];
        if (!entity) continue;
        if (entity.balance < 0n) return 'negative_balance_detected';
        if (entity.capacity < 0n || entity.capacity > entity.maxCapacity) {
          return 'capacity_bounds_violated';
        }
        sumAfter += entity.balance;
      }
    }

    if (sumAfter + totalCost !== sumBefore) {
      return 'value_conservation_violated';
    }

    return null;
  }

  private abortBatch(
    operations: readonly Operation[],
    revertedState: Record<string, Entity>,
    reason: string,
  ): BatchResult {
    this._entities = revertedState;
    const decisions: OperationDecision[] = operations.map((op) => ({
      operationId: op.id ?? '',
      status: 'aborted',
      reason,
    }));

    const executionDigest = this.computeDigest({
      entities: revertedState,
      decisions,
      volume: 0n,
      cost: 0n,
      rolledBack: true,
    });

    return {
      acceptedCount: 0,
      rejectedCount: 0,
      blockedCount: operations.length,
      totalVolume: 0n,
      totalCost: 0n,
      rolledBack: true,
      executionDigest,
      decisions,
    };
  }

  private computeDigest(params: DigestParams): string {
    const keys: string[] = [];
    for (const id in params.entities) {
      if (Object.prototype.hasOwnProperty.call(params.entities, id)) {
        keys.push(id);
      }
    }
    keys.sort((a, b) => a.localeCompare(b));

    const sortedEntities = keys
      .map((id) => {
        const e = params.entities[id];
        return e ? `${id}:${e.balance}:${e.capacity}:${e.lastTimestamp}` : '';
      })
      .join(';');

    const decisionsStr = params.decisions
      .map((d) => `${d.operationId}:${d.status}`)
      .join(',');

    const payload = `${sortedEntities}|${decisionsStr}|${params.volume}|${params.cost}|${params.rolledBack}`;
    return createHash('sha256').update(payload, 'utf8').digest('hex');
  }
}

export function executeBatch(
  engine: BatchEngine,
  operations: readonly Operation[],
  now: bigint,
): BatchResult {
  return engine.processBatch(operations, now);
}

import assert from 'node:assert/strict';
import process from 'node:process';
import { buildWorkspaceSkeleton, extractFileSymbols } from '../../lib/workspace_skeleton.mjs';
import { assertSchema } from '../../lib/schema_validator.mjs';
import { canonicalDigest } from '../../lib/canonical_json.mjs';

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

log('[CTDD TEST] Starting Workspace Skeleton AST Extractor Test Suite...');

// 1. Interfaces with Generics and Inheritance
{
  const tsCode = `
export interface BaseEntity {
  readonly id: string;
}

/** Represents a state model entity with generic options */
export interface Repository<T extends BaseEntity = BaseEntity> extends BaseEntity {
  find(id: string): Promise<T | null>;
  save(entity: T): Promise<void>;
}
`;
  const symbols = extractFileSymbols('src/repo.ts', tsCode);
  assert.equal(symbols.length, 2);

  const base = symbols.find((s) => s.name === 'BaseEntity');
  assert.ok(base);
  assert.equal(base.kind, 'INTERFACE');
  assert.equal(base.exported, true);
  assert.ok(base.signature.includes('readonly id: string'));

  const repo = symbols.find((s) => s.name === 'Repository');
  assert.ok(repo);
  assert.equal(repo.kind, 'INTERFACE');
  assert.equal(repo.exported, true);
  assert.ok(repo.signature.includes('<T extends BaseEntity = BaseEntity>'));
  assert.ok(repo.docComment?.includes('Represents a state model entity'));

  log('  PASS: Interfaces with generics, inheritance and JSDoc comments verified');
}

// 2. Type Aliases, Unions and Enums
{
  const tsCode = `
export type Status = 'ACTIVE' | 'PENDING' | 'REJECTED';
export type Mapped<T> = { [K in keyof T]: string };

export enum ErrorCode {
  INSUFFICIENT_FUNDS = 100,
  ACCOUNT_FROZEN = 101,
}
`;
  const symbols = extractFileSymbols('src/types.ts', tsCode);
  assert.equal(symbols.length, 3);

  const status = symbols.find((s) => s.name === 'Status');
  assert.equal(status?.kind, 'TYPE_ALIAS');
  assert.ok(status?.signature.includes("'ACTIVE' | 'PENDING' | 'REJECTED'"));

  const mapped = symbols.find((s) => s.name === 'Mapped');
  assert.equal(mapped?.kind, 'TYPE_ALIAS');
  assert.ok(mapped?.signature.includes('[K in keyof T]: string'));

  const errEnum = symbols.find((s) => s.name === 'ErrorCode');
  assert.equal(errEnum?.kind, 'ENUM');
  assert.ok(errEnum?.signature.includes('INSUFFICIENT_FUNDS = 100'));

  log('  PASS: Type aliases, union types and enums verified');
}

// 3. Functions, Overloads, Async and Body Stripping
{
  const tsCode = `
export async function processBatch<T>(items: readonly T[], limit: number): Promise<boolean> {
  // Heavy internal computation
  const filtered = items.slice(0, limit);
  if (filtered.length === 0) return false;
  return true;
}

function internalHelper(x: number): number {
  return x * 2;
}
`;
  const symbols = extractFileSymbols('src/engine.ts', tsCode);
  assert.equal(symbols.length, 2);

  const processBatch = symbols.find((s) => s.name === 'processBatch');
  assert.ok(processBatch);
  assert.equal(processBatch.kind, 'FUNCTION');
  assert.equal(processBatch.exported, true);
  // Must NOT leak function body ({ ... })
  assert.ok(!processBatch.signature.includes('Heavy internal computation'));
  assert.ok(processBatch.signature.startsWith('export async function processBatch<T>'));
  assert.ok(processBatch.signature.endsWith('Promise<boolean>'));

  const internal = symbols.find((s) => s.name === 'internalHelper');
  assert.ok(internal);
  assert.equal(internal.exported, false);
  assert.ok(!internal.signature.includes('return x * 2'));

  log('  PASS: Functions with generics, async and body-stripping verified');
}

// 4. Arrow Functions and Variable Declarations (const vs let)
{
  const tsCode = `
export const calculateFee = (amountCents: number, rate: number): number => {
  return Math.round(amountCents * rate);
};

export const MAX_RETRIES = 5;
export let currentStreak = 0;
`;
  const symbols = extractFileSymbols('src/calc.ts', tsCode);
  assert.equal(symbols.length, 3);

  const fn = symbols.find((s) => s.name === 'calculateFee');
  assert.ok(fn);
  assert.equal(fn.kind, 'FUNCTION');
  assert.equal(fn.exported, true);
  assert.ok(!fn.signature.includes('Math.round'));

  const max = symbols.find((s) => s.name === 'MAX_RETRIES');
  assert.ok(max);
  assert.equal(max.kind, 'CONST');
  assert.equal(max.exported, true);
  assert.ok(max.signature.includes('MAX_RETRIES = 5'));

  const streak = symbols.find((s) => s.name === 'currentStreak');
  assert.ok(streak);
  assert.equal(streak.kind, 'VARIABLE');
  assert.equal(streak.exported, true);

  log('  PASS: Arrow functions, constants and variables verified');
}

// 5. Classes with Constructor, Properties and Public Methods
{
  const tsCode = `
export class SettlementLedger {
  readonly accountId: string;
  private secretKey: string;

  constructor(accountId: string) {
    this.accountId = accountId;
    this.secretKey = 'hidden';
  }

  public recordSettlement(amount: number): boolean {
    return true;
  }

  private internalValidate(): void {
    // hidden
  }
}
`;
  const symbols = extractFileSymbols('src/ledger.ts', tsCode);
  assert.equal(symbols.length, 1);

  const cls = symbols[0];
  assert.equal(cls.name, 'SettlementLedger');
  assert.equal(cls.kind, 'CLASS');
  assert.equal(cls.exported, true);
  // Must include public members, must NOT include private secretKey or private internalValidate
  assert.ok(cls.signature.includes('readonly accountId: string'));
  assert.ok(cls.signature.includes('constructor(accountId: string);'));
  assert.ok(cls.signature.includes('recordSettlement(amount: number): boolean;'));
  assert.ok(!cls.signature.includes('secretKey'));
  assert.ok(!cls.signature.includes('internalValidate'));

  log('  PASS: Class signatures with public member extraction verified');
}

// 6. Re-exports
{
  const tsCode = `
export { reverseSettlement as reverse, SettlementStatus } from './engine.js';
`;
  const symbols = extractFileSymbols('src/index.ts', tsCode);
  assert.equal(symbols.length, 2);

  const rev = symbols.find((s) => s.name === 'reverse');
  assert.ok(rev);
  assert.equal(rev.exported, true);
  assert.ok(rev.signature.includes("from './engine.js'"));

  log('  PASS: Re-exports verified');
}

// 7. Non-TypeScript Generic Extraction (Python & Shell)
{
  const pyCode = `
class AccountManager:
    def __init__(self, name):
        self.name = name

def execute_reversal(state, amount):
    return True

def _private_calc():
    pass
`;
  const pySymbols = extractFileSymbols('src/manager.py', pyCode);
  assert.equal(pySymbols.length, 3); // AccountManager (class), execute_reversal (public fn), _private_calc (private fn)
  assert.equal(pySymbols[0].name, 'AccountManager');
  assert.equal(pySymbols[0].kind, 'CLASS');
  assert.equal(pySymbols[1].name, 'execute_reversal');
  assert.equal(pySymbols[1].kind, 'FUNCTION');
  assert.equal(pySymbols[1].exported, true);
  assert.equal(pySymbols[2].name, '_private_calc');
  assert.equal(pySymbols[2].kind, 'FUNCTION');
  assert.equal(pySymbols[2].exported, false);

  const shCode = `
function deploy_ledger() {
  echo "deploying"
}
`;
  const shSymbols = extractFileSymbols('src/deploy.sh', shCode);
  assert.equal(shSymbols.length, 1);
  assert.equal(shSymbols[0].name, 'deploy_ledger');
  assert.equal(shSymbols[0].kind, 'FUNCTION');

  log('  PASS: Non-TS generic extraction (Python & Shell) verified');
}

// 8. Full Workspace Skeleton Construction, Deterministic Sorting & Schema Validation
{
  const records = [
    {
      path: 'src/b_ledger.ts',
      text: 'export function withdraw(amount: number): void {}',
    },
    {
      path: 'src/a_types.ts',
      text: 'export interface Account { id: string; }',
    },
  ];

  const skeleton = buildWorkspaceSkeleton(records);
  assert.equal(skeleton.schema, 'aegis.workspace_skeleton.v1');
  assert.equal(skeleton.symbolCount, 2);
  assert.equal(skeleton.symbols[0].path, 'src/a_types.ts');
  assert.equal(skeleton.symbols[1].path, 'src/b_ledger.ts');
  assert.equal(skeleton.digest, canonicalDigest({
    schema: 'aegis.workspace_skeleton.v1',
    symbolCount: 2,
    symbols: skeleton.symbols,
  }));

  // Validate that the skeleton fits into aegis.preflight_handoff.v3 schema
  const preflightV3 = {
    schema: 'aegis.preflight_handoff.v3',
    phase: 'DISCOVERED',
    status: 'SEMANTIC_DELIBERATION_REQUIRED',
    intent: 'Test skeleton integration',
    preflightDigest: '0'.repeat(64),
    capture: {
      provenance: 'USER',
      transport: 'ARGV_STRING',
      unicodeNormalization: 'NFC',
      lineEndings: 'LF',
      byteLength: 25,
    },
    discovery: {
      sourceRoot: 'src',
      status: 'SOURCE_OBSERVED',
      files: [
        { path: 'src/a_types.ts', bytes: 50, digest: '0'.repeat(64), kind: 'UTF8_TEXT' },
        { path: 'src/b_ledger.ts', bytes: 60, digest: '0'.repeat(64), kind: 'UTF8_TEXT' },
      ],
      ignoredEntries: [],
      visitedEntries: 2,
      scannedBytes: 110,
      sourceSnapshotDigest: '0'.repeat(64),
      workspaceSkeleton: skeleton,
    },
  };

  assertSchema('aegis.preflight_handoff.v3', preflightV3);

  log('  PASS: Full Workspace Skeleton construction, deterministic sort and v3 schema validation verified');
}

log('[CTDD TEST] All Workspace Skeleton AST Extractor tests passed successfully!');

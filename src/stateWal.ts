import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { EngineSnapshot } from './reorgEngine.js';

interface WalEnvelope {
  readonly version: 1;
  readonly payload: string;
  readonly checksum: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function recordField(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

function stableEncode(value: unknown): string {
  if (typeof value === 'bigint') return `{"$bigint":"${value.toString()}"}`;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableEncode(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableEncode(record[key])}`).join(',')}}`;
}

function hashText(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < value.length; i++) {
    hash ^= BigInt(value.charCodeAt(i));
    hash = (hash * 0x100000001b3n) & 0xFFFFFFFFFFFFFFFFn;
  }
  return hash.toString(16).padStart(16, '0');
}

function isEngineSnapshot(value: unknown): value is EngineSnapshot {
  if (!isRecord(value)) return false;
  const tree = recordField(value, 'treeSnapshot');
  if (!isRecord(tree) || !isRecord(recordField(tree, 'blocks'))) return false;
  if (!isRecord(recordField(value, 'subscriptions')) || !isRecord(recordField(value, 'txToBlockMap')) || !isRecord(recordField(value, 'canonicalHeightToHash'))) return false;
  const tipHeight = recordField(tree, 'tipHeight');
  const tipHash = recordField(tree, 'tipHash');
  return typeof tipHeight === 'number'
    && (tipHash === null || typeof tipHash === 'string')
    && typeof recordField(value, 'totalAlertsEmitted') === 'bigint'
    && typeof recordField(value, 'lastProcessedMs') === 'bigint'
    && typeof recordField(value, 'eventSequence') === 'bigint';
}

function decodeSnapshot(payload: string): EngineSnapshot | null {
  try {
    const value: unknown = JSON.parse(payload, (_key: string, current: unknown) => {
      const bigintValue = isRecord(current) ? recordField(current, '$bigint') : null;
      if (isRecord(current) && Object.keys(current).length === 1 && typeof bigintValue === 'string') return BigInt(bigintValue);
      return current;
    });
    return isEngineSnapshot(value) ? value : null;
  } catch {
    return null;
  }
}

function decodeEnvelope(value: unknown): WalEnvelope | null {
  const version = isRecord(value) ? recordField(value, 'version') : null;
  const payload = isRecord(value) ? recordField(value, 'payload') : null;
  const checksum = isRecord(value) ? recordField(value, 'checksum') : null;
  if (version !== 1 || typeof payload !== 'string' || typeof checksum !== 'string') return null;
  return { version: 1, payload, checksum };
}

export interface StateWal {
  append(snapshot: EngineSnapshot): void;
  readLatest(): EngineSnapshot | null;
}

export class FileStateWal implements StateWal {
  private readonly _path: string;
  private _lastChecksum: string | null = null;

  constructor(path: string) {
    if (!path || path.trim() === '') throw new TypeError('journal path cannot be empty');
    this._path = path;
    mkdirSync(dirname(path), { recursive: true });
  }

  append(snapshot: EngineSnapshot): void {
    const payload = stableEncode(snapshot);
    const checksum = hashText(payload);
    if (checksum === this._lastChecksum) return;
    const envelope: WalEnvelope = { version: 1, payload, checksum };
    const fd = openSync(this._path, 'a');
    try {
      appendFileSync(fd, `${JSON.stringify(envelope)}\n`, 'utf8');
      fsyncSync(fd);
      this._lastChecksum = checksum;
    } finally {
      closeSync(fd);
    }
  }

  readLatest(): EngineSnapshot | null {
    if (!existsSync(this._path)) return null;
    const lines = readFileSync(this._path, 'utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line || line.trim() === '') continue;
      try {
        const envelope = decodeEnvelope(JSON.parse(line) as unknown);
        if (!envelope || hashText(envelope.payload) !== envelope.checksum) continue;
        const snapshot = decodeSnapshot(envelope.payload);
        if (snapshot) {
          this._lastChecksum = envelope.checksum;
          return snapshot;
        }
      } catch {
        // A torn final line is ignored; the last complete valid record wins.
      }
    }
    return null;
  }
}

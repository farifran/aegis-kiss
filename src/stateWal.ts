import { appendFileSync, existsSync, mkdirSync, readFileSync, openSync, closeSync, fsyncSync } from 'node:fs';
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
  if (!isRecord(tree)) return false;
  if (!isRecord(recordField(tree, 'blocks'))) return false;
  const tipHash = recordField(tree, 'tipHash');
  if (tipHash !== null && typeof tipHash !== 'string') return false;
  if (typeof recordField(tree, 'tipHeight') !== 'number') return false;
  if (!isRecord(recordField(value, 'subscriptions')) || !isRecord(recordField(value, 'txToBlockMap'))) return false;
  if (!isRecord(recordField(value, 'canonicalHeightToHash'))) return false;
  return typeof recordField(value, 'totalAlertsEmitted') === 'bigint'
    && typeof recordField(value, 'lastProcessedMs') === 'bigint'
    && typeof recordField(value, 'eventSequence') === 'bigint';
}

function encodeSnapshot(snapshot: EngineSnapshot): string {
  return JSON.stringify(snapshot, (_key: string, value: unknown) => {
    if (typeof value === 'bigint') return { $bigint: value.toString() };
    return value;
  });
}

function decodeSnapshot(payload: string): EngineSnapshot | null {
  try {
    const value: unknown = JSON.parse(payload, (_key: string, current: unknown) => {
      const bigintValue = isRecord(current) ? recordField(current, '$bigint') : null;
      if (typeof bigintValue === 'string' && isRecord(current) && Object.keys(current).length === 1) {
        return BigInt(bigintValue);
      }
      return current;
    });
    if (!isRecord(value)) return null;
    if (!isEngineSnapshot(value)) return null;
    return value;
  } catch {
    return null;
  }
}

function decodeEnvelope(value: unknown): WalEnvelope | null {
  if (!isRecord(value)) return null;
  const version = recordField(value, 'version');
  const payload = recordField(value, 'payload');
  const checksum = recordField(value, 'checksum');
  if (version !== 1 || typeof payload !== 'string' || typeof checksum !== 'string') return null;
  return {
    version: 1,
    payload,
    checksum
  };
}

export interface StateWal {
  append(snapshot: EngineSnapshot): void;
  readLatest(): EngineSnapshot | null;
}

export class FileStateWal implements StateWal {
  private readonly _path: string;

  constructor(path: string) {
    if (!path || path.trim() === '') throw new TypeError('journal path cannot be empty');
    this._path = path;
    mkdirSync(dirname(path), { recursive: true });
  }

  append(snapshot: EngineSnapshot): void {
    const payload = encodeSnapshot(snapshot);
    const envelope: WalEnvelope = {
      version: 1,
      payload,
      checksum: hashText(payload)
    };
    const line = `${JSON.stringify(envelope)}\n`;
    const fd = openSync(this._path, 'a');
    try {
      appendFileSync(fd, line, 'utf8');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  readLatest(): EngineSnapshot | null {
    if (!existsSync(this._path)) return null;
    const content = readFileSync(this._path, 'utf8');
    const lines = content.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line || line.trim() === '') continue;
      try {
        const envelope = decodeEnvelope(JSON.parse(line) as unknown);
        if (!envelope || hashText(envelope.payload) !== envelope.checksum) continue;
        const snapshot = decodeSnapshot(envelope.payload);
        if (snapshot) return snapshot;
      } catch {
        continue;
      }
    }
    return null;
  }
}

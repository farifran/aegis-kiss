export interface KeyMetadata {
  readonly keyId: string;
  readonly keyMaterial: bigint;
  readonly maxOperations: number;
  readonly expiresAtMs: bigint;
  usageCount: number;
  quarantined: boolean;
}

export interface EncryptedEnvelope {
  readonly keyId: string;
  readonly payloadCipher: bigint;
  readonly checksum: bigint;
  readonly timestampMs: bigint;
}

export interface DecryptedMessage {
  readonly keyId: string;
  readonly payloadPlain: bigint;
  readonly verified: boolean;
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

export class CryptoEnvelopeManager {
  private readonly _keys: Map<string, KeyMetadata>;
  private _masterKeyId: string;
  private _isMasterRotating: boolean;
  private _isSystemActive: boolean;
  private _quarantinedCount: number;
  private _processedCount: number;
  private _rejectedCount: number;

  constructor() {
    this._keys = new Map<string, KeyMetadata>();
    this._masterKeyId = '';
    this._isMasterRotating = false;
    this._isSystemActive = true;
    this._quarantinedCount = 0;
    this._processedCount = 0;
    this._rejectedCount = 0;
  }

  registerKey(keyId: string, keyMaterial: bigint, maxOps: number, ttlMs: bigint): void {
    if (!keyId) throw new TypeError('keyId required');
    if (maxOps <= 0) throw new RangeError('maxOps must be positive');
    if (ttlMs <= 0n) throw new RangeError('ttlMs must be positive');
    const now = BigInt(Date.now());
    const expiresAtMs = now + ttlMs;
    this._keys.set(keyId, { keyId, keyMaterial, maxOperations: maxOps, expiresAtMs, usageCount: 0, quarantined: false });
    if (!this._masterKeyId) {
      this._masterKeyId = keyId;
    }
  }

  setMasterKey(keyId: string): void {
    const k = this._keys.get(keyId);
    if (!k || k.quarantined) throw new Error('invalid master key');
    this._masterKeyId = keyId;
  }

  rotateMasterKey(newKeyId: string): void {
    const k = this._keys.get(newKeyId);
    if (!k || k.quarantined) throw new Error('invalid new master key');
    this._isMasterRotating = true;
    this._masterKeyId = newKeyId;
    this._isMasterRotating = false;
  }

  sealEnvelope(keyId: string, plaintext: bigint, nowMs?: bigint): EncryptedEnvelope | null {
    if (!this._isSystemActive) return null;
    const key = this._keys.get(keyId);
    if (!key) {
      this._rejectedCount++;
      return null;
    }
    const now = nowMs !== undefined ? nowMs : BigInt(Date.now());
    if (key.quarantined || now >= key.expiresAtMs || key.usageCount >= key.maxOperations) {
      if (!key.quarantined) {
        key.quarantined = true;
        this._quarantinedCount++;
      }
      this._rejectedCount++;
      return null;
    }

    key.usageCount++;
    this._processedCount++;

    const xored = (plaintext ^ key.keyMaterial) & 0xFFFFFFFFFFFFFFFFn;
    const cipher = ((xored << 13n) | (xored >> 51n)) & 0xFFFFFFFFFFFFFFFFn;

    let cs = FNV_OFFSET;
    cs = ((cs ^ cipher) * FNV_PRIME) & 0xFFFFFFFFFFFFFFFFn;
    cs = ((cs ^ key.keyMaterial) * FNV_PRIME) & 0xFFFFFFFFFFFFFFFFn;

    if (key.usageCount >= key.maxOperations) {
      key.quarantined = true;
      this._quarantinedCount++;
    }

    return { keyId, payloadCipher: cipher, checksum: cs, timestampMs: now };
  }

  openEnvelope(envelope: EncryptedEnvelope, nowMs?: bigint): DecryptedMessage | null {
    if (!this._isSystemActive) return null;
    const key = this._keys.get(envelope.keyId);
    if (!key || key.quarantined) return null;
    const now = nowMs !== undefined ? nowMs : BigInt(Date.now());
    if (now >= key.expiresAtMs) {
      key.quarantined = true;
      this._quarantinedCount++;
      return null;
    }

    let cs = FNV_OFFSET;
    cs = ((cs ^ envelope.payloadCipher) * FNV_PRIME) & 0xFFFFFFFFFFFFFFFFn;
    cs = ((cs ^ key.keyMaterial) * FNV_PRIME) & 0xFFFFFFFFFFFFFFFFn;
    if (cs !== envelope.checksum) return null;

    const unrotated = ((envelope.payloadCipher >> 13n) | (envelope.payloadCipher << 51n)) & 0xFFFFFFFFFFFFFFFFn;
    const plain = (unrotated ^ key.keyMaterial) & 0xFFFFFFFFFFFFFFFFn;

    return { keyId: envelope.keyId, payloadPlain: plain, verified: true };
  }

  get isSystemActive(): boolean { return this._isSystemActive; }
  get isMasterRotating(): boolean { return this._isMasterRotating; }
  get quarantinedCount(): number { return this._quarantinedCount; }
  get processedCount(): number { return this._processedCount; }
  get rejectedCount(): number { return this._rejectedCount; }
  get masterKeyId(): string { return this._masterKeyId; }
}

export function obterEstadoQuarentenaBitmask(manager: CryptoEnvelopeManager): number {
  let mask = 0;
  if (manager.isSystemActive) mask = mask | 1;
  if (manager.quarantinedCount > 0) mask = mask | 2;
  if (manager.isMasterRotating) mask = mask | 4;
  const qLevel = manager.quarantinedCount > 31 ? 31 : manager.quarantinedCount;
  mask = mask | ((qLevel & 31) << 3);
  return mask;
}

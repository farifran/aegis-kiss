/**
 * Limitador de taxa baseado no algoritmo Token Bucket de alta precisão (offline-first).
 */

export type TokenBucketStatus = number;

export class TokenBucket {
  private capacityBits: bigint;
  private refillRateBitsPerMs: bigint;
  private tokensBits: bigint;
  private lastRefillTimestampMs: bigint;
  private isExhausted = false;

  /**
   * @param capacityMegaBytes - Capacidade máxima do bucket em MegaBytes (MB)
   * @param fillRateMegaBytesPerSec - Taxa de recarga em MegaBytes por segundo (MB/s)
   */
  constructor(capacityMegaBytes: number, fillRateMegaBytesPerSec: number) {
    // 1 MegaByte = 8.388.608 bits (1024 * 1024 * 8)
    const bytesPerMb = 1024n * 1024n;
    const bitsPerMb = bytesPerMb * 8n;

    this.capacityBits = BigInt(Math.floor(capacityMegaBytes)) * bitsPerMb;

    // MB/s -> bits/ms (MegaBytes * 8 * 1024 * 1024 / 1000)
    this.refillRateBitsPerMs = (BigInt(Math.floor(fillRateMegaBytesPerSec)) * bitsPerMb) / 1000n;
    if (this.refillRateBitsPerMs === 0n) {
      this.refillRateBitsPerMs = 1n;
    }

    this.tokensBits = this.capacityBits;
    this.lastRefillTimestampMs = BigInt(Date.now());
  }

  private refillLazy(): void {
    const nowMs = BigInt(Date.now());
    const elapsedMs = nowMs - this.lastRefillTimestampMs;

    if (elapsedMs > 0n) {
      const generatedTokens = elapsedMs * this.refillRateBitsPerMs;
      this.tokensBits += generatedTokens;
      if (this.tokensBits > this.capacityBits) {
        this.tokensBits = this.capacityBits;
      }
      this.lastRefillTimestampMs = nowMs;
    }
  }

  consumeMegaBytes(megaBytes: number): boolean {
    this.refillLazy();
    const requiredBits = BigInt(Math.floor(megaBytes * 1024 * 1024 * 8));

    if (this.tokensBits >= requiredBits) {
      this.tokensBits -= requiredBits;
      this.isExhausted = false;
      return true;
    }

    this.isExhausted = true;
    return false;
  }

  getAvailableTokensBits(): bigint {
    this.refillLazy();
    return this.tokensBits;
  }

  /**
   * Codifica o estado do bucket em uma bitmask de 8 bits:
   * - Bit 0: esgotado (1 = esgotado, 0 = disponível)
   * - Bit 1: em refil ativo (1 = refil ativo)
   * - Bits 2-7: reservados para prioridade (padrão 0)
   */
  encodeStateBitmask(priorityFlags = 0): TokenBucketStatus {
    this.refillLazy();
    let mask = 0;

    if (this.tokensBits < this.capacityBits) {
      mask |= 1 << 1; // Bit 1: refil ativo
    }

    if (this.tokensBits === 0n || this.isExhausted) {
      mask |= 1 << 0; // Bit 0: esgotado
    }

    const priorityBits = (priorityFlags & 0x3f) << 2; // Bits 2-7
    mask |= priorityBits;

    return mask & 0xff;
  }
}

/**
 * Função exportada auxiliar para obter o estado da bitmask do bucket.
 */
export function encodeTokenBucketState(
  bucket: TokenBucket,
  priorityFlags = 0
): TokenBucketStatus {
  return bucket.encodeStateBitmask(priorityFlags);
}

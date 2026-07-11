/**
 * Converts Megabytes (MB) to bits.
 * 1 MB = 1024 * 1024 * 8 bits = 8,388,608 bits
 *
 * @param megabytes - The number of megabytes to convert.
 * @returns The equivalent number of bits.
 */
export function convertMegabytesToBits(megabytes: number): number {
  return megabytes * 8388608;
}

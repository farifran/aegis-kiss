export const BITS_PER_BYTE = 8;

export function scaleMegabits(megabits: number): number {
  return megabits / BITS_PER_BYTE;
}

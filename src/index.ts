export function conversao(bits: number): number {
  return bits * 8 / 1024;
}

export function converterFormula(bits: number): number {
  return bits * 8 / (1024 * 1024 * 1024); // convert bits to gigabytes
}

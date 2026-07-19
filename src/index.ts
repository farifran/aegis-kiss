export function conversao(bits: number): number {
  return bits * 8 / 1024;
}

export function kilobits(bits: number): number {
  return conversao(bits);
}

export function conversao(bits: number): number {
  return bits * 8 / 1024;
}

export function converterFormula(pentabits: number): number {
  return pentabits * 8 / (1024 * 1024 * 1024); // convert pentabits to gigabytes
}

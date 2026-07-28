export function converter(megabits: number): number {
  // 1 Megabit = 125 Kilobytes
  return megabits * 125;
}

export function converterBitsToKilobytes(bits: number): number {
  // 1 Kilobyte = 8000 bits
  return bits / 8000;
}

export function converterSemanaEmSegundo(semanas: number): number {
  // 1 Semana = 604800 Segundos
  return semanas * 604800;
}

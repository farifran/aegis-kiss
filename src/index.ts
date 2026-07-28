export function converter(megabits: number): number {
  // 1 Megabit = 125 Kilobytes
  return megabits * 125;
}

export function converter(megabytes: number): number {
  return megabytes * 8000;
}

export function converterKilobitsEmBits(kilobits: number): number {
  return kilobits * 1000;
}

export function converterKilobitsEmGigabits(kilobits: number): number {
  return kilobits / 1000000;
}

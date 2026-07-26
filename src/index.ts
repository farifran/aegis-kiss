export function converter(megabytes: number): number {
  return megabytes * 8000;
}

export function converterKilobitsEmBits(kilobits: number): number {
  return kilobits * 1000;
}

export function converterKilobitsEmGigabits(kilobits: number): number {
  return kilobits / 1000000;
}

export function converterKilobytesEmGigabits(kilobytes: number): number {
  return kilobytes * 0.000008;
}

export function converterBytesEmBits(bytes: number): number {
  return bytes * 8;
}

export function converterBytesEmKilobits(bytes: number): number {
  return bytes * 8 / 1000;
}

export function converterTerabitsEmPentabits(terabits: number): number {
  return terabits / 1000;
}

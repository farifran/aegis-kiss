export function megabitsToBytes(megabits: number): number {
  return megabits * 125000;
}

export function quadratica(x: number): number {
  return x * x;
}

export function megabitsToKilobits(megabits: number): number {
  return megabits * 1000 / 1024;
}

export function megabitsToGigabits(megabits: number): number {
  return megabits * 1000 / (1024 * 1024);
}

export function power(base: number, exponent: number): number {
  let result = 1;
  for (let i = 0; i < exponent; i++) {
    result *= base;
  }
  return result;
}

export function terabitsToMegabits(terabits: number): number {
  return terabits * 1024 * 1024 * 125000;
}

export function terabitsToGigabits(terabits: number): number {
  return terabits * 1024 * 1024;
}

export function terabitsToBytes(terabits: number): number {
  return terabits * 1024 * 1024 * 125000;
}

export function terabitsToKilobits(terabits: number): number {
  return terabits * 1024 * 1024;
}

export function terabytesToMegabytes(terabytes: number): number {
  return terabytes * 1280000000;
}

export function terabytesToGigabytes(terabytes: number): number {
  return terabytes * 1024 * 1024;
}

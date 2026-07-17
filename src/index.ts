export function quadratica(x: number): number {
  return x * x;
}

export function megabitsToKilobits(megabits: number): number {
  return megabits * 1000 / 1024;
}

export function megabitsToGigabits(megabits: number): number {
  return megabits * 1000 / (1024 * 1024);
}

export function megabitsToBytes(megabits: number): number {
  return megabits * 125000;
}

export function power(base: number, exponent: number): number {
  let result = 1;
  for (let i = 0; i < exponent; i++) {
    result *= base;
  }
  return result;
}

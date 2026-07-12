function mbToBits(megaBytes: number): number {
  return megaBytes * 1024 ** 2 * 8;
}

console.log(mbToBits(1));

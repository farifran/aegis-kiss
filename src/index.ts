function mbToBits(megaBytes: number): number {
  return megaBytes * 1024 ** 2 * 8;
}

function mbToGb(megaBytes: number): number {
  return megaBytes / 1024 / 1024;
}

console.log(mbToBits(1));
console.log(mbToGb(1));

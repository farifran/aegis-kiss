// entire file content ...
// ... goes in between

function megaBytesToBits(megaBytes: number): number {
  return megaBytes * 1024 * 1024 * 8;
}

function bitsToMegaBytes(bits: number): number {
  return bits / (1024 * 1024 * 8);
}

export { megaBytesToBits, bitsToMegaBytes };

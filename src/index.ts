export function converter(kilobits: number): number {
  // 1 Gigabyte = 8,388,608 Kilobits (using binary definitions: 1 GB = 1024^3 Bytes, 1 Kb = 1024 Bits)
  return kilobits / 8388608;
}
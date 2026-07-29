/**
 * Calcula o checksum CRC32 de uma string usando uma tabela de lookup de 256 entradas.
 * @param data - dados de entrada
 * @returns checksum CRC32 de 32 bits
 */
export function calcularCRC32(data: string): number {
  let crc = 0xffffffff;
  const table = new Uint32Array(256);

  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }

  for (let i = 0; i < data.length; i++) {
    const byte = data.charCodeAt(i);
    const tableVal = table[(crc ^ byte) & 0xff] ?? 0;
    crc = (crc >>> 8) ^ tableVal;
  }

  return (crc ^ 0xffffffff) >>> 0;
}

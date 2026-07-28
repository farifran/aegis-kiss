/**
 * Converte semanas em segundos.
 * @param semanas - número de semanas (inteiro positivo)
 * @returns número de segundos correspondente
 */
export function converterSemanaEmSegundo(semanas: number): number {
  const segundosPorMinuto = 60;
  const minutosPorHora = 60;
  const horasPorDia = 24;
  const diasPorSemana = 7;
  return semanas * diasPorSemana * horasPorDia * minutosPorHora * segundosPorMinuto;
}

/**
 * Converte kilobits em pentabytes.
 * 1 pentabyte = 10^15 bytes = 8 * 10^15 bits
 * 1 kilobit = 10^3 bits
 * @param kilobits - número de kilobits (inteiro positivo)
 * @returns número de pentabytes correspondente
 */
export function converterKilobitsEmPentabytes(kilobits: number): number {
  const bitsPorKilobit = 1_000;
  const bitsPorByte = 8;
  const bytesPorPentabyte = 1_000_000_000_000_000; // 10^15
  const bitsPorPentabyte = bytesPorPentabyte * bitsPorByte;
  return (kilobits * bitsPorKilobit) / bitsPorPentabyte;
}

/**
 * Converte megabytes em kilobytes.
 * @param megabytes - número de megabytes (inteiro positivo)
 * @returns número de kilobytes correspondente
 */
export function converterMegabytesEmKilobytes(megabytes: number): number {
  const bytesPorMegabyte = 1_000_000;
  const kilobytesPorMegabyte = bytesPorMegabyte / 1_000;
  return megabytes * kilobytesPorMegabyte;
}

/**
 * Converte horas em minutos.
 * @param horas - número de horas (inteiro positivo)
 * @returns número de minutos correspondente
 */
export function converterHorasEmMinutos(horas: number): number {
  const minutosPorHora = 60;
  if (horas <= 0) {
    return 0;
  }
  return horas * minutosPorHora;
}

/**
 * Converte horas em minutos com investigação.
 * @param horas - número de horas (inteiro positivo)
 * @param investigation - investigação a ser realizada
 * @returns número de minutos correspondente
 */
export function converterHorasEmMinutosInvestigation(horas: number, investigation: string): number {
  const minutosPorHora = 60;
  if (horas <= 0) {
    return 0;
  }
  return horas * minutosPorHora;
}

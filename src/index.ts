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

/**
 * Converte semanas em dias.
 * @param semanas - número de semanas (inteiro positivo)
 * @returns número de dias correspondente
 */
export function converterSemanasEmDias(semanas: number): number {
  const diasPorSemana = 7;
  if (semanas <= 0) {
    return 0;
  }
  return semanas * diasPorSemana;
}

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
export function converterHorasEmMinutosInvestigation(horas: number, _investigation: string): number {
  const minutosPorHora = 60;
  if (horas <= 0) {
    return 0;
  }
  return horas * minutosPorHora;
}

/**
 * Converte fahrenheit para celsius.
 * @param fahrenheit - temperatura em fahrenheit
 * @returns temperatura em celsius
 */
export function converterFahrenheitEmCelsius(fahrenheit: number): number {
  return (fahrenheit - 32) * 5 / 9;
}

/**
 * Calcula o IMC.
 * @param pesoKg - peso em kg
 * @param alturaM - altura em metros
 * @returns IMC
 */
export function calcularIMC(pesoKg: number, alturaM: number): number {
  return pesoKg / (alturaM * alturaM);
}

/**
 * Valida o tamanho da senha.
 * @param senha - senha a ser validada
 * @param minLength - mínimo de caracteres exigidos
 * @returns true se a senha atende ao requisito de tamanho, false caso contrário
 */
export function validarTamanhoSenha(senha: string, minLength: number): boolean {
  return senha.length >= minLength;
}

/**
 * Formata o valor em moeda BRL.
 * @param valor - valor a ser formatado
 * @returns valor formatado em moeda BRL
 */
export function formatarMoedaBRL(valor: number): string {
  return `R$ ${valor.toFixed(2)}`;
}

/**
 * Remove duplicados de um array.
 * @param arr - array a ser processado
 * @returns array sem duplicados
 */
export function removerDuplicadosArray(arr: number[]): number[] {
  return [...new Set(arr)];
}

/**
 * Função de rate limiting com janela deslizante.
 * @param timestamps - array de timestamps
 * @param limit - limite de requisições
 * @param windowMs - janela de tempo em milissegundos
 * @returns true se o limite não foi atingido, false caso contrário
 */
export function rateLimiterSlidingWindow(timestamps: number[], limit: number, windowMs: number): boolean {
  // Implementação da função de rate limiting com janela deslizante
  // ...
  return true;
}

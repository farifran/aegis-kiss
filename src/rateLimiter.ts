/**
 * Função de rate limiting com janela deslizante.
 * @param timestamps - array de timestamps
 * @param limit - limite de requisições
 * @param windowMs - janela de tempo em milissegundos
 * @returns true se o limite não foi atingido, false caso contrário
 */
export function rateLimiterSlidingWindow(timestamps: number[], limit: number, windowMs: number): boolean {
  const agora = Date.now();
  const dentroDaJanela = timestamps.filter((t) => agora - t <= windowMs);
  return dentroDaJanela.length <= limit;
}

export function converterSegundosEmMilissegundos(segundos: number): number {
  return segundos * 1000;
}

export function converterSemanasEmSegundos(semanas: number): number {
  return semanas * 604800;
}

export function converterDiasEmSegundos(dias: number): number {
  return dias * 86400;
}

export function converterBytesEmKilobits(bytes: number): number {
  return bytes * 8 / 1000;
}

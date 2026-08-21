type PricingContext = { precoCusto: number; estoqueAtual: number; acessosPorMinuto: number; categoriaFidelidade: string; localizacao: string; precosConcorrentes: number[] };
type PricingStrategy = { name: string; apply: (currentPrice: number, context: PricingContext) => number };

export class PricingEngine {
  private _margemMinima: number;
  private _strategies: PricingStrategy[];

  constructor(margemMinima: number) {
    if (margemMinima < 0) throw new Error("margemMinima must be non-negative")
    this._margemMinima = margemMinima
    this._strategies = []
  }

  addStrategy(strategy: PricingStrategy): void {
    this._strategies.push(strategy)
  }

  calculatePrice(precoInicial: number, contexto: PricingContext): number {
    let precoAtual = precoInicial
    for (const s of this._strategies) {
    precoAtual = s.apply(precoAtual, contexto)
    }
    const precoMinimo = contexto.precoCusto * (1 + this._margemMinima)
    if (precoAtual < precoMinimo) { precoAtual = precoMinimo }
    return Math.round(precoAtual * 100) / 100
  }

  get margemMinima(): number { return this._margemMinima }

  get strategyCount(): number { return this._strategies.length }
}

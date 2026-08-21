type PricingContext = { precoCusto: number; estoqueAtual: number; acessosPorMinuto: number; categoriaFidelidade: string; localizacao: string; precosConcorrentes: number[] };
type PricingStrategy = { name: string; apply: (currentPrice: number, context: PricingContext) => number };

export class PricingEngine {
  private _margemMinima: number;
  private _strategies: PricingStrategy[];

  constructor(margemMinima: number) {
    if (margemMinima < 0) throw new Error("margemMinima must be non-negative");
    this._margemMinima = margemMinima;
    this._strategies = [];
  }

  addStrategy(strategy: PricingStrategy): void {
    this._strategies.push(strategy);
  }

  calculatePrice(precoInicial: number, contexto: PricingContext): number {
    let precoAtual = precoInicial;
    for (const s of this._strategies) {
      precoAtual = s.apply(precoAtual, contexto);
    }
    const precoMinimo = contexto.precoCusto * (1 + this._margemMinima);
    if (precoAtual < precoMinimo) {
      precoAtual = precoMinimo;
    }
    return Math.round(precoAtual * 100) / 100;
  }

  get margemMinima(): number {
    return this._margemMinima;
  }

  get strategyCount(): number {
    return this._strategies.length;
  }
}

export function createStandardPricingEngine(margemMinima: number): PricingEngine {
  const engine = new PricingEngine(margemMinima);
  engine.addStrategy({
    name: "ScarcityStrategy",
    apply: (p: number, ctx: PricingContext) => (ctx.estoqueAtual < 10 ? p * 1.12 : p),
  });
  engine.addStrategy({
    name: "DemandElasticityStrategy",
    apply: (p: number, ctx: PricingContext) => (ctx.acessosPorMinuto > 500 ? p * 1.05 : p),
  });
  engine.addStrategy({
    name: "CompetitorMatchStrategy",
    apply: (p: number, ctx: PricingContext) => {
      if (!ctx.precosConcorrentes || ctx.precosConcorrentes.length === 0) return p;
      const primeiro = ctx.precosConcorrentes[0];
      if (primeiro === undefined) return p;
      let menor: number = primeiro;
      for (const c of ctx.precosConcorrentes) {
        if (c !== undefined && c < menor) menor = c;
      }
      const alvo = menor * 0.99;
      const piso = ctx.precoCusto * (1 + margemMinima);
      const candidato = alvo < piso ? piso : alvo;
      return candidato < p ? candidato : p;
    },
  });
  return engine;
}

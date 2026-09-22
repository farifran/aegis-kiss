const sourceEvidenceByteLimit = 32_768;
const sourceEvidenceFileByteLimit = 8_192;
const policySignalSemantics = {
  verdict: 'SEMANTIC_NOT_LEXICAL',
  assessment: 'REQUIRED_FOR_EACH_SIGNAL_RULE',
  residualReview: 'SEPARATE_FROM_POLICY_ASSESSMENT',
};
const determinismDimensionKinds = [
  'ORDERING',
  'CANONICALIZATION',
  'DUPLICATES',
  'EMPTY_INPUT',
  'ODD_CARDINALITY',
  'ROUNDING',
  'REMAINDER_DISTRIBUTION',
  'ZERO_DIVISOR',
  'TIE_BREAKING',
  'COUNTING_IDENTITY',
  'BOUNDED_ARITHMETIC',
];
const counterexampleByDimension = {
  ORDERING: {
    inputClass: 'PERMUTED_EQUIVALENT_INPUTS',
    baseline: 'Elementos equivalentes na ordem [A, B].',
    variation: 'Os mesmos elementos na ordem [B, A].',
  },
  CANONICALIZATION: {
    inputClass: 'EQUIVALENT_REPRESENTATIONS',
    baseline: 'Um valor lógico na representação A.',
    variation: 'O mesmo valor lógico na representação B.',
  },
  DUPLICATES: {
    inputClass: 'DUPLICATED_ELEMENT',
    baseline: 'Coleção [A].',
    variation: 'Coleção [A, A].',
  },
  EMPTY_INPUT: {
    inputClass: 'EMPTY_COLLECTION',
    baseline: 'Coleção com um elemento válido.',
    variation: 'Coleção vazia.',
  },
  ODD_CARDINALITY: {
    inputClass: 'THREE_ELEMENTS',
    baseline: 'Coleção com dois elementos.',
    variation: 'Coleção com três elementos.',
  },
  ROUNDING: {
    inputClass: 'NON_EXACT_DIVISION',
    baseline: 'Divisão inteira exata 4/2.',
    variation: 'Divisão inteira não exata 5/2.',
  },
  REMAINDER_DISTRIBUTION: {
    inputClass: 'MULTIPLE_RECIPIENTS_WITH_REMAINDER',
    baseline: 'Dois destinatários sem resto.',
    variation: 'Dois destinatários com uma unidade de resto.',
  },
  ZERO_DIVISOR: {
    inputClass: 'ZERO_DENOMINATOR',
    baseline: 'Divisão 1/1.',
    variation: 'Divisão 1/0.',
  },
  TIE_BREAKING: {
    inputClass: 'EQUAL_PRIORITY_CANDIDATES',
    baseline: 'Dois candidatos com prioridades distintas.',
    variation: 'Os mesmos candidatos com prioridade igual.',
  },
  COUNTING_IDENTITY: {
    inputClass: 'DUPLICATED_IDENTITY_OCCURRENCES',
    baseline: 'Identidades [A, B].',
    variation: 'Ocorrências [A, A, B].',
  },
  BOUNDED_ARITHMETIC: {
    inputClass: 'OUTSIDE_REPRESENTABLE_RANGE',
    baseline: 'Maior valor representável.',
    variation: 'Uma unidade acima do maior valor representável.',
  },
};
const dimensionTriggerPattern = {
  ORDERING: /\b(?:ordem|orden\p{L}*|permut\p{L}*|travers\p{L}*|order\p{L}*)\b/iu,
  CANONICALIZATION: /\b(?:canoni\p{L}*|codifica\p{L}*|serializa\p{L}*|representa\p{L}*|encod\p{L}*)\b/iu,
  DUPLICATES: /\b(?:duplic\p{L}*|repetid\p{L}*|duplicate\p{L}*)\b/iu,
  EMPTY_INPUT: /\b(?:vazi\p{L}*|empty|null|nulo)\b/iu,
  ODD_CARDINALITY: /(?:[ií]mpar|\b(?:odd|merkle|bin[aá]ri\p{L}*)\b)/iu,
  ROUNDING: /\b(?:arredond\p{L}*|trunc\p{L}*|divis\p{L}*|round\p{L}*)\b/iu,
  REMAINDER_DISTRIBUTION: /\b(?:resto|res[ií]du\p{L}*|remainder)\b/iu,
  ZERO_DIVISOR: /\b(?:divis\p{L}*\s+(?:por\s+)?zero|zero\s+divisor|zero\s+denominator|denominador\s+(?:igual\s+a\s+)?zero)\b/iu,
  TIE_BREAKING: /\b(?:empat\p{L}*|tie(?:-?break\p{L}*)?|prioridade\s+igual)\b/iu,
  COUNTING_IDENTITY: /\b(?:conta(?:gem|r)|quantidade|participante\p{L}*|identidade\p{L}*|unique\p{L}*)\b/iu,
  BOUNDED_ARITHMETIC: /\b(?:bits?|bitmask|overflow|underflow|satura\p{L}*|limit\p{L}*|bounded)\b/iu,
};
const structuralAbsencePattern = /\b(?:n[aã]o\s+(?:exist\p{L}*|aceit\p{L}*|admit\p{L}*|possu\p{L}*|cont[eé]m)|ausente\p{L}*|proibid\p{L}*|exclu[ií]d\p{L}*|rejeitad\p{L}*|imposs[ií]ve\p{L}*|forbidden|excluded|rejected|absent)\b/iu;
const structuralRulePattern = {
  OPERATION_ABSENT: /\b(?:n[aã]o\s+(?:exist\p{L}*|possu\p{L}*|cont[eé]m)|ausente\p{L}*|imposs[ií]ve\p{L}*|absent)\b/iu,
  INPUT_CLASS_FORBIDDEN: /\b(?:n[aã]o\s+(?:aceit\p{L}*|admit\p{L}*)|proibid\p{L}*|rejeitad\p{L}*|forbidden|rejected)\b/iu,
  INPUT_SCHEMA_EXCLUDES_CLASS: /\b(?:schema|esquema)\b[^.!?\n]{0,120}\b(?:exclu[ií]d\p{L}*|n[aã]o\s+(?:aceit\p{L}*|admit\p{L}*)|excluded)\b/iu,
};
const explicitRejectionPattern = /\b(?:rejeit\p{L}*|recus\p{L}*|falha\p{L}*|inv[aá]lid\p{L}*|reject\p{L}*|error|failure)\b/iu;
const requestedBehaviorRemovalPattern = /\b(?:sempre\s+desativ\p{L}*|permanec\p{L}*\s+sempre\s+desativ\p{L}*|n[aã]o\s+deve\s+(?:exigir|executar|produzir|expor|calcular)|remov\p{L}*|omit\p{L}*|nenhum\p{L}*\s+(?:c[aá]lculo|resultado|efeito|indicador|compara(?:ç|c)[aã]o))\b/iu;
const dimensionResolutionRules = {
  ORDERING: {
    INPUT_ORDER_PRESERVED: { relation: 'DEFINED_RESULT', parameter: false },
    CANONICAL_ORDER: { relation: 'OUTPUTS_EQUAL', parameter: true },
    PERMUTATION_INVARIANT: { relation: 'OUTPUTS_EQUAL', parameter: false },
  },
  CANONICALIZATION: {
    CANONICAL_REPRESENTATION: { relation: 'OUTPUTS_EQUAL', parameter: true },
  },
  DUPLICATES: {
    DUPLICATES_PRESERVED: { relation: 'DEFINED_RESULT', parameter: false },
    DUPLICATES_MERGED: { relation: 'DEFINED_RESULT', parameter: true },
    DUPLICATES_REJECTED: { relation: 'EXPLICIT_REJECTION', parameter: false },
  },
  EMPTY_INPUT: {
    EMPTY_RETURNS_IDENTITY: { relation: 'DEFINED_RESULT', parameter: true },
    EMPTY_REJECTED: { relation: 'EXPLICIT_REJECTION', parameter: false },
  },
  ODD_CARDINALITY: {
    ODD_DUPLICATE_LAST: { relation: 'DEFINED_RESULT', parameter: false },
    ODD_PROMOTE_LAST: { relation: 'DEFINED_RESULT', parameter: false },
    ODD_REJECTED: { relation: 'EXPLICIT_REJECTION', parameter: false },
  },
  ROUNDING: {
    ROUND_TRUNCATE_TOWARD_ZERO: { relation: 'DEFINED_RESULT', parameter: false },
    ROUND_FLOOR: { relation: 'DEFINED_RESULT', parameter: false },
    ROUND_CEILING: { relation: 'DEFINED_RESULT', parameter: false },
    ROUND_EXACT_ONLY: { relation: 'EXPLICIT_REJECTION', parameter: false },
  },
  REMAINDER_DISTRIBUTION: {
    REMAINDER_RETAINED: { relation: 'DEFINED_RESULT', parameter: false },
    REMAINDER_DISTRIBUTED_BY_RULE: { relation: 'DEFINED_RESULT', parameter: true },
    REMAINDER_REJECTED: { relation: 'EXPLICIT_REJECTION', parameter: false },
  },
  ZERO_DIVISOR: {
    ZERO_DIVISOR_REJECTED: { relation: 'EXPLICIT_REJECTION', parameter: false },
    ZERO_DIVISOR_RETURNS_ZERO: { relation: 'DEFINED_RESULT', parameter: false },
    ZERO_DIVISOR_RETURNS_SENTINEL: { relation: 'DEFINED_RESULT', parameter: true },
  },
  TIE_BREAKING: {
    TIE_BREAK_BY_KEY: { relation: 'DEFINED_RESULT', parameter: true },
    TIE_PRESERVE_INPUT_ORDER: { relation: 'DEFINED_RESULT', parameter: false },
  },
  COUNTING_IDENTITY: {
    COUNT_UNIQUE_IDENTITIES: { relation: 'DEFINED_RESULT', parameter: true },
    COUNT_OCCURRENCES: { relation: 'DEFINED_RESULT', parameter: false },
  },
  BOUNDED_ARITHMETIC: {
    OVERFLOW_REJECT: { relation: 'EXPLICIT_REJECTION', parameter: false },
    OVERFLOW_SATURATE: { relation: 'DEFINED_RESULT', parameter: true },
    OVERFLOW_WRAP: { relation: 'DEFINED_RESULT', parameter: true },
    OVERFLOW_MODULO: { relation: 'DEFINED_RESULT', parameter: true },
  },
};
const dimensionActivationPatterns = {
  ORDERING: /\b(?:arvore|tree|sequencia|sequence|ordenacao|ordering|permutacao|permutation)\b/u,
  CANONICALIZATION: /\b(?:hash|serializacao|serialization|codificacao|encoding|representacao canonica|canonical representation)\b/u,
  DUPLICATES: /\b(?:arvore|tree|colecao|collection|lote|batch)\b/u,
  EMPTY_INPUT: /\b(?:arvore|tree|colecao|collection|lote|batch)\b/u,
  ODD_CARDINALITY: /\b(?:arvore binaria|binary tree)\b/u,
  ROUNDING: /\b(?:fracion\p{L}*|fraction\p{L}*|divis\p{L}*|ratio|razao|bigint)\b/u,
  REMAINDER_DISTRIBUTION: /\b(?:fracion\p{L}*|fraction\p{L}*|divis\p{L}*|resto|remainder|residu\p{L}*)\b/u,
  ZERO_DIVISOR: /\b(?:divis\p{L}*|denominador|denominator|ratio|razao)\b/u,
  TIE_BREAKING: /\b(?:ciclo\p{L}*|cycle\p{L}*|prioridade|priority|ranking)\b/u,
  COUNTING_IDENTITY: /\b(?:quantidade|contagem|contador\p{L}*|count|counter|participante\p{L}*)\b/u,
};
const resolutionEvidenceTerms = {
  INPUT_ORDER_PRESERVED: [/ordem\s+(?:de\s+)?entrada|input\s+order/iu],
  CANONICAL_ORDER: [/ordem|order|sort/iu, /can[oô]nic\p{L}*|alfab[eé]tic\p{L}*|lexicogr[aá]fic\p{L}*/iu],
  PERMUTATION_INVARIANT: [/permut\p{L}*/iu, /invari\p{L}*|mesm\p{L}*|igual\p{L}*/iu],
  CANONICAL_REPRESENTATION: [/representa\p{L}*|codifica\p{L}*|serializa\p{L}*|encod\p{L}*/iu, /can[oô]nic\p{L}*/iu],
  DUPLICATES_PRESERVED: [/duplic\p{L}*/iu, /preserv\p{L}*/iu],
  DUPLICATES_MERGED: [/duplic\p{L}*/iu, /mescl\p{L}*|consolid\p{L}*|agreg\p{L}*|deduplic\p{L}*|merge\p{L}*/iu],
  DUPLICATES_REJECTED: [/duplic\p{L}*/iu, /rejeit\p{L}*|reject\p{L}*/iu],
  EMPTY_RETURNS_IDENTITY: [/vazi\p{L}*|empty/iu, /identidade|identity/iu],
  EMPTY_REJECTED: [/vazi\p{L}*|empty/iu, /rejeit\p{L}*|reject\p{L}*/iu],
  ODD_DUPLICATE_LAST: [/[ií]mpar|odd/iu, /duplic\p{L}*/iu, /[uú]ltim\p{L}*|last/iu],
  ODD_PROMOTE_LAST: [/[ií]mpar|odd/iu, /promov\p{L}*|promote\p{L}*/iu, /[uú]ltim\p{L}*|last/iu],
  ODD_REJECTED: [/[ií]mpar|odd/iu, /rejeit\p{L}*|reject\p{L}*/iu],
  ROUND_TRUNCATE_TOWARD_ZERO: [/trunc\p{L}*/iu, /zero/iu],
  ROUND_FLOOR: [/arredond\p{L}*|round\p{L}*|floor/iu, /baixo|inferior|floor/iu],
  ROUND_CEILING: [/arredond\p{L}*|round\p{L}*|ceiling/iu, /cima|superior|ceiling/iu],
  ROUND_EXACT_ONLY: [/exat\p{L}*|exact/iu, /rejeit\p{L}*|exig\p{L}*|reject\p{L}*|require\p{L}*/iu],
  REMAINDER_RETAINED: [/resto|res[ií]du\p{L}*|remainder/iu, /retid\p{L}*|mantid\p{L}*|retain\p{L}*/iu],
  REMAINDER_DISTRIBUTED_BY_RULE: [/resto|res[ií]du\p{L}*|remainder/iu, /distribu\p{L}*/iu],
  REMAINDER_REJECTED: [/resto|res[ií]du\p{L}*|remainder/iu, /rejeit\p{L}*|reject\p{L}*/iu],
  ZERO_DIVISOR_REJECTED: [/divis\p{L}*|denominador|denominator/iu, /zero/iu, /rejei\p{L}*|reject\p{L}*/iu],
  ZERO_DIVISOR_RETURNS_ZERO: [/divis\p{L}*|denominador|denominator/iu, /zero/iu, /retorn\p{L}*|produz\p{L}*|return\p{L}*/iu],
  ZERO_DIVISOR_RETURNS_SENTINEL: [/divis\p{L}*|denominador|denominator/iu, /zero/iu, /sentinela|sentinel/iu],
  TIE_BREAK_BY_KEY: [/empat\p{L}*|tie/iu, /chave|key/iu],
  TIE_PRESERVE_INPUT_ORDER: [/empat\p{L}*|tie/iu, /ordem\s+(?:de\s+)?entrada|input\s+order/iu],
  COUNT_UNIQUE_IDENTITIES: [/cont\p{L}*|quantidade|count/iu, /identidade\p{L}*|participante\p{L}*|identit\p{L}*/iu, /[uú]nic\p{L}*|unique/iu],
  COUNT_OCCURRENCES: [/cont\p{L}*|quantidade|count/iu, /ocorr[eê]nci\p{L}*|occurrence\p{L}*/iu],
  OVERFLOW_REJECT: [/overflow|acima\s+d\p{L}+\s+limit\p{L}*|maior\s+valor\s+represent[aá]vel/iu, /rejeit\p{L}*|reject\p{L}*/iu],
  OVERFLOW_SATURATE: [/overflow|acima\s+d\p{L}+\s+limit\p{L}*|maior\s+valor\s+represent[aá]vel/iu, /satur\p{L}*/iu],
  OVERFLOW_WRAP: [/overflow|acima\s+d\p{L}+\s+limit\p{L}*/iu, /wrap|circular/iu],
  OVERFLOW_MODULO: [/overflow|acima\s+d\p{L}+\s+limit\p{L}*/iu, /m[oó]dulo|modulo/iu],
};
const explicitUncertaintyPattern = /\b(?:acima\s+de|abaixo\s+de|maior\s+que|menor\s+que|escolh\p{L}*|defin\p{L}*|ainda|alternativ\p{L}*|ou|either|choose|undefined|unspecified)\b/iu;
const incompleteOperandPattern = /\(\s*\)|``|\b(?:acima\s+de|abaixo\s+de|maior\s+que|menor\s+que|above|below|greater\s+than|less\s+than)\s*(?=[.,;:!?)]|$)/iu;
const explicitAlternativePattern = /\b(?:ou|alternativ\p{L}*|escolh\p{L}*|either|or|choose)\b/iu;
const publicInterfaceIntentPattern = /\b(?:fun(?:ç|c)[aã]o\s+(?:pura|p[uú]blica)|public\s+function|api\s+p[uú]blica|re-?exportad\p{L}*|public\s+api)\b/iu;
const explicitInterfaceDefinitionPattern = /(?:\b(?:assinatura|signature|interface|data\s+model|modelo\s+de\s+dados)\b[^.!?\n]{0,240}\b(?:retorn\p{L}*|returns?|sa[ií]da|output|falha|erro|error)\b|\b(?:fun(?:ç|c)[aã]o|function)\s+[\p{L}_$][\p{L}\p{N}_$]*\s*\([^)]*\)\s*(?:->|:)|\b(?:recebe|accepts?|inputs?)\b[^.!?\n]{0,240}\b(?:retorn\p{L}*|returns?|sa[ií]da|output)\b)/iu;
const publicInterfaceGapPattern = /\b(?:assinatura|signature|interface\s+p[uú]blica|modelo\s+de\s+dados|data\s+model|entradas?\s+e\s+sa[ií]das?|inputs?\s+and\s+outputs?|par[aâ]metros?\s+p[uú]blicos?|public\s+parameters?)\b/iu;
const cryptographicSmallHashPattern = /\bcriptogr[aá]fic\p{L}*\b[^.!?\n]{0,180}\b(?:32|64|96|128)\s*bits?\b|\b(?:32|64|96|128)\s*bits?\b[^.!?\n]{0,180}\bcriptogr[aá]fic\p{L}*\b/iu;
const hashRiskPattern = /\b(?:colis(?:ão|oes|ões)|collision|segunda\s+preimagem|second\s+preimage|criptogr[aá]fic\p{L}*|adversarial)\b/iu;
const hashSecurityDecisionPattern = /\b(?:fingerprint|n[aã]o\s+criptogr[aá]fic\p{L}*|non[- ]?cryptographic|criptogr[aá]fic\p{L}*|cryptographic|colis(?:ão|oes|ões)|collision|segunda\s+preimagem|second\s+preimage)\b/iu;
const thresholdRiskPattern = /\b(?:limiar|threshold)\b/iu;
const injectiveInvariantPattern = /\b(?:injetiv\p{L}*|injective)\b/iu;
const retainedResidualPattern = /\b(?:resto|res[ií]du\p{L}*|remainder)\b[^.!?\n]{0,140}\b(?:retid\p{L}*|mantid\p{L}*|retain\p{L}*|n[aã]o\s+liquid\p{L}*)\b/iu;
const conservationInvariantPattern = /\b(?:conserv\p{L}*|soma\s+total|total\s+sum|balance\p{L}*|igual|equal|diferen(?:ç|c)a\s+n[aã]o\s+nula)\b/iu;
const feasibilityRiskPattern = /\b(?:viabil\p{L}*|feasibility|evid[eê]nci\p{L}*|medi(?:ç|c)[aã]o|measurement|perfilamento|profiling|aloca(?:ç|c)(?:ão|ões)|lat[eê]ncia|throughput|desempenho|performance)\b/iu;
const mechanicalDimensionPolicyIds = {
  ROUNDING: 'ARCH-BIGINT-ARITHMETIC',
  ZERO_DIVISOR: 'ARCH-BIGINT-ARITHMETIC',
  BOUNDED_ARITHMETIC: 'ARCH-OBSERVABILITY-COUNTERS',
};
const concreteResolutionParameterPatterns = {
  CANONICAL_ORDER: /(?=.*\b(?:alfab[eé]tic\p{L}*|lexicogr[aá]fic\p{L}*|crescente|decrescente|ascending|descending|min(?:im\p{L}*)?|m[aá]xim\p{L}*)\b)(?=.*\b(?:id|identificador|identifier|chave|key|campo\s+[\p{L}\p{N}_-]+|field\s+[\p{L}\p{N}_-]+)\b)/isu,
  CANONICAL_REPRESENTATION: /(?=.*\b(?:json|utf-?8|cbor|protobuf|big[- ]endian|little[- ]endian|bin[aá]ri\p{L}*\s+fix\p{L}*|textual)\b)(?=.*\b(?:ordem\s+(?:fixa|de\s+campos)|fixed\s+field\s+order|length[- ]?prefix\p{L}*|prefixo\s+de\s+comprimento|delimit\p{L}*|separador\p{L}*|tag\p{L}*)\b)/isu,
  DUPLICATES_MERGED: /(?=.*\b(?:id|identificador|identifier|chave|key)\b)(?=.*\b(?:som\p{L}*|m[ií]nim\p{L}*|m[aá]xim\p{L}*|primeir\p{L}*|[uú]ltim\p{L}*|merge\p{L}*\s+por\s+[\p{L}\p{N}_-]+)\b)/isu,
  EMPTY_RETURNS_IDENTITY: /(?:\b0x[0-9a-f]+\b|\b-?\d+n\b|\bhash\s*\([^)]*(?:vazi\p{L}*|empty)[^)]*\))/iu,
  REMAINDER_DISTRIBUTED_BY_RULE: /\b(?:maior\s+resto|largest\s+remainder|ordem\s+(?:de\s+)?entrada|input\s+order|menor\s+(?:id|identificador)|smallest\s+(?:id|identifier))\b/iu,
  ZERO_DIVISOR_RETURNS_SENTINEL: /\b(?:null|undefined|nan|none|0x[0-9a-f]+|-?\d+n?)\b/iu,
  TIE_BREAK_BY_KEY: /\b(?:id|identificador|identifier|chave\s+[\p{L}\p{N}_-]+|key\s+[\p{L}\p{N}_-]+)\b/iu,
  COUNT_UNIQUE_IDENTITIES: /\b(?:id|identificador|identifier|conta|account|endere(?:ç|c)o|address)\b/iu,
  OVERFLOW_SATURATE: /\b(?:\d+|2\s*\^\s*\d+\s*-\s*1|m[aá]xim\p{L}*\s+represent[aá]vel|maior\s+valor\s+represent[aá]vel)\b/iu,
  OVERFLOW_WRAP: /\b(?:\d+|2\s*\^\s*\d+|largura\s+de\s+\d+\s*bits?|\d+\s*bits?)\b/iu,
  OVERFLOW_MODULO: /\b(?:\d+|2\s*\^\s*\d+|m[oó]dulo\s+\d+)\b/iu,
};

function normalizedObservableText(text) {
  return text.normalize('NFC')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/gu, ' ')
    .replace(/[.,;:!?]+$/gu, '')
    .trim();
}

function matchingDimensionResolutions(kind, text) {
  const allowedKinds = Object.keys(dimensionResolutionRules[kind] ?? {});
  return allowedKinds.filter((resolutionKind) => (
    resolutionEvidenceTerms[resolutionKind]?.every((pattern) => pattern.test(text))
  ));
}

function decisionResolutionIsConcrete(kind, text) {
  const matches = matchingDimensionResolutions(kind, text);
  if (matches.length !== 1) return false;
  const resolutionKind = matches[0];
  if (dimensionResolutionRules[kind][resolutionKind].parameter !== true) return true;
  return concreteResolutionParameterPatterns[resolutionKind]?.test(text) === true;
}

function mechanicalPolicyForDimension(dimension, subjectText, intent) {
  const policyId = mechanicalDimensionPolicyIds[dimension.kind];
  if (policyId === undefined) return null;
  if ((dimension.kind === 'ROUNDING' || dimension.kind === 'ZERO_DIVISOR')
    && !/\bbigint\b/iu.test(intent)) return null;
  if ((dimension.kind === 'ROUNDING' || dimension.kind === 'ZERO_DIVISOR')
    && /(?:\b(?:escolh\p{L}*|alternativ\p{L}*|choose|alternative)\b[^.!?\n]{0,100}\b(?:arredond\p{L}*|trunc\p{L}*|divis\p{L}*|denominador|round\p{L}*|zero)\b|\b(?:arredondamento|rounding|divisor\s+zero|zero\s+divisor)\b[^.!?\n]{0,100}\b(?:ou|or|versus|vs\.?|alternativ\p{L}*)\b)/iu
      .test(intent)) return null;
  if (dimension.kind === 'BOUNDED_ARITHMETIC'
    && !/\b(?:bitmask|observabilidade|telemetria|observability|telemetry)\b/iu
      .test(subjectText)) return null;
  if (dimension.kind === 'BOUNDED_ARITHMETIC'
    && /(?:\b(?:escolh\p{L}*|alternativ\p{L}*|choose|alternative)\b[^.!?\n]{0,100}\b(?:overflow|satura\p{L}*|rejeit\p{L}*|wrap|fora\s+da\s+faixa)\b|\b(?:overflow|fora\s+da\s+faixa)\b[^.!?\n]{0,100}\b(?:ou|or|versus|vs\.?|alternativ\p{L}*)\b[^.!?\n]{0,100}\b(?:satura\p{L}*|rejeit\p{L}*|wrap)\b)/iu
      .test(intent)) return null;
  return policyId;
}

function hasMatureAlternativesForIncompleteOperand(unknown, intent, decision) {
  const userReferences = unknown.basis
    .filter(({ source }) => source === 'USER_INTENT')
    .map(({ reference }) => reference);
  if (!userReferences.some((reference) => incompleteOperandPattern.test(reference))) return true;
  if (userReferences.some((reference) => (
    explicitAlternativePattern.test(reference) && intent.includes(reference)
  ))) return true;
  return decision.answers.every(({ contractEffect }) => (
    /\b(?:configura(?:ç|c)[aã]o|configur[aá]vel|par[aâ]metro|argumento|fornecid\p{L}*|configuration|parameter|argument|provided)\b/iu
      .test(contractEffect)
  ));
}

function hasDisjunctiveOutcome(text) {
  const withoutAtomicComparators = normalizedObservableText(text)
    .replace(/\b(?:maior|menor)\s+ou\s+igual(?:\s+a)?\b/giu, '')
    .replace(/\b(?:greater|less)\s+than\s+or\s+equal(?:\s+to)?\b/giu, '')
    .replace(/\b(?:um|uma|one)\s+(?:ou|or)\s+(?:mais|more)\b/giu, '');
  return /\b(?:ou|or|either)\b|\s\/\s/iu.test(withoutAtomicComparators);
}

function hasUnresolvedExpression(text) {
  for (const match of text.matchAll(/\(\s*\)/gu)) {
    const preceding = match.index === 0 ? '' : text[match.index - 1];
    const following = text.slice(match.index + match[0].length);
    if (/[\p{L}\p{N}_$\]})]/u.test(preceding) || /^\s*=>/u.test(following)) continue;
    return true;
  }
  return /(?<!`)``(?!`)/u.test(text)
    || /\b(?:acima\s+de|abaixo\s+de|maior\s+que|menor\s+que|above|below|greater\s+than|less\s+than)\s*(?=[.,;:!?)]|$)/iu.test(text);
}

function isBareDeterminismAssertion(text) {
  const normalized = text.normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('pt-BR');
  return /\bmesm[ao]\s+entrada\b[^.!?\n]{0,120}\bmesm[ao]\s+(?:saida|resultado)\b/u.test(normalized)
    || /\bsame\s+input\b[^.!?\n]{0,120}\bsame\s+(?:output|result)\b/u.test(normalized)
    || /\b(?:total\s+)?determinismo\b/u.test(normalized)
    || /\b(?:totalmente\s+)?deterministic[oa]s?\b/u.test(normalized)
    || /\b(?:fully\s+)?deterministic\b/u.test(normalized);
}

function observableIsGeneric(text) {
  const normalized = text.normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return /^(?:o |a )?(?:resultado|saida|comportamento|estado|determinismo)(?: publico| final| total)?$/u
    .test(normalized);
}

function proofConclusion(obligation) {
  const parameter = obligation.resolutionParameter === null
    ? ''
    : ` (${obligation.resolutionParameter})`;
  return `Base: ${obligation.baselineOutcome}; Variação: ${obligation.variationOutcome}; Resolução: ${obligation.resolutionKind}${parameter}.`;
}

function proofObligationMatchesDimension(dimension, proof) {
  const obligation = dimension.proofObligation;
  if (obligation === null || obligation === undefined) return false;
  const resolutionRule = dimensionResolutionRules[dimension.kind]?.[obligation.resolutionKind];
  if (resolutionRule === undefined || obligation.relation !== resolutionRule.relation) return false;
  const evidenceTerms = resolutionEvidenceTerms[obligation.resolutionKind];
  if (evidenceTerms === undefined
    || evidenceTerms.some((pattern) => !pattern.test(dimension.rationale))) return false;
  const hasParameter = obligation.resolutionParameter !== null;
  if (hasParameter !== resolutionRule.parameter) return false;
  if (observableIsGeneric(obligation.baselineOutcome)
    || observableIsGeneric(obligation.variationOutcome)
    || proof.then.normalize('NFC') !== proofConclusion(obligation).normalize('NFC')) {
    return false;
  }
  if (obligation.relation === 'OUTPUTS_EQUAL'
    && normalizedObservableText(obligation.baselineOutcome)
      !== normalizedObservableText(obligation.variationOutcome)) {
    return false;
  }
  if (obligation.relation === 'EXPLICIT_REJECTION'
    && (proof.outcomeKind !== 'REJECTION'
      || !explicitRejectionPattern.test(obligation.variationOutcome))) {
    return false;
  }
  if (obligation.relation !== 'EXPLICIT_REJECTION' && proof.outcomeKind === 'REJECTION') {
    return false;
  }
  if (obligation.resolutionParameter !== null
    && !literalReferenceAppears(dimension.rationale, obligation.resolutionParameter)) {
    return false;
  }
  return true;
}

function canonicalIntegerThreshold(text) {
  const normalized = text.normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('pt-BR');
  const forms = [
    { pattern: /(?:maior\s+ou\s+igual\s+a|greater\s+than\s+or\s+equal\s+to|>=)\s*(-?\d+)/u, direction: 'MIN', shift: 0n },
    { pattern: /(?:(?:estritamente\s+)?maior\s+que|strictly\s+greater\s+than|>)\s*(-?\d+)/u, direction: 'MIN', shift: 1n },
    { pattern: /(?:menor\s+ou\s+igual\s+a|less\s+than\s+or\s+equal\s+to|<=)\s*(-?\d+)/u, direction: 'MAX', shift: 0n },
    { pattern: /(?:(?:estritamente\s+)?menor\s+que|strictly\s+less\s+than|<)\s*(-?\d+)/u, direction: 'MAX', shift: -1n },
  ];
  for (const { pattern, direction, shift } of forms) {
    const match = pattern.exec(normalized);
    if (match !== null) return `${direction}:${BigInt(match[1]) + shift}`;
  }
  return null;
}

function boundedSignalRequiresEncodedValue(intent, signal) {
  if (!/\bbits?\s+\d+\s*[–—-]\s*\d+\b/iu.test(signal.reference)) return false;
  const lineStart = intent.lastIndexOf('\n', Math.max(0, signal.offset - 1)) + 1;
  const followingBreak = intent.indexOf('\n', signal.offset + signal.reference.length);
  const lineEnd = followingBreak === -1 ? intent.length : followingBreak;
  const localStatement = intent.slice(lineStart, lineEnd);
  return /\b(?:quantidade|contador\p{L}*|contagem|n[uú]mero|count|counter|volume)\b/iu
    .test(localStatement);
}

function activatedDeterminismDimensions(text) {
  const normalized = text.normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('pt-BR');
  return Object.entries(dimensionActivationPatterns)
    .filter(([, pattern]) => pattern.test(normalized))
    .map(([kind]) => kind);
}

function acceptanceBranchKey(acceptanceCase) {
  return JSON.stringify({
    given: normalizedObservableText(acceptanceCase.given),
    when: normalizedObservableText(acceptanceCase.when),
    decisionBinding: acceptanceCase.decisionBinding,
  });
}

function assertObservableOutcomesAreUnique(acceptanceCases) {
  const outcomesByBranch = new Map();
  for (const acceptanceCase of acceptanceCases) {
    if (hasDisjunctiveOutcome(acceptanceCase.then)) {
      throw new Error(`ambiguous_observable_outcome:${acceptanceCase.id}`);
    }
    const branch = acceptanceBranchKey(acceptanceCase);
    const outcome = `${acceptanceCase.outcomeKind}\n${normalizedObservableText(acceptanceCase.then)}`;
    const previous = outcomesByBranch.get(branch);
    if (previous !== undefined && previous.outcome !== outcome) {
      throw new Error(`conflicting_observable_outcomes:${previous.id}:${acceptanceCase.id}`);
    }
    outcomesByBranch.set(branch, { id: acceptanceCase.id, outcome });
  }
}

function assertRequirementReferences(items, requirementIds, kind) {
  for (const item of items) {
    for (const requirementId of item.requirementIds) {
      if (!requirementIds.has(requirementId)) {
        throw new Error(`${kind}_references_unknown_requirement:${requirementId}`);
      }
    }
  }
}

function basisClaims(draft) {
  return [
    ...draft.pathReferences,
    ...draft.architectureContexts,
    ...draft.complexityReview.alternatives,
    ...draft.nonNormativeItems,
    ...draft.requirements,
    ...draft.risks,
    ...draft.boundaryRules,
    ...draft.unknowns,
    ...draft.adversarialReview.findings,
    ...draft.determinismReview.dimensions,
  ];
}

function literalReferenceAppears(text, reference) {
  const normalizedText = text.normalize('NFC').toLocaleLowerCase('pt-BR');
  const normalizedReference = reference.normalize('NFC').toLocaleLowerCase('pt-BR');
  if (/^[\p{L}\p{N}_-]+$/u.test(normalizedReference)) {
    return normalizedText.split(/[^\p{L}\p{N}_-]+/u).includes(normalizedReference);
  }
  return normalizedText.includes(normalizedReference);
}

function closureAuthorityForDimension({
  status,
  basis,
  closureText,
  intent,
  decisionEvidence,
  constitutionRules,
  policyRules,
}) {
  if (status === 'DECISION_REQUIRED' || status === 'GAP_FOUND') return 'MODEL_ARGUMENT';
  for (const item of basis) {
    if (item.source === 'USER_DECISION'
      && literalReferenceAppears(decisionEvidence.get(item.reference) ?? '', closureText)) {
      return 'HUMAN_DECISION';
    }
    if (item.source === 'SAFE_MECHANICAL_DEFAULT') {
      const rule = policyRules.find(({ id }) => id === item.reference);
      if (rule !== undefined && literalReferenceAppears(rule.statement, closureText)) {
        return 'MECHANICAL_FACT';
      }
    }
    if (item.source === 'USER_INTENT'
      && intent.includes(item.reference)
      && literalReferenceAppears(item.reference, closureText)) {
      return 'AUTHORITATIVE_RULE';
    }
    if (item.source === 'CONSTITUTION') {
      const rule = constitutionRules.find(({ id }) => id === item.reference);
      if (rule !== undefined && literalReferenceAppears(rule.statement, closureText)) {
        return 'AUTHORITATIVE_RULE';
      }
    }
    if (item.source === 'ARCHITECTURE_POLICY') {
      const rule = policyRules.find(({ id }) => id === item.reference);
      if (rule !== undefined && literalReferenceAppears(rule.statement, closureText)) {
        return 'AUTHORITATIVE_RULE';
      }
    }
  }
  return 'MODEL_ARGUMENT';
}

function matchingReferences(intent, references) {
  return references.filter((reference) => literalReferenceAppears(intent, reference));
}

function mechanicalPolicySignals(policy, intent) {
  return policy.rules.flatMap((rule) => [
    ...matchingReferences(intent, rule.reviewReferences)
      .map((reference) => ({
        ruleId: rule.id,
        kind: 'REVIEW',
        reference,
      })),
    ...matchingReferences(intent, rule.forbiddenReferences)
      .map((reference) => ({
        ruleId: rule.id,
        kind: 'POSSIBLE_CONFLICT',
        reference,
      })),
  ]);
}

function ruleApplication(rule, architectureTags, intent) {
  const contextApplies = rule.appliesMode === 'all'
    ? rule.appliesWhen.every((tag) => architectureTags.has(tag))
    : rule.appliesWhen.some((tag) => architectureTags.has(tag));
  const reviewReferences = matchingReferences(intent, rule.reviewReferences);
  const forbiddenReferences = matchingReferences(intent, rule.forbiddenReferences);
  return {
    applies: contextApplies || reviewReferences.length > 0 || forbiddenReferences.length > 0,
  };
}

function workspaceBasisRange(reference) {
  const match = /^(src\/[^:]+):L([1-9]\d*)(?:-L([1-9]\d*))?$/u.exec(reference);
  if (match === null) return null;
  const startLine = Number.parseInt(match[2], 10);
  const endLine = Number.parseInt(match[3] ?? match[2], 10);
  if (endLine < startLine) return null;
  return { path: match[1], startLine, endLine };
}

function scopeContainsInternalPath(item) {
  return /(?:^|\s)(?:\.\/)?(?:src|lib|app|tests?)\/\S+/u.test(item);
}

function intentProductPaths(intent) {
  const pattern = /(?<![\p{L}\p{N}_.-])(?:\.\/)?src\/[\p{L}\p{N}_.@/+~-]*/gu;
  return [...new Set([...intent.matchAll(pattern)]
    .map(([path]) => path.replace(/^\.\//u, '').replace(/[.,;:]+$/u, '')))];
}

function technicalIdentifiers(text) {
  const pattern = /(?<![\p{L}\p{N}_$])(?:[\p{Lu}][\p{Ll}\p{N}_$-]+[\p{Lu}][\p{L}\p{N}_$-]*|[\p{Ll}_$][\p{L}\p{N}_$-]*[\p{Lu}][\p{L}\p{N}_$-]*|[\p{Lu}]{2,}(?:-[\p{L}\p{N}]+)?)(?![\p{L}\p{N}_$])/gu;
  return [...new Set([...text.matchAll(pattern)].map(([identifier]) => identifier))];
}

function targetIsQuantified(target) {
  return /\d/u.test(target)
    || /\b(?:zero|none|nenhum|nenhuma|sem\s+aloca(?:ç|c)(?:ão|ões)|no[- ]?allocation)\b/iu.test(target);
}

function numericTokens(text) {
  return [...new Set(text.match(/\d+(?:[.,]\d+)?/gu) ?? [])];
}

function semanticTokens(text) {
  const ignored = new Set([
    'a', 'as', 'at', 'de', 'do', 'dos', 'e', 'em', 'least', 'max', 'maximum', 'min',
    'minimum', 'no', 'none', 'o', 'os', 'per', 'por', 'sem', 'the', 'zero',
  ]);
  return [...new Set(text.normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .match(/[\p{L}\p{N}_-]+/gu) ?? [])]
    .filter((token) => token.length > 1 && !ignored.has(token));
}

function targetValueAppearsInEvidence(target, evidenceText) {
  if (literalReferenceAppears(evidenceText, target.value)) return true;
  const numbers = numericTokens(target.value);
  if (!numbers.every((number) => evidenceText.includes(number))) return false;
  const evidenceTokens = new Set(semanticTokens(evidenceText));
  return semanticTokens(target.value).every((token) => evidenceTokens.has(token));
}

function internalMechanismPhrases(text) {
  const patterns = [
    /\b(?:buffers?|arrays?|vetores?|objetos?)\s+(?:est[aá]tic[oa]s?|din[aâ]mic[oa]s?|tipad[oa]s?|pr[eé]-?alocad[oa]s?)\b/giu,
    /\bestruturas?\s+(?:planas?\s+)?pr[eé]-?alocad[oa]s?\b/giu,
    /\baloca(?:ç|c)(?:ão|ões)\s+(?:intermedi[aá]rias?\s+)?(?:de\s+)?heap\b/giu,
    /\binstancia(?:ç|c)(?:ão|ões)\s+tempor[aá]rias?\b/giu,
    /\bhierarquias?\s+(?:polim[oó]rficas?\s+)?de\s+classes?\b/giu,
    /\binje(?:ç|c)[aã]o\s+(?:din[aâ]mica\s+)?de\s+depend[eê]ncias?\b/giu,
  ];
  return [...new Set(patterns.flatMap((pattern) => [...text.matchAll(pattern)]
    .map(([phrase]) => phrase)))];
}

function assertNoUnprovenInternalMechanism(kind, id, text, trustedText) {
  for (const phrase of internalMechanismPhrases(text)) {
    if (!literalReferenceAppears(trustedText, phrase)) {
      throw new Error(`unproven_internal_mechanism:${kind}:${id}:${phrase}`);
    }
  }
}

const boundaryBehaviorPatterns = {
  REJECT: /\b(?:rejeit\p{L}*|recus\p{L}*|inv[aá]lid\p{L}*)\b/iu,
  SATURATE: /\bsatur\p{L}*\b/iu,
  EXPLICIT_SENTINEL: /\b(?:sentinela|sentinel|valor\s+especial)\b/iu,
  WRAP: /\b(?:wrap\p{L}*|trunc\p{L}*|circular|m[oó]dulo)\b/iu,
};

function textStatesBoundaryBehavior(text, behavior) {
  return behavior === 'NOT_APPLICABLE' || boundaryBehaviorPatterns[behavior].test(text);
}

function boundaryBehaviorIsExplicit(boundaryRule, behavior, humanResolutionEvidence) {
  if (behavior === 'NOT_APPLICABLE') return true;
  if (boundaryRule.basis.some(({ source, reference }) => source === 'USER_DECISION'
    && textStatesBoundaryBehavior(humanResolutionEvidence.get(reference) ?? '', behavior))) {
    return true;
  }
  return boundaryRule.basis.some(({ source, reference }) => source === 'USER_INTENT'
    && textStatesBoundaryBehavior(reference, behavior));
}

function basisCitesIntentSignal(claim, signal) {
  return claim.basis.some(({ source, reference }) => source === 'USER_INTENT'
    && (reference.includes(signal.reference) || signal.reference.includes(reference)));
}

function assertNoUnprovenTechnicalPrescription(kind, id, text, trustedText) {
  for (const identifier of technicalIdentifiers(text)) {
    if (!literalReferenceAppears(trustedText, identifier)) {
      throw new Error(`unproven_technical_prescription:${kind}:${id}:${identifier}`);
    }
  }
}


export {
  sourceEvidenceByteLimit,
  sourceEvidenceFileByteLimit,
  policySignalSemantics,
  determinismDimensionKinds,
  counterexampleByDimension,
  dimensionTriggerPattern,
  structuralAbsencePattern,
  structuralRulePattern,
  explicitRejectionPattern,
  requestedBehaviorRemovalPattern,
  dimensionResolutionRules,
  dimensionActivationPatterns,
  resolutionEvidenceTerms,
  explicitUncertaintyPattern,
  incompleteOperandPattern,
  explicitAlternativePattern,
  publicInterfaceIntentPattern,
  explicitInterfaceDefinitionPattern,
  publicInterfaceGapPattern,
  cryptographicSmallHashPattern,
  hashRiskPattern,
  hashSecurityDecisionPattern,
  thresholdRiskPattern,
  injectiveInvariantPattern,
  retainedResidualPattern,
  conservationInvariantPattern,
  feasibilityRiskPattern,
  mechanicalDimensionPolicyIds,
  concreteResolutionParameterPatterns,
  normalizedObservableText,
  matchingDimensionResolutions,
  decisionResolutionIsConcrete,
  mechanicalPolicyForDimension,
  hasMatureAlternativesForIncompleteOperand,
  hasDisjunctiveOutcome,
  hasUnresolvedExpression,
  isBareDeterminismAssertion,
  observableIsGeneric,
  proofConclusion,
  proofObligationMatchesDimension,
  canonicalIntegerThreshold,
  boundedSignalRequiresEncodedValue,
  activatedDeterminismDimensions,
  acceptanceBranchKey,
  assertObservableOutcomesAreUnique,
  assertRequirementReferences,
  basisClaims,
  literalReferenceAppears,
  closureAuthorityForDimension,
  matchingReferences,
  mechanicalPolicySignals,
  ruleApplication,
  workspaceBasisRange,
  scopeContainsInternalPath,
  intentProductPaths,
  technicalIdentifiers,
  targetIsQuantified,
  numericTokens,
  semanticTokens,
  targetValueAppearsInEvidence,
  internalMechanismPhrases,
  assertNoUnprovenInternalMechanism,
  boundaryBehaviorPatterns,
  textStatesBoundaryBehavior,
  boundaryBehaviorIsExplicit,
  basisCitesIntentSignal,
  assertNoUnprovenTechnicalPrescription,
};

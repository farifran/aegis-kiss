import { existsSync, readFileSync } from 'node:fs';
import { collectSymbolicProvenanceIssues } from './v7_rules.mjs';

/**
 * Validador Mecânico de Provenance Obrigatório (validateProvenanceEnforcement).
 *
 * Proíbe literais numéricos arbitrários em bounds, capacities e limites e
 * exige fundamentação autorizada para guardas e códigos de erro.
 */
export function validateProvenanceEnforcement({
  stateModel = null,
  architecturePolicy = null,
  literalFacts = [],
  fragments = [],
  intent = '',
  workspaceEvidence = [],
  requirements = [],
  invariants = [],
  decisions = [],
  boundaryRules = [],
} = {}) {
  void requirements;
  void invariants;
  void decisions;
  const issues = collectSymbolicProvenanceIssues({ stateModel, boundaryRules });
  if (!stateModel) return { valid: issues.length === 0, issues };

  const hasProvenanceContext = literalFacts.length > 0 || fragments.length > 0 || (
    stateModel.entities?.some((e) => (
      Boolean(e.capacityPolicy?.provenance)
      || e.fields?.some((f) => Boolean(f.bounds?.provenance))
    ))
  );

  const validPolicyRuleIds = new Set(architecturePolicy?.rules?.map((r) => r.id) ?? [
    'ARCH-PARSIMONY', 'ARCH-PRODUCT-BOUNDARY', 'ARCH-STRICT-EXPLICIT-MODULES',
    'ARCH-FAILURE-EXPLICIT', 'ARCH-DETERMINISTIC-TIME', 'ARCH-OBSERVABILITY-COUNTERS',
    'ARCH-HASH-SECURITY-LABEL', 'ARCH-CANONICAL-DIGEST-REPRESENTATION', 'ARCH-BIGINT-ARITHMETIC',
    'ARCH-LOCAL-DETERMINISTIC-CORE', 'ARCH-PUBLIC-INTERFACE', 'ARCH-CONTRACT-CONSISTENCY',
    'ARCH-STATE-TRANSITION-TOTALITY', 'ARCH-TEMPORAL-INVARIANCE', 'ARCH-MINIMAL-SUFFICIENT-CLOSURE',
  ]);

  const factsById = new Map(literalFacts.map((f) => [f.id, f]));
  const fragmentsById = new Map(fragments.map((f) => [f.id, f]));

  const factSupportsValue = (fact, valStr) => {
    if (valStr === '0' || valStr === '1') return true;
    const clean = (s) => String(s).replaceAll('_', '').replace(/n$/u, '').replace(',', '.').trim();
    const cleanVal = clean(valStr);

    const compareVals = (a, b) => {
      if (a === b) return true;
      try {
        if (BigInt(a) === BigInt(b)) return true;
      } catch {
        // Ignora valores não representáveis como BigInt
      }
      const numA = Number.parseFloat(a);
      const numB = Number.parseFloat(b);
      if (!Number.isNaN(numA) && !Number.isNaN(numB) && numA === numB) return true;
      return false;
    };

    if (fact.attributes?.value !== undefined && compareVals(clean(fact.attributes.value), cleanVal)) return true;
    if (fact.attributes?.canonicalValue !== undefined && compareVals(clean(fact.attributes.canonicalValue), cleanVal)) return true;
    if (fact.attributes?.width !== undefined) {
      const w = fact.attributes.width;
      if (String(w) === valStr || String((2 ** w) - 1) === valStr || String(Math.pow(2, w - 1) - 1) === valStr) return true;
    }
    if (fact.attributes?.bitWidth !== undefined) {
      const w = fact.attributes.bitWidth;
      if (String(w) === valStr || String((2 ** w) - 1) === valStr || String(Math.pow(2, w - 1) - 1) === valStr) return true;
    }
    if (fact.attributes?.start !== undefined && String(fact.attributes.start) === valStr) return true;
    if (fact.attributes?.end !== undefined && String(fact.attributes.end) === valStr) return true;
    return false;
  };

  const parseWorkspaceReference = (reference) => {
    if (typeof reference !== 'string' || reference.trim().length === 0) {
      return { refPath: '', targetStartLine: null, targetEndLine: null };
    }
    const raw = reference.trim();
    const sepIdx = Math.max(raw.lastIndexOf('#'), raw.lastIndexOf(':'));
    if (sepIdx > 0) {
      const potentialPath = raw.slice(0, sepIdx).trim();
      const potentialLineSpec = raw.slice(sepIdx + 1).trim();
      const m = potentialLineSpec.match(/^L?(\d+)(?:-L?(\d+))?$/i);
      if (m) {
        const start = Number.parseInt(m[1], 10);
        const end = m[2] ? Number.parseInt(m[2], 10) : start;
        return { refPath: potentialPath, targetStartLine: start, targetEndLine: end };
      }
    }
    return { refPath: raw, targetStartLine: null, targetEndLine: null };
  };

  const workspaceSupportsValue = (reference, valStr) => {
    if (valStr === '0' || valStr === '1') return true;
    if (typeof reference !== 'string' || reference.trim().length === 0) return false;

    const cleanVal = String(valStr).replaceAll('_', '').replace(/n$/u, '').trim();
    const { refPath, targetStartLine, targetEndLine } = parseWorkspaceReference(reference);
    if (!refPath) return false;

    let matchingSources = (workspaceEvidence || []).filter((entry) =>
      entry.path === refPath || entry.path.endsWith(`/${refPath}`) || refPath.endsWith(`/${entry.path}`),
    );

    if (matchingSources.length === 0) {
      if (existsSync(refPath)) {
        try {
          const content = readFileSync(refPath, 'utf8');
          matchingSources = [{ path: refPath, content, startLine: 1 }];
        } catch {
          return false;
        }
      } else {
        return false;
      }
    }

    for (const src of matchingSources) {
      const content = src.content ?? '';
      const lines = content.split('\n');
      const startLineOffset = src.startLine ?? 1;

      let textToCheck = content;
      if (targetStartLine !== null) {
        const fromIdx = Math.max(0, targetStartLine - startLineOffset);
        const toIdx = Math.min(lines.length - 1, (targetEndLine ?? targetStartLine) - startLineOffset);
        if (fromIdx <= toIdx && fromIdx < lines.length) {
          textToCheck = lines.slice(fromIdx, toIdx + 1).join('\n');
        } else {
          continue;
        }
      }

      const numMatches = textToCheck.match(/(?<![\w$])\d+(?:_\d+)*n?(?![\w$])/g) ?? [];
      for (const rawToken of numMatches) {
        const cleanToken = rawToken.replaceAll('_', '').replace(/n$/u, '').trim();
        if (cleanToken === cleanVal) return true;
        try {
          if (BigInt(cleanToken) === BigInt(cleanVal)) return true;
        } catch {
          // ignore non-integer comparison
        }
      }
    }

    return false;
  };

  const validateBoundProvenance = (val, boundKind, slotPrefix, bounds) => {
    if (val === null || val === undefined) return;
    const valStr = String(val);
    const provenance = bounds?.provenance;

    if (!provenance || !Array.isArray(provenance) || provenance.length === 0) {
      issues.push({
        slotId: `${slotPrefix}/bounds/${boundKind}/provenance`,
        kind: 'UNAUTHORIZED_NUMERIC_LITERAL',
        reason: `O limite ${boundKind} '${valStr}' em '${slotPrefix}' não possui provenance autorizada.`,
      });
      return;
    }

    let hasValidFactRef = false;
    let anyFactSupportsBound = false;
    let hasNonFactSupport = false;

    for (const p of provenance) {
      if (p.source === 'USER_INTENT') {
        if (typeof p.reference === 'string' && p.reference.startsWith('FACT-')) {
          const fact = factsById.get(p.reference);
          if (!fact) {
            issues.push({
              slotId: `${slotPrefix}/bounds/${boundKind}/unauthorizedLiteral`,
              kind: 'UNAUTHORIZED_NUMERIC_LITERAL',
              reason: `O limite ${boundKind} '${valStr}' em '${slotPrefix}' cita o fato '${p.reference}' que não existe na evidência da demanda.`,
            });
          } else {
            hasValidFactRef = true;
            if (factSupportsValue(fact, valStr)) {
              anyFactSupportsBound = true;
            }
          }
        } else if (typeof p.reference === 'string' && p.reference.startsWith('FRAG-')) {
          if (fragmentsById.size > 0 && !fragmentsById.has(p.reference)) {
            issues.push({
              slotId: `${slotPrefix}/bounds/${boundKind}/unauthorizedLiteral`,
              kind: 'UNAUTHORIZED_NUMERIC_LITERAL',
              reason: `O limite ${boundKind} '${valStr}' em '${slotPrefix}' cita o fragmento '${p.reference}' que não existe na evidência da demanda.`,
            });
          } else {
            hasNonFactSupport = true;
          }
        } else if (intent && intent.length > 0 && typeof p.reference === 'string' && !intent.includes(p.reference)) {
          issues.push({
            slotId: `${slotPrefix}/bounds/${boundKind}/unauthorizedLiteral`,
            kind: 'UNAUTHORIZED_NUMERIC_LITERAL',
            reason: `A referência '${p.reference}' citada em USER_INTENT para o limite '${valStr}' em '${slotPrefix}' não aparece no texto da demanda.`,
          });
        } else {
          hasNonFactSupport = true;
        }
      } else if (p.source === 'WORKSPACE_EVIDENCE') {
        if (!workspaceSupportsValue(p.reference, valStr)) {
          issues.push({
            slotId: `${slotPrefix}/bounds/${boundKind}/unauthorizedLiteral`,
            kind: 'UNAUTHORIZED_NUMERIC_LITERAL',
            reason: `O limite ${boundKind} '${valStr}' em '${slotPrefix}' cita '${p.reference}' em WORKSPACE_EVIDENCE, mas o valor não existe no trecho de código referenciado.`,
          });
        } else {
          hasNonFactSupport = true;
        }
      } else if ((p.source === 'ARCHITECTURE_POLICY' || p.source === 'SAFE_MECHANICAL_DEFAULT') && !validPolicyRuleIds.has(p.reference)) {
        issues.push({
          slotId: `${slotPrefix}/bounds/${boundKind}/unauthorizedPolicy`,
          kind: 'UNAUTHORIZED_NUMERIC_LITERAL',
          reason: `A regra de política '${p.reference}' citada para o limite '${valStr}' em '${slotPrefix}' não existe na governança.`,
        });
      } else {
        hasNonFactSupport = true;
      }
    }

    if (hasValidFactRef && !anyFactSupportsBound && !hasNonFactSupport) {
      issues.push({
        slotId: `${slotPrefix}/bounds/${boundKind}/unauthorizedLiteral`,
        kind: 'UNAUTHORIZED_NUMERIC_LITERAL',
        reason: `O limite ${boundKind} '${valStr}' em '${slotPrefix}' não é autorizado pelos fatos literais citados em provenance.`,
      });
    }
  };

  if (hasProvenanceContext && Array.isArray(stateModel.entities)) {
    for (const entity of stateModel.entities) {
      if (entity.isCollection && entity.capacityPolicy?.maxEntries !== null && entity.capacityPolicy?.maxEntries !== undefined) {
        const maxVal = String(entity.capacityPolicy.maxEntries);
        const prov = entity.capacityPolicy.provenance;
        if (!prov || !Array.isArray(prov) || prov.length === 0) {
          issues.push({
            slotId: `entity/${entity.name}/capacityPolicy/provenance`,
            kind: 'UNAUTHORIZED_NUMERIC_LITERAL',
            reason: `A capacidade máxima '${maxVal}' da entidade '${entity.name}' não possui declaração de provenance autorizada.`,
          });
        } else {
          for (const p of prov) {
            if (p.source === 'USER_INTENT') {
              if (typeof p.reference === 'string' && p.reference.startsWith('FACT-')) {
                const fact = factsById.get(p.reference);
                if (!fact) {
                  issues.push({
                    slotId: `entity/${entity.name}/capacityPolicy/unauthorizedLiteral`,
                    kind: 'UNAUTHORIZED_NUMERIC_LITERAL',
                    reason: `O valor de capacidade '${maxVal}' cita o fato literal '${p.reference}' que não existe na evidência da demanda.`,
                  });
                } else if (!factSupportsValue(fact, maxVal)) {
                  issues.push({
                    slotId: `entity/${entity.name}/capacityPolicy/unauthorizedLiteral`,
                    kind: 'UNAUTHORIZED_NUMERIC_LITERAL',
                    reason: `O valor de capacidade '${maxVal}' cita o fato '${p.reference}', mas os atributos do fato não autorizam esse valor.`,
                  });
                }
              } else if (typeof p.reference === 'string' && p.reference.startsWith('FRAG-')) {
                if (fragmentsById.size > 0 && !fragmentsById.has(p.reference)) {
                  issues.push({
                    slotId: `entity/${entity.name}/capacityPolicy/unauthorizedLiteral`,
                    kind: 'UNAUTHORIZED_NUMERIC_LITERAL',
                    reason: `O valor de capacidade '${maxVal}' cita o fragmento '${p.reference}' que não existe na evidência da demanda.`,
                  });
                }
              } else if (intent && intent.length > 0 && typeof p.reference === 'string' && !intent.includes(p.reference)) {
                issues.push({
                  slotId: `entity/${entity.name}/capacityPolicy/unauthorizedLiteral`,
                  kind: 'UNAUTHORIZED_NUMERIC_LITERAL',
                  reason: `A referência '${p.reference}' citada em USER_INTENT para a capacidade máxima '${maxVal}' não aparece no texto da demanda.`,
                });
              }
            } else if (p.source === 'WORKSPACE_EVIDENCE') {
              if (!workspaceSupportsValue(p.reference, maxVal)) {
                issues.push({
                  slotId: `entity/${entity.name}/capacityPolicy/unauthorizedLiteral`,
                  kind: 'UNAUTHORIZED_NUMERIC_LITERAL',
                  reason: `A capacidade máxima '${maxVal}' da entidade '${entity.name}' cita '${p.reference}' em WORKSPACE_EVIDENCE, mas o valor não existe no trecho de código referenciado.`,
                });
              }
            } else if ((p.source === 'ARCHITECTURE_POLICY' || p.source === 'SAFE_MECHANICAL_DEFAULT') && !validPolicyRuleIds.has(p.reference)) {
              issues.push({
                slotId: `entity/${entity.name}/capacityPolicy/unauthorizedPolicy`,
                kind: 'UNAUTHORIZED_NUMERIC_LITERAL',
                reason: `A regra de política '${p.reference}' citada para capacidade '${maxVal}' não existe na governança.`,
              });
            }
          }
        }
      }

      for (const field of entity.fields ?? []) {
        if (field.bounds) {
          validateBoundProvenance(field.bounds.lowerBound, 'lowerBound', `state/${entity.name}.${field.name}`, field.bounds);
          validateBoundProvenance(field.bounds.upperBound, 'upperBound', `state/${entity.name}.${field.name}`, field.bounds);
        }
      }
    }
  }

  if (Array.isArray(stateModel.operations)) {
    for (const op of stateModel.operations) {
      for (const param of (op.parameters ?? [])) {
        if (param.bounds) {
          validateBoundProvenance(param.bounds.lowerBound, 'lowerBound', `operation/${op.name}/parameter/${param.name}`, param.bounds);
          validateBoundProvenance(param.bounds.upperBound, 'upperBound', `operation/${op.name}/parameter/${param.name}`, param.bounds);
        }
      }
    }
  }

  const hasGroundingCorpus = (workspaceEvidence.length > 0 || intent.length > 0);
  if (hasGroundingCorpus && Array.isArray(stateModel.operations)) {
    const groundingCorpus = [
      intent,
      ...literalFacts.map((f) => f.reference),
      ...workspaceEvidence.map((w) => w.content ?? ''),
    ].join('\n').toLowerCase();

    const standardGuardPrefixes = [
      'guard_', 'err_', 'error_', 'invalid_', 'insufficient_', 'queue_',
      'capacity_', 'limit_', 'timeout_', 'unauthorized_', 'not_found_', 'conflict_',
    ];

    const standardAllowedCodes = new Set([
      'queue_full_rejected', 'queue_full', 'capacity_exceeded', 'max_entries_exceeded',
      'batch_empty_noop', 'batch_settled', 'success', 'noop', 'rejected', 'default_rejection',
    ]);

    const isCodeGrounded = (rawCode) => {
      if (!rawCode || typeof rawCode !== 'string') return true;
      const code = rawCode.trim().toLowerCase();
      if (standardAllowedCodes.has(code)) return true;
      if (groundingCorpus.includes(code)) return true;

      let coreToken = code;
      for (const prefix of standardGuardPrefixes) {
        if (coreToken.startsWith(prefix)) {
          coreToken = coreToken.slice(prefix.length);
          break;
        }
      }
      if (coreToken.length >= 3 && groundingCorpus.includes(coreToken)) {
        return true;
      }
      return false;
    };

    for (const op of stateModel.operations) {
      for (const guard of (op.guardPrecedence ?? [])) {
        if (!isCodeGrounded(guard)) {
          issues.push({
            slotId: `operation/${op.name}/guard/${guard}/unauthorized`,
            kind: 'UNAUTHORIZED_GUARD_OR_ERROR_CODE',
            reason: `A guarda ou código de rejeição '${guard}' na operação '${op.name}' não possui fundamentação no texto da demanda, evidências do repositório ou requisitos.`,
          });
        }
      }
      for (const param of (op.parameters ?? [])) {
        const errCode = param.onInvalid?.error || param.bounds?.onInvalid?.error;
        if (errCode && !isCodeGrounded(errCode)) {
          issues.push({
            slotId: `operation/${op.name}/parameter/${param.name}/onInvalid/${errCode}`,
            kind: 'UNAUTHORIZED_GUARD_OR_ERROR_CODE',
            reason: `O código de erro de parâmetro '${errCode}' na operação '${op.name}' não possui fundamentação no texto da demanda, evidências do repositório ou requisitos.`,
          });
        }
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}


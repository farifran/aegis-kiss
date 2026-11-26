import { standaloneSchemaDocument } from './schema_validator.mjs';

function compact(value, propertyMap = false) {
  if (Array.isArray(value)) return value.map((item) => compact(item));
  if (value === null || typeof value !== 'object') return value;
  if (propertyMap) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, compact(item)]));
  const result = Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['$id', '$schema', 'description', 'title', 'if', 'then', 'else', 'allOf', 'uniqueItems', 'pattern', 'minLength', 'maxLength', 'minItems', 'maxItems'].includes(key))
    .map(([key, item]) => [key === 'oneOf' ? 'anyOf' : key, compact(item, key === 'properties')]));
  if (!Object.hasOwn(result, 'type') && Object.hasOwn(result, 'const')) {
    result.type = result.const === null ? 'null' : typeof result.const;
  }
  if (!Object.hasOwn(result, 'type') && Array.isArray(result.enum)) {
    const types = new Set(result.enum.map((item) => item === null ? 'null' : typeof item));
    if (types.size === 1) [result.type] = types;
  }
  return result;
}

// Share identical schema nodes, never property maps or data values. All refs are local.
export function shareSchemaDefinitions(schema) {
  const counts = new Map();
  const definitions = {};
  const names = new Map();
  const isSchema = (value) => typeof value.type === 'string'
    || Array.isArray(value.type) || Array.isArray(value.anyOf) || Array.isArray(value.enum);
  const count = (value) => {
    if (value === null || typeof value !== 'object') return;
    if (!Array.isArray(value) && isSchema(value)) {
      const key = JSON.stringify(value);
      if (key.length > 40) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    Object.values(value).forEach(count);
  };
  count(schema);
  const replace = (value, inline = false) => {
    if (Array.isArray(value)) return value.map((item) => replace(item));
    if (value === null || typeof value !== 'object') return value;
    const key = JSON.stringify(value);
    if (!inline && isSchema(value) && counts.get(key) > 1) {
      if (!names.has(key)) {
        const name = `s${names.size + 1}`;
        names.set(key, name);
        definitions[name] = replace(value, true);
      }
      return { $ref: `#/$defs/${names.get(key)}` };
    }
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, replace(item)]));
  };
  const result = replace(schema, true);
  return Object.keys(definitions).length === 0 ? result : { ...result, $defs: definitions };
}

function injectConditionalHints(schema) {
  const hints = [
    [schema.properties?.intentClaims?.items?.properties?.contractEffect, 'Obrigatório (texto curto) se disposition=NORMATIVE; use null se DECISION, POLICY_CORRECTION ou NON_NORMATIVE.'],
    [schema.properties?.pathReferences?.items?.properties?.requirementIndexes, 'Use [] quando role for EVIDENCE_ONLY ou IMPLEMENTATION_SUGGESTION.'],
    [schema.properties?.decisions?.items?.properties?.semanticKey, 'Identificador pontuado em lowercase snake_case (ex: "domain.decision_key").'],
    [schema.properties?.stateModel?.properties?.entities?.items?.properties?.fields?.items?.properties?.preservation, 'Lista com os nomes exatos das operações em operations[].name que preservam o campo (ou ["*"]).'],
  ];
  const arithBranch = schema.properties?.determinismReview?.properties?.arithmetic?.anyOf?.find((b) => b.properties);
  if (arithBranch?.properties) {
    hints.push(
      [arithBranch.properties.operandMax, 'Finito obrigatório se numericRepresentation=SAFE_INTEGER_BOUNDED (ex: "9007199254740991"); pode ser null se BIGINT_EXACT.'],
      [arithBranch.properties.quotientPolicy, 'Se DIVIDE/MODULO, use TRUNC_ZERO, FLOOR, CEIL ou EXACT_DIVISIBLE_OR_REJECT (proibido DECIMAL_BOUNDED).'],
    );
  }
  const branchProps = schema.properties?.stateModel?.properties?.operations?.items?.properties?.branches?.items?.properties;
  if (branchProps) {
    hints.push(
      [branchProps.statusOrError, 'Vincule explicitamente o valor correspondente de externalEffects[].possibleOutcomes[] (ex: "SUCCESS").'],
      [branchProps.externalEffects?.items?.properties?.externalInterfaceStatus, 'Use "UNBOUND_ABSTRACT_BOUNDARY" se não houver adaptador em src/; exige executionOrder e possibleOutcomes (payloads podem ser null).'],
    );
  }
  for (const [node, text] of hints) {
    if (node && typeof node === 'object') node.description = text;
  }
}

export function buildSemanticOutputSchema({ hasAmendments = false, shared = true } = {}) {
  const schema = compact(standaloneSchemaDocument('aegis.semantic_opinion.v3'));
  schema.$id = 'aegis.semantic_opinion.v3';
  schema.$schema = 'https://json-schema.org/draft/2020-12/schema';
  for (const name of ['schema', 'sourceEvidenceDigest']) {
    delete schema.properties[name];
    schema.required = schema.required.filter((key) => key !== name);
  }
  const det = schema.properties.determinismReview;
  delete det.properties.fragmentIndexes;
  det.required = det.required.filter((key) => key !== 'fragmentIndexes');
  const coverage = det.properties.coverage.items;
  delete coverage.properties.disposition;
  coverage.required = coverage.required.filter((key) => key !== 'disposition');
  // Wire decisions only send lightweight { index, patch }; full-object { index, value } is compiler output.
  const prepBranches = schema.properties.decisions.items.properties.answers.items.properties.preparedEffect.anyOf;
  const prepObj = prepBranches?.find((b) => b.type === 'object');
  if (prepObj?.properties) {
    for (const col of Object.values(prepObj.properties)) {
      const variants = col?.items?.anyOf;
      if (Array.isArray(variants)) {
        const patchOnly = variants.filter((v) => v.properties && Object.hasOwn(v.properties, 'patch'));
        if (patchOnly.length === 1) col.items = patchOnly[0];
      }
    }
  }
  const prepare = (value) => {
    if (value === null || typeof value !== 'object') return;
    if (value.properties !== undefined) {
      for (const name of (!hasAmendments ? ['amendmentIndex'] : [])) {
        delete value.properties[name];
      }
      const required = new Set(value.required ?? []);
      for (const [name, field] of Object.entries(value.properties)) {
        const nullable = field.type === 'null' || field.type?.includes('null')
          || field.anyOf?.some((branch) => branch.type === 'null');
        if (!required.has(name) && !nullable) {
          if (typeof field.type === 'string' && !Object.hasOwn(field, 'enum') && !Object.hasOwn(field, 'const')) {
            value.properties[name] = { ...field, type: [field.type, 'null'] };
          } else {
            value.properties[name] = { anyOf: [field, { type: 'null' }] };
          }
        }
      }
      value.required = Object.keys(value.properties);
    }
    Object.values(value).forEach(prepare);
  };
  prepare(schema);
  injectConditionalHints(schema);
  return shared ? shareSchemaDefinitions(schema) : schema;
}

// null in an originally optional wire field means "not supplied", not an invented default.
export function omitOptionalNulls(value, schema) {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    if (schema.items) value.forEach((item) => omitOptionalNulls(item, schema.items));
    return;
  }
  for (const [key, field] of Object.entries(schema.properties ?? {})) {
    if (!Object.hasOwn(value, key)) continue;
    if (value[key] === null && !(schema.required ?? []).includes(key)) delete value[key];
    else omitOptionalNulls(value[key], field);
  }
  for (const branch of schema.oneOf ?? schema.anyOf ?? []) omitOptionalNulls(value, branch);
}

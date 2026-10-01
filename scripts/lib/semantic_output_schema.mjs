import { standaloneSchemaDocument } from './schema_validator.mjs';

function compact(value, propertyMap = false) {
  if (Array.isArray(value)) return value.map((item) => compact(item));
  if (value === null || typeof value !== 'object') return value;
  if (propertyMap) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, compact(item)]));
  const result = Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['$id', '$schema', 'description', 'title', 'if', 'then', 'else', 'allOf', 'uniqueItems', 'pattern'].includes(key))
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
    || Array.isArray(value.type) || Array.isArray(value.anyOf);
  const count = (value) => {
    if (value === null || typeof value !== 'object') return;
    if (!Array.isArray(value) && isSchema(value)) {
      const key = JSON.stringify(value);
      if (key.length > 120) counts.set(key, (counts.get(key) ?? 0) + 1);
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
        const name = `shared${names.size + 1}`;
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

export function buildSemanticOutputSchema({ hasAmendments = false, shared = true } = {}) {
  const schema = compact(standaloneSchemaDocument('aegis.semantic_opinion.v3'));
  schema.$id = 'aegis.semantic_opinion.v3';
  schema.$schema = 'https://json-schema.org/draft/2020-12/schema';
  for (const name of ['schema', 'sourceEvidenceDigest']) {
    delete schema.properties[name];
    schema.required = schema.required.filter((key) => key !== name);
  }
  const coverage = schema.properties.determinismReview.properties.coverage.items;
  delete coverage.properties.disposition;
  coverage.required = coverage.required.filter((key) => key !== 'disposition');
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
        if (!required.has(name) && !nullable) value.properties[name] = { anyOf: [field, { type: 'null' }] };
      }
      value.required = Object.keys(value.properties);
    }
    Object.values(value).forEach(prepare);
  };
  prepare(schema);
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

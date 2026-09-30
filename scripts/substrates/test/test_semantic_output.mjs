import assert from 'node:assert/strict';
import process from 'node:process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { loadSemanticConstitution } from '../../lib/semantic_request.mjs';
import { semanticSupervisorInstructions } from '../../lib/semantic_gateway.mjs';
import { schemaFiles } from '../../lib/schema_catalog.mjs';
import { schemaDocument, standaloneSchemaDocument } from '../../lib/schema_validator.mjs';
import { buildSemanticOutputSchema, omitOptionalNulls, shareSchemaDefinitions } from '../../lib/semantic_output_schema.mjs';

// The human and runtime constitutions must carry exactly the same rules.
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const constitution = loadSemanticConstitution(repositoryRoot);
const supervisorInstructions = semanticSupervisorInstructions({ constitution });
assert.ok(supervisorInstructions.includes('Na mesma análise, revise semanticamente'));
assert.ok(supervisorInstructions.includes('adversarialReview'));
assert.ok(supervisorInstructions.includes('não a verdade semântica'));
const constitutionText = readFileSync(new URL('../../../AGENTS.md', import.meta.url), 'utf8');
const sections = constitutionText.trim().split(/^## /mu).slice(1);
assert.equal(sections.length, constitution.rules.length);
for (const [index, rule] of constitution.rules.entries()) {
  const [heading, ...body] = sections[index].split('\n');
  assert.ok(heading.endsWith(`(${rule.id})`));
  assert.equal(body.join('\n').trim(), rule.statement);
}

function expand(value, root) {
  if (Array.isArray(value)) return value.map((item) => expand(item, root));
  if (value === null || typeof value !== 'object') return value;
  if (value.$ref !== undefined) {
    assert.match(value.$ref, /^#\/\$defs\/[A-Za-z0-9]+$/u);
    const definition = root.$defs[value.$ref.split('/').at(-1)];
    assert.ok(definition, 'Every reference must resolve inside the delivered document');
    return expand(definition, root);
  }
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== '$defs')
    .map(([key, item]) => [key, expand(item, root)]));
}

// Formatos canônicos resolvem todas as referências internas.
for (const [id] of schemaFiles) {
  const checkRefs = (value) => {
    if (value === null || typeof value !== 'object') return;
    if (typeof value.$ref === 'string' && !value.$ref.startsWith('#')) {
      const target = schemaFiles.get(value.$ref.split('#')[0]);
      assert.ok(target, `Unknown reference in ${id}`);
    }
    Object.values(value).forEach(checkRefs);
  };
  checkRefs(schemaDocument(id));
}
for (const id of ['aegis.semantic_draft.v9', 'aegis.semantic_opinion.v3']) {
  const capacity = standaloneSchemaDocument(id).properties.stateModel.properties.entities.items.properties.capacityPolicy;
  const validate = new Ajv2020({ strict: false }).compile(capacity);
  assert.equal(validate({ maxEntries: null, overflowPolicy: 'NO_CONTRACT_LIMIT', unboundedRationale: 'No contractual maximum.' }), true);
  assert.equal(validate({ maxEntries: null, overflowPolicy: 'NO_CONTRACT_LIMIT' }), false);
  assert.equal(validate({ maxEntries: '10', overflowPolicy: 'NO_CONTRACT_LIMIT', unboundedRationale: 'Contradictory.' }), false);
  assert.equal(validate({ maxEntries: '10', overflowPolicy: 'REJECT_NEW' }), true);
}

for (const hasAmendments of [false, true]) {
  const schema = buildSemanticOutputSchema({ hasAmendments });
  const expanded = buildSemanticOutputSchema({ hasAmendments, shared: false });
  assert.deepEqual(expand(schema, schema), expanded, 'Sharing must not remove or change a validation rule');
  assert.deepEqual(schema, buildSemanticOutputSchema({ hasAmendments }), 'Stable schema and definition names');
  assert.ok(JSON.stringify(schema).length < JSON.stringify(expanded).length * 0.8);
  const visit = (value) => {
    if (value === null || typeof value !== 'object') return;
    if (value.properties) {
      assert.deepEqual([...value.required].sort(), Object.keys(value.properties).sort());
      assert.equal(value.additionalProperties, false);
    }
    Object.values(value).forEach(visit);
  };
  visit(schema);
  const validate = new Ajv2020({ strict: false }).compile(schema);
  assert.equal(validate({}), false, 'Mandatory semantic data must remain mandatory');
  assert.equal(expanded.properties.stateModel.anyOf.at(-1).type, 'null');
  const coverage = expanded.properties.determinismReview.properties.coverage.items;
  assert.equal(Object.hasOwn(coverage.properties, 'disposition'), false);
}

const field = { type: 'string', minLength: 1, maxLength: 240 };
const sampleSchema = {
  type: 'object', required: ['literal'], additionalProperties: false,
  properties: { literal: field, optional: { type: 'object', properties: { note: field } } },
};
const sample = { literal: null, optional: { note: null } };
omitOptionalNulls(sample, sampleSchema);
assert.deepEqual(sample, { literal: null, optional: {} });
const missingState = { stateModel: null };
omitOptionalNulls(missingState, { properties: { stateModel: { type: 'object' } } });
assert.deepEqual(missingState, {}, 'Absent state does not invent initialization, bounds or reset rules');

// A business property called "then", "type", or "title" is data, not schema metadata.
const named = { type: 'object', properties: { then: field, title: field, type: field } };
const shared = shareSchemaDefinitions(named);
assert.deepEqual(expand(shared, shared), named);
process.stdout.write('Semantic output schema: shared definitions, strict shape and absent fields PASS\n');

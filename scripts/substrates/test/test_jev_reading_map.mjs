import assert from 'node:assert/strict';
import process from 'node:process';
import { buildJevReadingMap, assertReadingMapAnswers } from '../../lib/jev_reading_map.mjs';
import { readingCases } from './jev_reading_cases.mjs';

for (const item of readingCases) {
  const map = buildJevReadingMap(item.intent, { mode: 'linked', context: item.context, candidates: item.candidates });
  assert.deepEqual(map, buildJevReadingMap(item.intent, { mode: 'linked', context: item.context, candidates: item.candidates }));
  assert.equal(map.authority, 'ADVISORY_ONLY');
  for (const [key, value] of Object.entries(item.expected)) assert.ok(Object.hasOwn(map.questions[key].criteria, value), key);
  const answers = Object.fromEntries(Object.entries(map.questions).map(([id, question]) => [id, Object.keys(question.criteria)[0]]));
  assertReadingMapAnswers(map, answers);
  assert.throws(() => assertReadingMapAnswers(map, { ...answers, fake: 'NORMATIVE' }));
  assert.throws(() => assertReadingMapAnswers(map, {}));
  assert.throws(() => assertReadingMapAnswers(map, { ...answers, [Object.keys(answers)[0]]: 'FAKE' }));
}
const intent = Array.from({ length: 70 }, (_, index) => `Item ${index}`).join('\n');
const limited = buildJevReadingMap(intent, { mode: 'linked' });
assert.equal(limited.coverage.evaluatedPairs.length, 64);
assert.equal(limited.coverage.omittedAdjacentPairs, 5);
assert.ok(limited.coverage.nonAdjacentPairsNotEvaluated > 0);
assert.equal(limited.state.fragments.length, 70, 'No original text may be pruned');
assert.throws(() => buildJevReadingMap('Teste.', { mode: 'linked', candidates: [{ fragmentId: 'FRAG-9999', contextId: 'POLICY-X' }] }));
assert.throws(() => buildJevReadingMap('Teste.', { mode: 'linked', candidates: [{ fragmentId: 'FRAG-0001', contextId: 'POLICY-X' }] }));
assert.throws(() => buildJevReadingMap('Teste.', { context: [{ id: 'POLICY-X', kind: 'evidence', text: 'Não é política.' }] }));
assert.throws(() => buildJevReadingMap('Teste.', { context: [{ id: 'POLICY-X', kind: 'policy', text: ' ' }] }));
process.stdout.write('JEV reading map: references, deterministic projection, answer space, bounded coverage PASS\n');

// Opt-in experiment. Never imported by the demand pipeline or npm test.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { captureDemand, observeWorkspace, buildPreflightHandoff, loadArchitecturePolicy } from '../../lib/issue_contract_core.mjs';
import { buildSemanticRequest, loadSemanticConstitution } from '../../lib/semantic_request.mjs';
import { buildJevDecisionBatch, assertJevDecisionBatch } from '../../lib/jev_projection.mjs';
import { canonicalDigest } from '../../lib/canonical_json.mjs';
import { compileJevAssessment, requestJevAssessment } from '../../lib/jev_gateway.mjs';
import { jevCases } from './jev_cases.mjs';

const cases = jevCases.filter(([split]) => split === 'dev').map(([, ...test]) => test);

const args = process.argv.slice(2);
assert.ok(args.every((arg) => ['--live', '--repeat=2'].includes(arg)), 'Use [--live] [--repeat=2]');
const live = args.includes('--live');
const repetitions = args.includes('--repeat=2') ? 2 : 1;
const root = fileURLToPath(new URL('../../../', import.meta.url));
const policy = loadArchitecturePolicy(root).policy;
const constitution = loadSemanticConstitution(root);
const report = { startedAt: new Date().toISOString(), mode: live ? 'LIVE' : 'LOCAL_PROTOCOL_ONLY',
  credentialPresent: Boolean(process.env.AI_GATEWAY_API_KEY), repetitions,
  rubric: 'Predeclared advisory labels; disagreement requires review, not automatic model failure.',
  results: [], liveRequests: 0, liveResponses: 0, localProtocolCases: 0 };
const outputDir = await mkdtemp(join(tmpdir(), 'aegis-jev-evaluation-'));
const reportPath = join(outputDir, 'report.json');

for (const [id, text, expected] of cases) {
  const intent = captureDemand([text]);
  const workspaceObservation = observeWorkspace(root, intent);
  const preflight = buildPreflightHandoff({ demand: intent, discovery: workspaceObservation.discovery });
  const request = buildSemanticRequest({ repositoryRoot: root, preflight, policy, constitution, workspaceObservation });
  const batch = buildJevDecisionBatch(request);
  assert.equal(batch.state.fragments.length, expected.length, `Rubric segmentation drift: ${id}`);
  assert.deepEqual(Object.keys(batch.state), ['fragments']);
  const tampered = globalThis.structuredClone(batch);
  tampered.bindings[Object.keys(tampered.bindings)[0]].axis = 'review';
  const { batchDigest: discardedDigest, ...tamperedPayload } = tampered;
  void discardedDigest;
  tampered.batchDigest = canonicalDigest(tamperedPayload);
  assert.throws(() => assertJevDecisionBatch(tampered), /jev_fragment_question_mismatch/);
  const expectedChoice = (key) => expected[batch.state.fragments.findIndex((fragment) => fragment.id === batch.bindings[key].subjectId)][batch.bindings[key].axis === 'role' ? 0 : 1];
  const answers = Object.fromEntries(Object.entries(batch.questions).map(([key, question]) => [key, {
    type: 'choice', choice: expectedChoice(key), confidence: 1,
    probabilities: Object.fromEntries(Object.keys(question.criteria).map((label) => [label, label === expectedChoice(key) ? 1 : 0])),
  }]));
  // Synthetic data verifies our parser only; never included in live accuracy.
  const synthetic = { model: 'LOCAL_TEST_FIXTURE', answers, usage: { input_tokens: 0, output_tokens: 0 } };
  compileJevAssessment(batch, synthetic);
  const missing = globalThis.structuredClone(synthetic);
  delete missing.answers[Object.keys(answers)[0]];
  assert.throws(() => compileJevAssessment(batch, missing), /answers_mismatch|schema_validation_failed/);
  const invalid = globalThis.structuredClone(synthetic);
  invalid.answers[Object.keys(answers)[0]].probabilities.NORMATIVE = -1;
  assert.throws(() => compileJevAssessment(batch, invalid), /invalid_probabilities/);
  report.localProtocolCases += 1;
  const row = { id, demand: intent, fragments: batch.state.fragments, expected,
    localProtocol: 'PASS', wireBytes: Buffer.byteLength(JSON.stringify({ state: batch.state, questions: batch.questions })), runs: [] };
  report.results.push(row);
  if (live && report.credentialPresent) {
    for (let repetition = 0; repetition < repetitions; repetition += 1) {
      const started = performance.now();
      report.liveRequests += 1;
      try {
        const assessment = await requestJevAssessment(batch);
        report.liveResponses += 1;
        const observations = Object.entries(assessment.answers).map(([key, answer]) => ({
          questionId: key,
          choice: answer.choice, confidence: answer.confidence, probabilities: answer.probabilities,
          agreesWithRubric: expectedChoice(key) === answer.choice,
        }));
        row.runs.push({ status: 'VALID_RESPONSE', elapsedMs: Math.round(performance.now() - started),
          model: assessment.model, usage: assessment.usage, observations });
      } catch (error) {
        // Persist only a known error code, never provider bodies or credentials.
        const code = String(error?.message).split(':')[0];
        row.runs.push({ status: 'REQUEST_FAILED', elapsedMs: Math.round(performance.now() - started),
          code: /^[a-z_]+$/u.test(code) ? code : 'unexpected_error' });
        break;
      }
      await writeFile(reportPath, JSON.stringify(report, null, 2));
    }
  }
  process.stdout.write(`${id}: ${row.runs.at(-1)?.status ?? (live ? 'CREDENTIAL_MISSING' : 'LOCAL_PROTOCOL_PASS')}\n`);
  // Avoid repeatedly charging/retrying a broken connection.
  if (row.runs.some(({ status }) => status === 'REQUEST_FAILED')) break;
}
report.completedAt = new Date().toISOString();
const successfulRuns = report.results.flatMap((row) => row.runs).filter((run) => run.status === 'VALID_RESPONSE');
const observations = successfulRuns.flatMap((run) => run.observations);
report.summary = {
  rubricAgreement: observations.length === 0 ? null
    : observations.filter((observation) => observation.agreesWithRubric).length / observations.length,
  meanLatencyMs: successfulRuns.length === 0 ? null
    : Math.round(successfulRuns.reduce((sum, run) => sum + run.elapsedMs, 0) / successfulRuns.length),
  unstableCases: report.results.filter((row) => row.runs.length === 2
    && row.runs.every((run) => run.status === 'VALID_RESPONSE')
    && JSON.stringify(row.runs[0].observations.map((item) => item.choice))
      !== JSON.stringify(row.runs[1].observations.map((item) => item.choice))).map((row) => row.id),
};
report.status = live && !report.credentialPresent ? 'BLOCKED_MISSING_CREDENTIAL'
  : report.results.some((row) => row.runs.some((run) => run.status === 'REQUEST_FAILED')) ? 'STOPPED_ON_FAILURE'
    : live ? 'LIVE_COMPLETE' : 'LOCAL_COMPLETE';
await writeFile(reportPath, JSON.stringify(report, null, 2));
process.stdout.write(JSON.stringify({ status: report.status, reportPath, liveRequests: report.liveRequests,
  liveResponses: report.liveResponses, localProtocolCases: report.localProtocolCases }) + '\n');
if (live && report.status !== 'LIVE_COMPLETE') process.exitCode = 2;

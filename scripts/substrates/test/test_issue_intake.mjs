import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import process from 'node:process';
import {
  buildPreflightHandoff,
  captureDemand,
  discoverWorkspace,
  maxDemandBytes,
} from '../../lib/issue_contract_core.mjs';
import { formatIssueDemand, resolveIssueDemand, stripNoisyIssueSections } from '../../lib/issue_intake.mjs';
import { assertPreflightDocument } from '../../lib/preflight_integrity.mjs';

const rootDir = resolve(import.meta.dirname, '../../..');

// 1. Strip noisy comments, debug <details>, and log fences while keeping normal code/prose.
const rawBody = [
  '<!-- template hint -->',
  'Implementar validação de limite diário.',
  '',
  '<details><summary>Debug Logs</summary>',
  'Error: noisy stacktrace',
  '</details>',
  '',
  '```log',
  '[2026-11-12] noisy ci output',
  '```',
  '',
  '```ts',
  'export const limit = 100;',
  '```',
].join('\n');

const cleanedBody = stripNoisyIssueSections(rawBody);
assert.equal(cleanedBody.includes('template hint'), false);
assert.equal(cleanedBody.includes('noisy stacktrace'), false);
assert.equal(cleanedBody.includes('noisy ci output'), false);
assert.equal(cleanedBody.includes('Implementar validação de limite diário.'), true);
assert.equal(cleanedBody.includes('export const limit = 100;'), true);

// 2. Block magic capture when multiple open issues exist.
await assert.rejects(
  () => resolveIssueDemand([], {
    repositoryRoot: rootDir,
    execGh: async () => [
      { number: 1, title: 'Primeira issue' },
      { number: 2, title: 'Segunda issue' },
    ],
  }),
  /multiple_open_issues/,
);

// 3. Reject when no open issues exist.
await assert.rejects(
  () => resolveIssueDemand([], {
    repositoryRoot: rootDir,
    execGh: async () => [],
  }),
  /no_open_issues/,
);

// 4. Allow automatic capture only when a single open issue exists (without comments).
let requestedFields = '';
const singleResolved = await resolveIssueDemand([], {
  repositoryRoot: rootDir,
  execGh: async (ghArgs) => {
    if (ghArgs[1] === 'list') return [{ number: 7, title: 'Única issue aberta' }];
    requestedFields = ghArgs[ghArgs.indexOf('--json') + 1];
    return { number: 7, title: 'Única issue aberta', body: 'Corpo objetivo da demanda.' };
  },
});
assert.equal(requestedFields, 'number,title,body');
assert.equal(singleResolved.issueRef, '#7');
assert.equal(singleResolved.demandText, '# Issue #7: Única issue aberta\n\nCorpo objetivo da demanda.');

// 5. Normal demand keeps 64 KB ceiling, while issue demand scales up to accommodate issue size.
const oversizeNormal = 'a'.repeat(maxDemandBytes + 100);
assert.throws(() => captureDemand([oversizeNormal]), /input_too_large/);

const largeIssue = formatIssueDemand({
  number: 99,
  title: 'Issue estruturada extensa',
  body: 'x'.repeat(maxDemandBytes + 1024),
});
assert.ok(largeIssue.maxBytes > maxDemandBytes);
const capturedLargeIssue = captureDemand([largeIssue.demandText], { maxBytes: largeIssue.maxBytes });
const tempDir = mkdtempSync(resolve(tmpdir(), 'aegis-issue-intake-'));
try {
  mkdirSync(resolve(tempDir, 'src'), { recursive: true });
  writeFileSync(resolve(tempDir, 'src/index.ts'), 'export function ok() { return 1; }\n');
  const discovery = discoverWorkspace(tempDir, capturedLargeIssue);
  const preflight = buildPreflightHandoff({ demand: capturedLargeIssue, discovery, version: 'v3' });
  assertPreflightDocument(preflight);

  // 6. End-to-end CLI test with local issue file via `./aegis --issue`.
  cpSync(resolve(rootDir, 'aegis'), resolve(tempDir, 'aegis'));
  cpSync(resolve(rootDir, 'AGENTS.md'), resolve(tempDir, 'AGENTS.md'));
  cpSync(resolve(rootDir, 'ARCHITECTURE.md'), resolve(tempDir, 'ARCHITECTURE.md'));
  cpSync(resolve(rootDir, 'scripts'), resolve(tempDir, 'scripts'), { recursive: true });
  cpSync(resolve(rootDir, 'governance'), resolve(tempDir, 'governance'), { recursive: true });
  symlinkSync(resolve(rootDir, 'node_modules'), resolve(tempDir, 'node_modules'));
  mkdirSync(resolve(tempDir, '.harness/config'), { recursive: true });
  mkdirSync(resolve(tempDir, '.harness/runtime'), { recursive: true });
  writeFileSync(resolve(tempDir, '.harness/config/roles.json'), JSON.stringify({
    schema: 'aegis.role_assignment.v1',
    roles: {
      contractSupervisor: { channel: 'IDE', adapter: 'ide-native', model: null, credentialEnv: null },
      codingAgent: { channel: 'IDE', adapter: 'ide-native', model: null, credentialEnv: null },
    },
  }));
  writeFileSync(resolve(tempDir, 'issue-sample.md'), [
    '# Suporte a limite de estorno',
    '',
    '<!-- ignored comment -->',
    'Rejeitar estorno acima do saldo diário.',
    '',
    '```log',
    'noisy log line',
    '```',
  ].join('\n'));

  const stdout = execFileSync('bash', ['./aegis', '--issue', 'issue-sample.md'], {
    cwd: tempDir,
    encoding: 'utf8',
    env: { ...process.env, AEGIS_TEST_AUTOMATION: '1' },
  });
  const brief = JSON.parse(stdout);
  assert.equal(brief.schema, 'aegis.preflight_handoff.v3');
  assert.equal(brief.intent.includes('# Issue: Suporte a limite de estorno'), true);
  assert.equal(brief.intent.includes('Rejeitar estorno acima do saldo diário.'), true);
  assert.equal(brief.intent.includes('noisy log line'), false);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

process.stdout.write('[AEGIS][TEST] issue intake adapter and dynamic byte budget: PASS\n');

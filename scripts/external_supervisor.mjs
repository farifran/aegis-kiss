#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { sha256 } from './lib/canonical_json.mjs';
import { requestOpenAiJson } from './lib/openai_compatible.mjs';
import { assertSchema } from './lib/schema_validator.mjs';
import { loadSupervisorConfig, supervisorIdentity } from './lib/supervisor_config.mjs';

const root = resolve(process.env.AEGIS_ROOT ?? fileURLToPath(new URL('..', import.meta.url)));
const maxRequestBytes = 128 * 1024;
const maxResponseBytes = 256 * 1024;

function fail(code) {
  throw new Error(code);
}

async function readBoundedStdin() {
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    total += chunk.length;
    if (total > maxRequestBytes) fail('supervisor_request_budget_exceeded');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    fail('invalid_supervisor_request');
  }
}

async function writeAtomic(runtime, path, value) {
  await mkdir(runtime, { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, 'utf8');
  await rename(temporary, path);
}

export async function runExternalSupervisor(request, { repositoryRoot = root, requestFn = globalThis.fetch } = {}) {
  const startedAtEpochMs = Date.now();
  const started = performance.now();
  assertSchema('aegis.ide_semantic_request.v2', request);
  const config = await loadSupervisorConfig(repositoryRoot);
  if (config.mode !== 'EXTERNAL') fail('external_supervisor_not_configured');
  const supervisor = supervisorIdentity(config);
  const response = await requestOpenAiJson({
    config: config.external,
    system: 'Você é o compilador semântico do Aegis. Responda exclusivamente com o JSON exigido no prompt recebido.',
    prompt: request.prompt,
    maxResponseBytes,
    unavailableCode: 'external_supervisor_unavailable',
    timeoutCode: 'external_supervisor_timeout',
    responseCode: 'external_supervisor_invalid_response',
    requestFn,
  });
  const decision = response.value;
  assertSchema('aegis.preflight_decision.v2', decision);
  if (decision.contextDigest !== request.contextDigest || decision.promptDigest !== request.promptDigest) {
    fail('external_supervisor_binding_mismatch');
  }
  const runtime = resolve(repositoryRoot, '.harness/runtime');
  const decisionPath = resolve(runtime, 'preflight_decision.json');
  const decisionBytes = Buffer.from(`${JSON.stringify(decision)}\n`, 'utf8');
  const execution = {
    schema: 'aegis.supervisor_execution.v1',
    executionId: request.executionId,
    baseCommit: request.baseCommit,
    supervisor,
    promptDigest: request.promptDigest,
    decisionArtifactBytesDigest: sha256(decisionBytes),
    timing: {
      phase: 'external_supervisor',
      startedAtEpochMs,
      durationMs: Math.round((performance.now() - started) * 1000) / 1000,
    },
    usage: {
      promptTokens: response.usage.promptTokens,
      completionTokens: response.usage.completionTokens,
    },
  };
  await writeAtomic(runtime, decisionPath, decision);
  await writeAtomic(runtime, resolve(runtime, 'supervisor_execution.json'), execution);
  return {
    schema: 'aegis.external_semantic_result.v1',
    status: 'SEMANTIC_DECISION_READY',
    decisionPath: '.harness/runtime/preflight_decision.json',
    supervisor,
    decision,
    execution,
  };
}

if ((process.argv[1] ?? '').endsWith('/external_supervisor.mjs')) {
  try {
    const result = await runExternalSupervisor(await readBoundedStdin());
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`[AEGIS][SUPERVISOR][FATAL] ${error instanceof Error ? error.message : 'external_supervisor_failed'}\n`);
    process.exit(1);
  }
}

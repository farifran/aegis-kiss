#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { resolve } from 'node:path';
import { clearTimeout as clearScheduledTimeout, setTimeout as scheduleTimeout } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';
import { sha256 } from './lib/canonical_json.mjs';
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

function extractJson(content) {
  if (typeof content !== 'string' || content.length === 0) fail('supervisor_empty_response');
  const trimmed = content.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    fail('supervisor_invalid_json');
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
  const { endpoint, model, apiKeyEnv, timeoutMs } = config.external;
  const headers = { 'content-type': 'application/json' };
  if (apiKeyEnv !== null) {
    const token = process.env[apiKeyEnv];
    if (typeof token !== 'string' || token.length === 0) fail('external_supervisor_api_key_missing');
    headers.authorization = `Bearer ${token}`;
  }
  if (typeof requestFn !== 'function' || typeof globalThis.AbortController !== 'function') {
    fail('external_supervisor_runtime_unavailable');
  }
  const controller = new globalThis.AbortController();
  const timer = scheduleTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await requestFn(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: 'system', content: 'Você é o compilador semântico do Aegis. Responda exclusivamente com o JSON exigido no prompt recebido.' },
          { role: 'user', content: request.prompt },
        ],
      }),
    });
  } catch (error) {
    if (error?.name === 'AbortError') fail('external_supervisor_timeout');
    fail('external_supervisor_unavailable');
  } finally {
    clearScheduledTimeout(timer);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxResponseBytes) fail('external_supervisor_response_budget_exceeded');
  if (!response.ok) fail(`external_supervisor_http_${response.status}`);
  let payload;
  try {
    payload = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('external_supervisor_invalid_response');
  }
  const decision = extractJson(payload?.choices?.[0]?.message?.content);
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
      promptTokens: Number.isInteger(payload?.usage?.prompt_tokens) ? payload.usage.prompt_tokens : null,
      completionTokens: Number.isInteger(payload?.usage?.completion_tokens) ? payload.usage.completion_tokens : null,
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

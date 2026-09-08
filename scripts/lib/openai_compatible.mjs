import { Buffer } from 'node:buffer';
import process from 'node:process';
import { clearTimeout as clearScheduledTimeout, setTimeout as scheduleTimeout } from 'node:timers';

function fail(code) {
  throw new Error(code);
}

function jsonFromContent(content, code) {
  if (typeof content !== 'string' || content.length === 0) fail(code);
  const trimmed = content.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    fail(code);
  }
}

export async function requestOpenAiJson({
  config,
  system,
  prompt,
  maxResponseBytes,
  unavailableCode,
  timeoutCode,
  responseCode,
  requestFn = globalThis.fetch,
}) {
  const headers = { 'content-type': 'application/json' };
  if (config.apiKeyEnv !== null) {
    const token = process.env[config.apiKeyEnv];
    if (typeof token !== 'string' || token.length === 0) fail('external_model_api_key_missing');
    headers.authorization = `Bearer ${token}`;
  }
  if (typeof requestFn !== 'function' || typeof globalThis.AbortController !== 'function') {
    fail('external_model_runtime_unavailable');
  }
  const controller = new globalThis.AbortController();
  const timer = scheduleTimeout(() => controller.abort(), config.timeoutMs);
  let response;
  try {
    response = await requestFn(`${config.endpoint}/chat/completions`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      }),
    });
  } catch (error) {
    if (error?.name === 'AbortError') fail(timeoutCode);
    fail(unavailableCode);
  } finally {
    clearScheduledTimeout(timer);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxResponseBytes) fail('external_model_response_budget_exceeded');
  if (!response.ok) fail(`${responseCode}_${response.status}`);
  let payload;
  try {
    payload = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail(responseCode);
  }
  return {
    value: jsonFromContent(payload?.choices?.[0]?.message?.content, responseCode),
    usage: {
      promptTokens: Number.isInteger(payload?.usage?.prompt_tokens) ? payload.usage.prompt_tokens : null,
      completionTokens: Number.isInteger(payload?.usage?.completion_tokens) ? payload.usage.completion_tokens : null,
    },
  };
}

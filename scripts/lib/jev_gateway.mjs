import { TypeSafeClient } from '@typesafe-ai/sdk';
import process from 'node:process';

import { canonicalDigest } from './canonical_json.mjs';
import {
  assertJevAssessment,
  assertJevDecisionBatch,
} from './jev_projection.mjs';

const gatewayBaseUrl = 'https://ai-gateway.vercel.sh/typesafe';

function gatewayFailure(error) {
  const detail = error instanceof Error ? error.message : 'unknown_gateway_failure';
  if (error?.status === 401) {
    return new Error(`jev_gateway_authentication_failed:${detail}`);
  }
  if (error?.status === 403 && /credit card|customer_verification_required/iu.test(detail)) {
    return new Error(`jev_gateway_billing_required:${detail}`);
  }
  if (error?.status === 403) {
    return new Error(`jev_gateway_access_denied:${detail}`);
  }
  if (error?.status === 429) {
    return new Error(`jev_gateway_rate_limited:${detail}`);
  }
  if (error?.status === 422) {
    return new Error(`jev_gateway_request_rejected:${detail}`);
  }
  return new Error(`jev_gateway_unavailable:${detail}`);
}

export function compileJevAssessment(batch, response) {
  assertJevDecisionBatch(batch);
  const payload = {
    schema: 'aegis.jev_assessment.v1',
    sourceBatchDigest: batch.batchDigest,
    authority: 'ADVISORY_ONLY',
    provider: 'TYPESAFE_JEV',
    transport: 'VERCEL_AI_GATEWAY',
    model: response.model,
    answers: response.answers,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
  const assessment = {
    ...payload,
    assessmentDigest: canonicalDigest(payload),
  };
  assertJevAssessment(assessment, batch);
  return assessment;
}

export async function requestJevAssessment(batch, options = {}) {
  assertJevDecisionBatch(batch);
  const apiKey = options.apiKey ?? process.env.AI_GATEWAY_API_KEY;
  if (typeof apiKey !== 'string' || apiKey.trim() === '') {
    throw new Error('jev_gateway_api_key_missing');
  }
  const client = options.client ?? new TypeSafeClient({
    apiKey,
    baseURL: gatewayBaseUrl,
    defaultModel: 'jev-latest',
    logLevel: 'off',
    timeout: options.timeoutMs ?? 10_000,
    retry: { maxRetries: options.maxRetries ?? 2 },
  });
  let response;
  try {
    response = await client.systemOne({
      state: batch.state,
      questions: batch.questions,
    });
  } catch (error) {
    throw gatewayFailure(error);
  }
  return compileJevAssessment(batch, response);
}

#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

import { assertSchema } from './lib/schema_validator.mjs';

const root = resolve(process.env.AEGIS_ROOT ?? process.cwd());
const runtimeDir = resolve(root, '.harness', 'runtime');
const userConfirmationPath = resolve(runtimeDir, 'user_confirmation_request.json');
const resolutionPath = resolve(runtimeDir, 'preflight_resolution.json');

async function main() {
  if (!existsSync(userConfirmationPath)) {
    process.stderr.write('{"schema":"aegis.rejection.v1","status":"REJECTED","phase":"RESOLVE","reason":"MISSING_USER_CONFIRMATION"}\n');
    process.exit(1);
  }

  const request = JSON.parse(await readFile(userConfirmationPath, 'utf8'));
  const rawArgs = process.argv.slice(2);

  if (rawArgs.length === 0) {
    process.stderr.write('{"schema":"aegis.rejection.v1","status":"REJECTED","phase":"RESOLVE","reason":"MISSING_ARGUMENT"}\n');
    process.exit(1);
  }

  let answers = [];
  if (rawArgs[0] === '--json') {
    if (!rawArgs[1]) {
      process.stderr.write('{"schema":"aegis.rejection.v1","status":"REJECTED","phase":"RESOLVE","reason":"MISSING_JSON_PAYLOAD"}\n');
      process.exit(1);
    }
    answers = JSON.parse(rawArgs[1]);
  } else {
    answers = rawArgs.map((arg) => {
      const parts = arg.split('=');
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw new Error(`Formato de resposta inválido '${arg}'. Use Q-0001=ANS-0001 ou --json.`);
      }
      return { questionId: parts[0], answerId: parts[1] };
    });
  }

  // Validação semântica contra o pedido ativo
  for (const answer of answers) {
    const question = request.questions.find((q) => q.id === answer.questionId);
    if (!question) {
      process.stderr.write(`Pergunta ${answer.questionId} não existe no pedido de confirmação ativo.\n`);
      process.exit(1);
    }
    if ('answerId' in answer) {
      const option = question.answers.find((a) => a.id === answer.answerId);
      if (!option) {
        process.stderr.write(`Opção ${answer.answerId} não existe para a pergunta ${answer.questionId}.\n`);
        process.exit(1);
      }
    }
  }

  const resolution = {
    schema: 'aegis.semantic_resolution.v2',
    executionId: request.executionId,
    contractDraftDigest: request.contractDraftDigest,
    method: 'INTERACTIVE_WIZARD',
    attestation: 'CONTRACT_REVIEWED_AND_APPROVED',
    answers,
  };

  assertSchema('aegis.semantic_resolution.v2', resolution);
  await writeFile(resolutionPath, `${JSON.stringify(resolution, null, 2)}\n`, 'utf8');
  process.stdout.write(`[AEGIS][RESOLVE] Decisões gravadas com sucesso para ${answers.length} pergunta(s).\n`);
}

main().catch((err) => {
  process.stderr.write(`[AEGIS][RESOLVE_ERROR] ${err.message}\n`);
  process.exit(1);
});

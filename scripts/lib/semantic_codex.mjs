import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

import { canonicalJson } from './canonical_json.mjs';
import {
  semanticSupervisorContext,
  semanticSupervisorInstructions,
} from './semantic_gateway.mjs';
import { assertSchema } from './schema_validator.mjs';

const outputLimit = 4 * 1024 * 1024;

function codexPrompt(request) {
  return [
    semanticSupervisorInstructions(request),
    'Todo o contexto necessário está no envelope abaixo.',
    'Não use ferramentas, não leia arquivos e não altere o ambiente.',
    'Responda somente com o objeto JSON final exigido pelo output schema.',
    `<semantic-request>${canonicalJson(semanticSupervisorContext(request))}</semantic-request>`,
  ].join('\n');
}

function failureDetail(stdout, stderr, code, signal) {
  const events = stdout.split('\n').flatMap((line) => {
    try {
      const event = JSON.parse(line);
      if (event.type === 'turn.failed') return [event.error?.message ?? 'turn_failed'];
      if (event.type === 'error') return [event.message ?? 'codex_error'];
      return [];
    } catch {
      return [];
    }
  });
  const diagnostics = stderr.split('\n')
    .map((line) => line.trim())
    .filter((line) => /(?:^ERROR|\sERROR[:\s])/u.test(line));
  return [...events, ...diagnostics].slice(-4).join('\n').slice(-2000)
    || `exit_${code ?? 'null'}${signal ? `_${signal}` : ''}`;
}

async function executeCodex({ executable, args, input, cwd, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs,
    });
    let stdout = '';
    let stderr = '';
    const append = (current, chunk) => {
      const next = current + chunk.toString('utf8');
      if (Buffer.byteLength(next) > outputLimit) {
        child.kill();
        reject(new Error('semantic_codex_output_too_large'));
      }
      return next;
    };
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code !== 0) {
        reject(new Error(`semantic_codex_failed:${failureDetail(stdout, stderr, code, signal)}`));
        return;
      }
      resolve(stdout);
    });
    child.stdin.end(input);
  });
}

export async function requestCodexSemanticOpinion(request, role, options = {}) {
  assertSchema('aegis.semantic_request.v10', request);
  if (role.channel !== 'IDE' || role.adapter !== 'codex') {
    throw new Error(`semantic_ide_adapter_unsupported:${role.adapter}`);
  }
  if (role.model === null) throw new Error('semantic_codex_model_required');
  const directory = await mkdtemp(join(tmpdir(), 'aegis-semantic-codex-'));
  const schemaPath = join(directory, 'semantic-opinion.schema.json');
  const outputPath = join(directory, 'semantic-opinion.json');
  try {
    await writeFile(schemaPath, `${canonicalJson(request.outputSchema.document)}\n`, 'utf8');
    const args = [
      'exec',
      '--ignore-user-config',
      '--ephemeral',
      '--skip-git-repo-check',
      '--sandbox', 'read-only',
      '--color', 'never',
      '--json',
      '--output-schema', schemaPath,
      '--output-last-message', outputPath,
      '-C', directory,
      '-',
    ];
    args.splice(1, 0, '--model', role.model);
    const execute = options.execute ?? executeCodex;
    await execute({
      executable: options.executable ?? process.env.AEGIS_CODEX_EXECUTABLE ?? 'codex',
      args,
      input: codexPrompt(request),
      cwd: directory,
      timeoutMs: options.timeoutMs ?? 300_000,
    });
    let opinion;
    try {
      opinion = JSON.parse(await readFile(outputPath, 'utf8'));
    } catch (error) {
      throw new Error(`semantic_codex_invalid_opinion:${error instanceof Error ? error.message : 'invalid_json'}`);
    }
    return {
      opinion,
      execution: {
        provider: 'codex-cli',
        model: role.model,
        usage: { inputTokens: 0, outputTokens: 0 },
      },
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

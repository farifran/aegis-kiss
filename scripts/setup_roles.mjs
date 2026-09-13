#!/usr/bin/env node

import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, URL } from 'node:url';

import {
  assertRoleAssignment,
  loadRoleAssignment,
  publicRoleAssignmentSummary,
  roleAssignmentPath,
  roleAssignmentRelativePath,
} from './lib/role_assignment.mjs';
import { canonicalJson } from './lib/canonical_json.mjs';

const root = resolve(process.env.AEGIS_ROOT ?? fileURLToPath(new URL('..', import.meta.url)));

function rejection(reason, detail = '') {
  const error = new Error(reason);
  if (detail) error.detail = detail;
  return error;
}

function trimAnswer(value) {
  return value.normalize('NFC').trim();
}

async function askRequired(terminal, question, defaultValue = '') {
  const answer = trimAnswer(await terminal.question(question));
  const value = answer || defaultValue;
  if (!value) throw rejection('SETUP_VALUE_REQUIRED');
  return value;
}

async function chooseChannel(terminal, label) {
  process.stderr.write(`\n${label}\n  1) API de modelo\n  2) IDE/agente\n`);
  const answer = await askRequired(terminal, 'Escolha [1]: ', '1');
  if (answer === '1') return 'API';
  if (answer === '2') return 'IDE';
  throw rejection('INVALID_SETUP_CHANNEL');
}

function assertAdapter(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value) || value.length > 80) {
    throw rejection('INVALID_ADAPTER_IDENTIFIER');
  }
  return value;
}

function assertEnvironmentVariable(value) {
  if (!/^[A-Z][A-Z0-9_]*$/u.test(value)) throw rejection('INVALID_CREDENTIAL_ENVIRONMENT_VARIABLE');
  return value;
}

async function configureRole(terminal, label, defaults) {
  const channel = await chooseChannel(terminal, label);
  const compatibleDefaults = defaults?.channel === channel ? defaults : null;
  const adapter = assertAdapter(await askRequired(
    terminal,
    'Adaptador (ex.: openai-compatible, codex, cursor): ',
    compatibleDefaults?.adapter ?? (channel === 'API' ? 'openai-compatible' : 'codex'),
  ));
  const modelAnswer = trimAnswer(await terminal.question(
    `Modelo${channel === 'API' ? '' : ' (opcional)'}${compatibleDefaults?.model ? ` [${compatibleDefaults.model}]` : ''}: `,
  ));
  const model = modelAnswer || compatibleDefaults?.model || null;
  if (channel === 'API' && model === null) throw rejection('API_MODEL_REQUIRED');
  if (model !== null && model.length > 120) throw rejection('INVALID_MODEL_IDENTIFIER');
  if (channel === 'IDE') return { channel, adapter, model, credentialEnv: null };

  process.stderr.write('Informe somente o NOME da variável de ambiente. A chave nunca é digitada nem gravada pelo Aegis.\n');
  const credentialEnv = assertEnvironmentVariable(await askRequired(
    terminal,
    `Variável da chave${compatibleDefaults?.credentialEnv ? ` [${compatibleDefaults.credentialEnv}]` : ' [AEGIS_SUPERVISOR_API_KEY]'}: `,
    compatibleDefaults?.credentialEnv ?? 'AEGIS_SUPERVISOR_API_KEY',
  ));
  return { channel, adapter, model, credentialEnv };
}

async function configure() {
  if (!process.stdin.isTTY || !process.stderr.isTTY) throw rejection('SETUP_REQUIRES_INTERACTIVE_TERMINAL');
  const previous = await loadRoleAssignment(root);
  const terminal = createInterface({ input: process.stdin, output: process.stderr });
  try {
    if (previous) {
      const replace = trimAnswer(await terminal.question('Já existe uma configuração local. Substituir? [s/N]: '));
      if (!['s', 'sim', 'y', 'yes'].includes(replace.toLocaleLowerCase('pt-BR'))) {
        process.stdout.write(`${canonicalJson({ status: 'UNCHANGED', path: roleAssignmentRelativePath })}\n`);
        return;
      }
    }
    const contractSupervisor = await configureRole(
      terminal,
      'Quem supervisiona o contrato?',
      previous?.roles.contractSupervisor,
    );
    process.stderr.write('\nQuem executará código depois de uma autorização humana separada?\n  1) A mesma opção do supervisor\n  2) Configurar outra opção\n');
    const codingChoice = await askRequired(terminal, 'Escolha [1]: ', '1');
    let codingAgent;
    if (codingChoice === '1') {
      codingAgent = { ...contractSupervisor };
    } else if (codingChoice === '2') {
      codingAgent = await configureRole(terminal, 'Agente de codificação', previous?.roles.codingAgent);
    } else {
      throw rejection('INVALID_CODING_AGENT_SELECTION');
    }
    const assignment = {
      schema: 'aegis.role_assignment.v1',
      roles: { contractSupervisor, codingAgent },
    };
    assertRoleAssignment(assignment);
    const path = roleAssignmentPath(root);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${canonicalJson(assignment)}\n`, { encoding: 'utf8', mode: 0o600 });
    await chmod(path, 0o600);
    process.stdout.write(`${canonicalJson({
      status: 'CONFIGURED',
      path: roleAssignmentRelativePath,
      ...publicRoleAssignmentSummary(assignment),
    })}\n`);
  } finally {
    terminal.close();
  }
}

async function show() {
  const assignment = await loadRoleAssignment(root);
  if (assignment === null) throw rejection('ROLE_ASSIGNMENT_NOT_CONFIGURED');
  process.stdout.write(`${canonicalJson({
    status: 'CONFIGURED',
    path: roleAssignmentRelativePath,
    ...publicRoleAssignmentSummary(assignment),
  })}\n`);
}

try {
  if (process.argv.length === 2) await configure();
  else if (process.argv.length === 3 && process.argv[2] === '--show') await show();
  else throw rejection('INVALID_SETUP_ARITY');
} catch (error) {
  const message = error instanceof Error ? error.message : 'setup_failed';
  process.stderr.write(`${JSON.stringify({
    schema: 'aegis.rejection.v1',
    status: 'REJECTED',
    phase: 'SETUP',
    reason: message.replace(/[^a-z0-9]+/giu, '_').toUpperCase(),
    ...(error?.detail ? { detail: error.detail } : {}),
  })}\n`);
  process.exitCode = 1;
}

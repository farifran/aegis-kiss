import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { canonicalDigest } from './canonical_json.mjs';

const root = resolve(process.env.AEGIS_ROOT ?? fileURLToPath(new URL('../..', import.meta.url)));
export const supervisorConfigRelativePath = '.harness/supervisor.json';

function fail(code) {
  throw new Error(code);
}

function validEnvironmentName(value) {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]*$/u.test(value);
}

function validEndpoint(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024) return false;
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.username.length === 0 && parsed.password.length === 0;
  } catch {
    return false;
  }
}

function normalizeExternal(value) {
  if (
    value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !['endpoint', 'model', 'apiKeyEnv', 'timeoutMs'].includes(key))
    || !validEndpoint(value.endpoint)
    || typeof value.model !== 'string' || value.model.length === 0 || value.model.length > 256
    || !(value.apiKeyEnv === null || validEnvironmentName(value.apiKeyEnv))
    || !Number.isInteger(value.timeoutMs) || value.timeoutMs < 1_000 || value.timeoutMs > 120_000
  ) {
    fail('invalid_supervisor_config');
  }
  return {
    endpoint: value.endpoint.replace(/\/+$/u, ''),
    model: value.model,
    apiKeyEnv: value.apiKeyEnv,
    timeoutMs: value.timeoutMs,
  };
}

function normalizeConfig(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || value.schema !== 'aegis.supervisor_config.v1') {
    fail('invalid_supervisor_config');
  }
  const allowed = value.mode === 'IDE'
    ? ['schema', 'mode', 'reviewer']
    : ['schema', 'mode', 'external', 'reviewer'];
  if (!['IDE', 'EXTERNAL'].includes(value.mode) || Object.keys(value).some((key) => !allowed.includes(key))) {
    fail('invalid_supervisor_config');
  }
  const reviewer = value.reviewer === undefined || value.reviewer === null ? null : normalizeExternal(value.reviewer);
  if (value.mode === 'IDE') return { schema: 'aegis.supervisor_config.v1', mode: 'IDE', reviewer };
  return {
    schema: 'aegis.supervisor_config.v1',
    mode: 'EXTERNAL',
    external: normalizeExternal(value.external),
    reviewer,
  };
}

export function defaultSupervisorConfig() {
  return { schema: 'aegis.supervisor_config.v1', mode: 'IDE', reviewer: null };
}

export function supervisorIdentity(config) {
  const normalized = normalizeConfig(config);
  return normalized.mode === 'IDE'
    ? { mode: 'IDE', id: 'ide-active-model', configDigest: canonicalDigest(normalized) }
    : { mode: 'EXTERNAL', id: normalized.external.model, configDigest: canonicalDigest(normalized) };
}

export function reviewerIdentity(config) {
  const reviewer = normalizeConfig(config).reviewer;
  if (reviewer === null) return null;
  return {
    mode: 'EXTERNAL',
    id: reviewer.model,
    configDigest: canonicalDigest({ schema: 'aegis.reviewer_config.v1', external: reviewer }),
  };
}

export async function loadSupervisorConfig(repositoryRoot = root) {
  const path = resolve(repositoryRoot, supervisorConfigRelativePath);
  try {
    return normalizeConfig(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if (error?.code === 'ENOENT') return defaultSupervisorConfig();
    if (error instanceof Error && error.message === 'invalid_supervisor_config') throw error;
    fail('invalid_supervisor_config');
  }
}

export async function writeSupervisorConfig(config, repositoryRoot = root) {
  const normalized = normalizeConfig(config);
  const path = resolve(repositoryRoot, supervisorConfigRelativePath);
  await mkdir(resolve(repositoryRoot, '.harness'), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(normalized)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, path);
  return supervisorIdentity(normalized);
}

function usage() {
  process.stdout.write('Uso: node scripts/lib/supervisor_config.mjs show | ide | external --endpoint <url> --model <id> [--api-key-env <VAR>] [--timeout-ms <n>] | reviewer off | reviewer external --endpoint <url> --model <id> [--api-key-env <VAR>] [--timeout-ms <n>]\n');
}

function parseExternalOptions(rest) {
  const options = { endpoint: '', model: '', apiKeyEnv: null, timeoutMs: 45_000 };
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (value === undefined) return null;
    if (key === '--endpoint' && options.endpoint.length === 0) options.endpoint = value;
    else if (key === '--model' && options.model.length === 0) options.model = value;
    else if (key === '--api-key-env' && options.apiKeyEnv === null) options.apiKeyEnv = value;
    else if (key === '--timeout-ms' && options.timeoutMs === 45_000 && /^\d+$/u.test(value)) options.timeoutMs = Number(value);
    else return null;
  }
  return options.endpoint.length > 0 && options.model.length > 0 ? options : null;
}

function parseCommand(argv) {
  const [command, ...rest] = argv;
  if (command === 'show' && rest.length === 0) return { command };
  if (command === 'ide' && rest.length === 0) return { command };
  if (command === 'external') {
    const options = parseExternalOptions(rest);
    return options === null ? null : { command, options };
  }
  if (command === 'reviewer' && rest[0] === 'off' && rest.length === 1) return { command: 'reviewer-off' };
  if (command === 'reviewer' && rest[0] === 'external') {
    const options = parseExternalOptions(rest.slice(1));
    return options === null ? null : { command: 'reviewer-external', options };
  }
  return null;
}

if ((process.argv[1] ?? '').endsWith('/supervisor_config.mjs')) {
  const parsed = parseCommand(process.argv.slice(2));
  if (parsed === null) {
    usage();
    process.exit(1);
  }
  try {
    if (parsed.command === 'show') {
      const config = await loadSupervisorConfig(root);
      process.stdout.write(`${JSON.stringify({ schema: 'aegis.supervisor_setup.v1', status: 'CONFIGURED', supervisor: supervisorIdentity(config), reviewer: reviewerIdentity(config) })}\n`);
    } else {
      const current = await loadSupervisorConfig(root);
      let config;
      if (parsed.command === 'ide') config = { ...defaultSupervisorConfig(), reviewer: current.reviewer };
      else if (parsed.command === 'external') config = { schema: 'aegis.supervisor_config.v1', mode: 'EXTERNAL', external: parsed.options, reviewer: current.reviewer };
      else if (parsed.command === 'reviewer-off') config = { ...current, reviewer: null };
      else config = { ...current, reviewer: parsed.options };
      const supervisor = await writeSupervisorConfig(config, root);
      const normalized = await loadSupervisorConfig(root);
      process.stdout.write(`${JSON.stringify({ schema: 'aegis.supervisor_setup.v1', status: 'CONFIGURED', supervisor, reviewer: reviewerIdentity(normalized) })}\n`);
    }
  } catch (error) {
    process.stderr.write(`[AEGIS][SETUP][FATAL] ${error instanceof Error ? error.message : 'setup_failed'}\n`);
    process.exit(1);
  }
}

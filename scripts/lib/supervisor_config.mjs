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

function normalizeConfig(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || value.schema !== 'aegis.supervisor_config.v1') {
    fail('invalid_supervisor_config');
  }
  if (value.mode === 'IDE') {
    if (Object.keys(value).some((key) => !['schema', 'mode'].includes(key))) fail('invalid_supervisor_config');
    return { schema: 'aegis.supervisor_config.v1', mode: 'IDE' };
  }
  if (value.mode !== 'EXTERNAL' || Object.keys(value).some((key) => !['schema', 'mode', 'external'].includes(key))) {
    fail('invalid_supervisor_config');
  }
  const external = value.external;
  if (
    external === null || typeof external !== 'object' || Array.isArray(external)
    || Object.keys(external).some((key) => !['endpoint', 'model', 'apiKeyEnv', 'timeoutMs'].includes(key))
    || !validEndpoint(external.endpoint)
    || typeof external.model !== 'string' || external.model.length === 0 || external.model.length > 256
    || !(external.apiKeyEnv === null || validEnvironmentName(external.apiKeyEnv))
    || !Number.isInteger(external.timeoutMs) || external.timeoutMs < 1_000 || external.timeoutMs > 120_000
  ) {
    fail('invalid_supervisor_config');
  }
  return {
    schema: 'aegis.supervisor_config.v1',
    mode: 'EXTERNAL',
    external: {
      endpoint: external.endpoint.replace(/\/+$/u, ''),
      model: external.model,
      apiKeyEnv: external.apiKeyEnv,
      timeoutMs: external.timeoutMs,
    },
  };
}

export function defaultSupervisorConfig() {
  return { schema: 'aegis.supervisor_config.v1', mode: 'IDE' };
}

export function supervisorIdentity(config) {
  const normalized = normalizeConfig(config);
  return normalized.mode === 'IDE'
    ? { mode: 'IDE', id: 'ide-active-model', configDigest: canonicalDigest(normalized) }
    : { mode: 'EXTERNAL', id: normalized.external.model, configDigest: canonicalDigest(normalized) };
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
  process.stdout.write('Uso: node scripts/lib/supervisor_config.mjs show | ide | external --endpoint <url> --model <id> [--api-key-env <VAR>] [--timeout-ms <n>]\n');
}

function parseCommand(argv) {
  const [command, ...rest] = argv;
  if (command === 'show' && rest.length === 0) return { command };
  if (command === 'ide' && rest.length === 0) return { command };
  if (command !== 'external') return null;
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
  return { command, options };
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
      process.stdout.write(`${JSON.stringify({ schema: 'aegis.supervisor_setup.v1', status: 'CONFIGURED', supervisor: supervisorIdentity(config) })}\n`);
    } else {
      const config = parsed.command === 'ide'
        ? defaultSupervisorConfig()
        : { schema: 'aegis.supervisor_config.v1', mode: 'EXTERNAL', external: parsed.options };
      const supervisor = await writeSupervisorConfig(config, root);
      process.stdout.write(`${JSON.stringify({ schema: 'aegis.supervisor_setup.v1', status: 'CONFIGURED', supervisor })}\n`);
    }
  } catch (error) {
    process.stderr.write(`[AEGIS][SETUP][FATAL] ${error instanceof Error ? error.message : 'setup_failed'}\n`);
    process.exit(1);
  }
}

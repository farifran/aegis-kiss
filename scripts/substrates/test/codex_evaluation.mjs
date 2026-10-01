// Shared opt-in experiment transport, not a runtime model fallback.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout, clearTimeout } from 'node:timers';
import { performance } from 'node:perf_hooks';
import { Buffer } from 'node:buffer';

export async function codexEvaluation({ model, prompt, schema }) {
  const dir = await mkdtemp(join(tmpdir(), 'aegis-eval-call-'));
  await writeFile(join(dir, 'schema.json'), JSON.stringify(schema));
  await writeFile(join(dir, 'prompt.txt'), prompt);
  const start = performance.now();
  let events = '';
  await new Promise((resolve, reject) => {
    const child = spawn('codex', ['exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '-C', dir,
      '--model', model, '--output-schema', join(dir, 'schema.json'), '--output-last-message', join(dir, 'answer.json'), '--json', '--color', 'never', '-'],
    { stdio: ['pipe', 'pipe', 'ignore'] });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('evaluation_timeout')); }, 180000);
    child.stdout.on('data', (chunk) => { events += chunk.toString(); });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`evaluation_exit_${code}`)); });
    child.stdin.on('error', reject);
    child.stdin.end(prompt);
  });
  const parsed = events.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  // A contaminated run is a failure, never an accuracy result.
  if (parsed.some((event) => event.item && !['agent_message', 'reasoning'].includes(event.item.type))) {
    throw new Error('evaluation_used_tools_or_actions');
  }
  const answer = JSON.parse(await readFile(join(dir, 'answer.json'), 'utf8'));
  return { answer, elapsedMs: Math.round(performance.now() - start), usage: parsed.find((event) => event.type === 'turn.completed')?.usage ?? null,
    promptBytes: Buffer.byteLength(prompt), artifacts: dir };
}

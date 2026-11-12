import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { basename, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { maxDemandBytes, maxIssueDemandBytes } from './issue_contract_core.mjs';

const execFileAsync = promisify(execFile);

const noisySummaryPattern = /\b(?:logs?|stack\s*trace|trace|debug|console|output|stdout|stderr|ci\s+output|error\s+log)\b/iu;
const noisyDetailsPattern = /<details\b[^>]*>\s*<summary\b[^>]*>([\s\S]*?)<\/summary>[\s\S]*?<\/details>/giu;
const noisyFencePattern = /(^|\n)(`{3,}|~{3,})\s*(?:log|logs|stacktrace|trace|console|output|stdout|stderr)\b[^\n]*\n[\s\S]*?\n\2[ \t]*(?=\n|$)/giu;
const htmlCommentPattern = /<!--[\s\S]*?-->/gu;
const githubIssueRefPattern = /^#?(\d+)$/u;
const githubIssueUrlPattern = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/\d+(?:[/?#].*)?$/iu;

async function defaultExecGh(ghArgs, { cwd }) {
  try {
    const { stdout } = await execFileAsync('gh', ghArgs, {
      cwd,
      timeout: 15_000,
      maxBuffer: 2 * 1024 * 1024,
      encoding: 'utf8',
    });
    return JSON.parse(stdout);
  } catch (error) {
    const reason = error?.code === 'ENOENT' ? 'gh_cli_unavailable' : (error?.stderr || error?.message || 'gh_command_failed');
    throw new Error(`issue_fetch_failed:${String(reason).trim().split('\n')[0]}`);
  }
}

/**
 * Remove seções ruidosas (comentários HTML, blocos de log/stacktrace e details de debug)
 * preservando a especificação e blocos de código normativos da issue.
 */
export function stripNoisyIssueSections(body = '') {
  if (typeof body !== 'string' || body.length === 0) return '';
  let cleaned = body.replace(/\r\n?/gu, '\n');
  cleaned = cleaned.replace(htmlCommentPattern, '');
  cleaned = cleaned.replace(noisyDetailsPattern, (fullMatch, summary) => (
    noisySummaryPattern.test(summary) ? '' : fullMatch
  ));
  cleaned = cleaned.replace(noisyFencePattern, '$1');
  cleaned = cleaned.replace(/\n{3,}/gu, '\n\n').trim();
  return cleaned;
}

/**
 * Formata título e corpo limpo da issue como demanda única e calcula o teto
 * necessário para que o cabeçalho e o tamanho da issue não restrinjam a demanda.
 */
export function formatIssueDemand({ number = null, title, body = '' }) {
  const cleanTitle = String(title ?? '').replace(/\r\n?/gu, '\n').trim();
  if (cleanTitle.length === 0) {
    throw new Error('invalid_issue_title');
  }
  const cleanBody = stripNoisyIssueSections(body);
  const header = number !== null ? `# Issue #${number}: ${cleanTitle}` : `# Issue: ${cleanTitle}`;
  const demandText = cleanBody.length > 0 ? `${header}\n\n${cleanBody}` : header;
  const headerBytes = Buffer.byteLength(header, 'utf8');
  const totalBytes = Buffer.byteLength(demandText, 'utf8');
  if (totalBytes > maxIssueDemandBytes) {
    throw new Error('input_too_large');
  }
  const maxBytes = Math.min(maxIssueDemandBytes, Math.max(maxDemandBytes, totalBytes));
  return {
    demandText,
    headerBytes,
    totalBytes,
    maxBytes,
  };
}

function readLocalIssueFile(fileRef, repositoryRoot) {
  const resolved = resolve(repositoryRoot, fileRef);
  const rootPrefix = repositoryRoot.endsWith(sep) ? repositoryRoot : `${repositoryRoot}${sep}`;
  if (!resolved.startsWith(rootPrefix) || !existsSync(resolved)) {
    throw new Error(`invalid_issue_reference:${fileRef}`);
  }
  const stats = lstatSync(resolved);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`invalid_issue_reference:${fileRef}`);
  }
  const raw = readFileSync(resolved, 'utf8').replace(/\r\n?/gu, '\n');
  const lines = raw.split('\n');
  const headingMatch = lines[0]?.match(/^#\s+(.+)$/u);
  const title = headingMatch ? headingMatch[1].trim() : basename(resolved);
  const body = headingMatch ? lines.slice(1).join('\n') : raw;
  return {
    sourceKind: 'LOCAL_FILE',
    issueRef: fileRef,
    ...formatIssueDemand({ number: null, title, body }),
  };
}

/**
 * Resolve uma issue explícita (número, URL ou arquivo local) ou captura a única
 * issue aberta quando não houver ambiguidade. Bloqueia captura mágica se houver >1 aberta.
 */
export async function resolveIssueDemand(args, {
  repositoryRoot,
  execGh = defaultExecGh,
} = {}) {
  if (!Array.isArray(args) || args.length > 1) {
    throw new Error('invalid_issue_arity');
  }

  if (args.length === 1) {
    const ref = String(args[0] ?? '').trim();
    if (ref.length === 0) {
      throw new Error('invalid_issue_reference');
    }
    const numberMatch = ref.match(githubIssueRefPattern);
    if (numberMatch || githubIssueUrlPattern.test(ref)) {
      const ghTarget = numberMatch ? numberMatch[1] : ref;
      const issue = await execGh(['issue', 'view', ghTarget, '--json', 'number,title,body'], { cwd: repositoryRoot });
      if (!issue || typeof issue.title !== 'string') {
        throw new Error(`issue_fetch_failed:invalid_payload_for_${ghTarget}`);
      }
      return {
        sourceKind: 'GITHUB_ISSUE',
        issueRef: `#${issue.number ?? ghTarget}`,
        ...formatIssueDemand({ number: issue.number ?? null, title: issue.title, body: issue.body ?? '' }),
      };
    }
    return readLocalIssueFile(ref, repositoryRoot);
  }

  const openIssues = await execGh(
    ['issue', 'list', '--state', 'open', '--limit', '20', '--json', 'number,title'],
    { cwd: repositoryRoot },
  );
  if (!Array.isArray(openIssues) || openIssues.length === 0) {
    throw new Error('no_open_issues');
  }
  if (openIssues.length > 1) {
    const preview = openIssues
      .slice(0, 5)
      .map((item) => `#${item.number} ${String(item.title ?? '').trim()}`)
      .join('; ');
    const suffix = openIssues.length > 5 ? ` (+${openIssues.length - 5} more)` : '';
    throw new Error(`multiple_open_issues:${openIssues.length} open issues (${preview}${suffix})`);
  }

  const target = openIssues[0];
  const issue = await execGh(
    ['issue', 'view', String(target.number), '--json', 'number,title,body'],
    { cwd: repositoryRoot },
  );
  return {
    sourceKind: 'GITHUB_ISSUE',
    issueRef: `#${issue.number ?? target.number}`,
    ...formatIssueDemand({ number: issue.number ?? target.number, title: issue.title, body: issue.body ?? '' }),
  };
}


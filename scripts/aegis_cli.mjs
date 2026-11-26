import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { buildDemandBrief, renderBriefMarkdown } from './lib/brief_renderer.mjs';
import { verifyContractMarkdown } from './lib/contract_verifier.mjs';
import { resolveIssueDemand } from './lib/issue_intake.mjs';
import { evaluateGuardPath, normalizeRepoRelativePath } from './lib/path_guard.mjs';
import { formatCheckReport, runProductCheck } from './lib/product_checker.mjs';
import {
  captureDemand,
  inspectWorkspaceFreshness,
  observeWorkspace,
  readCachedSkeleton,
  resolveRuntimePaths,
  writeFileAtomic,
} from './lib/workspace_observer.mjs';

function printHelp() {
  process.stdout.write([
    'Aegis KISS — Assistente Local para IDE (0 tokens no Discovery e na Verificação):',
    '  ./aegis brief "<demanda>"             Gera .harness/runtime/brief.md compacto sobre src/',
    '  ./aegis brief --issue [id|arquivo]    Captura issue (gh ou arquivo) e gera brief.md',
    '  ./aegis "<demanda>"                   Atalho direto para ./aegis brief "<demanda>"',
    '  ./aegis --issue [id|arquivo]          Atalho direto para ./aegis brief --issue [ref]',
    '  ./aegis verify-contract [caminho]     Valida caminhos, linhas, fronteira e cenários do contract.md',
    '  ./aegis check [opções]                Valida fronteira, escopo, tsc, eslint, static_checks e testes',
    '  ./aegis guard-path <caminho>          Retorna exit 0 só se a IA puder editar o caminho (hooks de IDE)',
    '  ./aegis status                        Exibe estado atual do brief, contrato e frescor de src/',
    '  ./aegis clean                         Limpa .harness/runtime/ (preserva src/ e lexicon.json)',
    '  ./aegis help                          Exibe esta ajuda',
    '',
    'Opções de brief:',
    '  --json                                Também imprime o JSON estruturado do brief no stdout',
    '  --files src/a.ts,src/b.ts             Prioriza caminhos específicos no Discovery',
    '',
    'Opções de check / guard-path:',
    '  --allow src/a.ts,src/b.ts             Modo rápido (bug trivial) sem exigir contract.md',
    '  --allow-outside arquivo               Exceção humana explícita fora de src/ (somente no check)',
    '  --skip-diff                           Pula checagem de escopo git no check',
  ].join('\n') + '\n');
}

function readBriefMeta(paths) {
  if (!existsSync(paths.briefMetaPath)) return null;
  try {
    return JSON.parse(readFileSync(paths.briefMetaPath, 'utf8'));
  } catch {
    return null;
  }
}

async function handleBrief(paths, args) {
  let useIssue = false;
  let emitJson = false;
  const explicitFiles = [];
  const positional = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--issue') {
      useIssue = true;
    } else if (arg === '--json') {
      emitJson = true;
    } else if (arg === '--files') {
      const next = args[i + 1];
      if (!next) throw new Error('missing_files_argument');
      explicitFiles.push(...next.split(',').map((s) => s.trim()).filter(Boolean));
      i += 1;
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown_flag:${arg}`);
    } else {
      positional.push(arg);
    }
  }

  let demandText;
  let maxBytes;
  let sourceRef = null;

  if (useIssue) {
    const resolved = await resolveIssueDemand(positional, { repositoryRoot: paths.root });
    demandText = resolved.demandText;
    maxBytes = resolved.maxBytes;
    sourceRef = resolved.issueRef;
  } else {
    demandText = positional[0];
    if (positional.length !== 1) throw new Error('invalid_demand_arity');
  }

  const intent = captureDemand([demandText], maxBytes ? { maxBytes } : {});
  const cachedSkeleton = await readCachedSkeleton(paths);
  const previousMeta = readBriefMeta(paths);
  const workspaceObservation = observeWorkspace(paths.root, {
    cachedWorkspaceSkeleton: cachedSkeleton,
    cachedSnapshotDigest: previousMeta?.sourceSnapshotDigest ?? null,
  });

  const brief = buildDemandBrief({
    repositoryRoot: paths.root,
    intent,
    workspaceObservation,
    explicitTargetPaths: explicitFiles,
    sourceRef,
  });
  const markdown = renderBriefMarkdown(brief);

  await Promise.all([
    writeFileAtomic(paths.briefMdPath, markdown),
    writeFileAtomic(paths.briefMetaPath, `${JSON.stringify({
      schema: 'aegis.brief_meta.v1',
      sourceSnapshotDigest: brief.sourceSnapshotDigest,
      sourceRef: brief.sourceRef,
      excerptedPaths: brief.coverage.excerptedPaths,
      observedTextFileCount: brief.coverage.observedTextFileCount,
      briefBytes: markdown.length,
    }, null, 2)}\n`),
    writeFileAtomic(paths.skeletonJsonPath, `${JSON.stringify({
      sourceSnapshotDigest: brief.sourceSnapshotDigest,
      workspaceSkeleton: workspaceObservation.workspaceSkeleton,
    })}\n`),
  ]);

  if (emitJson) {
    process.stdout.write(`${JSON.stringify(brief, null, 2)}\n`);
  } else {
    process.stdout.write([
      `[AEGIS][BRIEF] OK -> .harness/runtime/brief.md (${markdown.length} bytes)`,
      `- ${brief.coverage.discoveryRoot}/ snapshot: ${brief.sourceSnapshotDigest.slice(0, 12)} (${brief.coverage.observedTextFileCount} arquivos, ${brief.coverage.excerptedPaths.length} no brief)`,
      `- símbolos AST: ${brief.skeletonSymbols.length}${brief.topography ? ` · mapa topográfico: ${Object.keys(brief.topography).length} arquivos` : ''}`,
    ].join('\n') + '\n');
  }
}

function handleVerifyContract(paths, args) {
  if (args.length > 1) throw new Error('invalid_verify_contract_arity');
  let targetPath = paths.contractMdPath;
  if (args[0]) {
    if (args[0].startsWith('--')) throw new Error(`unknown_flag:${args[0]}`);
    const relContract = normalizeRepoRelativePath(paths.root, args[0]);
    if (!relContract) throw new Error(`invalid_contract_path:${args[0]}`);
    targetPath = resolve(paths.root, relContract);
  }
  const meta = readBriefMeta(paths);
  const result = verifyContractMarkdown({
    repositoryRoot: paths.root,
    contractPath: targetPath,
    expectedSnapshotDigest: meta?.sourceSnapshotDigest ?? null,
  });

  if (result.ok) {
    process.stdout.write([
      `[AEGIS][CONTRACT] PASS (${result.scenarioCount} cenários, ${result.authorizedPaths.length} arquivo(s) autorizado(s), workspace: ${result.workspaceFreshness})`,
      ...result.warnings.map((w) => `- AVISO: ${w}`),
    ].join('\n') + '\n');
    return;
  }

  process.stderr.write([
    `[AEGIS][CONTRACT] FAIL (${result.errors.length} erro(s))`,
    ...result.errors.map((e) => `- ${e}`),
    ...result.warnings.map((w) => `- AVISO: ${w}`),
  ].join('\n') + '\n');
  process.exitCode = 1;
}

function handleCheck(paths, args) {
  let skipDiff = false;
  const allowPaths = [];
  const allowOutsidePaths = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--skip-diff') {
      skipDiff = true;
    } else if (arg === '--allow' || arg === '--allow-outside') {
      const next = args[i + 1];
      if (!next || next.startsWith('--')) throw new Error(`missing_argument_for:${arg}`);
      const target = arg === '--allow' ? allowPaths : allowOutsidePaths;
      target.push(...next.split(',').map((s) => s.trim()).filter(Boolean));
      i += 1;
    } else {
      throw new Error(`unknown_argument:${arg}`);
    }
  }
  const report = runProductCheck({
    repositoryRoot: paths.root,
    contractPath: paths.contractMdPath,
    skipDiff,
    allowPaths,
    allowOutsidePaths,
  });
  const formatted = formatCheckReport(report);
  if (report.ok) {
    process.stdout.write(formatted);
  } else {
    process.stderr.write(formatted);
    process.exitCode = 1;
  }
}

function handleGuardPath(paths, args) {
  const allowPaths = [];
  let targetPath = null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--allow') {
      const next = args[i + 1];
      if (!next || next.startsWith('--')) throw new Error('missing_argument_for:--allow');
      allowPaths.push(...next.split(',').map((s) => s.trim()).filter(Boolean));
      i += 1;
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown_flag:${arg}`);
    } else if (!targetPath) {
      targetPath = arg;
    } else {
      throw new Error(`unexpected_argument:${arg}`);
    }
  }
  if (!targetPath) throw new Error('missing_target_path');
  const decision = evaluateGuardPath({
    repositoryRoot: paths.root,
    targetPath,
    contractPath: paths.contractMdPath,
    allowPaths,
  });
  if (decision.allowed) {
    process.stdout.write(`[AEGIS][GUARD] ALLOW ${decision.path}\n`);
    return;
  }
  process.stderr.write(`[AEGIS][GUARD] DENY ${decision.path} — ${decision.reason}\n`);
  process.exitCode = 1;
}

function handleStatus(paths) {
  const meta = readBriefMeta(paths);
  const hasBrief = existsSync(paths.briefMdPath);
  const hasContract = existsSync(paths.contractMdPath);
  const freshness = inspectWorkspaceFreshness(paths.root, meta?.sourceSnapshotDigest ?? null);
  process.stdout.write(`${JSON.stringify({
    status: hasContract ? 'CONTRACT_PRESENT' : (hasBrief ? 'BRIEF_READY' : 'IDLE'),
    briefPath: hasBrief ? '.harness/runtime/brief.md' : null,
    contractPath: hasContract ? '.harness/runtime/contract.md' : null,
    workspaceFreshness: freshness.workspaceFreshness,
    observedTextFileCount: meta?.observedTextFileCount ?? null,
  }, null, 2)}\n`);
}

async function handleClean(paths) {
  if (existsSync(paths.runtimeDir) && lstatSync(paths.runtimeDir).isSymbolicLink()) {
    throw new Error('unsafe_runtime_symlink');
  }
  await rm(paths.runtimeDir, { recursive: true, force: true });
  process.stdout.write('[AEGIS] clean=PASS runtime_reset=1 product_preserved=1\n');
}

async function main() {
  const root = resolve(process.env.AEGIS_ROOT || process.cwd());
  const paths = resolveRuntimePaths(root);
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  switch (command) {
    case 'brief':
      await handleBrief(paths, rest);
      break;
    case '--issue':
      await handleBrief(paths, ['--issue', ...rest]);
      break;
    case 'verify-contract':
    case '--verify-contract':
    case '--verify':
      handleVerifyContract(paths, rest);
      break;
    case 'check':
    case '--check':
      handleCheck(paths, rest);
      break;
    case 'guard-path':
    case '--guard-path':
      handleGuardPath(paths, rest);
      break;
    case 'status':
    case '--status':
      handleStatus(paths);
      break;
    case 'clean':
    case '--clean':
      await handleClean(paths);
      break;
    default:
      if (command.startsWith('--')) {
        throw new Error(`unknown_command:${command}`);
      }
      await handleBrief(paths, [command, ...rest]);
      break;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[AEGIS][ERROR] ${message}\n`);
  process.exit(1);
});

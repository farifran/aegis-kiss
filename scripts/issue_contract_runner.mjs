#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { canonicalDigest, canonicalJson, sha256 } from './lib/canonical_json.mjs';
import {
  applyUserResolution,
  buildIssueDraft,
  computeContractDigest,
  createProofRegistry,
  loadArchitecturePolicy,
  renderContractMarkdown,
  sanitizeInputText,
  validateContract,
} from './lib/issue_contract_core.mjs';
import { semanticStatePath } from './lib/semantic_state.mjs';

const root = resolve(process.env.AEGIS_ROOT ?? fileURLToPath(new URL('..', import.meta.url)));
const runtimeDir = resolve(root, '.harness/runtime');
const contractJsonPath = resolve(runtimeDir, 'contract.json');
const contractMdPath = resolve(runtimeDir, 'contract.md');
const userConfirmationPath = resolve(runtimeDir, 'user_confirmation_request.json');
const resolutionPath = resolve(runtimeDir, 'preflight_resolution.json');

function parseJsonOrFile(raw, baseDir) {
  const filePath = resolve(baseDir, raw);
  if (existsSync(filePath)) {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  }
  return JSON.parse(raw);
}

async function handleDraft(args) {
  let changeKind = 'PRODUCT';
  let targetHint = '';
  let demandText = '';
  let specData = null;
  let decisionsData = null;
  let channel = 'IDE_DEFAULT';
  let answersData = null;

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--kind' && ['PRODUCT', 'HARNESS'].includes(args[index + 1])) {
      changeKind = args[index + 1];
      index += 1;
    } else if (args[index] === '--target' && typeof args[index + 1] === 'string') {
      targetHint = args[index + 1];
      index += 1;
    } else if (args[index] === '--channel' && typeof args[index + 1] === 'string') {
      channel = args[index + 1];
      index += 1;
    } else if (args[index] === '--spec' && typeof args[index + 1] === 'string') {
      specData = parseJsonOrFile(args[index + 1], root);
      index += 1;
    } else if (args[index] === '--decisions' && typeof args[index + 1] === 'string') {
      decisionsData = parseJsonOrFile(args[index + 1], root);
      index += 1;
    } else if (args[index] === '--answers' && typeof args[index + 1] === 'string') {
      answersData = parseJsonOrFile(args[index + 1], root);
      index += 1;
    } else if (!demandText && !args[index].startsWith('--')) {
      demandText = args[index];
    }
  }

  if (!demandText && specData?.intent) {
    demandText = specData.intent;
  }

  if (!demandText) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    demandText = Buffer.concat(chunks);
  }

  const rawBuffer = Buffer.isBuffer(demandText) ? demandText : Buffer.from(demandText, 'utf8');
  const sanitizedText = sanitizeInputText(rawBuffer);

  let policy;
  let policyText;
  try {
    const architecturePolicy = loadArchitecturePolicy(root);
    policy = architecturePolicy.policy;
    policyText = architecturePolicy.policyText;
  } catch {
    policy = {
      rules: [{ id: 'ARCH-FAILURE-EXPLICIT' }],
      amendments: [],
      origin: { sourceDigest: sha256(''), sourcePath: 'ARCHITECTURE.md' },
    };
    policyText = '';
  }

  if (specData && Array.isArray(specData.decisions) && !decisionsData) {
    decisionsData = specData.decisions;
  }

  const draft = buildIssueDraft({
    sanitizedText,
    architecture: {
      candidateRules: policy.rules,
      policyDigest: sha256(policyText),
    },
    changeKind,
    targetHint,
    decisions: Array.isArray(decisionsData) ? decisionsData : [],
    title: specData?.title,
    intent: specData?.intent,
    requirements: specData?.requirements,
    behavior: specData?.behavior,
    invariants: specData?.invariants,
    preconditions: specData?.preconditions,
    postconditions: specData?.postconditions,
    failureSemantics: specData?.failureSemantics,
    authorizedPaths: specData?.authorizedPaths ?? specData?.scope?.authorizedPaths,
    proofObligations: specData?.proofObligations,
  });

  await mkdir(runtimeDir, { recursive: true });
  await writeFile(contractJsonPath, `${canonicalJson(draft)}\n`, 'utf8');
  await writeFile(contractMdPath, `${renderContractMarkdown(draft)}\n`, 'utf8');

  const questions = (draft.decisions ?? []).map((d) => ({
    id: d.questionId,
    question: d.question,
    recommendedAnswerId: d.recommendedAnswerId,
    selectedAnswerId: d.selectedAnswerId,
    answers: d.answers,
  }));

  const digest = computeContractDigest(draft);
  const confirmationRequest = {
    schema: 'aegis.preflight_finalization.v2',
    status: 'USER_CONFIRMATION_REQUIRED',
    executionId: digest,
    decisionDigest: digest,
    preflightPromptDigest: digest,
    confirmation: {
      channel,
      confirmationId: digest,
    },
    title: draft.title,
    intent: draft.intent,
    scope: draft.scope,
    questions,
    artifactPath: '.harness/runtime/contract.md',
  };

  await writeFile(userConfirmationPath, `${JSON.stringify(confirmationRequest, null, 2)}\n`, 'utf8');

  if (Array.isArray(answersData)) {
    const resolution = {
      schema: 'aegis.preflight_resolution.v2',
      decisionDigest: digest,
      preflightPromptDigest: digest,
      confirmation: {
        channel,
        confirmationId: digest,
        selectedAtEpochMs: Date.now(),
      },
      answers: answersData,
    };
    await writeFile(resolutionPath, `${JSON.stringify(resolution, null, 2)}\n`, 'utf8');
  }

  process.stdout.write(`${JSON.stringify(confirmationRequest)}\n`);
  process.exit(2);
}

async function handleApprove() {
  if (!existsSync(contractJsonPath)) {
    process.stderr.write('[AEGIS][FATAL] missing_contract_draft\n');
    process.exit(1);
  }

  const rawContract = JSON.parse(await readFile(contractJsonPath, 'utf8'));
  let contract = rawContract;

  if (existsSync(resolutionPath)) {
    try {
      const resolution = JSON.parse(await readFile(resolutionPath, 'utf8'));
      if (Array.isArray(resolution.answers)) {
        contract = applyUserResolution(contract, resolution.answers);
      }
    } catch {
      // Continue with draft as is
    }
  }

  const contractDigest = computeContractDigest(contract);
  const proofRegistry = createProofRegistry(contract);
  const proofRegistryDigest = canonicalDigest(proofRegistry);

  let policy;
  let policyText;
  try {
    const architecturePolicy = loadArchitecturePolicy(root);
    policy = architecturePolicy.policy;
    policyText = architecturePolicy.policyText;
  } catch {
    process.stderr.write('[AEGIS][FATAL] architecture_policy_unavailable\n');
    process.exit(1);
  }

  validateContract({
    root,
    contract,
    policy,
    policyText,
    registry: proofRegistry,
    phase: 'compile',
  });

  const statePath = semanticStatePath(root);
  await mkdir(resolve(root, 'src/.aegis'), { recursive: true });

  const semanticState = {
    schema: 'aegis.semantic_state.v1',
    contract,
    proofRegistry,
    digests: {
      contractSemanticDigest: contractDigest,
      proofRegistrySemanticDigest: proofRegistryDigest,
    },
  };

  await writeFile(statePath, `${canonicalJson(semanticState)}\n`, 'utf8');
  await writeFile(contractJsonPath, `${canonicalJson(contract)}\n`, 'utf8');
  await writeFile(contractMdPath, `${renderContractMarkdown(contract, true, contractDigest)}\n`, 'utf8');

  if (existsSync(userConfirmationPath)) {
    try {
      const existingReq = JSON.parse(await readFile(userConfirmationPath, 'utf8'));
      existingReq.status = 'FINALIZED';
      await writeFile(userConfirmationPath, `${JSON.stringify(existingReq, null, 2)}\n`, 'utf8');
    } catch {}
  }

  process.stdout.write(`${JSON.stringify({
    schema: 'aegis.preflight_finalization.v2',
    status: 'FINALIZED',
    contractDigest,
    evidenceState: 'GOVERNED',
  })}\n`);
  process.exit(0);
}

const command = process.argv[2];
const remainingArgs = process.argv.slice(3);

try {
  if (command === 'draft') {
    await handleDraft(remainingArgs);
  } else if (command === 'approve') {
    await handleApprove();
  } else {
    process.stderr.write(`[AEGIS][FATAL] unknown_command:${command}\n`);
    process.exit(1);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : 'issue_runner_failed';
  process.stderr.write(`[AEGIS][FATAL] ${message}\n`);
  process.exit(1);
}

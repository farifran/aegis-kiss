#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { canonicalDigest, canonicalJson, sha256 } from './lib/canonical_json.mjs';
import { validateContract } from './lib/contract_validator.mjs';
import {
  applyUserResolution,
  buildIssueDraft,
  computeContractDigest,
  createProofRegistry,
  renderContractMarkdown,
  sanitizeInputText,
} from './lib/issue_contract_core.mjs';
import { loadArchitecturePolicy } from './lib/preflight_core.mjs';
import { semanticStatePath } from './lib/semantic_state.mjs';

const root = resolve(process.env.AEGIS_ROOT ?? fileURLToPath(new URL('..', import.meta.url)));
const runtimeDir = resolve(root, '.harness/runtime');
const contractJsonPath = resolve(runtimeDir, 'contract.json');
const contractMdPath = resolve(runtimeDir, 'contract.md');
const userConfirmationPath = resolve(runtimeDir, 'user_confirmation_request.json');
const resolutionPath = resolve(runtimeDir, 'preflight_resolution.json');

async function handleDraft(args) {
  let changeKind = 'PRODUCT';
  let targetHint = '';
  let demandText = '';

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--kind' && ['PRODUCT', 'HARNESS'].includes(args[index + 1])) {
      changeKind = args[index + 1];
      index += 1;
    } else if (args[index] === '--target' && typeof args[index + 1] === 'string') {
      targetHint = args[index + 1];
      index += 1;
    } else if (!demandText) {
      demandText = args[index];
    }
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

  const draft = buildIssueDraft({
    sanitizedText,
    architecture: {
      candidateRules: policy.rules,
      policyDigest: sha256(policyText),
    },
    changeKind,
    targetHint,
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

  const confirmationRequest = {
    schema: 'aegis.preflight_finalization.v2',
    status: 'USER_CONFIRMATION_REQUIRED',
    executionId: computeContractDigest(draft),
    title: draft.title,
    intent: draft.intent,
    scope: draft.scope,
    questions,
    artifactPath: '.harness/runtime/contract.md',
  };

  await writeFile(userConfirmationPath, `${JSON.stringify(confirmationRequest, null, 2)}\n`, 'utf8');

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

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import process from 'node:process';

import { createRejectionError as rejection } from './rejection_report.mjs';
import { readPreflight, validateContract } from './runner_runtime.mjs';

async function readGovernedState(statePath) {
  const { parseSemanticState } = await import('./semantic_state.mjs');
  return parseSemanticState(JSON.parse(await readFile(statePath, 'utf8')));
}

function writeStatus(status) {
  process.stdout.write(`${JSON.stringify(status)}\n`);
}

async function inspectWorkspaceFreshness(paths, contract) {
  try {
    const { discoverWorkspace } = await import('./issue_contract_core.mjs');
    const currentSnapshotDigest = discoverWorkspace(paths.root).sourceSnapshotDigest;
    return {
      workspaceFreshness: currentSnapshotDigest === contract.sourceSnapshotDigest
        ? 'MATCHES_BASELINE'
        : 'CHANGED_SINCE_BASELINE',
    };
  } catch (error) {
    return {
      workspaceFreshness: 'UNAVAILABLE',
      workspaceFreshnessReason: error instanceof Error ? error.message : 'unknown_error',
    };
  }
}

async function writeGovernedStatus(paths, statePath, runtimeContract = null) {
  try {
    const [{ canonicalDigest }, state] = await Promise.all([
      import('./canonical_json.mjs'),
      readGovernedState(statePath),
    ]);
    if (runtimeContract !== null && canonicalDigest(runtimeContract) !== state.contractDigest) {
      writeStatus({
        status: 'INVALID_SEMANTIC_STATE',
        reason: 'RUNTIME_CONTRACT_MISMATCH',
        contractIntegrity: 'INVALID',
        workspaceFreshness: 'NOT_CHECKED',
        implementationCompliance: 'NOT_EVALUATED',
        semanticState: statePath,
      });
      return;
    }
    const freshness = await inspectWorkspaceFreshness(paths, state.contract);
    const requiresSemanticRevision = state.contract.approval !== null && (
      state.contract.specification.decisions.length > 0
      || state.contract.specification.determinismReview.dimensions.some(({ status }) => (
        status === 'DECISION_REQUIRED' || status === 'GAP_FOUND'
      ))
    );
    writeStatus({
      status: requiresSemanticRevision ? 'GOVERNED_REVISION_REQUIRED' : 'GOVERNED',
      contractDigest: state.contractDigest,
      contractIntegrity: 'VALID',
      governanceFreshness: requiresSemanticRevision ? 'REVISION_REQUIRED' : 'CURRENT',
      ...(requiresSemanticRevision ? { reason: 'SEMANTIC_DECISIONS_NOT_MATERIALIZED' } : {}),
      ...freshness,
      implementationCompliance: 'NOT_EVALUATED',
      semanticState: statePath,
    });
  } catch {
    writeStatus({
      status: 'INVALID_SEMANTIC_STATE',
      contractIntegrity: 'INVALID',
      workspaceFreshness: 'NOT_CHECKED',
      implementationCompliance: 'NOT_EVALUATED',
      semanticState: statePath,
    });
  }
}

async function statusForContract(paths, statePath) {
  let contract;
  try {
    contract = JSON.parse(await readFile(paths.contractJsonPath, 'utf8'));
  } catch {
    return {
      status: 'SEMANTIC_REDELIBERATION_REQUIRED',
      foundSchema: 'INVALID',
      requiredSchema: 'aegis.issue_contract.v14',
    };
  }
  if (contract.schema !== 'aegis.issue_contract.v14') {
    return {
      status: 'SEMANTIC_REDELIBERATION_REQUIRED',
      foundSchema: contract.schema ?? 'INVALID',
      requiredSchema: 'aegis.issue_contract.v14',
    };
  }
  if (contract.approval !== null) {
    if (!existsSync(statePath)) {
      return {
        status: 'INVALID_SEMANTIC_STATE',
        reason: 'MISSING_GOVERNED_STATE',
        contractIntegrity: 'INVALID',
        workspaceFreshness: 'NOT_CHECKED',
        implementationCompliance: 'NOT_EVALUATED',
        semanticState: statePath,
      };
    }
    await writeGovernedStatus(paths, statePath, contract);
    return null;
  }

  let preflight;
  try {
    preflight = await readPreflight(paths);
  } catch {
    return { status: 'INVALID_PREFLIGHT', preflightPath: paths.preflightJsonPath };
  }
  try {
    await validateContract(paths, contract, preflight);
  } catch {
    return { status: 'SEMANTIC_REDELIBERATION_REQUIRED', reason: 'INVALID_OR_STALE_CONTRACT' };
  }
  if (contract.effectiveDeterminismStatus === 'BLOCKED_BY_GAP') {
    return {
      status: 'BLOCKED_BY_GAP',
      draftPath: paths.contractJsonPath,
      gapCount: contract.specification.closureCertificate?.gapLedger?.length ?? 0,
      gapLedger: contract.specification.closureCertificate?.gapLedger ?? [],
    };
  }
  return { status: 'DRAFT_PENDING_CONFIRMATION', draftPath: paths.contractJsonPath };
}

export async function handleStatus(paths) {
  const statePath = paths.semanticStateJsonPath;

  if (existsSync(paths.contractJsonPath)) {
    const status = await statusForContract(paths, statePath);
    if (status !== null) writeStatus(status);
    return;
  }

  if (existsSync(paths.preflightJsonPath)) {
    try {
      await readPreflight(paths);
      writeStatus({
        status: 'SEMANTIC_DELIBERATION_REQUIRED',
        phase: 'DISCOVERED',
        preflightPath: paths.preflightJsonPath,
      });
    } catch {
      writeStatus({ status: 'INVALID_PREFLIGHT', preflightPath: paths.preflightJsonPath });
    }
    return;
  }

  if (existsSync(statePath)) {
    await writeGovernedStatus(paths, statePath);
    return;
  }

  writeStatus({ status: 'IDLE', workspace: 'clean' });
}

export async function handleVerify(paths) {
  const { semanticStatePath, parseSemanticState } = await import('./semantic_state.mjs');
  const statePath = semanticStatePath(paths.root);
  if (!existsSync(statePath)) throw rejection('NO_GOVERNED_CONTRACT');
  const state = parseSemanticState(JSON.parse(await readFile(statePath, 'utf8')));
  let activeContext = 'NOT_PRESENT';
  if (existsSync(paths.preflightJsonPath)) {
    try {
      const preflight = await readPreflight(paths);
      activeContext = state.contract.sourcePreflightDigest === preflight.preflightDigest
        ? 'MATCHES_CONTRACT'
        : 'DIFFERENT_PREFLIGHT';
    } catch {
      activeContext = 'INVALID_PREFLIGHT';
    }
  }
  const freshness = await inspectWorkspaceFreshness(paths, state.contract);
  process.stdout.write(`${JSON.stringify({
    schema: 'aegis.contract_verification.v2',
    status: 'VALID',
    contractDigest: state.contractDigest,
    contractIntegrity: 'VALID',
    ...freshness,
    implementationCompliance: 'NOT_EVALUATED',
    activeContext,
  })}\n`);
}


#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const root = resolve(process.env.AEGIS_ROOT ?? fileURLToPath(new URL('..', import.meta.url)));
const harnessDir = resolve(root, '.harness');
const runtimeDir = resolve(harnessDir, 'runtime');
const contractJsonPath = resolve(runtimeDir, 'contract.json');
const contractMdPath = resolve(runtimeDir, 'contract.md');
const preflightJsonPath = resolve(runtimeDir, 'preflight.json');
const userConfirmationPath = resolve(runtimeDir, 'user_confirmation_request.json');
const resolutionPath = resolve(runtimeDir, 'preflight_resolution.json');
const semanticDraftByteLimit = 262_144;

function rejection(reason, detail = '') {
  const error = new Error(reason);
  if (detail) error.detail = detail;
  return error;
}

async function readPreflight() {
  if (!existsSync(preflightJsonPath)) throw rejection('MISSING_PREFLIGHT');
  const [{ assertPreflightDocument }, preflight] = await Promise.all([
    import('./lib/preflight_integrity.mjs'),
    readFile(preflightJsonPath, 'utf8').then(JSON.parse),
  ]);
  assertPreflightDocument(preflight);
  return preflight;
}

async function readPolicy() {
  const [{ loadArchitecturePolicy }, { assertSchema }] = await Promise.all([
    import('./lib/issue_contract_core.mjs'),
    import('./lib/schema_validator.mjs'),
  ]);
  try {
    const loaded = loadArchitecturePolicy(root);
    assertSchema('aegis.architecture_policy.v1', loaded.policy);
    return loaded;
  } catch (error) {
    throw rejection('ARCHITECTURE_POLICY_UNAVAILABLE', error.message);
  }
}

async function readConstitution() {
  try {
    const { loadSemanticConstitution } = await import('./lib/semantic_contract.mjs');
    return loadSemanticConstitution(root);
  } catch (error) {
    throw rejection('SEMANTIC_CONSTITUTION_UNAVAILABLE', error.message);
  }
}

async function assertDiscoveryUnchanged(preflight) {
  const [{ canonicalDigest }, { discoverWorkspace }] = await Promise.all([
    import('./lib/canonical_json.mjs'),
    import('./lib/issue_contract_core.mjs'),
  ]);
  const currentDiscovery = discoverWorkspace(root, preflight.intent);
  if (currentDiscovery.sourceSnapshotDigest !== preflight.discovery.sourceSnapshotDigest) {
    throw rejection('SOURCE_SNAPSHOT_CHANGED');
  }
  if (canonicalDigest(currentDiscovery) !== canonicalDigest(preflight.discovery)) {
    throw rejection('DISCOVERY_EVIDENCE_MISMATCH');
  }
}

async function readPendingRevision(preflight, loadedPolicy, constitution) {
  const pathsExist = [contractJsonPath, userConfirmationPath, resolutionPath]
    .map((path) => existsSync(path));
  if (!pathsExist[2]) return null;
  if (!pathsExist[0] || !pathsExist[1]) throw rejection('INCOMPLETE_SEMANTIC_REVISION_STATE');

  const [
    {
      assertContractDocument,
      buildSemanticRevision,
      resolutionRequiresRecompilation,
    },
    contract,
    request,
    resolution,
  ] = await Promise.all([
    import('./lib/semantic_contract.mjs'),
    readFile(contractJsonPath, 'utf8').then(JSON.parse),
    readFile(userConfirmationPath, 'utf8').then(JSON.parse),
    readFile(resolutionPath, 'utf8').then(JSON.parse),
  ]);
  if (contract.constitutionDigest !== constitution.digest
    || contract.policyDigest !== loadedPolicy.policyDigest) {
    return null;
  }
  assertContractDocument({
    contract,
    preflight,
    policy: loadedPolicy.policy,
    policyDigest: loadedPolicy.policyDigest,
    constitutionDigest: constitution.digest,
  });
  if (!resolutionRequiresRecompilation({ contract, request, resolution })) return null;
  return {
    resolution,
    request: buildSemanticRevision(contract, resolution),
  };
}

async function handleDraft(args) {
  const [
    { canonicalJson },
    { buildPreflightHandoff, captureDemand, discoverWorkspace },
    { assertPreflightDocument },
  ] = await Promise.all([
    import('./lib/canonical_json.mjs'),
    import('./lib/issue_contract_core.mjs'),
    import('./lib/preflight_integrity.mjs'),
  ]);
  const demand = captureDemand(args);
  const discovery = discoverWorkspace(root, demand);
  const preflight = buildPreflightHandoff({ demand, discovery });
  assertPreflightDocument(preflight);
  const serializedPreflight = `${canonicalJson(preflight)}\n`;

  await mkdir(harnessDir, { recursive: true });
  const stagingDir = await mkdtemp(resolve(harnessDir, '.preflight-'));
  const stagedPreflightPath = resolve(stagingDir, 'preflight.json');
  try {
    await writeFile(stagedPreflightPath, serializedPreflight, { encoding: 'utf8', flush: true });
    await rm(runtimeDir, { recursive: true, force: true });
    await mkdir(runtimeDir, { recursive: true });
    await rename(stagedPreflightPath, preflightJsonPath);
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }

  process.stdout.write(`${JSON.stringify({
    schema: preflight.schema,
    status: preflight.status,
    phase: preflight.phase,
    preflightDigest: preflight.preflightDigest,
    sourceSnapshotDigest: preflight.discovery.sourceSnapshotDigest,
    dataPath: '.harness/runtime/preflight.json',
  })}\n`);
}

async function handleValidatePreflight() {
  await readPreflight();
}

async function handleSemanticRequest() {
  const [{ canonicalJson }, { buildSemanticRequest }] = await Promise.all([
    import('./lib/canonical_json.mjs'),
    import('./lib/semantic_contract.mjs'),
  ]);
  const [preflight, loadedPolicy, constitution] = await Promise.all([
    readPreflight(),
    readPolicy(),
    readConstitution(),
  ]);
  await assertDiscoveryUnchanged(preflight);
  const revision = await readPendingRevision(preflight, loadedPolicy, constitution);
  const request = buildSemanticRequest({
    repositoryRoot: root,
    preflight,
    policy: loadedPolicy.policy,
    constitution,
    revision: revision?.request ?? null,
  });
  process.stdout.write(`${canonicalJson(request)}\n`);
}

async function handleSemanticCompile(args) {
  if (args.length !== 0) throw rejection('INVALID_SEMANTIC_COMPILE_ARITY');
  const [
    { canonicalJson },
    {
      assertRevisionApplied,
      buildConfirmationRequest,
      buildSemanticRequest,
      compileSemanticContract,
      renderSemanticContractMarkdown,
    },
  ] = await Promise.all([
    import('./lib/canonical_json.mjs'),
    import('./lib/semantic_contract.mjs'),
  ]);
  let draft;
  try {
    let serializedDraft = '';
    let receivedBytes = 0;
    for await (const chunk of process.stdin) {
      receivedBytes += Buffer.byteLength(chunk);
      if (receivedBytes > semanticDraftByteLimit) throw new Error('semantic_draft_too_large');
      serializedDraft += chunk;
    }
    draft = JSON.parse(serializedDraft);
  } catch (error) {
    throw rejection('INVALID_SEMANTIC_DRAFT', error.message);
  }
  const [preflight, loadedPolicy, constitution] = await Promise.all([
    readPreflight(),
    readPolicy(),
    readConstitution(),
  ]);
  await assertDiscoveryUnchanged(preflight);
  const revision = await readPendingRevision(preflight, loadedPolicy, constitution);
  const request = buildSemanticRequest({
    repositoryRoot: root,
    preflight,
    policy: loadedPolicy.policy,
    constitution,
    revision: revision?.request ?? null,
  });
  if (draft.sourceContextDigest !== request.contextDigest) {
    throw rejection('SEMANTIC_CONTEXT_MISMATCH');
  }
  if (revision !== null) assertRevisionApplied(draft, revision.resolution);
  const contract = compileSemanticContract({
    draft,
    preflight,
    policy: loadedPolicy.policy,
    policyDigest: loadedPolicy.policyDigest,
    constitutionDigest: constitution.digest,
    humanResolutions: revision?.resolution.answers ?? [],
  });
  const confirmation = buildConfirmationRequest(contract);

  await mkdir(runtimeDir, { recursive: true });
  await Promise.all([
    writeFile(contractJsonPath, `${canonicalJson(contract)}\n`, 'utf8'),
    writeFile(contractMdPath, `${renderSemanticContractMarkdown(contract, {
      policyRules: loadedPolicy.policy.rules,
    })}\n`, 'utf8'),
    writeFile(userConfirmationPath, `${canonicalJson(confirmation)}\n`, 'utf8'),
    rm(resolutionPath, { force: true }),
  ]);
  process.stdout.write(`${canonicalJson(confirmation)}\n`);
}

async function handleApprove() {
  if (!existsSync(contractJsonPath)) {
    throw rejection(existsSync(preflightJsonPath)
      ? 'SEMANTIC_DELIBERATION_REQUIRED'
      : 'MISSING_CONTRACT_DRAFT');
  }
  const [
    { canonicalDigest, canonicalJson },
    {
      assertConfirmationRequest,
      assertContractDocument,
      renderSemanticContractMarkdown,
      resolutionRequiresRecompilation,
    },
    { semanticStatePath },
  ] = await Promise.all([
    import('./lib/canonical_json.mjs'),
    import('./lib/semantic_contract.mjs'),
    import('./lib/semantic_state.mjs'),
  ]);
  const [contract, preflight, loadedPolicy, constitution] = await Promise.all([
    readFile(contractJsonPath, 'utf8').then(JSON.parse),
    readPreflight(),
    readPolicy(),
    readConstitution(),
  ]);
  assertContractDocument({
    contract,
    preflight,
    policy: loadedPolicy.policy,
    policyDigest: loadedPolicy.policyDigest,
    constitutionDigest: constitution.digest,
  });

  if (existsSync(userConfirmationPath)) {
    const request = JSON.parse(await readFile(userConfirmationPath, 'utf8'));
    assertConfirmationRequest(contract, request);
    if (existsSync(resolutionPath)) {
      const resolution = JSON.parse(await readFile(resolutionPath, 'utf8'));
      if (resolutionRequiresRecompilation({ contract, request, resolution })) {
        throw rejection('SEMANTIC_RECOMPILATION_REQUIRED');
      }
    }
  }

  await assertDiscoveryUnchanged(preflight);
  const contractDigest = canonicalDigest(contract);
  const statePath = semanticStatePath(root);
  const semanticState = {
    schema: 'aegis.semantic_state.v3',
    contract,
    contractDigest,
  };
  await mkdir(dirname(statePath), { recursive: true });
  await Promise.all([
    writeFile(statePath, `${canonicalJson(semanticState)}\n`, 'utf8'),
    writeFile(contractJsonPath, `${canonicalJson(contract)}\n`, 'utf8'),
    writeFile(contractMdPath, `${renderSemanticContractMarkdown(contract, {
      governed: true,
      contractDigest,
      policyRules: loadedPolicy.policy.rules,
    })}\n`, 'utf8'),
  ]);
  await Promise.all([
    rm(userConfirmationPath, { force: true }),
    rm(resolutionPath, { force: true }),
  ]);
  process.stdout.write(`${JSON.stringify({
    schema: 'aegis.preflight_finalization.v3',
    status: 'FINALIZED',
    contractDigest,
    evidenceState: 'GOVERNED',
    implementationAuthorized: false,
  })}\n`);
}

async function handleVerify() {
  const { semanticStatePath, parseSemanticState } = await import('./lib/semantic_state.mjs');
  const statePath = semanticStatePath(root);
  if (!existsSync(statePath)) throw rejection('NO_GOVERNED_CONTRACT');
  const state = parseSemanticState(JSON.parse(await readFile(statePath, 'utf8')));
  process.stdout.write(`${JSON.stringify({
    schema: 'aegis.contract_verification.v1',
    status: 'VALID',
    contractDigest: state.contractDigest,
    implementationExecuted: false,
  })}\n`);
}

const command = process.argv[2];
const remainingArgs = process.argv.slice(3);

try {
  if (command === 'draft') await handleDraft(remainingArgs);
  else if (command === 'validate-preflight') await handleValidatePreflight();
  else if (command === 'semantic-request') await handleSemanticRequest();
  else if (command === 'semantic-compile') await handleSemanticCompile(remainingArgs);
  else if (command === 'approve') await handleApprove();
  else if (command === 'verify') await handleVerify();
  else throw rejection('UNKNOWN_INTERNAL_COMMAND', command);
} catch (error) {
  const message = error instanceof Error ? error.message : 'issue_runner_failed';
  const separator = message.indexOf(':');
  const rawReason = separator === -1 ? message : message.slice(0, separator);
  const inferredDetail = separator === -1 ? '' : message.slice(separator + 1).trim();
  const phase = command === 'draft' || command === 'validate-preflight'
    ? 'PREFLIGHT'
    : command === 'semantic-request' || command === 'semantic-compile'
      ? 'SEMANTIC'
      : command === 'approve' ? 'APPROVAL' : command === 'verify' ? 'VERIFICATION' : 'COMMAND';
  process.stderr.write(`${JSON.stringify({
    schema: 'aegis.rejection.v1',
    status: 'REJECTED',
    phase,
    reason: rawReason.replace(/[^a-z0-9]+/giu, '_').toUpperCase(),
    ...(error?.detail || inferredDetail ? { detail: error?.detail || inferredDetail } : {}),
  })}\n`);
  process.exitCode = 1;
}

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

import { createRejectionError as rejection } from './rejection_report.mjs';

export function resolveRunnerPaths(root) {
  const harnessDir = resolve(root, '.harness');
  const runtimeDir = resolve(harnessDir, 'runtime');
  return {
    root,
    harnessDir,
    runtimeDir,
    semanticStateJsonPath: resolve(harnessDir, 'state', 'semantic-state.json'),
    contractJsonPath: resolve(runtimeDir, 'contract.json'),
    contractMdPath: resolve(runtimeDir, 'contract.md'),
    preflightJsonPath: resolve(runtimeDir, 'preflight.json'),
    skeletonJsonPath: resolve(runtimeDir, 'workspace_skeleton.json'),
    semanticExecutionPath: resolve(runtimeDir, 'semantic-execution.json'),
    userConfirmationPath: resolve(runtimeDir, 'user_confirmation_request.json'),
    resolutionPath: resolve(runtimeDir, 'preflight_resolution.json'),
  };
}

export async function writeFileAtomic(target, content) {
  const parent = dirname(target);
  await mkdir(parent, { recursive: true });
  const stagingDirectory = await mkdtemp(resolve(parent, '.aegis-write-'));
  const stagedPath = resolve(stagingDirectory, basename(target));
  try {
    await writeFile(stagedPath, content, { encoding: 'utf8', flush: true });
    await rename(stagedPath, target);
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
}

export async function clearSupersededRuntime(paths) {
  const entries = await readdir(paths.runtimeDir, { withFileTypes: true });
  const preserved = new Set([basename(paths.preflightJsonPath), basename(paths.skeletonJsonPath)]);
  await Promise.all(entries
    .filter(({ name }) => !preserved.has(name))
    .map(({ name }) => rm(resolve(paths.runtimeDir, name), { recursive: true, force: true })));
}

export async function readCachedSkeleton(paths) {
  if (!existsSync(paths.skeletonJsonPath)) return null;
  try {
    return JSON.parse(await readFile(paths.skeletonJsonPath, 'utf8'));
  } catch {
    return null;
  }
}

export async function readPreflight(paths) {
  if (!existsSync(paths.preflightJsonPath)) throw rejection('MISSING_PREFLIGHT');
  const [{ assertPreflightDocument }, preflight] = await Promise.all([
    import('./preflight_integrity.mjs'),
    readFile(paths.preflightJsonPath, 'utf8').then(JSON.parse),
  ]);
  assertPreflightDocument(preflight);
  return preflight;
}

export async function readPolicy(paths) {
  const [{ loadArchitecturePolicy }, { assertSchema }] = await Promise.all([
    import('./issue_contract_core.mjs'),
    import('./schema_validator.mjs'),
  ]);
  try {
    const loaded = loadArchitecturePolicy(paths.root);
    assertSchema('aegis.architecture_policy.v3', loaded.policy);
    return loaded;
  } catch (error) {
    throw rejection('ARCHITECTURE_POLICY_UNAVAILABLE', error.message);
  }
}

export async function readConstitution(paths) {
  try {
    const { loadSemanticConstitution } = await import('./semantic_request.mjs');
    return loadSemanticConstitution(paths.root);
  } catch (error) {
    throw rejection('SEMANTIC_CONSTITUTION_UNAVAILABLE', error.message);
  }
}

export async function assertDiscoveryUnchanged(paths, preflight) {
  const [{ canonicalDigest }, { observeWorkspace }] = await Promise.all([
    import('./canonical_json.mjs'),
    import('./issue_contract_core.mjs'),
  ]);
  const workspaceObservation = observeWorkspace(paths.root, preflight.intent, {
    cachedWorkspaceSkeleton: await readCachedSkeleton(paths),
  });
  const currentDiscovery = workspaceObservation.discovery;
  if (currentDiscovery.sourceSnapshotDigest !== preflight.discovery.sourceSnapshotDigest) {
    throw rejection('SOURCE_SNAPSHOT_CHANGED');
  }
  if (canonicalDigest(currentDiscovery) !== canonicalDigest(preflight.discovery)) {
    throw rejection('DISCOVERY_EVIDENCE_MISMATCH');
  }
  return workspaceObservation;
}

export async function readPendingRevision(
  paths,
  preflight,
  loadedPolicy,
  constitution,
  workspaceObservation = null,
) {
  const pathsExist = [paths.contractJsonPath, paths.userConfirmationPath, paths.resolutionPath]
    .map((path) => existsSync(path));
  if (!pathsExist[2]) return null;
  if (!pathsExist[0] || !pathsExist[1]) throw rejection('INCOMPLETE_SEMANTIC_REVISION_STATE');

  const [
    { assertContractDocument },
    {
      buildHumanResolutionRecords,
      buildSemanticRevision,
      resolutionRequiresRecompilation,
    },
    contract,
    request,
    resolution,
  ] = await Promise.all([
    import('./semantic_contract_lifecycle.mjs'),
    import('./semantic_approval.mjs'),
    readFile(paths.contractJsonPath, 'utf8').then(JSON.parse),
    readFile(paths.userConfirmationPath, 'utf8').then(JSON.parse),
    readFile(paths.resolutionPath, 'utf8').then(JSON.parse),
  ]);
  if (contract.constitutionDigest !== constitution.digest
    || contract.policyDigest !== loadedPolicy.policyDigest) {
    return null;
  }
  if (contract.schema !== 'aegis.issue_contract.v14') return null;
  assertContractDocument({
    repositoryRoot: paths.root,
    contract,
    preflight,
    policy: loadedPolicy.policy,
    policyDigest: loadedPolicy.policyDigest,
    constitution,
    constitutionDigest: constitution.digest,
    workspaceObservation,
  });
  if (!resolutionRequiresRecompilation({ contract, request, resolution })) return null;
  return {
    resolution,
    request: buildSemanticRevision(contract, resolution),
    sourceSpecification: contract.specification,
    humanResolutions: [
      ...contract.humanResolutions,
      ...buildHumanResolutionRecords(contract, resolution),
    ],
  };
}

export async function validateContract(paths, contract, preflight) {
  const { assertContractDocument } = await import('./semantic_contract_lifecycle.mjs');
  const [loadedPolicy, constitution] = await Promise.all([
    readPolicy(paths),
    readConstitution(paths),
  ]);
  const workspaceObservation = await assertDiscoveryUnchanged(paths, preflight);
  assertContractDocument({
    repositoryRoot: paths.root,
    contract,
    preflight,
    policy: loadedPolicy.policy,
    policyDigest: loadedPolicy.policyDigest,
    constitution,
    constitutionDigest: constitution.digest,
    workspaceObservation,
  });
}


import { assertSchema } from './schema_validator.mjs';
import { canonicalDigest } from './canonical_json.mjs';
import { computePreflightDigest, computeSourceSnapshotDigest } from './issue_contract_core.mjs';

function integrityFailure(detail) {
  throw new Error(`preflight_integrity_mismatch:${detail}`);
}

export function assertPreflightDocument(preflight) {
  const schemaId = preflight?.schema ?? 'aegis.preflight_handoff.v3';
  assertSchema(schemaId, preflight);

  if (computePreflightDigest(preflight) !== preflight.preflightDigest) {
    integrityFailure('preflight_digest');
  }

  const discovery = preflight.discovery;
  if (computeSourceSnapshotDigest(discovery.files, discovery.ignoredEntries)
    !== discovery.sourceSnapshotDigest) {
    integrityFailure('source_snapshot_digest');
  }

  const observedPaths = [
    ...discovery.files.map(({ path }) => path),
    ...discovery.ignoredEntries.map(({ path }) => path),
  ];
  if (new Set(observedPaths).size !== observedPaths.length) {
    integrityFailure('duplicate_source_path');
  }

  const scannedBytes = discovery.files.reduce((total, { bytes }) => total + bytes, 0);
  if (scannedBytes !== discovery.scannedBytes) {
    integrityFailure('scanned_bytes');
  }
  if (discovery.visitedEntries < observedPaths.length) {
    integrityFailure('visited_entries');
  }

  const hasTextSource = discovery.files.some(({ kind }) => kind === 'UTF8_TEXT');
  const expectedDiscoveryStatus = hasTextSource
    ? 'SOURCE_OBSERVED'
    : (observedPaths.length > 0 ? 'NO_TEXT_SOURCE' : 'EMPTY_SOURCE');
  if (discovery.status !== expectedDiscoveryStatus) {
    integrityFailure('discovery_status');
  }

  if (schemaId === 'aegis.preflight_handoff.v3') {
    const skeleton = discovery.workspaceSkeleton;
    if (skeleton) {
      const { digest, ...unsigned } = skeleton;
      if (canonicalDigest(unsigned) !== digest) {
        integrityFailure('workspace_skeleton_digest');
      }
      if (skeleton.symbolCount !== skeleton.symbols.length) {
        integrityFailure('workspace_skeleton_symbol_count');
      }
    }
  }
}

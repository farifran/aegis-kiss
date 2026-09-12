import { assertSchema } from './schema_validator.mjs';
import { computePreflightDigest, computeSourceSnapshotDigest } from './issue_contract_core.mjs';

function integrityFailure(detail) {
  throw new Error(`preflight_integrity_mismatch:${detail}`);
}

export function assertPreflightDocument(preflight) {
  assertSchema('aegis.preflight_handoff.v2', preflight);

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

  const evidence = discovery.lexicalEvidence;
  const queryTermKeys = evidence.queryTerms.map((term) => term.normalize('NFC').toLowerCase());
  if (new Set(queryTermKeys).size !== queryTermKeys.length) {
    integrityFailure('duplicate_query_term');
  }
  if (evidence.termsTruncated && evidence.queryTerms.length !== 64) {
    integrityFailure('term_truncation');
  }

  const textPaths = new Set(
    discovery.files.filter(({ kind }) => kind === 'UTF8_TEXT').map(({ path }) => path),
  );
  const matchedTermKeys = new Set();
  const queryTermKeySet = new Set(queryTermKeys);
  for (const match of evidence.matches) {
    const termKey = match.term.normalize('NFC').toLowerCase();
    if (!queryTermKeySet.has(termKey) || matchedTermKeys.has(termKey) || !textPaths.has(match.path)) {
      integrityFailure('lexical_match');
    }
    matchedTermKeys.add(termKey);
  }

  const applicable = textPaths.size > 0 && evidence.queryTerms.length > 0;
  const expectedEvidenceStatus = applicable
    ? (evidence.matches.length > 0 ? 'MATCH' : 'NO_MATCH')
    : 'NOT_APPLICABLE';
  if (evidence.status !== expectedEvidenceStatus) {
    integrityFailure('lexical_status');
  }

}

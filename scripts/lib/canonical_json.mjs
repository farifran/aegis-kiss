import { createHash } from 'node:crypto';

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalDigest(value) {
  return sha256(canonicalJson(value));
}

import { createHash } from 'node:crypto';

function compareCodeUnits(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareCodeUnits(left, right))
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

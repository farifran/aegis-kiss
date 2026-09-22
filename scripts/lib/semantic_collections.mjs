export function assertUniqueIds(items, field, kind) {
  const ids = items.map((item) => item[field]);
  if (new Set(ids).size !== ids.length) throw new Error(`duplicate_${kind}_id`);
  return new Set(ids);
}

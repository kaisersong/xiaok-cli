/** Frozen logical accounting format: recursively key-sorted, finite, plain JSON UTF-8. */
export function encodeMultiAgentRow(value: unknown): string {
  const seen = new Set<object>();
  function canonical(item: unknown): unknown {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (typeof item !== 'object' || !item) throw new Error('invalid multi-agent JSON value');
    if (seen.has(item)) throw new Error('cyclic multi-agent JSON value');
    seen.add(item);
    try {
      if (Array.isArray(item)) return item.map(canonical);
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new Error('non-plain multi-agent JSON value');
      return Object.fromEntries(Object.keys(item).sort().filter(key => (item as Record<string, unknown>)[key] !== undefined)
        .map(key => [key, canonical((item as Record<string, unknown>)[key])]));
    } finally { seen.delete(item); }
  }
  return JSON.stringify(canonical(value));
}

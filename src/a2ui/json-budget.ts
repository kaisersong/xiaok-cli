/** Shared preflight; run before recursive validation or serializing untrusted input. */
export const MAX_UI_BYTES = 1_000_000;
const dangerous = new Set(['__proto__', 'constructor', 'prototype']);
export function assertJsonBudget(input: unknown): void {
  const queue: Array<[unknown, number]> = [[input, 0]];
  let bytes = 0;
  let nodes = 0;
  while (queue.length) {
    const [value, depth] = queue.pop()!;
    if (++nodes > 20_000 || depth > 24) throw Error('UI complexity limit');
    if (value === null || value === undefined) {
      bytes += 5;
      continue;
    }
    if (typeof value === 'string')
      bytes += new TextEncoder().encode(JSON.stringify(value)).length + 1;
    else if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw Error('Invalid number');
      bytes += 24;
    } else if (typeof value === 'boolean') bytes += 5;
    else if (typeof value === 'object') {
      if (
        !Array.isArray(value) &&
        Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null
      )
        throw Error('Invalid JSON object');
      bytes += 2;
      for (const [key, child] of Object.entries(value)) {
        if (dangerous.has(key) || key.startsWith('$') || (key.startsWith('@') && key !== '@path'))
          throw Error('包含危险 key');
        bytes += new TextEncoder().encode(JSON.stringify(key)).length + 2;
        queue.push([child, depth + 1]);
        if (queue.length > 20_000) throw Error('UI complexity limit');
      }
    } else throw Error('Invalid JSON value');
    if (bytes > MAX_UI_BYTES) throw Error('UI payload limit');
  }
}
export function parseUiJson(text: string): unknown {
  if (text.length > MAX_UI_BYTES || new TextEncoder().encode(text).length > MAX_UI_BYTES)
    throw Error('UI payload limit');
  const value: unknown = JSON.parse(text);
  assertJsonBudget(value);
  return value;
}

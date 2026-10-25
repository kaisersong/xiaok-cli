/** Pure checks on already captured source bytes. No filesystem or authority. */
export function assertCapturedJsonUniqueKeys(raw: string, errorCode: string): void {
  // JSON.parse has already checked grammar. Scan iteratively so one long value
  // cannot exhaust the regexp engine stack; only object keys need token copies.
  const frames: Array<{keys?: Set<string>; expectingKey: boolean}> = [];
  for (let i = 0; i < raw.length; i++) {
    const token = raw[i];
    if (token === '{') frames.push({keys: new Set(), expectingKey: true});
    else if (token === '[') frames.push({expectingKey: false});
    else if (token === '}' || token === ']') frames.pop();
    else if (token === ',') { const frame = frames.at(-1); if (frame?.keys) frame.expectingKey = true; }
    else if (token === '"') {
      const start = i;
      i = capturedJsonStringEnd(raw, i);
      const frame = frames.at(-1);
      if (frame?.keys && frame.expectingKey) {
        const key: string = JSON.parse(raw.slice(start, i + 1));
        if (frame.keys.has(key)) throw Error(errorCode);
        frame.keys.add(key); frame.expectingKey = false;
      }
    }
  }
}
export function parseCapturedSourceJson(raw: string): unknown {
  if (typeof raw !== 'string') throw Error('captured_source_bytes');
  const value: unknown = JSON.parse(raw);
  assertCapturedJsonUniqueKeys(raw, 'captured_source_duplicate');
  return value;
}
export function capturedFields(value: unknown, required: readonly string[], optional: readonly string[] = []): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || required.some(key => !Object.hasOwn(value, key))
    || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) throw Error('captured_source_fields');
}
export function capturedIdentity(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value || /[\x00-\x1f\x7f]/.test(value)) throw Error('captured_source_identity');
}
export function capturedInteger(value: unknown, minimum = 0): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw Error('captured_source_integer');
}
export function freezeCapturedData<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) freezeCapturedData(entry);
    Object.freeze(value);
  }
  return value;
}

/** String grammar is already checked by JSON.parse at the caller. */
function capturedJsonStringEnd(raw: string, start: number): number {
  for (let i = start + 1; i < raw.length; i++) {
    if (raw[i] === '\\') i++;
    else if (raw[i] === '"') return i;
  }
  throw Error('captured_source_json_string');
}
/** Classifies numeric literals in already syntax-validated JSON; strings do not
 * participate. Fractions/exponents remain uninterpreted even if Number is integral. */
export function capturedJsonHasOnlySafeIntegerLiterals(raw: string): boolean {
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i]!;
    if (char === '"') { i = capturedJsonStringEnd(raw, i); continue; }
    if (char !== '-' && (char < '0' || char > '9')) continue;
    const start = i;
    for (; i < raw.length && !',]} \t\r\n'.includes(raw[i]!); i++) if (i - start >= 17) return false;
    const token = raw.slice(start, i);
    if (!/^-?(?:0|[1-9]\d*)$/.test(token) || !Number.isSafeInteger(Number(token))) return false;
    i--;
  }
  return true;
}

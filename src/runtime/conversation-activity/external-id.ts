import { createHash } from 'node:crypto';

/** New ledger IDs only; existing source/store identities must remain unchanged. */
export function isValidExternalId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 128
    && /^[A-Za-z0-9][A-Za-z0-9._:#-]{0,127}$/.test(value)
    && !value.includes('..');
}

/** Non-string inputs use a type-tagged representation, never a content-bearing error. */
function invalidInput(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return `${typeof value}:${typeof value === 'bigint' || typeof value === 'symbol' ? String(value) : JSON.stringify(value)}`;
  } catch {
    return `${typeof value}:unserializable`;
  }
}

export function normalizeExternalId(value: unknown): string {
  if (isValidExternalId(value)) return value;
  return `x:${hashWorkspaceId(invalidInput(value)).slice(0, 32)}`;
}

/** Hash the exact UTF-8 path; no platform-dependent path normalization. */
export function hashWorkspaceId(path: string): string {
  return createHash('sha256').update(path).digest('hex');
}

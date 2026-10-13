import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { isValidExternalId, normalizeExternalId, hashWorkspaceId } from '../../../src/runtime/conversation-activity/external-id.js';

describe('external IDs', () => {
  const uuid = '12345678-1234-1234-1234-123456789abc';
  it.each([`task_${uuid}#12`, `xiaok-mcp:v1:sha256:${'a'.repeat(64)}`, `project:conversation-project:${'a'.repeat(64)}`, uuid, 'a'.repeat(128), 'a.b_:#-'])('preserves valid ID %s', value => {
    expect(isValidExternalId(value)).toBe(true);
    expect(normalizeExternalId(value)).toBe(value);
  });
  it.each(['', '-abc', '.abc', ':abc', 'a/b', 'a\\b', 'a b', 'a..b', '..', 'a\nb', 'a\n', 'a'.repeat(129), null, undefined, 12, false, {}, []])('aliases invalid input %j', value => {
    expect(isValidExternalId(value)).toBe(false);
    const alias = normalizeExternalId(value);
    expect(alias).toMatch(/^x:[a-f0-9]{32}$/);
    expect(isValidExternalId(alias)).toBe(true);
    expect(normalizeExternalId(alias)).toBe(alias);
    expect(normalizeExternalId(value)).toBe(alias);
  });
  it('hashes raw strings and distinguishes inputs', () => {
    expect(normalizeExternalId('a/b')).toBe(`x:${createHash('sha256').update('a/b').digest('hex').slice(0, 32)}`);
    expect(normalizeExternalId('a/b')).not.toBe(normalizeExternalId('a\\b'));
    expect(normalizeExternalId('')).toBe(`x:${createHash('sha256').update('').digest('hex').slice(0, 32)}`);
  });
  it.each(['/workspace/private/CANARY-secret-内容', 'C:\\Users\\private', '\\\\server\\private'])('hashes workspace path %s', value => {
    const hash = hashWorkspaceId(value);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toBe(hashWorkspaceId(value));
    expect(hash).toBe(createHash('sha256').update(value).digest('hex'));
    expect(hash).not.toContain(value);
  });
  it('does not throw on circular objects or throwing serialization', () => {
    const circular: Record<string, unknown> = {}; circular.self = circular;
    for (const value of [circular, { toJSON() { throw new Error('CANARY-secret-内容'); } }, Symbol('x'), 1n]) {
      expect(() => normalizeExternalId(value)).not.toThrow();
      expect(isValidExternalId(normalizeExternalId(value))).toBe(true);
    }
  });
});

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { isValidExternalId, parseExternalId, hashWorkspaceId } from '../../../src/runtime/conversation-activity/external-id.js';

describe('external IDs', () => {
  const uuid = '12345678-1234-1234-1234-123456789abc';
  it.each([`task_${uuid}#12`, `xiaok-mcp:v1:sha256:${'a'.repeat(64)}`, `project:conversation-project:${'a'.repeat(64)}`, uuid, 'a'.repeat(127), 'a'.repeat(128), 'a.b_:#-'])('accepts valid ID %s', value => {
    expect(isValidExternalId(value)).toBe(true);
    expect(parseExternalId(value)).toBe(value);
  });
  it.each([
    '', '-abc', '.abc', ':abc', 'a/b', 'a\\b', 'a b', 'a..b', '..', 'a\nb', 'a\n', 'a'.repeat(129),
    'a\u0000b', 'a\rb', 'a\tb', 'a\u007fb', 'a\u200bb', 'a\u200db', 'a\ufeffb', 'a\u202eb', 'a\u2066b',
    'p\u0430ypal', '\uff41bc', 'x:' + 'a'.repeat(127),
    null, undefined, 12, false, {}, [],
  ])('rejects invalid input %j instead of aliasing it', value => {
    expect(isValidExternalId(value)).toBe(false);
    expect(parseExternalId(value)).toBeNull();
  });
  it('never invokes toJSON, getters or serialization on rejected objects', () => {
    let called = false;
    const circular: Record<string, unknown> = {}; circular.self = circular;
    const evil = { toJSON() { called = true; throw new Error('CANARY-secret-内容'); }, toString() { called = true; return 'ok'; } };
    for (const value of [circular, evil, Symbol('x'), 1n]) {
      expect(() => parseExternalId(value)).not.toThrow();
      expect(parseExternalId(value)).toBeNull();
    }
    expect(called).toBe(false);
  });
  it.each(['/workspace/private/CANARY-secret-内容', 'C:\\Users\\private', '\\\\server\\private'])('hashes workspace path %s', value => {
    const hash = hashWorkspaceId(value);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toBe(createHash('sha256').update(value).digest('hex'));
    expect(hash).not.toContain(value);
  });
});

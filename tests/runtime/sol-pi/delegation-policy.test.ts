import { expect, it } from 'vitest';
import { validateOrdinaryChildrenPolicy } from '../../../src/runtime/sol-pi/delegation-policy.js';
const now = 1_800_000_000_000;
const policy = { enabled: true, maxDepth: 2, maxChildren: 8, expiresAt: now + 60_000, nativeTools: ['read', 'bash'] };
it('freezes a bounded explicit ordinary delegation ceiling without promoting it to a grant', () => {
  const parsed = validateOrdinaryChildrenPolicy(policy, now, now + 120_000);
  expect(parsed).toEqual(policy); expect(Object.isFrozen(parsed)).toBe(true); expect(Object.isFrozen(parsed.nativeTools)).toBe(true);
  expect(parsed).not.toBe(policy);
});
it.each([
  { enabled: false }, { maxDepth: 0 }, { maxDepth: 9 }, { maxChildren: 257 }, { maxChildren: 0 },
  { expiresAt: now - 1 }, { expiresAt: now + 180_000 }, { nativeTools: ['web_fetch'] },
  { nativeTools: ['read', 'read'] }, { nativeTools: [] }, { model: 'other' },
  { strict: true }, { destination: 'other' }, { maxDepth: 1.5 },
])('rejects unapproved ordinary delegation field/value %j', delta => {
  expect(() => validateOrdinaryChildrenPolicy({ ...policy, ...delta }, now, now + 120_000)).toThrow();
});
it('rejects inherited and accessor policy data', () => {
  expect(() => validateOrdinaryChildrenPolicy(Object.create(policy), now, now + 120_000)).toThrow();
  let evaluated = false;
  const input = { ...policy }; Object.defineProperty(input, 'enabled', { enumerable: true, get() { evaluated = true; return true; } });
  expect(() => validateOrdinaryChildrenPolicy(input, now, now + 120_000)).toThrow(); expect(evaluated).toBe(false);
});

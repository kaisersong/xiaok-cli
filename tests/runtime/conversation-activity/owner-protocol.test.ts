import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, symlinkSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { activityOwnerAddress, authenticateActivityClient, createActivityOwnerCredentials, ACTIVITY_OWNER_PROTOCOL } from '../../../src/runtime/conversation-activity/owner-protocol.js';

describe('activity owner namespace and authenticated role', () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); roots.length = 0; });
  function root() { const path = mkdtempSync(join(tmpdir(), 'activity-protocol-')); roots.push(path); return path; }
  it('rejects POSIX symlink aliases while keeping distinct roots in distinct socket namespaces', () => {
    const first = root(), second = root(), alias = join(second, 'alias'); symlinkSync(first, alias);
    if (process.platform === 'win32') expect(activityOwnerAddress(alias).rootHash).toBe(activityOwnerAddress(first).rootHash);
    else expect(() => activityOwnerAddress(alias)).toThrow('activity_storage_not_private');
    unlinkSync(alias);
    expect(activityOwnerAddress(second).socketPath).not.toBe(activityOwnerAddress(first).socketPath);
  });
  it('creates private stable credentials and refuses actor spoofing, cross-root and wrong-role tokens', () => {
    const address = activityOwnerAddress(root()), credentials = createActivityOwnerCredentials(address);
    expect(createActivityOwnerCredentials(address)).toEqual(credentials);
    if (process.platform !== 'win32') expect(statSync(address.credentialsPath).mode & 0o077).toBe(0);
    const hello = { type: 'hello', protocol: ACTIVITY_OWNER_PROTOCOL, rootHash: address.rootHash, role: 'user', token: credentials.user };
    expect(authenticateActivityClient(credentials, hello)).toBe('user');
    for (const invalid of [{ ...hello, role: 'producer' }, { ...hello, rootHash: 'other' }, { ...hello, actorId: 'admin' }, { ...hello, token: '0'.repeat(64) }]) expect(() => authenticateActivityClient(credentials, invalid)).toThrow('activity_authentication_failed');
  });
});

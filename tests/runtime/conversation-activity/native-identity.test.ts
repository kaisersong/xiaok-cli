import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readNativeSessionIdentity } from '../../../src/ai/runtime/session-store/identity.js';
import { ActivityNativeIdentityRepository } from '../../../src/runtime/conversation-activity/native-identity.js';

describe('bounded native session identity and original ownership', () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); roots.length = 0; });
  function fixture(owner = 'instance') {
    const root = mkdtempSync(join(tmpdir(), 'activity-identity-')); roots.push(root);
    const file = join(root, 'session.json');
    const header = JSON.stringify({ schemaVersion: 1, sessionId: 'session', cwd: root, intentDelegation: { ownership: { state: 'owned', ownerInstanceId: owner } } });
    writeFileSync(file, `${header.slice(0, -1)},"messages":["${'large history '.repeat(2 * 1024 * 1024)}"]}`);
    return { root, file };
  }
  it('extracts native identity without materializing a 28MB message history', () => {
    const f = fixture();
    expect(readNativeSessionIdentity(f.file)).toEqual({ schemaVersion: 1, sessionId: 'session', cwd: f.root, ownership: { state: 'owned', ownerInstanceId: 'instance' } });
    const repository = new ActivityNativeIdentityRepository({ kind: 'cli', path: f.root, profileId: 'profile', instanceId: 'instance' });
    expect(repository.getThread('session')?.profileId).toBe('profile'); expect(repository.authorizeProducer('session')).toBe(true);
    expect(repository.getThread('../session')).toBeNull();
  });
  it('allows legitimate historical identity reads but denies a foreign execution owner and detects native deletion', () => {
    const f = fixture('other');
    const repository = new ActivityNativeIdentityRepository({ kind: 'cli', path: f.root, profileId: 'profile', instanceId: 'instance' });
    expect(repository.getThread('session')).not.toBeNull(); expect(repository.authorizeProducer('session')).toBe(false);
    rmSync(f.file); expect(repository.getThread('session')).toBeNull(); expect(repository.authorizeProducer('session')).toBe(false);
  });
  it('rejects a valid native session belonging to another workspace', () => {
    const f = fixture(); const repository = new ActivityNativeIdentityRepository({ kind: 'cli', path: f.root, profileId: 'profile', instanceId: 'instance', workspaceRoot: join(f.root, 'other') });
    expect(repository.getThread('session')).toBeNull(); expect(repository.authorizeProducer('session')).toBe(false);
  });
  it('does not guess identity from legacy headers missing required native fields or unknown schemas', () => {
    const f = fixture(); writeFileSync(f.file, JSON.stringify({ schemaVersion: 9, sessionId: 'session', cwd: f.root }));
    expect(readNativeSessionIdentity(f.file)).toBeNull();
    writeFileSync(f.file, '{"schemaVersion":1,"messages":[],"sessionId":"session","cwd":"/hidden"}');
    expect(readNativeSessionIdentity(f.file)).toBeNull();
  });
});

import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, statSync, symlinkSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { secureActivityStorage, createPrivateActivityDirectory } from '../../../src/runtime/conversation-activity/storage-permissions.js';
import { ConversationActivityStore } from '../../../src/runtime/conversation-activity/store.js';
import { attachCliConversationActivities, createActivityStartupNotices } from '../../../src/runtime/conversation-activity/cli-loader.js';

describe.skipIf(process.platform === 'win32')('private storage', () => {
  it('tightens legacy directories and files and rejects symlinks and chmod failure', () => {
    const base = mkdtempSync(join(tmpdir(), 'activity-private-'));
    const parent = join(base, 'conversation-activity'), root = join(parent, 'fake');
    try {
      mkdirSync(join(root, 'tasks', 'snapshots'), { recursive: true });
      const dirs = [parent, root, join(root, 'tasks'), join(root, 'tasks', 'snapshots')];
      const files = ['conversation-activity.sqlite','conversation-activity.sqlite-wal','conversation-activity.sqlite-shm','.owner.sqlite','activity-owner.log','tasks/snapshots/x.json'].map(name => join(root, name));
      dirs.forEach(dir => chmodSync(dir, 0o755)); files.forEach(file => { writeFileSync(file, 'fake'); chmodSync(file, 0o644); });
      secureActivityStorage(root);
      dirs.forEach(dir => expect(statSync(dir).mode & 0o777).toBe(0o700)); files.forEach(file => expect(statSync(file).mode & 0o777).toBe(0o600));
      expect(() => secureActivityStorage(root, { chmodSync() { throw Object.assign(new Error('fake'), { code: 'EPERM' }); } })).toThrow('activity_storage_not_private');
      expect(() => secureActivityStorage(root, { maxEntries: 1 })).toThrow('activity_storage_not_private');
      symlinkSync(join(root, 'tasks'), join(root, 'link'));
      expect(() => createPrivateActivityDirectory(join(root, 'link', 'new'))).toThrow('activity_storage_not_private');
      expect(existsSync(join(root, 'tasks', 'new'))).toBe(false);
      expect(() => secureActivityStorage(root)).toThrow('activity_storage_not_private');
    } finally { rmSync(base, { recursive: true, force: true }); }
  });
  it('accepts a linked ancestor above the activity tree (for example macOS /var -> /private/var)', () => {
    const base = mkdtempSync(join(tmpdir(), 'activity-linked-home-'));
    try {
      mkdirSync(join(base, 'real-home'));
      symlinkSync(join(base, 'real-home'), join(base, 'home'));
      const root = join(base, 'home', '.xiaok', 'conversation-activity', 'fake');
      expect(() => createPrivateActivityDirectory(root)).not.toThrow();
      expect(statSync(root).mode & 0o777).toBe(0o700);
      expect(statSync(join(base, 'home', '.xiaok', 'conversation-activity')).mode & 0o777).toBe(0o700);
    } finally { rmSync(base, { recursive: true, force: true }); }
  });
  it('creates writable SQLite sidecars privately under umask 022', () => {
    const root = mkdtempSync(join(tmpdir(), 'activity-sqlite-')), mask = process.umask(0o022);
    let store: ConversationActivityStore | undefined;
    try {
      const file = join(root, 'conversation-activity.sqlite'); store = new ConversationActivityStore(file);
      store.prepareAssociation({ operationId: 'fake', creationIdempotencyKey: 'fake', origin: { profileId: 'fake', threadId: 'fake', workspaceId: 'fake', actorId: 'fake' } });
      expect(statSync(root).mode & 0o777).toBe(0o700);
      for (const suffix of ['', '-wal', '-shm', '.owner.sqlite']) expect(statSync(file + suffix).mode & 0o777).toBe(0o600);
    } finally { store?.close(); process.umask(mask); rmSync(root, { recursive: true, force: true }); }
  });
  it('queues the exact permission failure notice once without throwing', async () => {
    const notices = createActivityStartupNotices({ configDir: '' });
    const debug = vi.fn();
    const options = { onDebug: debug, print: false, isTTY: true, conversationActivity: undefined, attachOptions: {} as any, startupNotices: notices };
    const deps = { importCli: async () => ({ CliConversationActivities: { attach: async () => { throw new Error('activity_storage_not_private'); } } }) };
    expect(await attachCliConversationActivities(options, deps)).toBeUndefined();
    expect(debug).toHaveBeenCalledExactlyOnceWith('cli_activity_storage_not_private', 'activity_storage_not_private');
    expect(notices.take()?.text).toBe('异步任务跟进已停用：无法把 ~/.xiaok/conversation-activity 设为仅本人可访问，请检查该目录的所有者和权限。');
    await attachCliConversationActivities(options, deps); expect(notices.take()).toBeUndefined();
  });
});

it('Windows permission guard is a no-op', () => {
  expect(() => secureActivityStorage('fake-nonexistent-directory', { platform: 'win32', chmodSync() { throw new Error('fake'); } })).not.toThrow();
});

import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, statSync, symlinkSync, rmSync, existsSync, readFileSync, readlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activityStorageLayout, secureActivityStorage, createPrivateActivityDirectory } from '../../../src/runtime/conversation-activity/storage-permissions.js';
import { getConfigDir } from '../../../src/utils/config.js';
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
  it.each([0o000, 0o022, 0o077, 0o277])('creates writable private storage under umask %s in a child', mask => {
    const base = mkdtempSync(join(tmpdir(), 'activity-mask-'));
    const moduleUrl = (name: string) => pathToFileURL(join(process.cwd(), '.test-dist/src/runtime/conversation-activity', name + '.js')).href;
    try {
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
        import { existsSync, statSync } from 'node:fs';
        import { join } from 'node:path';
        import { strict as assert } from 'node:assert';
        import { createPrivateActivityDirectory } from ${JSON.stringify(moduleUrl('storage-permissions'))};
        import { ConversationActivityStore } from ${JSON.stringify(moduleUrl('store'))};
        import { activityOwnerAddress, createActivityOwnerCredentials } from ${JSON.stringify(moduleUrl('owner-protocol'))};
        import { createActivityStartupNotices } from ${JSON.stringify(moduleUrl('cli-loader'))};
        process.umask(${mask});
        const root = join(${JSON.stringify(base)}, 'new', 'conversation-activity', 'workspace');
        createPrivateActivityDirectory(root);
        for (const dir of [root, join(root, '..'), join(root, '../..')]) assert.equal(statSync(dir).mode & 0o777, 0o700);
        const address = activityOwnerAddress(root); createActivityOwnerCredentials(address);
        assert.equal(statSync(address.credentialsPath).mode & 0o777, 0o600);
        const notices = createActivityStartupNotices({ configDir: root }); assert.equal(notices.take(), undefined);
        assert.equal(existsSync(join(root, 'conversation-activity', 'first-start-notice-shown')), false);
        const file = join(root, 'conversation-activity.sqlite');
        for (let round = 0; round < 2; round++) {
          const store = new ConversationActivityStore(file);
          for (let i = 0; i < 2; i++) store.prepareAssociation({ operationId: 'op'+round+i, creationIdempotencyKey: 'key'+round+i, origin: { profileId:'p', threadId:'t', workspaceId:'w', actorId:'a' } });
          for (const suffix of ['', '.owner.sqlite', '-wal', '-shm']) assert.equal(statSync(file+suffix).mode & 0o777, 0o600);
          store.close();
        }
      `], { encoding: 'utf8' });
      expect(result.stderr, result.error?.message).not.toContain('Error');
      expect(result.status, result.stderr).toBe(0);
    } finally { rmSync(base, { recursive: true, force: true }); }
  });
  it.each(['desktop', '.xiaok', 'custom-config'])('preserves unrelated shared entries in %s', name => {
    const base = mkdtempSync(join(tmpdir(), 'activity-shared-'));
    const previousConfigDir = process.env.XIAOK_CONFIG_DIR;
    const root = join(base, name);
    try {
      if (name === 'custom-config') { process.env.XIAOK_CONFIG_DIR = root; expect(getConfigDir()).toBe(root); }
      mkdirSync(root); chmodSync(root, 0o755); chmodSync(base, 0o755);
      const script = join(root, 'script'); writeFileSync(script, 'executable'); chmodSync(script, 0o755);
      const file = join(root, 'other'); writeFileSync(file, 'other'); chmodSync(file, 0o644);
      mkdirSync(join(root, 'plugins')); writeFileSync(join(root, 'plugins', 'plugin'), 'plugin');
      chmodSync(join(root, 'plugins'), 0o700);
      symlinkSync(base, join(root, 'venv')); symlinkSync(process.execPath, join(root, 'python'));
      const paths = [base, root, script, file, join(root, 'plugins'), join(root, 'plugins', 'plugin'), process.execPath];
      const links = [join(root, 'venv'), join(root, 'python')].map(path => readlinkSync(path));
      const contents = [script, file, join(root, 'plugins', 'plugin')].map(path => readFileSync(path, 'utf8'));
      const before = paths.map(path => ({ mode: statSync(path).mode, mtime: [base, root].includes(path) ? 0 : statSync(path).mtimeMs }));
      mkdirSync(join(root, 'snapshots')); chmodSync(join(root, 'snapshots'), 0o755);
      writeFileSync(join(root, 'snapshots', 'task.json'), '{}'); chmodSync(join(root, 'snapshots', 'task.json'), 0o644);
      writeFileSync(join(root, 'conversation-activity.sqlite'), '');
      writeFileSync(join(root, 'conversation-activity.sqlite-wal'), '');
      createPrivateActivityDirectory(root); secureActivityStorage(root);
      const store = new ConversationActivityStore(join(root, 'conversation-activity.sqlite')); store.close();
      paths.forEach((path, i) => expect({ mode: statSync(path).mode, mtime: [base, root].includes(path) ? 0 : statSync(path).mtimeMs }).toEqual(before[i]));
      expect(statSync(join(root, 'conversation-activity.sqlite')).mode & 0o777).toBe(0o600);
      expect(statSync(join(root, 'snapshots')).mode & 0o777).toBe(0o700);
      expect(statSync(join(root, 'snapshots', 'task.json')).mode & 0o777).toBe(0o600);
      expect(statSync(script).mode & 0o777).toBe(0o755);
      expect(activityStorageLayout(root)).toBe('shared');
      expect([join(root, 'venv'), join(root, 'python')].map(path => readlinkSync(path))).toEqual(links);
      expect([script, file, join(root, 'plugins', 'plugin')].map(path => readFileSync(path, 'utf8'))).toEqual(contents);
      symlinkSync(file, join(root, 'activity-owner.status.json'));
      expect(() => secureActivityStorage(root)).toThrow('activity_storage_not_private');
    } finally {
      if (previousConfigDir === undefined) delete process.env.XIAOK_CONFIG_DIR; else process.env.XIAOK_CONFIG_DIR = previousConfigDir;
      rmSync(base, { recursive: true, force: true });
    }
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

it.skipIf(process.platform === 'win32')('real owner creates private files under inherited strict umask', async () => {
  const base = mkdtempSync(join(tmpdir(), 'activity-owner-mask-'));
  const { ensureConversationActivityOwner } = await import('../../../src/runtime/conversation-activity/owner-launcher.js');
  const { spawn } = await import('node:child_process');
  const { readdirSync, lstatSync } = await import('node:fs');
  let client: Awaited<ReturnType<typeof ensureConversationActivityOwner>> | undefined;
  let pid: number | undefined;
  try {
    const root = join(base, 'conversation-activity', 'owner');
    client = await ensureConversationActivityOwner({ schemaVersion: 1, dataRoot: root, profileId: 'fake', actorId: 'fake', identity: { kind: 'cli', path: root } }, {
      timeoutMs: 5000,
      entryPath: join(process.cwd(), '.test-dist/src/runtime/conversation-activity/owner-entry.js'),
      spawn: ((executable, args, options) => spawn(executable, ['--input-type=module', '-e', `process.umask(0o277); process.argv = [process.execPath, ${JSON.stringify(args![0])}, ${JSON.stringify(args![1])}]; await import(${JSON.stringify(pathToFileURL(args![0]).href)});`], options)) as typeof spawn,
    });
    pid = (await client.request<{ pid: number }>('status')).pid;
    const check = (dir: string) => {
      expect(lstatSync(dir).mode & 0o777).toBe(0o700);
      for (const name of readdirSync(dir)) {
        const path = join(dir, name), state = lstatSync(path);
        if (state.isDirectory()) check(path);
        else if (state.isFile()) expect(state.mode & 0o777, path).toBe(0o600);
      }
    };
    check(root);
  } catch (error) {
    const log = join(base, 'conversation-activity', 'owner', 'activity-owner.log');
    throw new Error(`${String(error)}: ${existsSync(log) ? readFileSync(log, 'utf8') : ''}`);
  } finally {
    client?.dispose();
    if (pid) { process.kill(pid, 'SIGTERM'); await vi.waitFor(() => expect(() => process.kill(pid!, 0)).toThrow(), { timeout: 5000 }); }
    rmSync(base, { recursive: true, force: true });
  }
}, 15_000);

import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { CliConversationActivities } from '../../../src/runtime/conversation-activity/cli.js';
import { attachCliConversationActivities, createActivityStartupNotices } from '../../../src/runtime/conversation-activity/cli-loader.js';

const attachOptions = {} as Parameters<typeof CliConversationActivities.attach>[0];
const options = { print: false, isTTY: true, conversationActivity: undefined, attachOptions };

describe('attachCliConversationActivities', () => {
  it.each(['ERR_UNKNOWN_BUILTIN_MODULE', undefined])('silently handles import failure (%s)', async code => {
    const error = Object.assign(new Error('No such built-in module: node:sqlite'), { code });
    const onDebug = vi.fn();
    const importCli = vi.fn().mockRejectedValue(error);
    await expect(attachCliConversationActivities({ ...options, onDebug }, { importCli })).resolves.toBeUndefined();
    expect(onDebug).toHaveBeenCalledExactlyOnceWith('cli_activity_sqlite_unavailable', code ?? 'unclassified');
    expect(JSON.stringify(onDebug.mock.calls)).not.toContain('\\n    at ');
  });

  it.each([{ print: true }, { isTTY: false }, { conversationActivity: '0' }])('does not import when disabled: %j', async gate => {
    const importCli = vi.fn();
    expect(await attachCliConversationActivities({ ...options, ...gate }, { importCli })).toBeUndefined();
    expect(importCli).not.toHaveBeenCalled();
  });

  it('passes the existing attach options and returns the original instance', async () => {
    const result = {} as CliConversationActivities;
    const attach = vi.fn().mockResolvedValue(result);
    const importCli = vi.fn().mockResolvedValue({ CliConversationActivities: { attach } });
    expect(await attachCliConversationActivities(options, { importCli })).toBe(result);
    expect(importCli).toHaveBeenCalledTimes(1);
    expect(attach).toHaveBeenCalledExactlyOnceWith(attachOptions);
  });

  it('preserves owner failure logging', async () => {
    const error = new Error('owner unavailable');
    const onDebug = vi.fn();
    const attach = vi.fn().mockRejectedValue(error);
    const importCli = vi.fn().mockResolvedValue({ CliConversationActivities: { attach } });
    expect(await attachCliConversationActivities({ ...options, onDebug }, { importCli })).toBeUndefined();
    expect(onDebug).toHaveBeenCalledExactlyOnceWith('cli_activity_owner_unavailable', String(error));
  });
});


describe('activity startup notices', () => {
  async function load(configDir: string, gate = {}, importCli = vi.fn().mockResolvedValue({
    CliConversationActivities: { attach: vi.fn().mockResolvedValue({}) },
  })) {
    const notices = createActivityStartupNotices({ configDir, version: 'v22.12.0' });
    await attachCliConversationActivities({ ...options, ...gate, startupNotices: notices }, { importCli });
    return notices;
  }

  it('queues a clean degradation notice once per session', async () => {
    const notices = await load('', {}, vi.fn().mockRejectedValue(Object.assign(
      new Error('node:sqlite\n    at loader'), { code: 'ERR_UNKNOWN_BUILTIN_MODULE' })));
    const notice = notices.take();
    expect(notice?.text).toBe('异步任务跟进在当前 Node 版本（v22.12.0）不可用，其他功能不受影响。升级到 Node 22.14.0 或更新版本后会自动启用。');
    expect(notice?.text).not.toMatch(/ERR_|node:sqlite|    at /);
    expect(notices.take()).toBeUndefined();
  });

  it.each([{ print: true }, { isTTY: false }, { conversationActivity: '0' }])('disabled %j queues nothing', async gate => {
    expect((await load('', gate)).take()).toBeUndefined();
  });

  it('owner failure queues nothing', async () => {
    const notices = await load('', {}, vi.fn().mockResolvedValue({
      CliConversationActivities: { attach: vi.fn().mockRejectedValue(new Error('owner unavailable')) },
    }));
    expect(notices.take()).toBeUndefined();
  });

  it('persists only after terminal output and suppresses subsequent sessions', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'activity-notice-'));
    try {
      const first = (await load(dir)).take();
      expect(first?.text).toBe('已在后台启动任务跟进，设 XIAOK_CONVERSATION_ACTIVITY=0 可关闭。');
      expect((await load(dir)).take()?.text).toBe(first?.text);
      first?.markShown();
      expect((await load(dir)).take()).toBeUndefined();
      if (process.platform !== 'win32') {
        expect(statSync(join(dir, 'conversation-activity', 'first-start-notice-shown')).mode & 0o777).toBe(0o600);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('silently handles inaccessible marker paths', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'activity-notice-'));
    try {
      // A file in place of the directory reliably prevents writes even under root.
      writeFileSync(join(dir, 'conversation-activity'), 'blocked');
      const notices = await load(dir);
      expect(() => notices.take()?.markShown()).not.toThrow();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

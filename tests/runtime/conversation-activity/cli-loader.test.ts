import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { CliConversationActivities } from '../../../src/runtime/conversation-activity/cli.js';
import { ACTIVITY_OWNER_NOTICES, attachCliConversationActivities, createActivityStartupNotices } from '../../../src/runtime/conversation-activity/cli-loader.js';

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
    expect(attach).toHaveBeenCalledExactlyOnceWith({ ...attachOptions, onLegacyOwner: expect.any(Function), onOwnerReplaced: expect.any(Function) });
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

  it('owner failure queues a degradation notice', async () => {
    const notices = await load('', {}, vi.fn().mockResolvedValue({
      CliConversationActivities: { attach: vi.fn().mockRejectedValue(new Error('owner unavailable')) },
    }));
    expect(notices.take()?.text).toBe('异步任务跟进暂不可用，其他功能不受影响。如不需要，可设 XIAOK_CONVERSATION_ACTIVITY=0 关闭。');
  });

  it('keeps successful startup silent across fresh sessions without writing a notice marker', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'activity-notice-'));
    try {
      expect((await load(dir)).take()).toBeUndefined();
      expect((await load(dir)).take()).toBeUndefined();
      expect(existsSync(join(dir, 'conversation-activity', 'first-start-notice-shown'))).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('successful startup remains silent when the former marker path is inaccessible', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'activity-notice-'));
    try {
      // A file in place of the directory reliably prevents writes even under root.
      writeFileSync(join(dir, 'conversation-activity'), 'blocked');
      const notices = await load(dir);
      expect(() => notices.take()?.markShown()).not.toThrow();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

it.each(['v22.14.0', 'v22.15.0', 'v24.0.0'])('uses generic unavailable notice on %s', version => { const notices = createActivityStartupNotices({ configDir: '', version }); notices.queueUnavailable(); expect(notices.take()?.text).toBe('异步任务跟进暂不可用，其他功能不受影响。如不需要，可设 XIAOK_CONVERSATION_ACTIVITY=0 关闭。'); });

it('queues each actionable update notice once', () => {
  const notices = createActivityStartupNotices({ configDir: '/tmp/issue-23-notice-missing' });
  notices.queueLegacyPending(); notices.queueLegacyPending();
  expect(notices.take()?.text).toBe('有未完成的后台任务，任务结束后再次打开 xiaok 会自动更新。');
  notices.queueLegacyPending(); expect(notices.take()).toBeUndefined();
  notices.queueOwnerReplaced(); notices.queueOwnerReplaced();
  expect(notices.take()?.text).toBe('后台任务跟进已更新，请重新打开终端以继续跟进');
  expect(notices.take()).toBeUndefined();
});
it.each(['queueLegacyReplaced', 'queueLegacyPending', 'queueOwnerReplaced'] as const)('degradation suppresses %s in either order', method => {
  for (const first of [true, false]) {
    const notices = createActivityStartupNotices({ configDir: '' });
    if (first) notices[method](); notices.queueOwnerUnavailable(); if (!first) notices[method]();
    expect(notices.take()?.text).toContain('暂不可用'); expect(notices.take()).toBeUndefined();
  }
});

it.each(['replaced', 'reused_pending'] as const)('connects legacy callback %s to idle notice queue', async outcome => {
  const notices = createActivityStartupNotices({ configDir: '' }); const changed = vi.fn();
  const attach = vi.fn(async (input: Parameters<typeof CliConversationActivities.attach>[0]) => {
    input.onLegacyOwner?.(outcome); return {} as CliConversationActivities;
  });
  await attachCliConversationActivities({ ...options, attachOptions: { ...attachOptions, changed }, startupNotices: notices }, { importCli: async () => ({ CliConversationActivities: { attach } }) });
  expect(notices.take()?.text).toBe(outcome === 'replaced'
    ? '后台任务跟进已更新。更新前已打开的旧版终端不会再跟进，请重新打开终端。'
    : '有未完成的后台任务，任务结束后再次打开 xiaok 会自动更新。');
});
it('owner notice constants contain no restart or logout wording', () => {
  expect(Object.values(ACTIVITY_OWNER_NOTICES).every(text => !/重启|注销/.test(text))).toBe(true);
});
it('queues replacement callback once and suppresses legacy callback after failed attachment', async () => {
  const notices = createActivityStartupNotices({ configDir: '' }); const changed = vi.fn();
  let callback: (() => void) | undefined;
  const attach = vi.fn(async (input: Parameters<typeof CliConversationActivities.attach>[0]) => {
    callback = input.onOwnerReplaced; input.onLegacyOwner?.('replaced'); throw new Error('failed');
  });
  await attachCliConversationActivities({ ...options, attachOptions: { ...attachOptions, changed }, startupNotices: notices }, { importCli: async () => ({ CliConversationActivities: { attach } }) });
  callback?.(); callback?.(); expect(notices.take()?.text).toContain('暂不可用'); expect(notices.take()).toBeUndefined();
  const success = createActivityStartupNotices({ configDir: '' });
  const attachSuccess = vi.fn(async (input: Parameters<typeof CliConversationActivities.attach>[0]) => { callback = input.onOwnerReplaced; return {} as CliConversationActivities; });
  await attachCliConversationActivities({ ...options, attachOptions: { ...attachOptions, changed }, startupNotices: success }, { importCli: async () => ({ CliConversationActivities: { attach: attachSuccess } }) });
  callback?.(); callback?.(); expect(success.take()?.text).toBe('后台任务跟进已更新，请重新打开终端以继续跟进');
  expect(success.take()).toBeUndefined();
});

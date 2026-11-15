import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  awaitOwnerStatus, awaitProcessGone, deadlineBoundOwnerList, deadlineBoundRetireDependencies, POST_TEARDOWN_RESERVE_MS, ownerPathPrefixes, ownersWithPrefixes, processExists, PS_SCAN_RESERVE_MS, psTimeoutFor,
  RECLAIM_RESERVE_MS, REMOVE_RESERVE_MS, RETIRE_MIN_MS, reclaimAndReport, teardownOverrunError, reclaimLateOwners, removeTempDirWithRetry, retireActivityOwnersUnder, TEARDOWN_BUDGET_MS, tempDirRemoverFor,
  teardownCaseOwners, type ActivityOwnerProcess, type ActivityOwnerSurvivor,
} from '../../support/activity-owner-teardown.js';
import { retireOutdatedOwner } from '../../../src/runtime/conversation-activity/owner-retire.js';
import { createTeardownSteps } from '../../support/teardown-steps.js';

// #145：用例收尾闸门自身的失败路径。进程表与产品 retire 都用桩，只验证闸门的分类与认领。
describe('activity owner teardown gate (#145)', () => {
  const roots: string[] = [];
  afterEach(() => { vi.useRealTimers(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  const makeOwner = (pid: number, statusPid: number | null = pid) => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-owner-gate-'));
    roots.push(root);
    const dataRoot = join(realpathSync(root), 'config', 'conversation-activity', 'abc');
    mkdirSync(dataRoot, { recursive: true });
    if (statusPid !== null) writeFileSync(join(dataRoot, 'activity-owner.status.json'), JSON.stringify({ pid: statusPid, ownerEpoch: 'e', rootHash: 'h' }));
    return { root, dataRoot, owner: { pid, configPath: join(dataRoot, 'activity-owner.config.json') } as ActivityOwnerProcess };
  };

  // 第 8 轮 codex Major：删除本身耗时时，多目录不会在截止后再启动删除。
  it('does not start removing further directories once the remove deadline passed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const deadline = Date.now() + TEARDOWN_BUDGET_MS;
      const removeDeadline = deadline - RECLAIM_RESERVE_MS;
      const started: Array<{ dir: string; at: number }> = [];
      const reports: string[] = [];
      const teardown = createTeardownSteps('t');
      const report = await teardownCaseOwners({
        dirs: ['/case/a', '/case/b', '/case/c', '/case/d'], deadline, posix: false, step: teardown.step,
        // 每次删除消耗 2s（模拟慢盘）：删目录阶段 6s，第 4 个目录到达时已到截止。
        removeDir: (dir, until) => removeTempDirWithRetry(dir, until, (target) => {
          started.push({ dir: target, at: Date.now() });
          vi.setSystemTime(Date.now() + 2_000);
        }, (message) => reports.push(message)),
      });
      expect(started.every(({ at }) => at < removeDeadline)).toBe(true);
      expect(started.map(({ dir }) => dir)).toEqual(['/case/a', '/case/b', '/case/c']);
      expect(reports).toEqual([expect.stringContaining('跳过删除临时目录 /case/d')]);
      expect(report).toEqual({ survivors: [], reclaimFailed: false });
    } finally { vi.useRealTimers(); }
  });

  // 第 9 轮 codex Major：单次删除本身卡住也不能拖过截止——删除是异步的，与截止时刻赛跑，没删完的留在后台。
  it('does not let a single hanging removal hold the hook past the remove deadline', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const deadline = Date.now() + TEARDOWN_BUDGET_MS;
      const removeDeadline = deadline - RECLAIM_RESERVE_MS;
      const reports: string[] = [];
      const started: string[] = [];
      let settled = false;
      const teardown = createTeardownSteps('t');
      const running = teardownCaseOwners({
        dirs: ['/case/hang', '/case/next'], deadline, posix: false, step: teardown.step,
        removeDir: (dir, until) => removeTempDirWithRetry(dir, until, (target) => { started.push(target); return new Promise<void>(() => {}); }, (message) => reports.push(message)),
      }).then((value) => { settled = true; return value; });
      while (!settled && Date.now() <= deadline) await vi.advanceTimersByTimeAsync(10);
      expect(settled).toBe(true);
      expect(Date.now()).toBeLessThanOrEqual(removeDeadline);
      expect(await running).toEqual({ survivors: [], reclaimFailed: false });
      expect(started).toEqual(['/case/hang']);
      expect(reports).toEqual([expect.stringContaining('/case/hang 仍在后台删除'), expect.stringContaining('跳过删除临时目录 /case/next')]);
      expect(teardown.errors).toEqual([]);
    } finally { vi.useRealTimers(); }
  });

  it('removes a real directory with the default asynchronous removal', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xiaok-owner-rm-'));
    roots.push(dir);
    mkdirSync(join(dir, 'nested'), { recursive: true });
    writeFileSync(join(dir, 'nested', 'file.txt'), 'x');
    const reports: string[] = [];
    await removeTempDirWithRetry(dir, Date.now() + 5_000, undefined, (message) => reports.push(message));
    expect(existsSync(dir)).toBe(false);
    expect(reports).toEqual([]);
  });

  // 第 10 轮 DS M3：后台删除只在失败时再报一次，报告本身抛错也不会变成未处理拒绝。
  it('reports a background removal failure once and swallows a failing reporter', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      let failLater!: (error: Error) => void;
      const reports: string[] = [];
      const done = removeTempDirWithRetry('/case/bg', Date.now() + 500, () => new Promise<void>((_resolve, reject) => { failLater = reject; }), (message) => reports.push(message));
      await vi.advanceTimersByTimeAsync(500);
      await done;
      expect(reports).toEqual([expect.stringContaining('/case/bg 仍在后台删除')]);
      failLater(new Error('EBUSY late'));
      await vi.advanceTimersByTimeAsync(0);
      expect(reports).toHaveLength(2);
      expect(reports[1]).toContain('后台删除失败');
      expect(reports[1]).toContain('EBUSY late');
      let failAgain!: (error: Error) => void;
      let calls = 0;
      const second = removeTempDirWithRetry('/case/bg2', Date.now() + 500, () => new Promise<void>((_resolve, reject) => { failAgain = reject; }), () => { calls += 1; if (calls > 1) throw new Error('EPIPE'); });
      await vi.advanceTimersByTimeAsync(500);
      await second;
      failAgain(new Error('EBUSY'));
      await vi.advanceTimersByTimeAsync(0);
      await new Promise((resolve) => setImmediate(resolve));
      expect(calls).toBe(2);
      expect(unhandled).toEqual([]);
    } finally { process.off('unhandledRejection', onUnhandled); vi.useRealTimers(); }
  });

  // 第 10 轮 DS M3：hook 总耗时核对是纯函数，越界才给错误。
  it('flags a teardown that overran the budget plus reserve', () => {
    expect(teardownOverrunError(TEARDOWN_BUDGET_MS + POST_TEARDOWN_RESERVE_MS)).toBeUndefined();
    const error = teardownOverrunError(TEARDOWN_BUDGET_MS + POST_TEARDOWN_RESERVE_MS + 1);
    expect(error?.message).toContain(`${TEARDOWN_BUDGET_MS + POST_TEARDOWN_RESERVE_MS + 1}ms`);
    expect(teardownOverrunError(100, 50, 25)?.message).toContain('预算 50ms + 余量 25ms');
  });

  // 第 9 轮 codex minor 2：退休入口抛错时，已记录的预算截断步骤不丢。
  it('keeps the budget steps when the retire entry throws after a deadline cut', async () => {
    const { root, owner } = makeOwner(41050);
    const failure = new Error('收尾预算已用完：readCmdline（#145）');
    const survivors = await retireActivityOwnersUnder([root], {
      list: () => [owner], deadline: Date.now() + 60_000,
      awaitStatus: (dataRoot, pid) => awaitOwnerStatus(dataRoot, pid, 0),
      retire: async (_dataRoot, _status, _until, onBudget) => { onBudget('readCmdline 被截断'); throw failure; },
    });
    expect(survivors).toEqual([{ ...owner, reason: 'teardown_error', error: failure, budget: '收尾预算不足：readCmdline 被截断' }]);
  });

  // 第 8 轮 DS minor 4：Windows（posix=false）只删目录，不收不判。
  it('only removes the directories on Windows', async () => {
    const removed: string[] = [];
    let reads = 0;
    const teardown = createTeardownSteps('t');
    const report = await teardownCaseOwners({
      dirs: ['/case/a', '/case/b'], deadline: Date.now() + TEARDOWN_BUDGET_MS, posix: false, step: teardown.step,
      removeDir: (dir) => { removed.push(dir); },
      retire: { list: () => { reads += 1; return []; } }, reclaim: { list: () => { reads += 1; return []; } },
    });
    expect(removed).toEqual(['/case/a', '/case/b']);
    expect(reads).toBe(0);
    expect(report).toEqual({ survivors: [], reclaimFailed: false });
  });

  // 第 7 轮 DS minor 1：预算已不允许等 status 时，没有 status 记 teardown_deadline，不归咎于产品（missing_status）。
  it('reports teardown_deadline instead of missing_status when the budget left no time to wait', async () => {
    const { root, owner } = makeOwner(41043, null);
    const waits: number[] = [];
    const survivors = await retireActivityOwnersUnder([root], {
      list: () => [owner], deadline: Date.now() + PS_SCAN_RESERVE_MS, awaitStatus: async (_d, _p, ms) => { waits.push(ms); return undefined; },
    });
    expect(waits).toEqual([0]);
    expect(survivors).toEqual([{ ...owner, reason: 'teardown_deadline', budget: '没有剩余预算等 status' }]);
  });

  it('skips the product entry with teardown_deadline when the identity checks no longer fit the budget', async () => {
    const { root, owner } = makeOwner(41035);
    let calls = 0;
    const survivors = await retireActivityOwnersUnder([root], {
      list: () => [owner], deadline: Date.now() + 1_000, retire: async () => { calls += 1; return 'retired'; },
    });
    expect(calls).toBe(0);
    expect(survivors).toEqual([{ ...owner, reason: 'teardown_deadline', budget: '没有剩余预算进入产品退休入口' }]);
  });
});


// DS 第 6 轮 B1 / codex Major2：afterEach 的回收合并与报告编排，直接测实际实现（reclaimAndReport）。
describe('owner teardown report (#145)', () => {
  const owner = (pid: number, reason: ActivityOwnerSurvivor['reason'], extra: Partial<ActivityOwnerSurvivor> = {}): ActivityOwnerSurvivor =>
    ({ pid, configPath: `/case/${pid}/activity-owner.config.json`, reason, ...extra });
  const prefixes = ['/case/'];

  it('still reports an owner that appeared during teardown even when it is reclaimed', async () => {
    const report = await reclaimAndReport({
      retired: [owner(1, 'appeared_during_teardown')], retireStepFailed: false, prefixes,
      reclaim: async (_prefixes, reasonFor) => [owner(1, reasonFor(1), { reclaimed: true })],
    });
    expect(report).toEqual({ survivors: [owner(1, 'appeared_during_teardown', { reclaimed: true })], reclaimFailed: false });
  });

  it('keeps every retire-phase detail, including appeared owners, when the reclaim step fails', async () => {
    const failure = new Error('ps 不可用');
    const retired = [owner(1, 'kept_pending'), owner(2, 'appeared_during_teardown'), owner(3, 'teardown_error', { error: new Error('retire rejected') })];
    const report = await reclaimAndReport({ retired, retireStepFailed: false, prefixes, reclaim: async () => { throw failure; } });
    expect(report).toMatchObject({ reclaimFailed: true, error: failure });
    expect(report.survivors).toEqual([retired[0], retired[2], retired[1]]);
  });

  it('labels owners that never reached the product entry as unretired_after_error when the retire step failed', async () => {
    const reasons: string[] = [];
    const report = await reclaimAndReport({
      retired: [], retireStepFailed: true, prefixes,
      reclaim: async (_prefixes, reasonFor) => { reasons.push(reasonFor(7)); return [owner(7, reasonFor(7), { reclaimed: true })]; },
    });
    expect(reasons).toEqual(['unretired_after_error']);
    expect(report.survivors).toEqual([owner(7, 'unretired_after_error', { reclaimed: true })]);
  });

  it('labels an owner first seen by the post-removal scan as late_after_removal', async () => {
    const report = await reclaimAndReport({
      retired: [owner(1, 'kept_unknown')], retireStepFailed: false, prefixes,
      reclaim: async (_prefixes, reasonFor) => [owner(1, reasonFor(1), { reclaimed: true }), owner(9, reasonFor(9), { reclaimed: true })],
    });
    expect(report.survivors).toEqual([owner(1, 'kept_unknown', { reclaimed: true }), owner(9, 'late_after_removal', { reclaimed: true })]);
  });

  it('keeps the first error when the reclaim also fails for an attempted owner', async () => {
    const first = new Error('retire rejected');
    const report = await reclaimAndReport({
      retired: [owner(1, 'teardown_error', { error: first }), owner(2, 'kept_unverified')], retireStepFailed: false, prefixes,
      reclaim: async (_prefixes, reasonFor) => [
        owner(1, reasonFor(1), { reclaimed: false, error: new Error('EPERM') }),
        owner(2, reasonFor(2), { reclaimed: false, error: new Error('EPERM') }),
      ],
    });
    expect(report.survivors).toEqual([
      owner(1, 'teardown_error', { reclaimed: false, error: first }),
      owner(2, 'kept_unverified', { reclaimed: false, error: new Error('EPERM') }),
    ]);
  });

  it('does not scan when the prefixes could not be computed, but still reports the retire-phase owners', async () => {
    let scans = 0;
    const retired = [owner(2, 'appeared_during_teardown'), owner(1, 'kept_pending')];
    const report = await reclaimAndReport({ retired, retireStepFailed: true, prefixes: undefined, reclaim: async () => { scans += 1; return []; } });
    expect(scans).toBe(0);
    expect(report.survivors).toEqual([retired[1], retired[0]]);
  });
});

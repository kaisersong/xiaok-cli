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

  // DS 第 6 轮 minor 1/2：到期时按 pid 分类（status 恰好在到期时是它就照常退休）；dataRoot 已不存在单独记 data_root_gone。
  it('classifies at the deadline by pid and separates a removed data root from a missing status', async () => {
    const late = makeOwner(41027);
    const gone = makeOwner(41028, null);
    rmSync(gone.dataRoot, { recursive: true, force: true });
    let table = [late.owner, gone.owner];
    const retired: number[] = [];
    const survivors = await retireActivityOwnersUnder([late.root, gone.root], {
      list: () => table,
      // 等待本身到期给 undefined，但磁盘上的 status 已经是这个 pid。
      awaitStatus: async () => undefined,
      retire: async (_dir, status) => { retired.push(status.pid as number); table = table.filter((owner) => owner.pid !== status.pid); return 'retired'; },
    });
    expect(retired).toEqual([41027]);
    expect(survivors).toEqual([{ ...gone.owner, reason: 'data_root_gone' }]);
  });

  // DS 第 6/7 轮 M1/M3、codex 第 6/7 轮 Major1/2：整段 afterEach 的 owner 收尾（teardownCaseOwners，实际编排）在注入的截止时刻内结束。
  // 最坏情况同时出现：每次 ps 都要 900ms、待办读取永不返回、SIGTERM 后进程永不退出、owner 永不写 status、目录永远删不掉。
  // 范围：不含预算之后的 resetModules / clearAllMocks（TEARDOWN_BUDGET_MS 给它们留了 1s）。
  it('finishes the whole owner teardown within the injected budget in the worst case', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const started = Date.now();
      const hookDeadline = started + TEARDOWN_BUDGET_MS;
      const removeDeadline = hookDeadline - RECLAIM_RESERVE_MS;
      const pendingForever = makeOwner(41032);
      const neverExits = makeOwner(41033);
      const noStatus = makeOwner(41034, null);
      const owners = [pendingForever.owner, neverExits.owner, noStatus.owner];
      let psReads = 0;
      const slowPs = () => { psReads += 1; vi.setSystemTime(Date.now() + 900); return owners; };
      const identity = (pending: 'none' | 'never') => ({
        platform: 'linux' as const, currentPid: process.pid, currentUid: 1000,
        readStatusFile: async (path: string) => JSON.parse(readFileSync(path, 'utf8')),
        readCmdline: async (pid: number) => ['node', 'owner-entry.js', owners.find((owner) => owner.pid === pid)!.configPath],
        readUid: async () => 1000,
        readPendingTasks: () => pending === 'none' ? Promise.resolve('none' as const) : new Promise<never>(() => {}),
        kill: () => {}, isAlive: async () => true,
      });
      const rmAttempts: number[] = [];
      const teardown = createTeardownSteps('t');
      let settled = false;
      const running = teardownCaseOwners({
        dirs: [pendingForever.root, neverExits.root, noStatus.root], deadline: hookDeadline, posix: true, step: teardown.step,
        removeDir: (dir, until) => removeTempDirWithRetry(dir, until, () => { rmAttempts.push(Date.now()); throw new Error('EBUSY'); }, () => {}),
        retire: {
          list: slowPs,
          // owner 永不写 status：用永不触发的 watcher，只有截止时刻能结束等待。
          awaitStatus: (dataRoot, pid, deadlineMs) => awaitOwnerStatus(dataRoot, pid, deadlineMs, () => ({ close: () => {}, on: () => undefined as never })),
          // 与默认 retire 的接线相同（含 onBudget），只把身份读取等系统依赖换成桩。
          retire: (dataRoot, status, until, onBudget) => retireOutdatedOwner(dataRoot, status as never,
            deadlineBoundRetireDependencies(until, identity(dataRoot === neverExits.dataRoot ? 'none' : 'never'), onBudget)),
        },
        reclaim: { list: slowPs, kill: () => {}, exists: () => true },
      }).then((value) => { settled = true; return value; });
      while (!settled && Date.now() <= hookDeadline) await vi.advanceTimersByTimeAsync(10);
      expect(settled).toBe(true);
      expect(Date.now()).toBeLessThanOrEqual(hookDeadline);
      const report = await running;
      // 第 10 轮 DS minor 1：等 status 的时长由常量推出——退休截止 = D − 删目录保留 − 回收保留，再留阶段末尾 ps，
      // 减去首次 ps（900ms）与产品退休入口的保留。
      const statusWaitMs = TEARDOWN_BUDGET_MS - REMOVE_RESERVE_MS - RECLAIM_RESERVE_MS - PS_SCAN_RESERVE_MS - 900 - RETIRE_MIN_MS;
      expect(report).toEqual({ reclaimFailed: false, survivors: [
        { ...pendingForever.owner, reason: 'kept_unknown', reclaimed: false, budget: '收尾预算不足：readPendingTasks 被截断' },
        // 产品自己的 3s 退出等待在截止前用完：这是真的收不掉，不带 budget。
        { ...neverExits.owner, reason: 'kept_unverified', reclaimed: false },
        { ...noStatus.owner, reason: 'missing_status', reclaimed: false, budget: `status 只等了 ${statusWaitMs}ms（产品上限 5000ms，被收尾预算压短；只说明没等满上限）` },
      ] });
      // ps 次数：退休阶段首尾各一次、回收扫描一次、三个未退的 owner 共用最后一次快照，共 4 次（fake timers 下确定，第 9 轮 DS minor 2）。
      expect(psReads).toBe(4);
      // 删目录阶段只有 REMOVE_RESERVE_MS（0.5s）加退休阶段省下的时间：删不掉时退避重试，截止后的目录跳过（写 stderr）。
      expect(rmAttempts.length).toBeGreaterThanOrEqual(1);
      expect(rmAttempts.every((at) => at <= removeDeadline)).toBe(true);
      expect(teardown.errors).toEqual([]);
    } finally { vi.useRealTimers(); }
  });

  // 第 7 轮 codex Major1：到期仍在的 owner 共用一次进程表快照；pid 已被复用的判已退；快照读失败时错误附在每个 owner 上。
  it('confirms all still-alive owners with one shared process-table snapshot', async () => {
    const a = makeOwner(41040);
    const b = makeOwner(41041);
    const c = makeOwner(41042);
    const prefixes = ownerPathPrefixes([a.root, b.root, c.root]);
    let reads = 0;
    const tables = [[a.owner, b.owner, c.owner], [a.owner]];
    const result = await reclaimLateOwners(prefixes, { list: () => tables[reads++]!, kill: () => {}, awaitGone: async () => false });
    expect(reads).toBe(2);
    expect(result.map((owner) => [owner.pid, owner.reclaimed])).toEqual([[41040, false], [41041, true], [41042, true]]);
    const failure = new Error('ps 超时');
    let calls = 0;
    const failed = await reclaimLateOwners(prefixes, {
      list: () => { calls += 1; if (calls > 1) throw failure; return [a.owner, b.owner]; }, kill: () => {}, awaitGone: async () => false,
    });
    expect(failed).toEqual([{ ...a.owner, reason: 'late_after_removal', reclaimed: false, error: failure }, { ...b.owner, reason: 'late_after_removal', reclaimed: false, error: failure }]);
  });

  // 第 7 轮 codex Major2：第一次总会删；之后每次重试前看截止时刻，退避不越过截止；删不掉只报告、不抛。
  it('removeTempDirWithRetry never retries past its deadline', async () => {
    const reports: string[] = [];
    let attempts = 0;
    await removeTempDirWithRetry('/case/x', Date.now() - 1, () => { attempts += 1; throw new Error('EBUSY'); }, (message) => reports.push(message));
    expect(attempts).toBe(0);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain('跳过删除');
    await removeTempDirWithRetry('/case/w', Date.now() + 50, () => { attempts += 1; throw new Error('EBUSY'); }, (message) => reports.push(message));
    expect(reports[1]).toContain('EBUSY');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const until = Date.now() + 250;
      const at: number[] = [];
      const done = removeTempDirWithRetry('/case/y', until, () => { at.push(Date.now()); throw new Error('EBUSY'); }, () => {});
      await vi.advanceTimersByTimeAsync(1_000);
      await done;
      expect(at.every((time) => time <= until)).toBe(true);
      expect(at.length).toBe(2);
    } finally { vi.useRealTimers(); }
    let ok = 0;
    await removeTempDirWithRetry('/case/z', Date.now() + 1_000, () => { ok += 1; }, () => { throw new Error('不应报告'); });
    expect(ok).toBe(1);
  });

  // #146 CTO 裁定（Windows 回归）：win32 必须走同步 rmSync，只有 posix 走异步删除与截止赛跑。
  it('tempDirRemoverFor removes synchronously on win32 and asynchronously on posix', async () => {
    const makeDir = () => {
      const dir = mkdtempSync(join(tmpdir(), 'xiaok-rm-platform-'));
      roots.push(dir);
      mkdirSync(join(dir, 'nested'));
      writeFileSync(join(dir, 'nested', 'session.jsonl'), 'x');
      return dir;
    };
    const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
    try {
      Object.defineProperty(process, 'platform', { ...original, value: 'win32' });
      const winDir = makeDir();
      // 默认参数按调用时的 process.platform 选择
      const winResult = tempDirRemoverFor()(winDir);
      expect(winResult).toBeUndefined();
      expect(existsSync(winDir)).toBe(false);
    } finally { Object.defineProperty(process, 'platform', original); }
    const explicitWin = makeDir();
    expect(tempDirRemoverFor('win32')(explicitWin)).toBeUndefined();
    expect(existsSync(explicitWin)).toBe(false);
    for (const platform of ['linux', 'darwin'] as const) {
      const dir = makeDir();
      const result = tempDirRemoverFor(platform)(dir);
      expect(result).toBeInstanceOf(Promise);
      await result;
      expect(existsSync(dir)).toBe(false);
    }
  });

  // 第 7 轮 DS M3：阻塞 ps 的超时取所在阶段的剩余时间，到期就不读（timeout=0 在 execFileSync 里是不限时）。
  it('psTimeoutFor caps the ps timeout by the remaining budget and refuses an expired one', () => {
    expect(psTimeoutFor(Date.now() + 60_000)).toBe(1_000);
    expect(psTimeoutFor(Date.now() + 60_000, 400)).toBe(400);
    const left = psTimeoutFor(Date.now() + 300);
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThanOrEqual(300);
    expect(() => psTimeoutFor(Date.now() - 1)).toThrow('收尾预算已用完');
  });

  // 第 7 轮 DS M2：darwin 上读 cmdline/uid 是 ps；注入后这些读取到期即拒绝（产品 catch → kept_unverified），不再需要按平台预留。
  it('deadline-bound retire dependencies reject slow identity reads at the deadline and skip a late pending read', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      let pendingReads = 0;
      const deadline = Date.now() + 1_000;
      const deps = deadlineBoundRetireDependencies(deadline, {
        readCmdline: () => new Promise<never>(() => {}), readUid: () => new Promise<never>(() => {}),
        readPendingTasks: async () => { pendingReads += 1; return 'none'; },
      });
      const cmdline = deps.readCmdline!(1).catch((error: Error) => error.message);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await cmdline).toContain('readCmdline');
      expect(await deps.readPendingTasks!('/case')).toBe('unknown');
      expect(pendingReads).toBe(0);
      const fresh = deadlineBoundRetireDependencies(Date.now() + 1_000, { readPendingTasks: async () => { pendingReads += 1; return 'none'; } });
      expect(await fresh.readPendingTasks!('/case')).toBe('none');
      expect(pendingReads).toBe(1);
    } finally { vi.useRealTimers(); }
  });

  // 第 8 轮 DS M1 / 第 9 轮 DS B1：预算 + 预算后余量必须严格小于两个配置实际生效的 hookTimeout（从配置取值）。
  // 依赖从仓库根启动（vitest 的默认 root）。
  it('keeps the teardown budget below the hookTimeout of every vitest config that can run the file', async () => {
    const root = process.cwd();
    const effective: number[] = [];
    for (const file of ['vitest.config.ts', 'vitest.sandbox.config.mjs']) {
      const config: unknown = (await import(pathToFileURL(join(root, file)).href)).default;
      // 第 9 轮 DS minor 1：先断言形状，读错位置不能被默认值兜住。
      expect(config, file).toBeTypeOf('object');
      const test = (config as { test?: unknown }).test;
      expect(test, file).toBeTypeOf('object');
      const hookTimeout = (test as { hookTimeout?: unknown }).hookTimeout;
      if ('hookTimeout' in (test as object)) expect(hookTimeout, file).toBeTypeOf('number');
      // 配置里没有 hookTimeout 键时 vitest 默认 10s（resolved.hookTimeout ??= 1e4）。
      effective.push(typeof hookTimeout === 'number' ? hookTimeout : 10_000);
    }
    expect(effective).toHaveLength(2);
    for (const hookTimeout of effective) expect(TEARDOWN_BUDGET_MS + POST_TEARDOWN_RESERVE_MS).toBeLessThan(hookTimeout);
  });

  // 第 8 轮 DS M2：默认进程表读取的接线——带剩余时间作 ps 超时、到期就不读；退休/回收的默认 list 走它。
  it('wires the default process-table reads through the deadline', async () => {
    const timeouts: Array<number | undefined> = [];
    const fake = (_entry?: string, timeoutMs?: number) => { timeouts.push(timeoutMs); return []; };
    deadlineBoundOwnerList(Date.now() + 60_000, fake)();
    deadlineBoundOwnerList(Date.now() + 300, fake)();
    expect(timeouts[0]).toBe(1_000);
    expect(timeouts[1]).toBeGreaterThan(0);
    expect(timeouts[1]).toBeLessThanOrEqual(300);
    expect(() => deadlineBoundOwnerList(Date.now() - 1, fake)()).toThrow('收尾预算已用完');
    expect(timeouts).toHaveLength(2);
    // 不注入 list：到期的阶段不会去跑 ps，而是直接报预算用完。
    const { root } = makeOwner(41044);
    await expect(retireActivityOwnersUnder([root], { deadline: Date.now() - 1 })).rejects.toThrow('收尾预算已用完');
    await expect(reclaimLateOwners(ownerPathPrefixes([root]), { deadline: Date.now() - 1 })).rejects.toThrow('收尾预算已用完');
  });

  // 第 8 轮 DS minor 7：没有用例目录就不读进程表。
  it('does not read the process table when there are no case directories', async () => {
    let reads = 0;
    expect(await retireActivityOwnersUnder([], { list: () => { reads += 1; return []; } })).toEqual([]);
    expect(await reclaimLateOwners([], { list: () => { reads += 1; return []; } })).toEqual([]);
    expect(reads).toBe(0);
  });
});

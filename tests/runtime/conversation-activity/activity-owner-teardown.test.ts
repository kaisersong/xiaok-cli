import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  awaitOwnerStatus, awaitProcessGone, deadlineBoundOwnerList, deadlineBoundRetireDependencies, POST_TEARDOWN_RESERVE_MS, ownerPathPrefixes, ownersWithPrefixes, processExists, PS_SCAN_RESERVE_MS, psTimeoutFor,
  RECLAIM_RESERVE_MS, REMOVE_RESERVE_MS, RETIRE_MIN_MS, reclaimAndReport, teardownOverrunError, reclaimLateOwners, removeTempDirWithRetry, retireActivityOwnersUnder, TEARDOWN_BUDGET_MS,
  teardownCaseOwners, type ActivityOwnerProcess, type ActivityOwnerSurvivor,
} from '../../support/activity-owner-teardown.js';
import { retireOutdatedOwner } from '../../../src/runtime/conversation-activity/owner-retire.js';
import { createTeardownSteps } from '../../support/teardown-steps.js';

// #145：用例收尾闸门自身的失败路径。进程表与产品 retire 都用桩，只验证闸门的分类与认领。
describe('activity owner teardown gate (#145)', () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  const makeOwner = (pid: number, statusPid: number | null = pid) => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-owner-gate-'));
    roots.push(root);
    const dataRoot = join(realpathSync(root), 'config', 'conversation-activity', 'abc');
    mkdirSync(dataRoot, { recursive: true });
    if (statusPid !== null) writeFileSync(join(dataRoot, 'activity-owner.status.json'), JSON.stringify({ pid: statusPid, ownerEpoch: 'e', rootHash: 'h' }));
    return { root, dataRoot, owner: { pid, configPath: join(dataRoot, 'activity-owner.config.json') } as ActivityOwnerProcess };
  };

  it('reports an owner the product keeps for pending work as a survivor', async () => {
    const { root, dataRoot, owner } = makeOwner(41001);
    const seen: string[] = [];
    const survivors = await retireActivityOwnersUnder([root], {
      list: () => [owner],
      retire: async (dir) => { seen.push(dir); return 'kept_pending'; },
    });
    expect(seen).toEqual([dataRoot]);
    expect(survivors).toEqual([{ ...owner, reason: 'kept_pending' }]);
  });

  it('reports retired_but_alive when the product says retired but the process is still listed', async () => {
    const { root, owner } = makeOwner(41002);
    const survivors = await retireActivityOwnersUnder([root], { list: () => [owner], retire: async () => 'retired' });
    expect(survivors).toEqual([{ ...owner, reason: 'retired_but_alive' }]);
  });

  it('returns no survivors once the retired owner is gone from the process table', async () => {
    const { root, owner } = makeOwner(41003);
    let table = [owner];
    const survivors = await retireActivityOwnersUnder([root], { list: () => table, retire: async () => { table = []; return 'retired'; } });
    expect(survivors).toEqual([]);
  });

  it('does not call retire for an owner without a usable status file or with a foreign pid', async () => {
    const missing = makeOwner(41004, null);
    const foreign = makeOwner(41005, 99999);
    let calls = 0;
    const survivors = await retireActivityOwnersUnder([missing.root, foreign.root], {
      list: () => [missing.owner, foreign.owner],
      // 启动期限设为 0：只验证“到期仍没有可用 status”的分类，不等真实时间。
      awaitStatus: (dataRoot, pid) => awaitOwnerStatus(dataRoot, pid, 0),
      retire: async () => { calls += 1; return 'retired'; },
      // 截止时刻给足，status 等待不被预算压短（第 9 轮 DS M1：不依赖墙钟算出的毫秒数）。
      deadline: Date.now() + 60_000,
    });
    expect(calls).toBe(0);
    expect(survivors).toEqual([{ ...missing.owner, reason: 'missing_status' }, { ...foreign.owner, reason: 'status_pid_mismatch' }]);
  });

  it.skipIf(process.platform === 'win32')('claims owners through a symlinked case root and ignores owners of other roots', async () => {
    const mine = makeOwner(41006);
    const other = makeOwner(41007);
    const alias = `${mine.root}-alias`;
    symlinkSync(mine.root, alias, 'dir');
    roots.push(alias);
    const survivors = await retireActivityOwnersUnder([alias], { list: () => [mine.owner, other.owner], retire: async () => 'kept_unknown' });
    expect(survivors).toEqual([{ ...mine.owner, reason: 'kept_unknown' }]);
  });

  it('keeps matching a late owner after its case directory was removed when prefixes were taken beforehand', () => {
    const { root, owner } = makeOwner(41008);
    const prefixes = ownerPathPrefixes([root]);
    rmSync(root, { recursive: true, force: true });
    expect(ownersWithPrefixes(prefixes, () => [owner])).toEqual([owner]);
  });

  // codex M1 / DeepSeek minor 4：进程先出现、status 后落盘（owner 在 listen 之后才 rename 写 status），是正常启动窗口，
  // 不能判 missing_status。假定时器冻结 setTimeout/setInterval/setImmediate（Date 不需要冻结：没有计时器就不会再读时间），
  // 只有目录事件能让等待结束——换成任何轮询或到期兜底都会让用例挂住。
  it('waits for a starting owner to publish its status, then retires it through the product entry', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate'] });
    try {
      const { root, dataRoot, owner } = makeOwner(41009, null);
      let table = [owner];
      const retired: unknown[] = [];
      const pending = retireActivityOwnersUnder([root], {
        list: () => table,
        retire: async (_dir, status) => { retired.push(status); table = []; return 'retired'; },
      });
      // 闸门此刻已在等 status；按 owner-host 的方式原子落盘。
      const statusFile = join(dataRoot, 'activity-owner.status.json');
      writeFileSync(`${statusFile}.tmp`, JSON.stringify({ pid: 41009, ownerEpoch: 'e', rootHash: 'h' }));
      renameSync(`${statusFile}.tmp`, statusFile);
      expect(await pending).toEqual([]);
      expect(retired).toEqual([{ pid: 41009, ownerEpoch: 'e', rootHash: 'h' }]);
    } finally { vi.useRealTimers(); }
  });

  it('keeps waiting while the status file names another pid and resolves once it names the owner', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate'] });
    try {
      const { dataRoot } = makeOwner(41010, 99999);
      const pending = awaitOwnerStatus(dataRoot, 41010);
      const statusFile = join(dataRoot, 'activity-owner.status.json');
      writeFileSync(`${statusFile}.tmp`, JSON.stringify({ pid: 41010, ownerEpoch: 'e2', rootHash: 'h' }));
      renameSync(`${statusFile}.tmp`, statusFile);
      expect(await pending).toEqual({ pid: 41010, ownerEpoch: 'e2', rootHash: 'h' });
    } finally { vi.useRealTimers(); }
  });

  it('only returns a status that names the owner, even at the deadline', async () => {
    const { dataRoot } = makeOwner(41014, 99999);
    expect(await awaitOwnerStatus(dataRoot, 41014, 0)).toBeUndefined();
  });

  // codex Major 3：watcher 的异步 error 事件要让等待拒绝，而不是变成未捕获异常。
  it('rejects when the directory watcher emits an error, and the gate classifies it as teardown_error', async () => {
    const { root, dataRoot, owner } = makeOwner(41015, null);
    const emitter = new EventEmitter();
    const fakeWatch = () => Object.assign(emitter, { close: () => {} });
    const waiting = awaitOwnerStatus(dataRoot, 41015, 60_000, fakeWatch as never);
    emitter.emit('error', new Error('watch 失效'));
    await expect(waiting).rejects.toThrow('watch 失效');
    const survivors = await retireActivityOwnersUnder([root], {
      list: () => [owner],
      awaitStatus: async () => { throw new Error('watch 失效'); },
      retire: async () => 'retired',
    });
    expect(survivors).toMatchObject([{ pid: 41015, reason: 'teardown_error', error: new Error('watch 失效') }]);
  });

  // codex Major 1 / DeepSeek MA2：一个 owner 的 retire 拒绝，不能让函数提前返回、把其余 owner 的退休丢在后台；
  // 其余 owner 的结论照常给出。第二个 owner 的 retire 由显式信号控制完成。
  it('waits for every owner before returning when one retire rejects', async () => {
    const a = makeOwner(41016);
    const b = makeOwner(41017);
    let releaseB!: (outcome: 'kept_pending') => void;
    let bStarted!: () => void;
    const bRunning = new Promise<void>((resolve) => { bStarted = resolve; });
    let returned = false;
    const pending = retireActivityOwnersUnder([a.root, b.root], {
      list: () => [a.owner, b.owner],
      retire: async (dir) => {
        if (dir === a.dataRoot) throw new Error('retire rejected');
        bStarted();
        return new Promise((resolve) => { releaseB = resolve; });
      },
    }).then((value) => { returned = true; return value; });
    await bRunning;
    await Promise.resolve();
    expect(returned).toBe(false);
    releaseB('kept_pending');
    expect(await pending).toMatchObject([
      { pid: 41016, reason: 'teardown_error', error: new Error('retire rejected') },
      { pid: 41017, reason: 'kept_pending' },
    ]);
  });

  // DeepSeek MA1：两次进程表快照之间才出现的 owner 没走退休入口，要单独标出来交给回收，而不是标成 missing_status。
  it('marks an owner that appears between the two process-table reads as appeared_during_teardown', async () => {
    const a = makeOwner(41018);
    const b = makeOwner(41019);
    let reads = 0;
    const survivors = await retireActivityOwnersUnder([a.root, b.root], {
      list: () => (reads++ === 0 ? [a.owner] : [b.owner]),
      retire: async () => 'retired',
    });
    expect(survivors).toEqual([{ ...b.owner, reason: 'appeared_during_teardown' }]);
  });

  // codex minor：仍在的 owner 都要回收，并确认退出；不属于这组前缀的不碰；原因按调用方给的分类。
  it('reclaims every owner still under the prefixes and leaves other roots alone', async () => {
    const other = makeOwner(41011);
    const late = makeOwner(41012);
    const appeared = makeOwner(41020);
    const prefixes = ownerPathPrefixes([late.root, appeared.root]);
    rmSync(late.root, { recursive: true, force: true });
    const signals: Array<[number, string]> = [];
    const result = await reclaimLateOwners(prefixes, {
      list: () => [other.owner, late.owner, appeared.owner],
      kill: (pid, signal) => { signals.push([pid, signal]); },
      awaitGone: async (pid) => pid === 41012,
      reasonFor: (pid) => (pid === 41020 ? 'appeared_during_teardown' : 'late_after_removal'),
    });
    expect(signals).toEqual([[41012, 'SIGTERM'], [41020, 'SIGTERM']]);
    expect(result).toEqual([
      { ...late.owner, reason: 'late_after_removal', reclaimed: true },
      { ...appeared.owner, reason: 'appeared_during_teardown', reclaimed: false },
    ]);
  });

  // DeepSeek minor 1/7：只有 ESRCH 算已退出；EPERM 表示进程还在，不能报 reclaimed。
  it('treats only ESRCH as gone when signalling a late owner', async () => {
    const late = makeOwner(41021);
    const prefixes = ownerPathPrefixes([late.root]);
    const errno = (code: string) => Object.assign(new Error(code), { code });
    const gone = await reclaimLateOwners(prefixes, { list: () => [late.owner], kill: () => { throw errno('ESRCH'); }, awaitGone: async () => false });
    const denied = await reclaimLateOwners(prefixes, { list: () => [late.owner], kill: () => { throw errno('EPERM'); }, awaitGone: async () => true });
    expect(gone).toEqual([{ ...late.owner, reason: 'late_after_removal', reclaimed: true }]);
    expect(denied).toMatchObject([{ pid: 41021, reason: 'late_after_removal', reclaimed: false, error: { code: 'EPERM' } }]);
  });

  // DS 第 6 轮 minor 6：不依赖 pid 1 存在、也不依赖退出的 pid 不被复用——kill 的结果用桩给出。
  it('processExists treats EPERM as alive and ESRCH as gone', () => {
    expect(processExists(process.pid)).toBe(true);
    const errno = (code: string) => Object.assign(new Error(code), { code });
    const kill = vi.spyOn(process, 'kill');
    try {
      kill.mockImplementationOnce(() => { throw errno('EPERM'); });
      expect(processExists(41030)).toBe(true);
      kill.mockImplementationOnce(() => { throw errno('ESRCH'); });
      expect(processExists(41031)).toBe(false);
    } finally { kill.mockRestore(); }
  });

  // codex Major 2 / DeepSeek 第 6 轮 minor 4：轮询只用 kill(pid,0)，进程表只在到期时读一次（区分 pid 复用）；
  // 任何一次检查抛错都要让 Promise 拒绝，而不是逃出定时器回调。
  it('awaitProcessGone polls without the process table and reads it once at the deadline', async () => {
    let probes = 0;
    let reads = 0;
    expect(await awaitProcessGone(41022, () => { reads += 1; return true; }, 3_000, () => probes++ < 1)).toBe(true);
    expect(reads).toBe(0);
    expect(await awaitProcessGone(41023, () => { reads += 1; return true; }, 0, () => true)).toBe(false);
    expect(await awaitProcessGone(41024, () => { reads += 1; return false; }, 0, () => true)).toBe(true);
    expect(reads).toBe(2);
    await expect(awaitProcessGone(41025, () => { throw new Error('ps 不可用'); }, 0, () => true)).rejects.toThrow('ps 不可用');
    await expect(awaitProcessGone(41026, () => true, 3_000, () => { throw new Error('kill 失败'); })).rejects.toThrow('kill 失败');
  });

  // codex M2：ps 不可用时后面的收尾步骤照样执行，错误汇总抛出；retire 拒绝按 owner 归类，不会中断整步。
  it('runs every teardown step after a process-table failure and reports retire rejections per owner', async () => {
    const { root, owner } = makeOwner(41013);
    const teardown = createTeardownSteps('t');
    const ran: string[] = [];
    let survivors: unknown;
    expect(await teardown.step(() => retireActivityOwnersUnder([root], { list: () => { throw new Error('ps 不可用'); } }))).toBe(false);
    expect(await teardown.step(async () => {
      survivors = await retireActivityOwnersUnder([root], { list: () => [owner], retire: async () => { throw new Error('retire rejected'); } });
    })).toBe(true);
    await teardown.step(() => { ran.push('remove-dir'); });
    await teardown.step(() => { ran.push('reset-modules'); });
    teardown.fail(new Error('owner 存活'));
    expect(ran).toEqual(['remove-dir', 'reset-modules']);
    expect(survivors).toMatchObject([{ pid: 41013, reason: 'teardown_error', error: new Error('retire rejected') }]);
    expect(() => teardown.finish()).toThrow(AggregateError);
    expect(teardown.errors.map((error) => error.message)).toEqual(['ps 不可用', 'owner 存活']);
  });

  // DeepSeek minor 5：目录已不在（ENOENT）时等待直接给 undefined；建 watcher 前 status 已落盘时立即返回，不等事件。
  it('awaitOwnerStatus resolves undefined when the data root is gone and returns an already-published status immediately', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate'] });
    try {
      const { root, dataRoot } = makeOwner(41024);
      expect(await awaitOwnerStatus(dataRoot, 41024)).toEqual({ pid: 41024, ownerEpoch: 'e', rootHash: 'h' });
      rmSync(root, { recursive: true, force: true });
      expect(await awaitOwnerStatus(dataRoot, 41024)).toBeUndefined();
    } finally { vi.useRealTimers(); }
  });

  // DeepSeek minor 2/3（第 6 轮 minor 3）：收集时就统一成 Error；errors 是副本。
  it('teardown steps normalise collected errors to Error values and expose a copy', async () => {
    const teardown = createTeardownSteps('t');
    await teardown.step(() => { throw 'ps 不可用'; });
    teardown.fail(42);
    (teardown.errors as Error[]).push(new Error('外部写入'));
    expect(teardown.errors).toEqual([new Error('t：ps 不可用'), new Error('t：42')]);
    expect(teardown.errors.every((error) => error instanceof Error)).toBe(true);
    expect(() => teardown.finish()).toThrow(AggregateError);
  });

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

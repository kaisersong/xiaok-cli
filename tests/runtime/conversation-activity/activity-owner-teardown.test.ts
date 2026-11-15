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

  // Real filesystem integration uses the existing real deadline backstop.
  // Event-only behavior with frozen timers is separately pinned in activity-owner-status-events.test.ts.
  it('waits for a starting owner to publish its status, then retires it through the product entry', async () => {
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
    });

  it('keeps waiting while the status file names another pid and resolves once it names the owner', async () => {
      const { dataRoot } = makeOwner(41010, 99999);
      const pending = awaitOwnerStatus(dataRoot, 41010);
      const statusFile = join(dataRoot, 'activity-owner.status.json');
      writeFileSync(`${statusFile}.tmp`, JSON.stringify({ pid: 41010, ownerEpoch: 'e2', rootHash: 'h' }));
      renameSync(`${statusFile}.tmp`, statusFile);
      expect(await pending).toEqual({ pid: 41010, ownerEpoch: 'e2', rootHash: 'h' });
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
});

import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, watch, type FSWatcher } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { retireOutdatedOwner, type OwnerRetirementOutcome } from '../../src/runtime/conversation-activity/owner-retire.js';
import { ACTIVITY_STORAGE_NAMES } from '../../src/runtime/conversation-activity/storage-permissions.js';

/**
 * #145：进程内跑 chat 的用例每次都会拉起一个独立的 activity owner（detached，空闲 20 分钟
 * 才退出）。用例删了临时目录却不收 owner，跑完一个测试文件会累积几十个常驻 node 进程
 * （本地实测峰值 52~60 个、合计 RSS 3.6~4.4GB，见 PR 正文的原始日志）。
 *
 * 发现：按进程表找 argv 指向本用例目录的 owner-entry 进程（不依赖目录布局，也能发现
 * 还没写 status 文件的 owner）。owner 启动时把 dataRoot realpath 过（macOS 的 tmpdir
 * 是 /var → /private/var），所以比对前先把用例目录 realpath。
 * 收掉：用产品自带、带身份校验的 retireOutdatedOwner（status 文件、cmdline、uid、无待办）。
 */
export type OwnerSurvivorReason =
  | Exclude<OwnerRetirementOutcome, 'retired'>   // kept_pending / kept_unknown：产品按策略保留；kept_unverified：身份校验未过，或 SIGTERM 后 3s 内未退（产品把两者合用一个值）
  | 'missing_status'                               // 进程在，到期仍没有 status 文件
  | 'status_pid_mismatch'                          // 到期时 status 文件记录的仍不是这个进程
  | 'retired_but_alive'                            // 产品报 retired，进程却仍在
  | 'teardown_error'                               // 等 status 或产品 retire 本身出错（原始错误挂在 error 上）
  | 'appeared_during_teardown'                     // 第一次扫描之后、收尾过程中才出现的 owner，未走退休入口
  | 'unretired_after_error'                        // 退休那一步整体出错（例如 ps 不可用）而没被尝试的 owner
  | 'late_after_removal';                          // 删目录之后才出现、argv 指向已删目录的 owner
export interface ActivityOwnerSurvivor { pid: number; configPath: string; reason: OwnerSurvivorReason; error?: unknown; reclaimed?: boolean }
export interface ActivityOwnerProcess { pid: number; configPath: string }

/** 进程表里所有 activity owner（argv 末尾是 activity-owner.config.json）。仅 POSIX。 */
export function listActivityOwnerProcesses(entryScript?: string): ActivityOwnerProcess[] {
  if (process.platform === 'win32') return [];
  let out: string;
  try { out = execFileSync('ps', ['-axww', '-o', 'pid=,command='], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }); }
  catch (error) {
    // 不静默放行：查不了进程表就无法确认 owner 已收，明确报出原因。
    throw new Error(`ps 不可用，无法确认 activity owner 是否已收（#145）：${(error as NodeJS.ErrnoException).code ?? String(error)}`);
  }
  const owners: ActivityOwnerProcess[] = [];
  for (const line of out.split('\n')) {
    const match = /^\s*(\d+)\s+(.*\S)\s*$/.exec(line);
    if (!match) continue;
    const command = match[2];
    const marker = command.indexOf('owner-entry.js ');
    if (marker < 0 || !command.endsWith(ACTIVITY_STORAGE_NAMES.config)) continue;
    if (entryScript && !command.includes(entryScript)) continue;
    owners.push({ pid: Number(match[1]), configPath: command.slice(marker + 'owner-entry.js '.length) });
  }
  return owners;
}

function canonical(dir: string): string | undefined {
  try { return realpathSync(dir); } catch { return undefined; }
}

/**
 * 目录的认领前缀：原始路径 + realpath（须在目录仍存在时计算）。删目录之后 realpath 失效，
 * 所以调用方应先算好前缀，删完再用同一组前缀做一次迟到扫描。
 */
export function ownerPathPrefixes(dirs: readonly string[]): string[] {
  const roots = new Set<string>();
  for (const dir of dirs) {
    roots.add(dir);
    const real = canonical(dir);
    if (real) roots.add(real);
  }
  return [...roots].map((root) => root.endsWith(sep) ? root : root + sep);
}

export function ownersWithPrefixes(prefixes: readonly string[], list: () => ActivityOwnerProcess[] = listActivityOwnerProcesses): ActivityOwnerProcess[] {
  return list().filter((owner) => prefixes.some((prefix) => owner.configPath.startsWith(prefix)));
}

type OwnerStatus = { pid?: unknown; ownerEpoch?: unknown; rootHash?: unknown };

/** owner 启动完成的显式信号：owner 在 listen 之后以 rename 原子落盘 status 文件（owner-host.ts）。 */
export const OWNER_STARTUP_STATUS_WAIT_MS = 5_000;

function readOwnerStatus(dataRoot: string): OwnerStatus | undefined {
  try { return JSON.parse(readFileSync(join(dataRoot, ACTIVITY_STORAGE_NAMES.status), 'utf8')) as OwnerStatus; }
  catch { return undefined; }
}

type DirectoryWatcher = Pick<FSWatcher, 'close' | 'on'>;
type WatchDirectory = (dir: string, onChange: () => void) => DirectoryWatcher;
const watchDirectory: WatchDirectory = (dir, onChange) => watch(dir, onChange);

/**
 * 等 owner 启动完成：status 文件落盘且 pid 是它。由目录变更事件驱动，没有轮询、没有 sleep；
 * 进程先出现、status 后落盘是正常的启动窗口，不能判失败。
 * 只返回 pid 匹配的 status；到期仍没有就返回 undefined，由调用方再按文件现状分类。
 * watcher 的异步 error 事件会让 Promise 拒绝，交给调用方按 teardown_error 归类，不会变成未捕获异常。
 * 前提：dataRoot 在 owner 进程存在前就已建好（owner-launcher 先原子写 config 再 spawn），
 * 所以 dataRoot 不存在 = 目录已被删，直接按“没有 status”返回。
 */
export function awaitOwnerStatus(dataRoot: string, pid: number, deadlineMs = OWNER_STARTUP_STATUS_WAIT_MS, watchDir: WatchDirectory = watchDirectory): Promise<OwnerStatus | undefined> {
  const ready = (): OwnerStatus | undefined => { const status = readOwnerStatus(dataRoot); return status?.pid === pid ? status : undefined; };
  const now = ready();
  if (now) return Promise.resolve(now);
  return new Promise((resolve, reject) => {
    let settled = false;
    let watcher: DirectoryWatcher | undefined;
    const settle = (finish: () => void): void => {
      if (settled) return;
      settled = true; clearTimeout(timer); watcher?.close(); finish();
    };
    const timer = setTimeout(() => settle(() => resolve(ready())), deadlineMs);
    try { watcher = watchDir(dataRoot, () => { const status = ready(); if (status) settle(() => resolve(status)); }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') settle(() => resolve(undefined));
      else settle(() => reject(error));
      return;
    }
    watcher.on('error', (error) => settle(() => reject(error)));
    // 建 watcher 之前落盘的情况：再读一次，避免漏掉事件。
    const raced = ready();
    if (raced) settle(() => resolve(raced));
  });
}

export interface RetireActivityOwnersDependencies {
  list: () => ActivityOwnerProcess[];
  retire: (dataRoot: string, status: OwnerStatus) => Promise<OwnerRetirementOutcome>;
  awaitStatus: (dataRoot: string, pid: number) => Promise<OwnerStatus | undefined>;
}

/**
 * 收掉 dirs（须仍存在）下所有 activity owner；返回没能收掉的 owner 及原因，调用方据此判失败。
 * 还在启动中（status 未落盘）的 owner 先等它启动完成再走产品退休入口。
 * 每个 owner 的等待/退休各自收口：一个出错不会让其余 owner 的退休被丢在后台继续跑，
 * 函数返回时所有 owner 的操作都已结束（调用方之后才能删目录）。
 * 收完后重新查进程表，只认 argv 仍指向本目录的进程，避免 pid 复用造成误报；
 * 第一次扫描之后才出现的 owner 标成 appeared_during_teardown，交给 reclaimLateOwners 回收。
 */
export async function retireActivityOwnersUnder(dirs: readonly string[], dependencies: Partial<RetireActivityOwnersDependencies> = {}): Promise<ActivityOwnerSurvivor[]> {
  const list = dependencies.list ?? listActivityOwnerProcesses;
  const retire = dependencies.retire ?? ((dataRoot, status) => retireOutdatedOwner(dataRoot, status as Parameters<typeof retireOutdatedOwner>[1]));
  const awaitStatus = dependencies.awaitStatus ?? ((dataRoot, pid) => awaitOwnerStatus(dataRoot, pid));
  const prefixes = ownerPathPrefixes(dirs);
  const outcomes = new Map<number, { reason: OwnerSurvivorReason; error?: unknown }>();
  // 并行收：每个 owner 最坏约 13s（等 status 5s + 待办读取 5s + 退出等待 3s），串行会让多 owner 退化成 hook 超时。
  // 每个分支自己 catch，Promise.all 因此不会提前拒绝。
  await Promise.all(ownersWithPrefixes(prefixes, list).map(async (owner) => {
    const dataRoot = dirname(owner.configPath);
    try {
      const status = await awaitStatus(dataRoot, owner.pid);
      if (!status) { outcomes.set(owner.pid, { reason: readOwnerStatus(dataRoot) ? 'status_pid_mismatch' : 'missing_status' }); return; }
      const outcome = await retire(dataRoot, status);
      outcomes.set(owner.pid, { reason: outcome === 'retired' ? 'retired_but_alive' : outcome });
    } catch (error) {
      outcomes.set(owner.pid, { reason: 'teardown_error', error });
    }
  }));
  return ownersWithPrefixes(prefixes, list).map((owner) => ({ ...owner, ...(outcomes.get(owner.pid) ?? { reason: 'appeared_during_teardown' as const }) }));
}

export interface ReclaimLateOwnersDependencies {
  list: () => ActivityOwnerProcess[];
  kill: (pid: number, signal: NodeJS.Signals) => void;
  awaitGone: (pid: number) => Promise<boolean>;
  /** 这些 owner 为什么没走退休入口（默认 late_after_removal）。 */
  reasonFor: (pid: number) => OwnerSurvivorReason;
}

/**
 * 没走产品退休入口的 owner（删目录之后才出现、收尾中途出现，或退休那一步整体出错）：status 入口已随目录消失，
 * 只能对“进程表里 argv 仍指向这组前缀”的进程发 SIGTERM（同一次进程表读取确认身份，避免 pid 复用误杀），
 * 再确认它真的退出。返回值仍按原因报失败，但进程不会留下来污染后续用例。每个 owner 各自收口，不会提前拒绝。
 */
export async function reclaimLateOwners(prefixes: readonly string[], knownPids: ReadonlySet<number>, dependencies: Partial<ReclaimLateOwnersDependencies> = {}): Promise<ActivityOwnerSurvivor[]> {
  const list = dependencies.list ?? listActivityOwnerProcesses;
  const kill = dependencies.kill ?? ((pid, signal) => process.kill(pid, signal));
  const awaitGone = dependencies.awaitGone ?? ((pid) => awaitProcessGone(pid, () => ownersWithPrefixes(prefixes, list).some((owner) => owner.pid === pid)));
  const reasonFor = dependencies.reasonFor ?? (() => 'late_after_removal' as const);
  const late = ownersWithPrefixes(prefixes, list).filter((owner) => !knownPids.has(owner.pid));
  return Promise.all(late.map(async (owner): Promise<ActivityOwnerSurvivor> => {
    const reason = reasonFor(owner.pid);
    try { kill(owner.pid, 'SIGTERM'); }
    catch (error) {
      // 只有 ESRCH 才说明它已经退出；EPERM 等表示还在但收不掉。
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return { ...owner, reason, reclaimed: true };
      return { ...owner, reason, reclaimed: false, error };
    }
    try { return { ...owner, reason, reclaimed: await awaitGone(owner.pid) }; }
    catch (error) { return { ...owner, reason, reclaimed: false, error }; }
  }));
}

/** 进程是否还在：只有 ESRCH 算不存在；EPERM 说明进程在（只是不属于我们）。 */
export function processExists(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}

/**
 * owner 收到 SIGTERM 后的退出确认。owner 由产品以 detached 方式 spawn，ChildProcess 句柄在产品手里，
 * 测试拿不到它的 exit 事件，所以这里是唯一的有界轮询：每 50ms 查一次，按产品的 3s 退出预算到期判 false。
 * 任何一次检查（包括进程表读取）抛错都会让 Promise 拒绝，不会逃出定时器回调。
 */
export function awaitProcessGone(pid: number, stillListed: () => boolean, deadlineMs = 3_000, exists: (pid: number) => boolean = processExists): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = (): void => {
      try {
        if (!exists(pid) || !stillListed()) { resolve(true); return; }
        if (Date.now() - started >= deadlineMs) { resolve(false); return; }
        setTimeout(check, 50);
      } catch (error) { reject(error); }
    };
    check();
  });
}

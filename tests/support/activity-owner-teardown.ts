import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, watch, type FSWatcher } from 'node:fs';
import { rm as rmAsync } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { defaultOwnerRetirementDependencies, retireOutdatedOwner, type OwnerRetirementDependencies, type OwnerRetirementOutcome } from '../../src/runtime/conversation-activity/owner-retire.js';
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
  | 'data_root_gone'                               // 到期时 owner 的 dataRoot 已不存在（目录被删），与“还没写 status”分开
  | 'teardown_deadline'                            // 收尾预算已不允许等 status 或进入产品退休入口（未尝试退休）
  | 'status_pid_mismatch'                          // 到期时 status 文件记录的仍不是这个进程
  | 'retired_but_alive'                            // 产品报 retired，进程却仍在
  | 'teardown_error'                               // 等 status 或产品 retire 本身出错（原始错误挂在 error 上）
  | 'appeared_during_teardown'                     // 第一次扫描之后、收尾过程中才出现的 owner，未走退休入口
  | 'unretired_after_error'                        // 退休那一步整体出错（例如 ps 不可用）而没被尝试的 owner
  | 'late_after_removal';                          // 删目录之后才出现、argv 指向已删目录的 owner
export interface ActivityOwnerSurvivor {
  pid: number; configPath: string; reason: OwnerSurvivorReason; error?: unknown; reclaimed?: boolean;
  /** 收尾预算截断了哪一步（第 8 轮 DS M3）：有值时可能是机器慢、不一定是泄漏，失败消息里单独写出。 */
  budget?: string;
}
export interface ActivityOwnerProcess { pid: number; configPath: string }

/**
 * 进程表里所有 activity owner（argv 末尾是 activity-owner.config.json）。仅 POSIX。
 * timeoutMs：ps 是阻塞调用，收尾里每次读取都带上所在阶段剩余的时间（第 7 轮 DS M3），超时按读取失败报出。
 */
export function listActivityOwnerProcesses(entryScript?: string, timeoutMs = 5_000): ActivityOwnerProcess[] {
  if (process.platform === 'win32') return [];
  let out: string;
  try { out = execFileSync('ps', ['-axww', '-o', 'pid=,command='], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' }); }
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
  // 没有前缀就不读进程表（第 8 轮 DS minor 7：空用例不白跑阻塞 ps）。
  if (!prefixes.length) return [];
  return list().filter((owner) => prefixes.some((prefix) => owner.configPath.startsWith(prefix)));
}

type OwnerStatus = { pid?: unknown; ownerEpoch?: unknown; rootHash?: unknown };

/** owner 启动完成的显式信号：owner 在 listen 之后以 rename 原子落盘 status 文件（owner-host.ts）。 */
export const OWNER_STARTUP_STATUS_WAIT_MS = 5_000;

/**
 * 收尾的时间预算（#145 第 6/7 轮 DS M1/M3、codex Major1/2）：整个 afterEach 收尾共用一个注入的截止时刻 D，
 * 每个阶段只用到自己的截止时刻；阻塞的 ps 读取也带剩余时间作超时。不调大 hookTimeout。
 * - TEARDOWN_BUDGET_MS = 8s，按仓库里最小的 hookTimeout（vitest.config.ts 未设，取 vitest 默认 10s）定，sandbox 配置（30s）下同样成立；
 *   之后留 POST_TEARDOWN_RESERVE_MS = 1s 给 resetModules / clearAllMocks / resetAdapterState，8s + 1s 严格小于 10s（第 9 轮 DS B1），
 *   hook 末尾还会核对实际总耗时，越界时报可读的失败而不是 vitest 的裸超时。
 * - 退休阶段截止 D - REMOVE_RESERVE_MS - RECLAIM_RESERVE_MS：首次 ps、等 status、产品退休入口都在
 *   “退休截止 - PS_SCAN_RESERVE_MS” 之前收口，留出的 PS_SCAN_RESERVE_MS 给阶段末尾那次 ps。
 * - 删目录阶段截止 D - RECLAIM_RESERVE_MS：异步删除与截止时刻赛跑，退避重试不越过截止，截止后不再启动新的删除；
 *   没删完的留在后台继续，跳过/未完成的目录写 stderr。
 * - 回收阶段截止 D：一次 ps 扫描 → SIGTERM → kill(pid,0) 轮询到 D - PS_SCAN_RESERVE_MS → 仍在的共用一次 ps 快照确认。
 * - 等 status 最多 min(5s, 剩余 - RETIRE_MIN_MS)：给产品退休入口（身份校验、待办读取、退出等待）留 RETIRE_MIN_MS；
 *   产品入口的每个异步依赖都与截止时刻赛跑（经产品已有的依赖注入，见 deadlineBoundRetireDependencies）。
 */
export const TEARDOWN_BUDGET_MS = 8_000;
/** 预算之后的 resetModules / clearAllMocks / resetAdapterState 留的余量；TEARDOWN_BUDGET_MS + 它 < 各配置的 hookTimeout 有单测从配置取值断言，hook 末尾核对实际总耗时。 */
export const POST_TEARDOWN_RESERVE_MS = 1_000;
// 第 10 轮 DS M1：预算降到 8s 时，从删目录保留量里挪回 0.5s 给退休阶段（5.5s，等 status 最多 3s）。
// 回收阶段保留 2s 不动：扫描一次 ps（≤1s）+ 最后共用快照（≤1s），最坏情况用例在 ps 每次 900ms 时验证。
// 删目录阶段 0.5s：删除是异步的，常态毫秒级，截止后留在后台。
export const RECLAIM_RESERVE_MS = 2_000;
export const REMOVE_RESERVE_MS = 500;
export const PS_SCAN_RESERVE_MS = 1_000;
export const RETIRE_MIN_MS = 1_500;
/** 剩余不足这个值就不再拉起待办读取 worker（它会打开用例目录里的 SQLite）。 */
export const PENDING_READ_MIN_MS = 500;
/** 剩余不足这个值就不再进入产品退休入口。 */
export const RETIRE_ENTRY_MIN_MS = 300;

/**
 * hook 总耗时核对（第 10 轮 DS M2/M3）：超过“预算 + 余量”返回可读错误，否则 undefined。
 * 预算之后的 resetModules / clearAllMocks / resetAdapterState 都是同步的内存重置，无法与截止时刻赛跑，
 * 只能事后核对；它们若真卡住，vitest 的 hook 超时会先触发。
 */
export function teardownOverrunError(elapsedMs: number, budgetMs = TEARDOWN_BUDGET_MS, reserveMs = POST_TEARDOWN_RESERVE_MS): Error | undefined {
  return elapsedMs > budgetMs + reserveMs
    ? new Error(`用例收尾耗时 ${elapsedMs}ms，超过预算 ${budgetMs}ms + 余量 ${reserveMs}ms（#145）`)
    : undefined;
}

export function remainingMs(deadline: number, now: () => number = Date.now): number {
  return Math.max(0, deadline - now());
}

/** 按截止时刻给阻塞 ps 的超时；已到期就不读（execFileSync 的 timeout=0 表示不限时，不能传 0）。 */
export function psTimeoutFor(deadline: number, cap = 1_000): number {
  const left = remainingMs(deadline);
  if (left <= 0) throw new Error('收尾预算已用完，未读取进程表（#145）');
  return Math.min(cap, left);
}

/** 收尾里默认的进程表读取：每次都带截止时刻剩余的时间作 ps 超时，已到期就不读（第 8 轮 DS M2：可单测的接线）。 */
export function deadlineBoundOwnerList(
  deadline: number,
  list: (entryScript?: string, timeoutMs?: number) => ActivityOwnerProcess[] = listActivityOwnerProcesses,
): () => ActivityOwnerProcess[] {
  return () => list(undefined, psTimeoutFor(deadline));
}

/** 到截止时刻就以 onDeadline 结束的等待；截止前完成则返回原结果。计时器总会清掉。 */
function raceDeadline<T>(work: Promise<T>, deadline: number, onDeadline: () => T | Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([work, new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => { try { resolve(onDeadline()); } catch (error) { reject(error); } }, remainingMs(deadline));
  })]).finally(() => clearTimeout(timer));
}

/**
 * 给产品 retireOutdatedOwner 注入截止时刻（经产品已有的依赖注入，产品逻辑不变）：
 * - 读 status / cmdline / uid（darwin 上是带 1s 超时的 ps）到期即拒绝 → 产品 catch → kept_unverified；
 *   被放弃的 ps 是异步子进程，由产品自己的 1s 超时结束，不阻塞事件循环。
 * - 待办读取到期按 'unknown'（→ kept_unknown）；剩余不足 PENDING_READ_MIN_MS 就不再拉起读取 worker。
 * - 退出等待的 sleep 到期后立即返回（产品的 3s 循环随即用完 → kept_unverified）。
 * 这些结果都判失败，并在回收阶段 SIGTERM。
 */
export function deadlineBoundRetireDependencies(
  deadline: number, base: Partial<OwnerRetirementDependencies> = {},
  /** 某一步因预算到期而被截断时回调（第 8 轮 DS M3：区分“预算不足”与“owner 真收不掉”）。 */
  onBudget: (step: string) => void = () => {},
): Partial<OwnerRetirementDependencies> {
  const real = { ...defaultOwnerRetirementDependencies(), ...base };
  const expired = (step: string) => () => { onBudget(`${step} 被截断`); throw new Error(`收尾预算已用完：${step}（#145）`); };
  return {
    ...base,
    readStatusFile: (path) => raceDeadline(real.readStatusFile(path), deadline, expired('readStatusFile')),
    readCmdline: (pid) => raceDeadline(real.readCmdline(pid), deadline, expired('readCmdline')),
    readUid: (pid) => raceDeadline(real.readUid(pid), deadline, expired('readUid')),
    readPendingTasks: (dataRoot) => {
      if (remainingMs(deadline) < PENDING_READ_MIN_MS) { onBudget('readPendingTasks 未启动'); return Promise.resolve('unknown' as const); }
      return raceDeadline(real.readPendingTasks(dataRoot), deadline, () => { onBudget('readPendingTasks 被截断'); return 'unknown' as const; });
    },
    sleep: (ms) => {
      const left = remainingMs(deadline);
      if (left < ms) onBudget('退出等待被截断');
      return left > 0 ? real.sleep(Math.min(ms, left)) : Promise.resolve();
    },
  };
}

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
  retire: (dataRoot: string, status: OwnerStatus, deadline: number, onBudget: (step: string) => void) => Promise<OwnerRetirementOutcome>;
  awaitStatus: (dataRoot: string, pid: number, deadlineMs: number) => Promise<OwnerStatus | undefined>;
  /** 退休阶段的截止时刻（Date.now 时基），含阶段末尾那次 ps；默认 now + TEARDOWN_BUDGET_MS - RECLAIM_RESERVE_MS - REMOVE_RESERVE_MS。 */
  deadline: number;
  /** 默认 retire 用的产品依赖（测试注入身份/待办/存活桩），会再套一层截止时刻。 */
  retireDependencies: Partial<OwnerRetirementDependencies>;
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
  const deadline = dependencies.deadline ?? Date.now() + TEARDOWN_BUDGET_MS - RECLAIM_RESERVE_MS - REMOVE_RESERVE_MS;
  // 每个 owner 的等待与退休在 ownerDeadline 前收口，留 PS_SCAN_RESERVE_MS 给阶段末尾的 ps。
  const ownerDeadline = deadline - PS_SCAN_RESERVE_MS;
  const list = dependencies.list ?? deadlineBoundOwnerList(deadline);
  const retire = dependencies.retire ?? ((dataRoot, status, until, onBudget) => retireOutdatedOwner(
    dataRoot, status as Parameters<typeof retireOutdatedOwner>[1], deadlineBoundRetireDependencies(until, dependencies.retireDependencies, onBudget)));
  const awaitStatus = dependencies.awaitStatus ?? ((dataRoot, pid, deadlineMs) => awaitOwnerStatus(dataRoot, pid, deadlineMs));
  const prefixes = ownerPathPrefixes(dirs);
  const outcomes = new Map<number, { reason: OwnerSurvivorReason; error?: unknown; budget?: string }>();
  // 并行收，共用同一个截止时刻：等 status 最多 min(5s, 剩余 - RETIRE_MIN_MS)，产品退休入口由注入的截止时刻收口。
  // 每个分支自己 catch，Promise.all 不会提前拒绝。
  await Promise.all(ownersWithPrefixes(prefixes, list).map(async (owner) => {
    const dataRoot = dirname(owner.configPath);
    // 第 9 轮 codex minor 2：cut 放在 try 外，异常路径也保留被预算截断的步骤。
    const cut: string[] = [];
    try {
      const statusWaitMs = Math.min(OWNER_STARTUP_STATUS_WAIT_MS, Math.max(0, remainingMs(ownerDeadline) - RETIRE_MIN_MS));
      // 到期分类看 pid（DS 第 6 轮 minor 1）：status 恰在到期瞬间落盘且是它，照常走退休入口。
      const awaited = await awaitStatus(dataRoot, owner.pid, statusWaitMs);
      const onDisk = awaited ?? readOwnerStatus(dataRoot);
      const status = onDisk?.pid === owner.pid ? onDisk : undefined;
      if (!status) {
        // 预算已不允许等待（第 7 轮 DS minor 1）：不归咎于产品，记 teardown_deadline。
        const reason: OwnerSurvivorReason = onDisk ? 'status_pid_mismatch' : !existsSync(dataRoot) ? 'data_root_gone' : statusWaitMs === 0 ? 'teardown_deadline' : 'missing_status';
        const budget = reason === 'teardown_deadline' ? '没有剩余预算等 status'
          : reason === 'missing_status' && statusWaitMs < OWNER_STARTUP_STATUS_WAIT_MS ? `status 只等了 ${statusWaitMs}ms（产品上限 ${OWNER_STARTUP_STATUS_WAIT_MS}ms，被收尾预算压短；只说明没等满上限）` : undefined;
        outcomes.set(owner.pid, budget === undefined ? { reason } : { reason, budget });
        return;
      }
      if (remainingMs(ownerDeadline) < RETIRE_ENTRY_MIN_MS) { outcomes.set(owner.pid, { reason: 'teardown_deadline', budget: '没有剩余预算进入产品退休入口' }); return; }
      const outcome = await retire(dataRoot, status, ownerDeadline, (step) => { if (!cut.includes(step)) cut.push(step); });
      const reason: OwnerSurvivorReason = outcome === 'retired' ? 'retired_but_alive' : outcome;
      outcomes.set(owner.pid, cut.length ? { reason, budget: `收尾预算不足：${cut.join('、')}` } : { reason });
    } catch (error) {
      outcomes.set(owner.pid, cut.length ? { reason: 'teardown_error', error, budget: `收尾预算不足：${cut.join('、')}` } : { reason: 'teardown_error', error });
    }
  }));
  return ownersWithPrefixes(prefixes, list).map((owner) => ({ ...owner, ...(outcomes.get(owner.pid) ?? { reason: 'appeared_during_teardown' as const }) }));
}

export interface ReclaimLateOwnersDependencies {
  list: () => ActivityOwnerProcess[];
  kill: (pid: number, signal: NodeJS.Signals) => void;
  awaitGone: (pid: number) => Promise<boolean>;
  /** 默认 awaitGone 轮询用的存活检查（默认 processExists，即 kill(pid,0)）。 */
  exists: (pid: number) => boolean;
  /** 每个仍在的 owner 的原因（默认 late_after_removal）。 */
  reasonFor: (pid: number) => OwnerSurvivorReason;
  /** 回收阶段的截止时刻（Date.now 时基），含最后那次 ps 快照；默认 now + RECLAIM_RESERVE_MS。 */
  deadline: number;
}

/**
 * 删目录之后，把 argv 仍指向这组前缀的 owner 全部回收：既包括没走产品退休入口的（删目录后才出现、收尾中途出现、
 * 退休那一步整体出错），也包括走了入口却没收掉的（kept_*、missing_status、teardown_error 等，原因由 reasonFor 保留）。
 * 只对同一次进程表读取里认出的进程发 SIGTERM（避免 pid 复用误杀），再在截止时刻前确认退出。
 * 返回值仍按原因判失败，但进程不会留下来污染后续用例。每个 owner 各自收口，不会提前拒绝。
 */
export async function reclaimLateOwners(prefixes: readonly string[], dependencies: Partial<ReclaimLateOwnersDependencies> = {}): Promise<ActivityOwnerSurvivor[]> {
  const kill = dependencies.kill ?? ((pid, signal) => process.kill(pid, signal));
  const deadline = dependencies.deadline ?? Date.now() + RECLAIM_RESERVE_MS;
  const list = dependencies.list ?? deadlineBoundOwnerList(deadline);
  // 轮询只用 kill(pid,0)，到 deadline - PS_SCAN_RESERVE_MS 为止；仍在的 owner 共用最后一次 ps 快照确认（第 7 轮 codex Major1）。
  const awaitGone = dependencies.awaitGone ?? ((pid) => awaitProcessGone(pid, () => true, remainingMs(deadline - PS_SCAN_RESERVE_MS), dependencies.exists ?? processExists));
  const reasonFor = dependencies.reasonFor ?? (() => 'late_after_removal' as const);
  const late = ownersWithPrefixes(prefixes, list);
  const results = await Promise.all(late.map(async (owner): Promise<ActivityOwnerSurvivor> => {
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
  // pid 仍在、但 argv 已不指向本用例：pid 被复用，owner 其实已退。只读一次进程表；读失败就保持 reclaimed=false 并附上错误。
  const unconfirmed = results.filter((owner) => owner.reclaimed === false && owner.error === undefined);
  if (!unconfirmed.length) return results;
  let stillListed: Set<number>;
  try { stillListed = new Set(ownersWithPrefixes(prefixes, list).map((owner) => owner.pid)); }
  catch (error) { return results.map((owner) => unconfirmed.includes(owner) ? { ...owner, error } : owner); }
  return results.map((owner) => unconfirmed.includes(owner) && !stillListed.has(owner.pid) ? { ...owner, reclaimed: true } : owner);
}

/** 进程是否还在：只有 ESRCH 算不存在；EPERM 说明进程在（只是不属于我们）。 */
export function processExists(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}

/**
 * owner 收到 SIGTERM 后的退出确认。owner 由产品以 detached 方式 spawn，ChildProcess 句柄在产品手里，
 * 测试拿不到它的 exit 事件，所以这里是唯一的有界轮询：每 50ms 用 kill(pid, 0) 查一次（不阻塞），到期判 false。
 * 到期时调用一次 stillListed（pid 仍在但已不在进程表里 = pid 被复用）；reclaimLateOwners 默认传 () => true，
 * 改为对所有仍在的 owner 共用一次进程表快照，避免每个 owner 各读一次阻塞的 ps。
 * 任何一次检查（包括进程表读取）抛错都会让 Promise 拒绝，不会逃出定时器回调。
 */
export function awaitProcessGone(pid: number, stillListed: () => boolean, deadlineMs = RECLAIM_RESERVE_MS - PS_SCAN_RESERVE_MS, exists: (pid: number) => boolean = processExists): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = (): void => {
      try {
        if (!exists(pid)) { resolve(true); return; }
        if (Date.now() - started >= deadlineMs) { resolve(!stillListed()); return; }
        setTimeout(check, Math.min(50, Math.max(0, deadlineMs - (Date.now() - started))));
      } catch (error) { reject(error); }
    };
    check();
  });
}

export type OwnerTeardownReport =
  | { survivors: ActivityOwnerSurvivor[]; reclaimFailed: false }
  /** 回收那一步整体出错（例如 ps 不可用）：error 是原始抛出值（可能不是 Error）；survivors 仍保留退休阶段的明细。 */
  | { survivors: ActivityOwnerSurvivor[]; reclaimFailed: true; error: unknown };

/**
 * afterEach 收尾的回收与报告编排（DS 第 6 轮 B1 / codex Major2：抽成可单测的函数）。
 * 输入是退休阶段的结果（删目录之前），在删目录之后调用：
 * - 退休阶段中途才出现的 owner（appeared_during_teardown）与走过入口的 owner 分开；
 * - 按删目录前算好的前缀回收所有仍在的 owner，原因：走过入口的保留原因；中途出现的保持 appeared_during_teardown；
 *   其余新扫到的，退休步骤整体出错时为 unretired_after_error，否则为 late_after_removal；
 * - 回收结果的 reclaimed 合并回原记录，原有 error 优先保留；
 * - 回收步骤整体出错时，退休阶段的全部明细（含中途出现的）原样保留，错误单独返回。
 * survivors 非空即判本用例失败；回收成功（reclaimed=true）的也照样列出。
 */
export async function reclaimAndReport(input: {
  retired: readonly ActivityOwnerSurvivor[];
  retireStepFailed: boolean;
  /** 删目录前算好的前缀；undefined/空表示前缀没算成或没有，不做回收扫描。 */
  prefixes: readonly string[] | undefined;
  reclaim: (prefixes: readonly string[], reasonFor: (pid: number) => OwnerSurvivorReason) => Promise<ActivityOwnerSurvivor[]>;
}): Promise<OwnerTeardownReport> {
  const appeared = input.retired.filter((owner) => owner.reason === 'appeared_during_teardown');
  const appearedPids = new Set(appeared.map((owner) => owner.pid));
  const attempted = input.retired.filter((owner) => !appearedPids.has(owner.pid));
  if (!input.prefixes?.length) return { survivors: [...attempted, ...appeared], reclaimFailed: false };
  const attemptedReason = new Map(attempted.map((owner) => [owner.pid, owner.reason]));
  const reasonFor = (pid: number): OwnerSurvivorReason => attemptedReason.get(pid)
    ?? (appearedPids.has(pid) ? 'appeared_during_teardown' : input.retireStepFailed ? 'unretired_after_error' : 'late_after_removal');
  let reclaimed: ActivityOwnerSurvivor[];
  try { reclaimed = await input.reclaim(input.prefixes, reasonFor); }
  catch (error) { return { survivors: [...attempted, ...appeared], reclaimFailed: true, error }; }
  const byPid = new Map(reclaimed.map((owner) => [owner.pid, owner]));
  const merge = (owner: ActivityOwnerSurvivor): ActivityOwnerSurvivor => {
    const again = byPid.get(owner.pid);
    if (!again) return owner;
    const error = owner.error ?? again.error;
    return { ...owner, reclaimed: again.reclaimed, ...(error === undefined ? {} : { error }) };
  };
  const known = new Set([...attemptedReason.keys(), ...appearedPids]);
  return { survivors: [...attempted.map(merge), ...appeared.map(merge), ...reclaimed.filter((owner) => !known.has(owner.pid))], reclaimFailed: false };
}

/**
 * afterEach 的 owner 收尾编排（第 7 轮 codex Major2：删目录也在预算编排里，可整体单测）：
 * 删目录前算前缀 → 退休（截止 D - REMOVE - RECLAIM）→ 逐个删目录（截止 D - RECLAIM）→ 回收并报告（截止 D）。
 * 每一步经 step 执行，某步抛错不影响后面的步骤。posix=false（Windows）时不收不判，只删目录。
 */
export async function teardownCaseOwners(input: {
  dirs: readonly string[];
  deadline: number;
  posix: boolean;
  step: (work: () => unknown) => Promise<boolean>;
  removeDir: (dir: string, deadline: number) => unknown;
  retire?: Partial<Omit<RetireActivityOwnersDependencies, 'deadline'>>;
  reclaim?: Partial<Omit<ReclaimLateOwnersDependencies, 'deadline' | 'reasonFor'>>;
}): Promise<OwnerTeardownReport> {
  const removeDeadline = input.deadline - RECLAIM_RESERVE_MS;
  const retireDeadline = removeDeadline - REMOVE_RESERVE_MS;
  // undefined = 前缀没算成（那一步的错误已记下），区别于“算过但为空”。
  let prefixes: string[] | undefined;
  let retireStepFailed = false;
  const retired: ActivityOwnerSurvivor[] = [];
  if (input.posix) {
    await input.step(() => { prefixes = ownerPathPrefixes(input.dirs); });
    retireStepFailed = !await input.step(async () => {
      retired.push(...await retireActivityOwnersUnder(input.dirs, { ...input.retire, deadline: retireDeadline }));
    });
  }
  for (const dir of input.dirs) await input.step(() => input.removeDir(dir, removeDeadline));
  return reclaimAndReport({
    retired, retireStepFailed, prefixes: input.posix ? prefixes : undefined,
    reclaim: (scan, reasonFor) => reclaimLateOwners(scan, { ...input.reclaim, reasonFor, deadline: input.deadline }),
  });
}

/**
 * 删临时目录（原在 chat-interactive-runtime.test.ts，移到这里以便单测；第 7 轮 codex Major2）。
 * 每次删除（含第一次）启动前都看截止时刻，截止后跳过并写 stderr；退避也不越过截止。
 * 删除走异步 fs.promises.rm（libuv 线程池，不占事件循环）并与截止时刻赛跑（第 9 轮 codex Major）：
 * 到截止还没删完就写 stderr 并返回，删除留在后台继续（结果只记 stderr），所以单次慢删除也拖不过截止。
 * 删不掉只写 stderr、不判失败——
 * POSIX 允许 unlink 已打开的文件，Windows 不允许：测试进程里仍在运行的 chat 会话
 * 持有会话文件句柄时临时目录删不掉，rm 报 EPERM（Windows job 上 66 个用例
 * 因此失败）。清理是收尾动作，不该把用例判成失败；残留目录留在系统临时目录，由 CI 机器回收。
 */
export async function removeTempDirWithRetry(
  dir: string, deadline = Number.POSITIVE_INFINITY,
  rm: (dir: string) => void | Promise<void> = (target) => rmAsync(target, { recursive: true, force: true }),
  report: (message: string) => void = (message) => { process.stderr.write(message); },
): Promise<void> {
  // 第 8 轮 codex Major：截止后不再启动任何删除（含第一次），多目录时慢删除不会把后续目录拖过截止。
  if (remainingMs(deadline) <= 0) {
    report(`[chat-interactive-runtime] 收尾预算用完，跳过删除临时目录 ${dir}\n`);
    return;
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (attempt > 0 && remainingMs(deadline) <= 0) break;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attemptRm = Promise.resolve().then(() => rm(dir)).then(() => 'removed' as const);
    try {
      const result = Number.isFinite(deadline)
        ? await Promise.race([attemptRm, new Promise<'deadline'>((resolve) => { timer = setTimeout(() => resolve('deadline'), remainingMs(deadline)); })])
        : await attemptRm;
      if (result === 'removed') return;
      // 第 10 轮 DS M3 / minor 3：只在后台删除失败时再报一次；报告本身抛错（如 EPIPE）也不能变成未处理拒绝。
      attemptRm.catch((error) => {
        try { report(`[chat-interactive-runtime] 未能清理临时目录 ${dir}（收尾预算之后，后台删除失败）: ${String(error)}\n`); } catch { /* 报告失败只能丢弃 */ }
      });
      report(`[chat-interactive-runtime] 收尾预算用完，临时目录 ${dir} 仍在后台删除（用例结束后可能仍在删除或只删了一部分）\n`);
      return;
    } catch (error) {
      lastError = error;
      const left = remainingMs(deadline);
      if (left <= 0) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(200 * (attempt + 1), 1_000, left)));
    } finally { clearTimeout(timer); }
  }
  report(`[chat-interactive-runtime] 未能清理临时目录 ${dir}: ${String(lastError)}\n`);
}

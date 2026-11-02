import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
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
  | Exclude<OwnerRetirementOutcome, 'retired'>   // kept_pending / kept_unknown：产品按策略保留；kept_unverified：身份校验未过
  | 'missing_status'                               // 进程在，但没有可用的 status 文件
  | 'status_pid_mismatch'                          // status 文件记录的不是这个进程
  | 'retired_but_alive';                           // 产品报 retired，进程却仍在
export interface ActivityOwnerSurvivor { pid: number; configPath: string; reason: OwnerSurvivorReason }
export interface ActivityOwnerProcess { pid: number; configPath: string }

/** 进程表里所有 activity owner（argv 末尾是 activity-owner.config.json）。仅 POSIX。 */
export function listActivityOwnerProcesses(entryScript?: string): ActivityOwnerProcess[] {
  if (process.platform === 'win32') return [];
  const out = execFileSync('ps', ['-axww', '-o', 'pid=,command='], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
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

function ownersUnder(roots: readonly string[]): ActivityOwnerProcess[] {
  const prefixes = roots.map(canonical).filter((root): root is string => Boolean(root)).map((root) => root.endsWith(sep) ? root : root + sep);
  return listActivityOwnerProcesses().filter((owner) => prefixes.some((prefix) => owner.configPath.startsWith(prefix)));
}

/**
 * 收掉 dirs（须仍存在）下所有 activity owner；返回没能收掉的 owner 及原因，调用方据此判失败。
 * 收完后重新查进程表，只认 argv 仍指向本目录的进程，避免 pid 复用造成误报。
 */
export async function retireActivityOwnersUnder(dirs: readonly string[]): Promise<ActivityOwnerSurvivor[]> {
  const reasons = new Map<number, OwnerSurvivorReason>();
  // 并行收：每个 owner 最坏约 8s（待办读取 5s + 退出等待 3s），串行会让多 owner 退化成 hook 超时。
  await Promise.all(ownersUnder(dirs).map(async (owner) => {
    const dataRoot = dirname(owner.configPath);
    let status: { pid?: unknown; ownerEpoch?: unknown; rootHash?: unknown };
    try { status = JSON.parse(readFileSync(join(dataRoot, ACTIVITY_STORAGE_NAMES.status), 'utf8')); }
    catch { reasons.set(owner.pid, 'missing_status'); return; }
    if (status.pid !== owner.pid) { reasons.set(owner.pid, 'status_pid_mismatch'); return; }
    const outcome = await retireOutdatedOwner(dataRoot, status);
    reasons.set(owner.pid, outcome === 'retired' ? 'retired_but_alive' : outcome);
  }));
  return ownersUnder(dirs).map((owner) => ({ ...owner, reason: reasons.get(owner.pid) ?? 'missing_status' }));
}

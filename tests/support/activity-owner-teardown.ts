import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { retireOutdatedOwner, type OwnerRetirementOutcome } from '../../src/runtime/conversation-activity/owner-retire.js';
import { ACTIVITY_STORAGE_NAMES } from '../../src/runtime/conversation-activity/storage-permissions.js';

/**
 * #145/#143：进程内跑 chat 的用例每次都会拉起一个独立的 activity owner（detached，
 * 空闲 20 分钟才退出）。用例删了临时目录却不收 owner，单个测试文件就会累积几十个
 * 常驻 node 进程（每个约 64MB），在 3 vCPU / 7GB 的 macos-15 runner 上把后半程用例的
 * 启动拖过 waitForInputTurnReady 的窗口。用例收尾时用产品自带的、带身份校验的
 * retireOutdatedOwner 收掉本用例临时目录里的 owner，并确认进程确实退出。
 */
export interface ActivityOwnerTeardownResult { dataRoot: string; pid: unknown; outcome: OwnerRetirementOutcome | 'not_running' }

function findActivityDataRoots(dir: string, depth: number, out: string[]): void {
  if (depth < 0) return;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name === 'node_modules') continue;
    const child = join(dir, entry.name);
    if (entry.name === 'conversation-activity') {
      for (const root of readdirSync(child, { withFileTypes: true })) {
        if (root.isDirectory() && existsSync(join(child, root.name, ACTIVITY_STORAGE_NAMES.status))) out.push(join(child, root.name));
      }
      continue;
    }
    findActivityDataRoots(child, depth - 1, out);
  }
}

function isAlive(pid: unknown): boolean {
  if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

/** 收掉 dirs 下所有 activity owner；返回仍存活（未能收掉）的 owner，调用方据此判失败。 */
export async function retireActivityOwnersUnder(dirs: readonly string[]): Promise<ActivityOwnerTeardownResult[]> {
  const roots: string[] = [];
  for (const dir of dirs) findActivityDataRoots(dir, 4, roots);
  const survivors: ActivityOwnerTeardownResult[] = [];
  for (const dataRoot of roots) {
    let status: { pid?: unknown; ownerEpoch?: unknown; rootHash?: unknown };
    try { status = JSON.parse(readFileSync(join(dataRoot, ACTIVITY_STORAGE_NAMES.status), 'utf8')); } catch { continue; }
    if (!isAlive(status.pid)) continue;
    const outcome = await retireOutdatedOwner(dataRoot, status);
    if (isAlive(status.pid)) survivors.push({ dataRoot, pid: status.pid, outcome });
  }
  return survivors;
}

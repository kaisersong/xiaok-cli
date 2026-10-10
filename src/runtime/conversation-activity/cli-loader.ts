import { chmodPrivateActivityFile } from './storage-permissions.js';
import { ACTIVITY_STORAGE_NAMES } from './storage-permissions.js';
import { createPrivateActivityDirectory } from './storage-permissions.js';
import { statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CliConversationActivities } from './cli.js';

type AttachOptions = Parameters<typeof CliConversationActivities.attach>[0];
interface LoaderOptions {
  print: boolean;
  isTTY: boolean;
  conversationActivity: string | undefined;
  attachOptions: AttachOptions;
  startupNotices?: ActivityStartupNotices;
  onDebug?(event: string, detail: string): void;
}
interface LoaderDependencies {
  importCli(): Promise<{ CliConversationActivities: Pick<typeof CliConversationActivities, 'attach'> }>;
}

export async function attachCliConversationActivities(
  options: LoaderOptions,
  deps: LoaderDependencies = { importCli: () => import('./cli.js') },
): Promise<CliConversationActivities | undefined> {
  if (options.print || !options.isTTY || options.conversationActivity === '0') return undefined;

  let cli: Awaited<ReturnType<LoaderDependencies['importCli']>>;
  try {
    cli = await deps.importCli();
  } catch (error) {
    const code = error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      ? error.code : 'unclassified';
    options.onDebug?.('cli_activity_sqlite_unavailable', code);
    options.startupNotices?.queueUnavailable();
    return undefined;
  }

  try {
    const instance = await cli.CliConversationActivities.attach({ ...options.attachOptions,
      onLegacyOwner: outcome => { options.attachOptions.onLegacyOwner?.(outcome); if (outcome === 'replaced') options.startupNotices?.queueLegacyReplaced(); else options.startupNotices?.queueLegacyPending(); },
      onOwnerReplaced: () => { options.attachOptions.onOwnerReplaced?.(); options.startupNotices?.queueOwnerReplaced(); options.attachOptions.changed(); },
    });
    if (instance) options.startupNotices?.queueStarted();
    return instance;
  } catch (error) {
    if (error instanceof Error && error.message === 'activity_storage_not_private') {
      options.onDebug?.('cli_activity_storage_not_private', error.message);
      options.startupNotices?.queueStorageNotPrivate();
    } else {
      options.onDebug?.('cli_activity_owner_unavailable', String(error));
      options.startupNotices?.queueOwnerUnavailable();
    }
    return undefined;
  }
}


export const ACTIVITY_STARTUP_WAIT_MS = 2000;

export async function attachCliConversationActivitiesWithinBudget(
  options: LoaderOptions,
  budget: {
    waitMs?: number;
    onLate?(instance: CliConversationActivities): void;
    onSettled?(): void;
  } = {},
  deps?: LoaderDependencies,
): Promise<CliConversationActivities | undefined> {
  const pending = attachCliConversationActivities(options, deps);
  const timedOut = Symbol('activity_startup_timeout');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      pending,
      new Promise<typeof timedOut>(resolve => {
        timer = setTimeout(() => resolve(timedOut), budget.waitMs ?? ACTIVITY_STARTUP_WAIT_MS);
        timer.unref?.();
      }),
    ]);
    if (result !== timedOut) return result;
    options.onDebug?.('cli_activity_startup_deferred', '');
    void pending.then(instance => {
      try { if (instance) budget.onLate?.(instance); }
      finally { budget.onSettled?.(); }
    });
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}


export const CONVERSATION_ACTIVITY_MIN_NODE = '22.14.0';

function nodeSupportsActivity(version: string): boolean {
  const [major = 0, minor = 0, patch = 0] = version.replace(/^v/, '').split('.').map(Number);
  return major > 22 || major === 22 && (minor > 14 || minor === 14 && patch >= 0);
}

interface ActivityStartupNotice {
  text: string;
  /** Call only after the notice has actually been written to the terminal. */
  markShown(): void;
}
// 待设计师确认：后台进程更新提示文案。
export const ACTIVITY_OWNER_NOTICES = {
  replaced: '后台任务跟进已更新，请重新打开终端以继续跟进',
  legacyReplaced: '后台任务跟进已更新。更新前已打开的旧版终端不会再跟进，请重新打开终端。',
  legacyPending: '有未完成的后台任务，任务结束后再次打开 xiaok 会自动更新。',
} as const;
export interface ActivityStartupNotices {
  queueOwnerReplaced(): void;
  queueLegacyReplaced(): void;
  queueLegacyPending(): void;
  queueUnavailable(): void;
  queueStorageNotPrivate(): void;
  queueOwnerUnavailable(): void;
  queueStarted(): void;
  take(): ActivityStartupNotice | undefined;
}

export function createActivityStartupNotices(options: {
  configDir: string;
  version?: string;
  onDebug?(event: string, detail: string): void;
}): ActivityStartupNotices {
  const directory = join(options.configDir, 'conversation-activity');
  const marker = join(directory, ACTIVITY_STORAGE_NAMES.notice);
  let pending: ActivityStartupNotice | undefined;
  const updates: ActivityStartupNotice[] = [];
  const seen = new Set<string>();
  let degraded = false;
  const queueUpdate = (key: keyof typeof ACTIVITY_OWNER_NOTICES) => {
    if (degraded || seen.has(key)) return;
    seen.add(key); updates.push({ text: ACTIVITY_OWNER_NOTICES[key], markShown() {} });
  };
  let queued = false;
  const debug = (error: unknown): void => {
    options.onDebug?.('cli_activity_startup_notice_unavailable', String(error));
  };
  return {
    queueOwnerReplaced() { queueUpdate('replaced'); },
    queueLegacyReplaced() { queueUpdate('legacyReplaced'); },
    queueLegacyPending() { queueUpdate('legacyPending'); },
    queueOwnerUnavailable() {
      if (degraded) return;
      degraded = true; updates.length = 0;
      queued = true;
      pending = { text: '异步任务跟进暂不可用，其他功能不受影响。如不需要，可设 XIAOK_CONVERSATION_ACTIVITY=0 关闭。', markShown() {} };
    },
    queueStorageNotPrivate() {
      if (degraded) return;
      degraded = true; updates.length = 0;
      queued = true;
      pending = { text: '异步任务跟进已停用：无法把 ~/.xiaok/conversation-activity 设为仅本人可访问，请检查该目录的所有者和权限。', markShown() {} };
    },
    queueUnavailable() {
      if (degraded) return;
      degraded = true; updates.length = 0;
      queued = true;
      pending = {
        text: nodeSupportsActivity(options.version ?? process.version) ? '异步任务跟进暂不可用，其他功能不受影响。如不需要，可设 XIAOK_CONVERSATION_ACTIVITY=0 关闭。' : `异步任务跟进在当前 Node 版本（${options.version ?? process.version}）不可用，其他功能不受影响。升级到 Node ${CONVERSATION_ACTIVITY_MIN_NODE} 或更新版本后会自动启用。`,
        markShown() {},
      };
    },
    queueStarted() {
      if (queued) return;
      queued = true;
      try {
        statSync(marker);
        return;
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) debug(error);
      }
      pending = {
        text: '已在后台启动任务跟进，设 XIAOK_CONVERSATION_ACTIVITY=0 可关闭。',
        markShown() {
          try {
            createPrivateActivityDirectory(directory);
            writeFileSync(marker, '', { mode: 0o600, flag: 'wx' });
            chmodPrivateActivityFile(marker);
          } catch (error) {
            if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) debug(error);
          }
        },
      };
    },
    take() {
      if (updates.length) return updates.shift();
      const notice = pending;
      pending = undefined;
      return notice;
    },
  };
}

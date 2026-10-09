import { mkdirSync, statSync, writeFileSync } from 'node:fs';
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
    const instance = await cli.CliConversationActivities.attach(options.attachOptions);
    if (instance) options.startupNotices?.queueStarted();
    return instance;
  } catch (error) {
    options.onDebug?.('cli_activity_owner_unavailable', String(error));
    return undefined;
  }
}


export const CONVERSATION_ACTIVITY_MIN_NODE = '22.14.0';

interface ActivityStartupNotice {
  text: string;
  /** Call only after the notice has actually been written to the terminal. */
  markShown(): void;
}
interface ActivityStartupNotices {
  queueUnavailable(): void;
  queueStarted(): void;
  take(): ActivityStartupNotice | undefined;
}

export function createActivityStartupNotices(options: {
  configDir: string;
  version?: string;
  onDebug?(event: string, detail: string): void;
}): ActivityStartupNotices {
  const directory = join(options.configDir, 'conversation-activity');
  const marker = join(directory, 'first-start-notice-shown');
  let pending: ActivityStartupNotice | undefined;
  let queued = false;
  const debug = (error: unknown): void => {
    options.onDebug?.('cli_activity_startup_notice_unavailable', String(error));
  };
  return {
    queueUnavailable() {
      if (queued) return;
      queued = true;
      pending = {
        text: `异步任务跟进在当前 Node 版本（${options.version ?? process.version}）不可用，其他功能不受影响。升级到 Node ${CONVERSATION_ACTIVITY_MIN_NODE} 或更新版本后会自动启用。`,
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
            mkdirSync(directory, { recursive: true });
            writeFileSync(marker, '', { mode: 0o600, flag: 'wx' });
          } catch (error) {
            if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) debug(error);
          }
        },
      };
    },
    take() {
      const notice = pending;
      pending = undefined;
      return notice;
    },
  };
}

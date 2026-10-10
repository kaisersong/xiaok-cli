import { createPrivateActivityDirectory } from './storage-permissions.js';
import { statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
export async function attachCliConversationActivities(options, deps = { importCli: () => import('./cli.js') }) {
    if (options.print || !options.isTTY || options.conversationActivity === '0')
        return undefined;
    let cli;
    try {
        cli = await deps.importCli();
    }
    catch (error) {
        const code = error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
            ? error.code : 'unclassified';
        options.onDebug?.('cli_activity_sqlite_unavailable', code);
        options.startupNotices?.queueUnavailable();
        return undefined;
    }
    try {
        const instance = await cli.CliConversationActivities.attach(options.attachOptions);
        if (instance)
            options.startupNotices?.queueStarted();
        return instance;
    }
    catch (error) {
        if (error instanceof Error && error.message === 'activity_storage_not_private') {
            options.onDebug?.('cli_activity_storage_not_private', error.message);
            options.startupNotices?.queueStorageNotPrivate();
        }
        else {
            options.onDebug?.('cli_activity_owner_unavailable', String(error));
            options.startupNotices?.queueOwnerUnavailable();
        }
        return undefined;
    }
}
export const ACTIVITY_STARTUP_WAIT_MS = 2000;
export async function attachCliConversationActivitiesWithinBudget(options, budget = {}, deps) {
    const pending = attachCliConversationActivities(options, deps);
    const timedOut = Symbol('activity_startup_timeout');
    let timer;
    try {
        const result = await Promise.race([
            pending,
            new Promise(resolve => {
                timer = setTimeout(() => resolve(timedOut), budget.waitMs ?? ACTIVITY_STARTUP_WAIT_MS);
                timer.unref?.();
            }),
        ]);
        if (result !== timedOut)
            return result;
        options.onDebug?.('cli_activity_startup_deferred', '');
        void pending.then(instance => {
            try {
                if (instance)
                    budget.onLate?.(instance);
            }
            finally {
                budget.onSettled?.();
            }
        });
        return undefined;
    }
    finally {
        clearTimeout(timer);
    }
}
export const CONVERSATION_ACTIVITY_MIN_NODE = '22.14.0';
export function createActivityStartupNotices(options) {
    const directory = join(options.configDir, 'conversation-activity');
    const marker = join(directory, 'first-start-notice-shown');
    let pending;
    let queued = false;
    const debug = (error) => {
        options.onDebug?.('cli_activity_startup_notice_unavailable', String(error));
    };
    return {
        queueOwnerUnavailable() {
            if (queued)
                return;
            queued = true;
            pending = { text: '异步任务跟进暂不可用，其他功能不受影响。', markShown() { } };
        },
        queueStorageNotPrivate() {
            if (queued)
                return;
            queued = true;
            pending = { text: '异步任务跟进已停用：无法把 ~/.xiaok/conversation-activity 设为仅本人可访问，请检查该目录的所有者和权限。', markShown() { } };
        },
        queueUnavailable() {
            if (queued)
                return;
            queued = true;
            pending = {
                text: `异步任务跟进在当前 Node 版本（${options.version ?? process.version}）不可用，其他功能不受影响。升级到 Node ${CONVERSATION_ACTIVITY_MIN_NODE} 或更新版本后会自动启用。`,
                markShown() { },
            };
        },
        queueStarted() {
            if (queued)
                return;
            queued = true;
            try {
                statSync(marker);
                return;
            }
            catch (error) {
                if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
                    debug(error);
            }
            pending = {
                text: '已在后台启动任务跟进，设 XIAOK_CONVERSATION_ACTIVITY=0 可关闭。',
                markShown() {
                    try {
                        createPrivateActivityDirectory(directory);
                        writeFileSync(marker, '', { mode: 0o600, flag: 'wx' });
                    }
                    catch (error) {
                        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST'))
                            debug(error);
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

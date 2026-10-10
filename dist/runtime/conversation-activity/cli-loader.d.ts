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
    importCli(): Promise<{
        CliConversationActivities: Pick<typeof CliConversationActivities, 'attach'>;
    }>;
}
export declare function attachCliConversationActivities(options: LoaderOptions, deps?: LoaderDependencies): Promise<CliConversationActivities | undefined>;
export declare const ACTIVITY_STARTUP_WAIT_MS = 2000;
export declare function attachCliConversationActivitiesWithinBudget(options: LoaderOptions, budget?: {
    waitMs?: number;
    onLate?(instance: CliConversationActivities): void;
    onSettled?(): void;
}, deps?: LoaderDependencies): Promise<CliConversationActivities | undefined>;
export declare const CONVERSATION_ACTIVITY_MIN_NODE = "22.14.0";
interface ActivityStartupNotice {
    text: string;
    /** Call only after the notice has actually been written to the terminal. */
    markShown(): void;
}
export declare const ACTIVITY_OWNER_NOTICES: {
    readonly replaced: "后台任务跟进已更新，请重新打开终端以继续跟进";
    readonly legacyReplaced: "后台任务跟进已更新。更新前已打开的旧版终端不会再跟进，请重新打开终端。";
    readonly legacyPending: "有未完成的后台任务，任务结束后再次打开 xiaok 会自动更新。";
};
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
export declare function createActivityStartupNotices(options: {
    configDir: string;
    version?: string;
    onDebug?(event: string, detail: string): void;
}): ActivityStartupNotices;
export {};

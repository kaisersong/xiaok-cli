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
export declare const CONVERSATION_ACTIVITY_MIN_NODE = "22.14.0";
interface ActivityStartupNotice {
    text: string;
    /** Call only after the notice has actually been written to the terminal. */
    markShown(): void;
}
interface ActivityStartupNotices {
    queueUnavailable(): void;
    queueStorageNotPrivate(): void;
    queueStarted(): void;
    take(): ActivityStartupNotice | undefined;
}
export declare function createActivityStartupNotices(options: {
    configDir: string;
    version?: string;
    onDebug?(event: string, detail: string): void;
}): ActivityStartupNotices;
export {};

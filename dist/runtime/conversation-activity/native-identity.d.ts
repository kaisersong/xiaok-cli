import type { ActivityThreadIdentity } from './service.js';
/** Existing identity repositories only, with no executor boot claim or mutation. */
export declare class ActivityNativeIdentityRepository {
    private readonly options;
    private db?;
    constructor(options: {
        profileId: string;
        kind: 'desktop' | 'cli';
        path: string;
        instanceId?: string;
        workspaceRoot?: string;
    });
    getThread(threadId: string): ActivityThreadIdentity | null;
    authorizeProducer(threadId: string, instanceId?: string | undefined): boolean;
    close(): void;
}

import { ConversationActivityOwnerHost } from './owner-host.js';
import { ActivitySourceSupervisor, type ActivityManagedSource } from './source-supervisor.js';
export interface ActivityOwnerConfig {
    schemaVersion: 1;
    dataRoot: string;
    profileId: string;
    actorId: string;
    identity: {
        kind: 'desktop' | 'cli';
        path: string;
        workspaceRoot?: string;
    };
    managedSources?: ActivityManagedSource[];
    kswarm?: {
        url: string;
        mutationToken: string;
        brokerUrl: string;
        roomToken: string;
    };
}
export declare function activityOwnerConfigDigest(config: ActivityOwnerConfig): string;
/** Private configuration is supplied by the verified native bootstrap owner. */
export declare function startConversationActivityOwner(config: ActivityOwnerConfig): Promise<{
    host: ConversationActivityOwnerHost;
    supervisor: ActivitySourceSupervisor;
    stop(): Promise<void>;
}>;
export declare function serveConversationActivityOwner(configFile: string): Promise<void>;

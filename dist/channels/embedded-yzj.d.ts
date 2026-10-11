import type { EmbeddedChannel } from './embedded-channel.js';
import type { YZJTransport } from './yzj-transport.js';
import type { ApprovalStore } from './approval-store.js';
import type { ChannelReplyTarget } from './types.js';
import type { YZJIncomingMessage, YZJResolvedConfig } from './yzj-types.js';
import type { YZJNamedChannel } from '../types.js';
import type { RuntimeFacade } from '../ai/runtime/runtime-facade.js';
import type { RuntimeHooks } from '../runtime/hooks.js';
export interface EmbeddedYZJChannelOptions {
    runtimeFacade: RuntimeFacade;
    runtimeHooks: RuntimeHooks;
    approvalStore: ApprovalStore;
    onPromptOverride: (toolName: string, input: Record<string, unknown>) => Promise<boolean>;
    transport: Pick<YZJTransport, 'deliver'>;
    selectedChannel: YZJNamedChannel;
    yzjConfig: YZJResolvedConfig;
    sessionId: string;
    cwd: string;
}
export declare class EmbeddedYZJChannel implements EmbeddedChannel {
    private readonly options;
    private wsClient;
    private httpServer;
    constructor(options: EmbeddedYZJChannelOptions);
    start(): Promise<void>;
    cleanup(): Promise<void>;
    private handleInbound;
    pushApprovalRequest(approvalId: string, summary: string, replyTarget: ChannelReplyTarget): Promise<void>;
    makeOnPrompt(tuiOnPrompt: (toolName: string, input: Record<string, unknown>) => Promise<boolean>): (toolName: string, input: Record<string, unknown>) => Promise<boolean>;
    handleInboundForTest(msg: YZJIncomingMessage): Promise<void>;
    pushApprovalRequestForTest(approvalId: string, summary: string, replyTarget: ChannelReplyTarget): Promise<void>;
}

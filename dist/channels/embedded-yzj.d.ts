import type { EmbeddedChannel } from './embedded-channel.js';
import type { YZJTransport } from './yzj-transport.js';
import type { ApprovalStore } from './approval-store.js';
import type { ChannelReplyTarget } from './types.js';
import type { YZJIncomingMessage, YZJResolvedConfig } from './yzj-types.js';
import type { YZJNamedChannel } from '../types.js';
import type { RuntimeFacade } from '../ai/runtime/runtime-facade.js';
import type { RuntimeHooks } from '../runtime/hooks.js';
export interface EmbeddedYZJChannelOptions {
    allowedSenders?: string[];
    runtimeFacade: RuntimeFacade;
    runtimeHooks: RuntimeHooks;
    approvalStore: ApprovalStore;
    /** channel 侧确认的等待时长，超时按拒绝处理；默认沿用 ApprovalStore 的 5 分钟。 */
    approvalTimeoutMs?: number;
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
    /** 只用于定位明确来源的活动回合回复目标。 */
    private readonly activeTurnTargets;
    /** 本 channel 发出的确认请求 → 允许回复它的用户 openid。 */
    private readonly approvalOwners;
    private readonly senderGuard;
    constructor(options: EmbeddedYZJChannelOptions);
    start(): Promise<void>;
    cleanup(): Promise<void>;
    private handleInbound;
    pushApprovalRequest(approvalId: string, summary: string, replyTarget: ChannelReplyTarget, signal?: AbortSignal): Promise<void>;
    /**
     * 合并终端确认与 channel 确认：任何一侧给出明确决定即生效，绝不自动批准。
     * - 终端确认照常弹出；
     * - 当前 turn 由 channel 消息发起时，同时把确认请求推送给发起人，只有他显式 /approve 才算批准；
     * - channel 确认等待超时按拒绝处理；推送失败则退出 race；
     * - 终端发起的 turn 不推送到 channel，由终端确认决定。
     */
    makeOnPrompt(tuiOnPrompt: (toolName: string, input: Record<string, unknown>, signal?: AbortSignal) => Promise<boolean>): (toolName: string, input: Record<string, unknown>) => Promise<boolean>;
    /**
     * 向 channel 用户发起一次确认。decision：true=显式批准，false=拒绝/确认等待超时，
     * undefined=当前不是 channel 发起的 turn（不参与决定）。
     */
    private requestChannelApproval;
    /** 只接受本 channel 发出的、且由发起人本人回复的 /approve、/deny；其余一律忽略。 */
    private isAllowedApprover;
    handleInboundForTest(msg: YZJIncomingMessage): Promise<void>;
    pushApprovalRequestForTest(approvalId: string, summary: string, replyTarget: ChannelReplyTarget): Promise<void>;
}

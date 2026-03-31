import type { RuntimeHooks, RuntimeHookUnsubscribe } from '../runtime/hooks.js';
import type { ApprovalStore } from './approval-store.js';
import type { ChannelAddress, OutboundChannelMessage } from './types.js';
export interface ChannelDeliveryTransport {
    deliver(message: OutboundChannelMessage): Promise<void> | void;
}
export interface RuntimeNotificationBindings {
    resolveTarget(sessionId: string): ChannelAddress | undefined;
    approvalStore: ApprovalStore;
}
export declare class ChannelNotifier {
    private readonly transport;
    constructor(transport: ChannelDeliveryTransport);
    sendText(target: ChannelAddress, text: string): Promise<void>;
    bindRuntimeHooks(hooks: RuntimeHooks, bindings: RuntimeNotificationBindings): RuntimeHookUnsubscribe;
    private buildReplyTarget;
}

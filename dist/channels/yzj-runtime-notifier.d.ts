import type { RuntimeHooks, RuntimeHookUnsubscribe } from '../runtime/hooks.js';
import type { ApprovalStore } from './approval-store.js';
import type { ChannelReplyTarget } from './types.js';
import type { TaskManager } from './task-manager.js';
export interface YZJRuntimeNotificationTransport {
    send(target: ChannelReplyTarget, text: string): Promise<void> | void;
}
export declare class YZJRuntimeNotifier {
    private readonly transport;
    private readonly taskManager;
    private readonly approvalStore;
    private readonly flushDelayMs;
    private readonly buffers;
    constructor(transport: YZJRuntimeNotificationTransport, taskManager: TaskManager, approvalStore: ApprovalStore, flushDelayMs?: number);
    bind(sessionId: string, hooks: RuntimeHooks): RuntimeHookUnsubscribe;
    private enqueueProgress;
    private flushSession;
    private sendForSession;
}

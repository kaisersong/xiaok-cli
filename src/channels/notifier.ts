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

export class ChannelNotifier {
  constructor(private readonly transport: ChannelDeliveryTransport) {}

  async sendText(target: ChannelAddress, text: string): Promise<void> {
    await this.transport.deliver({
      channel: target.channel,
      target: this.buildReplyTarget(target),
      text,
    });
  }

  bindRuntimeHooks(hooks: RuntimeHooks, bindings: RuntimeNotificationBindings): RuntimeHookUnsubscribe {
    const subscriptions = [
      hooks.on('approval_required', (event) => {
        const target = bindings.resolveTarget(event.sessionId);
        const request = bindings.approvalStore.get(event.approvalId);
        if (!target || !request) {
          return;
        }

        void this.sendText(target, `Approval required: ${request.summary}`);
      }),
      hooks.on('turn_completed', (event) => {
        const target = bindings.resolveTarget(event.sessionId);
        if (!target) {
          return;
        }

        void this.sendText(target, `Turn completed: ${event.turnId}`);
      }),
    ];

    return () => {
      for (const unsubscribe of subscriptions) {
        unsubscribe();
      }
    };
  }

  private buildReplyTarget(target: ChannelAddress): OutboundChannelMessage['target'] {
    const replyTarget: OutboundChannelMessage['target'] = {
      chatId: target.chatId,
    };
    if (target.threadId) {
      replyTarget.threadId = target.threadId;
    }
    if (target.userId) {
      replyTarget.userId = target.userId;
    }
    if (target.messageId) {
      replyTarget.messageId = target.messageId;
    }
    if (target.metadata) {
      replyTarget.metadata = target.metadata;
    }
    return replyTarget;
  }
}

export class ChannelNotifier {
    transport;
    constructor(transport) {
        this.transport = transport;
    }
    async sendText(target, text) {
        await this.transport.deliver({
            channel: target.channel,
            target: this.buildReplyTarget(target),
            text,
        });
    }
    bindRuntimeHooks(hooks, bindings) {
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
    buildReplyTarget(target) {
        const replyTarget = {
            chatId: target.chatId,
        };
        if (target.threadId) {
            replyTarget.threadId = target.threadId;
        }
        if (target.messageId) {
            replyTarget.messageId = target.messageId;
        }
        return replyTarget;
    }
}

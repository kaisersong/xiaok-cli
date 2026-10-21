import { createHash } from 'node:crypto';
import { toDurableSessionSnapshot } from '../../ai/runtime/session-store/store.js';
import { assertCapturedMessageSchema } from '../../ai/runtime/provider-private-projection.js';
import { canonicalVerificationJson as json } from '../verification/protocol.js';
/** Original durable message conversion; a digest is a fact, never a grant. */
export function intentStageMessages(snapshot) {
    assertCapturedMessageSchema(snapshot.messages);
    return JSON.parse(JSON.stringify(toDurableSessionSnapshot(snapshot).messages));
}
export function intentStageMessagesHash(messages) {
    assertCapturedMessageSchema(messages);
    return createHash('sha256').update('xiaok-intent-stage-context-v1\0').update(json(messages)).digest('hex');
}
export function captureIntentStageContext(snapshot, stageId) {
    const messages = intentStageMessages(snapshot);
    return { stageId, messageCount: messages.length, messagesHash: intentStageMessagesHash(messages) };
}
export function assertIntentStagePrefix(snapshot, context) {
    const messages = intentStageMessages(snapshot);
    if (messages.length < context.messageCount || intentStageMessagesHash(messages.slice(0, context.messageCount)) !== context.messagesHash)
        throw Error('intent_stage_context_prefix');
    return messages;
}

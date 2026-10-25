import { type PersistedSessionSnapshot } from '../../ai/runtime/session-store/store.js';
import type { Message } from '../../types.js';
export interface IntentStageContext {
    stageId: string;
    messageCount: number;
    messagesHash: string;
}
/** Original durable message conversion; a digest is a fact, never a grant. */
export declare function intentStageMessages(snapshot: PersistedSessionSnapshot): Message[];
export declare function intentStageMessagesHash(messages: readonly Message[]): string;
export declare function captureIntentStageContext(snapshot: PersistedSessionSnapshot, stageId: string): IntentStageContext;
export declare function assertIntentStagePrefix(snapshot: PersistedSessionSnapshot, context: IntentStageContext): Message[];

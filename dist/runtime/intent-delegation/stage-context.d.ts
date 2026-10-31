import { type PersistedSessionSnapshot } from '../../ai/runtime/session-store/store.js';
import type { Message } from '../../types.js';
import type { StoredSessionSnapshot } from '../../ai/runtime/session-store/stored-snapshot-types.js';
export interface IntentStageContext {
    stageId: string;
    messageCount: number;
    messagesHash: string;
}
/** Original durable message conversion; a digest is a fact, never a grant. */
export declare function intentStageMessages(snapshot: StoredSessionSnapshot): Message[];
export declare function intentStageMessagesHash(messages: readonly Message[]): string;
export declare function captureIntentStageContext(snapshot: PersistedSessionSnapshot, stageId: string): IntentStageContext;
export declare function captureIntentStageContext(snapshot: StoredSessionSnapshot, stageId: unknown): IntentStageContext;
export declare function assertIntentStagePrefix(snapshot: StoredSessionSnapshot, context: IntentStageContext): Message[];

import type { AssistantPromotionTargetInput } from './producer-types.js';
export interface AssistantPromotionIntent {
    candidateId: string;
    runId: string;
    revision: number;
    source: 'user';
    state: 'accepting' | 'accepted';
    target: AssistantPromotionTargetInput;
    targetRef: string | null;
    createdAt: number;
    updatedAt: number;
}
/** Durable user intent, never a current verification capability. */
export declare function parseAssistantPromotionIntent(raw: unknown): Readonly<AssistantPromotionIntent>;

import type { Message } from '../../types.js';
import type { StrictKimiK3ProfileId } from '../providers/kimi-models.js';
export type { StrictKimiK3ProfileId } from '../providers/kimi-models.js';
export declare function computeEphemeralProviderTranscriptDigest(input: {
    surfaceKind: 'desktop-task' | 'cli-subagent' | 'cli-compaction' | 'cli-chat-task' | 'stateless-fresh-side-call';
    invocationId: string;
    providerConversationProfileId: StrictKimiK3ProfileId;
    messages: readonly Message[];
}): `sha256:${string}`;

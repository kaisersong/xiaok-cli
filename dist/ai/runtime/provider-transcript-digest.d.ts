import type { Message } from '../../types.js';
export type StrictKimiK3ProfileId = 'kimi-k3-coding-openai' | 'kimi-k3-256k-coding-openai';
export declare function computeEphemeralProviderTranscriptDigest(input: {
    surfaceKind: 'desktop-task' | 'cli-subagent' | 'cli-compaction' | 'cli-chat-task' | 'stateless-fresh-side-call';
    invocationId: string;
    providerConversationProfileId: StrictKimiK3ProfileId;
    messages: readonly Message[];
}): `sha256:${string}`;

import type { Message, ModelAdapter } from '../../types.js';
import type { StreamOptions } from './model-capabilities.js';
import type { StreamChunk, ToolDefinition } from '../../types.js';
type StreamCapableAdapter = Pick<ModelAdapter, 'stream'>;
export interface ProviderConversationAuthorization {
    readonly opaqueAuthorization: never;
}
export type ProviderConversationSurfaceKind = 'desktop-task' | 'cli-subagent' | 'cli-compaction' | 'cli-chat-task' | 'stateless-fresh-side-call';
export interface ProviderConversationAuthorizationReservation {
    readonly opaqueReservation: never;
}
interface ProviderConversationStreamInput {
    adapter: StreamCapableAdapter;
    messages: Message[];
    tools: ToolDefinition[];
    systemPrompt: string;
    options?: StreamOptions;
    invocationId: string;
}
export declare function streamCliChatTaskProviderConversation(input: ProviderConversationStreamInput): AsyncIterable<StreamChunk>;
export declare function streamCliSubagentProviderConversation(input: ProviderConversationStreamInput): AsyncIterable<StreamChunk>;
export declare function streamCliCompactionProviderConversation(input: ProviderConversationStreamInput): AsyncIterable<StreamChunk>;
export declare function streamDesktopTaskProviderConversation(input: ProviderConversationStreamInput): AsyncIterable<StreamChunk>;
export declare function streamStatelessSideCallProviderConversation(input: ProviderConversationStreamInput): AsyncIterable<StreamChunk>;
export declare function reserveProviderConversationAuthorization(input: {
    authorization: ProviderConversationAuthorization | undefined;
    adapter: StreamCapableAdapter;
    messages: readonly Message[];
}): ProviderConversationAuthorizationReservation;
export declare function consumeProviderConversationAuthorization(input: {
    reservation: ProviderConversationAuthorizationReservation;
    adapter: StreamCapableAdapter;
    messages: readonly Message[];
}): void;
export declare function verifyConsumedProviderConversationAuthorizationForRetry(input: {
    reservation: ProviderConversationAuthorizationReservation;
    adapter: StreamCapableAdapter;
    messages: readonly Message[];
}): void;
export {};

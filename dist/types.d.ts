import type { MessageBlock } from './ai/runtime/blocks.js';
import type { UsageStats } from './ai/runtime/usage.js';
import type { RuntimeEvent } from './runtime/events.js';
export type { MessageBlock, UsageStats };
export interface ModelAdapter {
    stream(messages: Message[], tools: ToolDefinition[], systemPrompt: string): AsyncIterable<StreamChunk>;
}
export type StreamChunk = {
    type: 'text';
    delta: string;
} | {
    type: 'tool_use';
    id: string;
    name: string;
    input: Record<string, unknown>;
} | {
    type: 'usage';
    usage: UsageStats;
} | {
    type: 'done';
};
export type ToolCall = Extract<MessageBlock, {
    type: 'tool_use';
}>;
export interface Message {
    role: 'user' | 'assistant';
    content: MessageBlock[];
}
export type ToolResultContent = Extract<MessageBlock, {
    type: 'tool_result';
}>;
export interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}
export type PermissionClass = 'safe' | 'write' | 'bash';
export interface Tool {
    definition: ToolDefinition;
    permission: PermissionClass;
    execute(input: Record<string, unknown>): Promise<string>;
}
export interface RuntimeHookSink {
    emit(event: RuntimeEvent): void;
}
export interface Credentials {
    schemaVersion: 1;
    accessToken: string;
    refreshToken: string;
    enterpriseId: string;
    userId: string;
    expiresAt: string;
}
export interface Config {
    schemaVersion: 1;
    defaultModel: 'claude' | 'openai' | 'custom';
    models: {
        claude?: {
            model: string;
            apiKey?: string;
            baseUrl?: string;
        };
        openai?: {
            model: string;
            apiKey?: string;
        };
        custom?: {
            baseUrl: string;
            apiKey?: string;
            model?: string;
        };
    };
    devApp?: {
        appKey: string;
        appSecret: string;
    };
    defaultMode: 'interactive';
    contextBudget: number;
}
export declare const DEFAULT_CONFIG: Config;
/** 校验 defaultModel 是否合法，防止脏数据写入 */
export declare function isValidProvider(v: unknown): v is Config['defaultModel'];

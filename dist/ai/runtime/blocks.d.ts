type CacheControl = {
    type: 'ephemeral';
};
export type TextBlock = {
    type: 'text';
    text: string;
    cache_control?: CacheControl;
};
export type ImageBlock = {
    type: 'image';
    source: {
        type: 'base64';
        media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
        data: string;
    };
    cache_control?: CacheControl;
};
export type ToolUseBlock = {
    type: 'tool_use';
    id: string;
    name: string;
    input: Record<string, unknown>;
    cache_control?: CacheControl;
};
export type ToolResultBlock = {
    type: 'tool_result';
    tool_use_id: string;
    content: string;
    is_error?: boolean;
    cache_control?: CacheControl;
};
export type ReasoningSource = 'reasoning_content' | 'reasoning' | 'reasoning_details' | 'reasoning_text' | 'thinking' | 'thought' | 'raw_think_tag' | 'synthetic';
export type ReasoningBlockProvenance = {
    captureVersion: 1;
    source: ReasoningSource;
    fieldPresence: 'present';
};
export type ThinkingBlock = {
    type: 'thinking';
    thinking: string;
    reasoningSource?: ReasoningSource;
    reasoningProvenance?: ReasoningBlockProvenance;
    cache_control?: CacheControl;
};
export type MessageBlock = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock;
export {};

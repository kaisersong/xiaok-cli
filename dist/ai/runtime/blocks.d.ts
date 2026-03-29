export type TextBlock = {
    type: 'text';
    text: string;
};
export type ToolUseBlock = {
    type: 'tool_use';
    id: string;
    name: string;
    input: Record<string, unknown>;
};
export type ToolResultBlock = {
    type: 'tool_result';
    tool_use_id: string;
    content: string;
    is_error?: boolean;
};
export type ThinkingBlock = {
    type: 'thinking';
    thinking: string;
};
export type MessageBlock = TextBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock;

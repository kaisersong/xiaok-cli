export interface PromptSegment {
    key: 'core_identity' | 'session_context' | 'skills' | 'tool_policy' | 'channel_hints' | 'project_context' | 'memory_summary' | 'model_hints';
    title: string;
    text: string;
    cacheable: boolean;
}
export interface PromptSnapshot {
    id: string;
    createdAt: number;
    cwd: string;
    channel: 'chat' | 'yzj';
    rendered: string;
    segments: PromptSegment[];
    memoryRefs: string[];
}

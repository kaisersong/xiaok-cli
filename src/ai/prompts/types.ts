export type PromptSegmentKind =
  | 'system_rule'
  | 'background_context'
  | 'derived_summary'
  | 'user_input';

export interface PromptSegment {
  key:
    | 'static_identity'
    | 'dynamic_context'
    | 'workspace_context'
    | 'core_identity'
    | 'session_context'
    | 'skills'
    | 'tool_policy'
    | 'channel_hints'
    | 'project_context'
    | 'memory_summary'
    | 'model_hints';
  title: string;
  text: string;
  cacheable: boolean;
  kind: PromptSegmentKind;
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

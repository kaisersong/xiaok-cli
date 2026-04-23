export type RuntimeEvent = {
    type: 'turn_started';
    sessionId: string;
    turnId: string;
} | {
    type: 'turn_completed';
    sessionId: string;
    turnId: string;
} | {
    type: 'turn_failed';
    sessionId: string;
    turnId: string;
    error: Error;
} | {
    type: 'turn_aborted';
    sessionId: string;
    turnId: string;
} | {
    type: 'intent_created';
    sessionId: string;
    turnId: string;
    intentId: string;
    templateId: string;
    deliverable: string;
    riskTier: 'low' | 'medium' | 'high';
} | {
    type: 'stage_activated';
    sessionId: string;
    turnId: string;
    intentId: string;
    stageId: string;
    label: string;
    order: number;
    totalStages: number;
} | {
    type: 'step_activated';
    sessionId: string;
    turnId: string;
    intentId: string;
    stepId: string;
} | {
    type: 'artifact_recorded';
    sessionId: string;
    turnId: string;
    intentId: string;
    stageId: string;
    artifactId: string;
    label: string;
    kind: string;
    path?: string;
} | {
    type: 'breadcrumb_emitted';
    sessionId: string;
    turnId: string;
    intentId: string;
    stepId: string;
    status: 'running' | 'blocked' | 'completed' | 'failed';
    message: string;
} | {
    type: 'receipt_emitted';
    sessionId: string;
    turnId: string;
    intentId: string;
    stepId: string;
    note: string;
} | {
    type: 'salvage_emitted';
    sessionId: string;
    turnId: string;
    intentId: string;
    summary: string[];
    reason?: string;
} | {
    type: 'approval_required';
    sessionId: string;
    turnId: string;
    approvalId: string;
} | {
    type: 'tool_started';
    sessionId: string;
    turnId: string;
    toolName: string;
    toolInput: Record<string, unknown>;
} | {
    type: 'tool_finished';
    sessionId: string;
    turnId: string;
    toolName: string;
    ok: boolean;
} | {
    type: 'compact_triggered';
    sessionId: string;
    turnId: string;
} | {
    type: 'pre_tool_use';
    sessionId: string;
    turnId: string;
    toolName: string;
    toolInput: Record<string, unknown>;
    toolUseId: string;
} | {
    type: 'post_tool_use';
    sessionId: string;
    turnId: string;
    toolName: string;
    toolInput: Record<string, unknown>;
    toolResponse: unknown;
    toolUseId: string;
} | {
    type: 'post_tool_use_failure';
    sessionId: string;
    turnId: string;
    toolName: string;
    toolInput: Record<string, unknown>;
    toolUseId: string;
    error: string;
    isInterrupt?: boolean;
} | {
    type: 'permission_request';
    sessionId: string;
    turnId: string;
    toolName: string;
    toolInput: Record<string, unknown>;
} | {
    type: 'permission_denied';
    sessionId: string;
    turnId: string;
    toolName: string;
    toolInput: Record<string, unknown>;
    toolUseId: string;
    reason: string;
} | {
    type: 'notification';
    sessionId: string;
    message: string;
    title?: string;
    notificationType: string;
} | {
    type: 'user_prompt_submit';
    sessionId: string;
    prompt: string;
} | {
    type: 'session_start';
    sessionId: string;
    source: 'startup' | 'resume' | 'clear' | 'compact';
    agentType?: string;
    model?: string;
} | {
    type: 'session_end';
    sessionId: string;
    reason: string;
} | {
    type: 'stop';
    sessionId: string;
    stopHookActive: boolean;
    lastAssistantMessage?: string;
} | {
    type: 'stop_failure';
    sessionId: string;
    error: string;
    errorDetails?: string;
    lastAssistantMessage?: string;
} | {
    type: 'subagent_start';
    sessionId: string;
    agentId: string;
    agentType: string;
} | {
    type: 'subagent_stop';
    sessionId: string;
    agentId: string;
    agentType: string;
    stopHookActive: boolean;
    agentTranscriptPath: string;
    lastAssistantMessage?: string;
} | {
    type: 'pre_compact';
    sessionId: string;
    trigger: 'manual' | 'auto';
    customInstructions: string | null;
} | {
    type: 'post_compact';
    sessionId: string;
    trigger: 'manual' | 'auto';
    compactSummary: string;
} | {
    type: 'setup';
    sessionId: string;
    trigger: 'init' | 'maintenance';
} | {
    type: 'worktree_create';
    sessionId: string;
    name: string;
} | {
    type: 'worktree_remove';
    sessionId: string;
    worktreePath: string;
} | {
    type: 'file_changed';
    sessionId: string;
    filePath: string;
    event: 'change' | 'add' | 'unlink';
};

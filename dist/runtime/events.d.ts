export type RuntimeEvent = {
    type: 'turn_started';
    sessionId: string;
    turnId: string;
} | {
    type: 'turn_completed';
    sessionId: string;
    turnId: string;
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
};

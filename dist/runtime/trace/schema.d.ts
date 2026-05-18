export type TraceSourceApp = 'xiaok-cli' | 'xiaok-desktop' | 'kswarm';
export type TraceScopeKind = 'session' | 'project' | 'task';
export type TraceEventSource = 'cli' | 'desktop' | 'kswarm' | 'tool' | 'memory' | 'skill' | 'guard' | 'diagnoser';
export type TraceSeverity = 'debug' | 'info' | 'warn' | 'error';
export interface TraceEvent {
    id: string;
    ts: string;
    source: TraceEventSource;
    type: string;
    severity?: TraceSeverity;
    message?: string;
    refs?: {
        turnId?: string;
        toolCallId?: string;
        taskId?: string;
        agentId?: string;
        artifactId?: string;
        memoryId?: string;
    };
    data?: Record<string, unknown>;
}
export interface TraceToolCall {
    id: string;
    turnId?: string;
    name: string;
    inputPreview: string;
    redactedInputSha256?: string;
    outputPreview?: string;
    redactedOutputSha256?: string;
    outputBytes?: number;
    persistedOutputPath?: string;
    startedAt: string;
    endedAt?: string;
    ok?: boolean;
    errorClass?: string;
    permission?: 'safe' | 'requires_approval' | 'denied';
}
export interface TraceTask {
    id: string;
    title: string;
    status: string;
    assignedAgent?: string;
    dependencies?: string[];
    phase?: string | number;
    dispatchState?: string;
    failureClass?: string;
    failureCount?: number;
    blockedReason?: string;
    evidenceContract?: string;
    artifacts?: string[];
}
export interface TraceAgent {
    id: string;
    name?: string;
    status: string;
    currentTask?: string;
}
export interface TraceArtifact {
    id: string;
    path: string;
    kind?: string;
    bytes?: number;
    sha256?: string;
    createdBy?: {
        toolCallId?: string;
        taskId?: string;
        agentId?: string;
    };
    existsAtExport: boolean;
    protected?: boolean;
}
export interface TraceRedaction {
    type: string;
    fieldPath?: string;
    count: number;
}
export interface TraceBundleV1 {
    schemaVersion: 1;
    bundleId: string;
    createdAt: string;
    source: {
        app: TraceSourceApp;
        version?: string;
        platform?: string;
        command?: string;
    };
    scope: {
        kind: TraceScopeKind;
        sessionId?: string;
        projectId?: string;
        taskId?: string;
        workspaceRoot?: string;
    };
    environment: Record<string, unknown>;
    turns: Array<{
        id: string;
        role?: string;
        ts?: string;
    }>;
    events: TraceEvent[];
    toolCalls: TraceToolCall[];
    approvals: Array<Record<string, unknown>>;
    tasks: TraceTask[];
    agents: TraceAgent[];
    artifacts: TraceArtifact[];
    memoryRefs: Array<Record<string, unknown>>;
    skillEvidence: Array<Record<string, unknown>>;
    recovery: Array<Record<string, unknown>>;
    crashes: Array<Record<string, unknown>>;
    redactions: TraceRedaction[];
    attachments: Array<Record<string, unknown>>;
    summary: Record<string, unknown>;
}
export declare function validateTraceBundle(input: unknown): {
    ok: true;
} | {
    ok: false;
    errors: string[];
};
export declare function isRecord(value: unknown): value is Record<string, unknown>;
